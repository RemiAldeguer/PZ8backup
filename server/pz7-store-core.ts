import type { SqliteSync } from './sqlite-sync.ts';
import type { Records, StoreLike, Table } from './contracts.ts';
import { TABLES } from './contracts.ts';
import { PZ7_EXTRA_TABLES, readPz7Extra, putPz7Extra, removePz7Extra, type ExtraReferences, type Pz7ExtraTable } from './pz7-extra.ts';

/** PZ7's UUIDs are authoritative. Identity JSON contains only PZ8 compatibility fields.
 * Unsupported native mutations fail closed, never leaving a sidecar-only phantom record.
 * This adapter does not create or migrate databases. */
const NATIVE = {
  zones: 'pz_zone', projects: 'pz_project', tasks: 'pz_task', resources: 'pz_resource',
  profiles: 'pz_cost_profile', timeEntries: 'pz_time_record', comments: 'pz_comment',
  expenses: 'pz_expense', taskLists: 'pz_activity',
} as const;
type NativeTable = keyof typeof NATIVE;
type Row = Record<string, unknown>;
type Identity = { entity: string; id: string; uuid: string; data: string; position: number };
const statuses: Record<string, string> = { pz_candidate: 'requested', pz_open: 'open', pz_closed: 'closed', pz_paused: 'paused' };
const taskStatuses: Record<string, string> = { pr_todo: 'todo', pr_in_progress: 'in_progress', pr_done: 'done', pr_ready: 'ready', pr_validation: 'validation' };
const roles: Record<string, string> = { pz_admin: 'administrator', pz_under_admin: 'project_creator', pz_user: 'user', pz_visitor: 'visitor' };
const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export class Pz7StoreCore implements StoreLike {
  private depth = 0;
  constructor(readonly db: SqliteSync) {
    try {
      const names = new Set((this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(row => row.name));
      for (const name of ['pz8_identity', 'pz_zone', 'pz_project', 'pz_activity', 'pz_task', 'pz_milestone', 'pz_resource', 'pz_cost_profile', 'pz_time_record', 'pz_comment', 'pz_expense']) {
        if (!names.has(name)) throw new Error(`Not a prepared PZ7 runtime database: missing ${name}`);
      }
      if (names.has('projects') || names.has('tasks')) throw new Error('Legacy PZ8 database refused');
      const columns = new Set((this.db.prepare('PRAGMA table_info(pz8_identity)').all() as { name: string }[]).map(row => row.name));
      if (!['entity', 'id', 'uuid', 'data', 'position'].every(column => columns.has(column))) throw new Error('Invalid pz8_identity schema');
      if ((this.db.prepare("SELECT 1 FROM pragma_table_info('pz_time_record') WHERE name='recording_day'").get())) throw new Error('PZ7 runtime has deprecated recording_day');
      this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS pz8_membership_ownership (
          member_uuid TEXT PRIMARY KEY REFERENCES pz_project_member(uuid) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS pz8_unit_memberships (
          unit_uuid TEXT NOT NULL REFERENCES pz_organizational_unit(uuid) ON DELETE CASCADE,
          resource_uuid TEXT NOT NULL REFERENCES pz_resource(uuid) ON DELETE RESTRICT,
          position INTEGER NOT NULL,
          PRIMARY KEY(unit_uuid,resource_uuid));`);
      if (!names.has('pz8_membership_ownership'))
        this.db.exec('INSERT INTO pz8_membership_ownership(member_uuid) SELECT uuid FROM pz_project_member');
    } catch (error) { this.db.close(); throw error; }
  }
  private lookup(entity: Table, id: string): Identity | undefined {
    return this.db.prepare('SELECT * FROM pz8_identity WHERE entity=? AND id=?').get(entity, id) as Identity | undefined;
  }
  private id(entity: Table, uuid: unknown): string | null {
    if (uuid == null) return null;
    const row = this.db.prepare('SELECT id FROM pz8_identity WHERE entity=? AND uuid=?').get(entity, uuid as string) as { id: string } | undefined;
    if (!row) throw new Error(`Unmapped ${entity} UUID: ${String(uuid)}`);
    return row.id;
  }
  private optionalId(entity: Table, uuid: unknown): string | null {
    if (uuid == null) return null;
    const row = this.db.prepare('SELECT id FROM pz8_identity WHERE entity=? AND uuid=?').get(entity, uuid as string) as { id: string } | undefined;
    return row?.id ?? null;
  }
  private uuid(entity: Table, id: unknown): string | null {
    if (id == null || id === '') return null;
    const row = this.lookup(entity, String(id));
    if (!row) throw new Error(`Unknown ${entity} id: ${String(id)}`);
    return row.uuid;
  }
  private one(sql: string, ...args: (string | number | null)[]): Row | undefined {
    return this.db.prepare(sql).get(...args as (string | number | null)[]) as Row | undefined;
  }
  private extraRefs(): ExtraReferences {
    return {
      uuid: (entity, id) => {
        const value = this.uuid(entity, id);
        if (!value) throw new Error(`Missing PZ7 reference ${entity}/${id}`);
        return value;
      },
      id: (entity, uuid) => {
        const value = this.id(entity, uuid);
        if (!value) throw new Error(`Missing PZ8 identity ${entity}/${uuid}`);
        return value;
      },
      workspace: () => this.workspace(),
    };
  }
  private materialize<K extends Table>(table: K, identity: Identity): Records[K] {
    const base = JSON.parse(identity.data) as Row;
    if (PZ7_EXTRA_TABLES.includes(table as Pz7ExtraTable))
      return readPz7Extra(this.db, table as Pz7ExtraTable, identity, this.extraRefs()) as Records[K];
    if (!(table in NATIVE)) return base as unknown as Records[K];
    const native = NATIVE[table as NativeTable];
    const row = this.one(`SELECT * FROM ${native === 'pz_task' ? (base.kind === 'milestone' ? 'pz_milestone' : 'pz_task') : native} WHERE uuid=?`, identity.uuid);
    if (!row) throw new Error(`Dangling PZ7 identity: ${table}/${identity.id}`);
    const result: Row = { ...base, id: identity.id };
    switch (table) {
      case 'zones': Object.assign(result, { name: row.name, color: row.color }); break;
      case 'profiles': {
        const history = this.one('SELECT cost FROM pz_cost_profile_history WHERE cost_profile_uuid=? ORDER BY start_date DESC, rowid DESC LIMIT 1', identity.uuid);
        Object.assign(result, { name: row.name, dailyRate: history?.cost ?? base.dailyRate }); break;
      }
      case 'projects': {
        const status = this.one('SELECT label FROM pz_project_status WHERE uuid=?', row.status_uuid as string);
        const root = row.activity_root_uuid ? this.one('SELECT start_date,end_date FROM pz_activity WHERE uuid=?', row.activity_root_uuid as string) : undefined;
        Object.assign(result, { name: row.name, description: row.description, color: row.color,
          budget: row.allocated_budget, zoneId: this.id('zones', row.zone_uuid),
          status: status ? (statuses[String(status.label)] ?? base.status) : base.status,
          startDate: root?.start_date ?? base.startDate, endDate: root?.end_date ?? base.endDate });
        if (row.integrated_at != null || 'timeIntegrationDate' in base) result.timeIntegrationDate = row.integrated_at ?? null;
        if ('customStatusId' in base || this.optionalId('projectStatusDefinitions', row.status_uuid))
          result.customStatusId = this.optionalId('projectStatusDefinitions', row.status_uuid);
        {
          const roleNames: Record<string, string> = { pr_manager: 'manager', pr_worker: 'collaborator', pr_visitor: 'observer' };
          const explicit: Record<string, string> = {};
          for (const resourceId of Object.keys((base.projectRoles ?? {}) as Record<string, string>)) {
            const resourceUuid = this.uuid('resources', resourceId);
            const member = this.one(`SELECT role.name FROM pz_project_member member JOIN pz_role role ON role.uuid=member.role_uuid
              WHERE member.project_uuid=? AND member.member_uuid=?`, identity.uuid, resourceUuid);
            if (member && roleNames[String(member.name)]) explicit[resourceId] = roleNames[String(member.name)];
          }
          for (const member of this.db.prepare(`SELECT member.member_uuid,role.name FROM pz_project_member member
            JOIN pz_role role ON role.uuid=member.role_uuid
            WHERE member.project_uuid=? AND NOT EXISTS (
              SELECT 1 FROM pz8_membership_ownership owned WHERE owned.member_uuid=member.uuid)`).all(identity.uuid) as { member_uuid: string; name: string }[]) {
            const resourceId = this.optionalId('resources', member.member_uuid);
            if (resourceId && roleNames[member.name]) explicit[resourceId] = roleNames[member.name];
          }
          if ('projectRoles' in base || Object.keys(explicit).length) result.projectRoles = explicit;
        }
        break;
      }
      case 'taskLists': Object.assign(result, { name: row.name,
        projectId: this.id('projects', row.project_uuid), parentId: this.optionalId('taskLists', row.activity_parent_uuid) });
        if (row.activity_key_rank != null || 'position' in base) result.position = row.activity_key_rank ?? undefined;
        break;
      case 'tasks': {
        const activity = this.one('SELECT project_uuid,activity_parent_uuid,name FROM pz_activity WHERE uuid=?', row.activity_uuid as string);
        if (!activity) throw new Error(`Missing PZ7 activity for task ${identity.id}`);
        const list = this.optionalId('taskLists', row.activity_uuid);
        const status = table === 'tasks' && base.kind !== 'milestone' && row.status_uuid ? this.one('SELECT label FROM pz_status WHERE uuid=?', row.status_uuid as string) : undefined;
        const allocation = base.kind === 'milestone' ? undefined : this.one('SELECT resource_uuid,allocated_hours FROM pz_allocation WHERE task_uuid=? ORDER BY rowid LIMIT 1', identity.uuid);
        Object.assign(result, { title: row.name, description: row.description, endDate: row.end_date,
          projectId: this.id('projects', activity.project_uuid),
          phase: list ? base.phase : (activity.activity_parent_uuid ? activity.name : base.phase),
          status: base.kind === 'milestone' ? (row.state ? 'done' : base.status === 'done' ? 'todo' : base.status) : (status ? taskStatuses[String(status.label)] ?? base.status : base.status) });
        if (list || 'listId' in base) result.listId = list;
        const rank = row[base.kind === 'milestone' ? 'key_rank' : 'activity_key_rank'];
        if (rank != null || 'position' in base) result.position = rank ?? undefined;
        if (base.kind !== 'milestone') Object.assign(result, { startDate: row.start_date, progress: row.percent_complete ?? base.progress,
          assigneeId: allocation ? this.id('resources', allocation.resource_uuid) : null, allocatedHours: allocation?.allocated_hours ?? 0 });
        const nativeKind = base.kind === 'milestone' ? 'pz_milestone_tags' : 'pz_task_tags';
        const key = base.kind === 'milestone' ? 'milestone_uuid' : 'task_uuid';
        result.tags = (this.db.prepare(`SELECT tags FROM ${nativeKind} WHERE ${key}=? ORDER BY rowid`).all(identity.uuid) as { tags: string }[]).map(tag => tag.tags);
        const predecessor = this.one('SELECT origin_entity_uuid FROM pz_constraint WHERE target_entity_uuid=? ORDER BY rowid LIMIT 1', identity.uuid);
        result.dependsOnId = predecessor ? this.id('tasks', predecessor.origin_entity_uuid) : null;
        break;
      }
      case 'resources': {
        const calendar = row.weekly_calendar_uuid ? this.one('SELECT * FROM pz_weekly_calendar WHERE uuid=?', row.weekly_calendar_uuid as string) : undefined;
        const week = calendar ? weekdays.map(day => calendar[`${day}_hours`]) : undefined;
        const role = row.role_uuid ? this.one('SELECT name FROM pz_role WHERE uuid=?', row.role_uuid as string) : undefined;
        Object.assign(result, { name: row.name, jobTitle: row.profession, description: row.description,
          type: ({ 0: 'virtual', 1: 'human', 2: 'material' } as Record<number, string>)[Number(row.type)] ?? base.type,
          active: !row.deactivated, profileId: this.id('profiles', row.cost_profile_uuid),
          role: role ? roles[String(role.name)] ?? base.role : base.role });
        if (row.manager_uuid != null || 'managerId' in base) result.managerId = this.id('resources', row.manager_uuid);
        if (row.integrated_at != null || 'timeIntegrationDate' in base) result.timeIntegrationDate = row.integrated_at ?? null;
        if (week) Object.assign(result, { weeklyCapacityHours: week, mondayHours: week[0], dailyHours: week[1] });
        break;
      }
      case 'timeEntries': Object.assign(result, { taskId: this.id('tasks', row.task_uuid), resourceId: this.id('resources', row.resource_uuid),
        date: row.recording_date, hours: row.time_spent }); break;
      case 'comments': {
        const discussion = this.one('SELECT project_uuid,entity_type,entity_uuid FROM pz_discussion WHERE uuid=?', row.discussion_uuid as string);
        if (!discussion) throw new Error(`Missing discussion for comment ${identity.id}`);
        const taskId = Number(discussion.entity_type) === 1 || Number(discussion.entity_type) === 2 ? this.id('tasks', discussion.entity_uuid) : null;
        const mentions = this.db.prepare('SELECT recipients_uuid FROM pz_comment_resource WHERE comment_uuid=? ORDER BY rowid').all(identity.uuid) as { recipients_uuid: string }[];
        Object.assign(result, { body: row.content, taskId, createdAt: row.created_date });
        if (row.author_uuid != null || 'authorId' in base) result.authorId = this.id('resources', row.author_uuid) ?? undefined;
        if ('projectId' in base || !taskId) result.projectId = this.id('projects', discussion.project_uuid);
        if (row.last_modified != null || 'updatedAt' in base) result.updatedAt = row.last_modified ?? undefined;
        if (mentions.length || 'mentionResourceIds' in base) result.mentionResourceIds = mentions.map(m => this.id('resources', m.recipients_uuid));
        break;
      }
      case 'expenses': {
        const kind = row.expense_type_uuid ? this.one('SELECT name FROM pz_expense_type WHERE uuid=?', row.expense_type_uuid as string) : undefined;
        Object.assign(result, { projectId: this.id('projects', row.project_uuid), label: row.name,
          amount: Number(row.quantity) * Number(row.unit_amount), plannedDate: row.planned_date,
          paidDate: row.actual_date, category: kind?.name ?? base.category }); break;
      }
    }
    return result as unknown as Records[K];
  }
  all<K extends Table>(table: K): Records[K][] {
    if (!TABLES.includes(table)) throw new Error(`Unknown collection: ${table}`);
    return (this.db.prepare('SELECT * FROM pz8_identity WHERE entity=? ORDER BY position,rowid').all(table) as Identity[]).map(row => this.materialize(table, row));
  }
  get<K extends Table>(table: K, id: string): Records[K] | undefined {
    if (!TABLES.includes(table)) throw new Error(`Unknown collection: ${table}`);
    const row = this.lookup(table, id);
    return row && this.materialize(table, row);
  }
  private upsert(table: string, uuid: string, columns: Row): void {
    const keys = Object.keys(columns);
    const sql = `INSERT INTO ${table} (uuid,${keys.join(',')}) VALUES (${Array(keys.length + 1).fill('?').join(',')}) ON CONFLICT(uuid) DO UPDATE SET ${keys.map(key => `${key}=excluded.${key}`).join(',')}`;
    this.db.prepare(sql).run(uuid, ...keys.map(key => columns[key] as string | number | null));
  }
  private nativePut(table: NativeTable, value: Row, uuid: string, prior?: Identity): void {
    switch (table) {
      case 'zones': this.upsert('pz_zone', uuid, { planzone_uuid: this.workspace(), name: value.name, color: value.color, saving_templates: 0 }); break;
      case 'profiles': {
        this.upsert('pz_cost_profile', uuid, { planzone_uuid: this.workspace(), name: value.name });
        const histories = this.db.prepare('SELECT uuid FROM pz_cost_profile_history WHERE cost_profile_uuid=? ORDER BY start_date DESC,rowid DESC').all(uuid) as { uuid: string }[];
        if (histories.length > 1) throw new Error('PZ7 cost profile has historical rates; PZ8 cannot safely update it');
        this.upsert('pz_cost_profile_history', histories[0]?.uuid ?? crypto.randomUUID(), { cost_profile_uuid: uuid, cost: value.dailyRate });
        break;
      }
      case 'resources': {
        const current = prior && this.one('SELECT weekly_calendar_uuid,invitation_accepted,affiliation FROM pz_resource WHERE uuid=?', uuid);
        const calendarId = current?.weekly_calendar_uuid as string | undefined ?? crypto.randomUUID();
        const weekly = value.weeklyCapacityHours as number[] | undefined;
        if (weekly && weekly.length !== 7) throw new Error('Invalid PZ7 weekly capacity');
        const hours = weekly ?? [value.mondayHours, value.dailyHours, value.dailyHours, value.dailyHours, value.dailyHours, 0, 0];
        this.upsert('pz_weekly_calendar', calendarId, Object.fromEntries(weekdays.map((day, i) => [`${day}_hours`, hours[i]])));
        const roleName: Record<string, string> = { administrator: 'pz_admin', project_creator: 'pz_under_admin', user: 'pz_user', visitor: 'pz_visitor' };
        const role = this.one('SELECT uuid FROM pz_role WHERE name=?', roleName[String(value.role ?? (value.id === 'resource-claire' ? 'administrator' : 'user'))] ?? '');
        if (!role) throw new Error(`Unknown PZ7 resource role: ${String(value.role)}`);
        const kind: Record<string, number> = { virtual: 0, human: 1, material: 2 };
        if (!(String(value.type) in kind)) throw new Error(`Unknown PZ7 resource type: ${String(value.type)}`);
        this.upsert('pz_resource', uuid, { planzone_uuid: this.workspace(), name: value.name,
          profession: value.jobTitle, description: value.description ?? null, type: kind[String(value.type)],
          invitation_accepted: current?.invitation_accepted ?? 0, affiliation: current?.affiliation ?? null,
          deactivated: value.active ? 0 : 1, weekly_calendar_uuid: calendarId,
          cost_profile_uuid: this.uuid('profiles', value.profileId), role_uuid: role.uuid,
          manager_uuid: this.uuid('resources', value.managerId), integrated_at: value.timeIntegrationDate ?? null });
        break;
      }
      case 'projects': {
        const statusName: Record<string, string> = { requested: 'pz_candidate', open: 'pz_open', closed: 'pz_closed', paused: 'pz_paused' };
        const label = statusName[String(value.status)];
        const status = value.customStatusId
          ? { uuid: this.uuid('projectStatusDefinitions', value.customStatusId) }
          : (label ? this.one('SELECT uuid FROM pz_project_status WHERE label=? AND planzone_uuid=?', label, this.workspace()) : undefined);
        if (!status?.uuid) throw new Error(`Unknown PZ7 project status: ${String(value.status)}`);
        const existing = prior && this.one('SELECT activity_root_uuid FROM pz_project WHERE uuid=?', uuid);
        const root = existing?.activity_root_uuid as string | undefined ?? crypto.randomUUID();
        this.upsert('pz_project', uuid, { zone_uuid: this.uuid('zones', value.zoneId), name: value.name,
          description: value.description, color: value.color, status_uuid: status.uuid,
          allocated_budget: value.budget, template: existing ? this.one('SELECT template FROM pz_project WHERE uuid=?', uuid)!.template : 0,
          allocated_expenses_budget: existing ? this.one('SELECT allocated_expenses_budget FROM pz_project WHERE uuid=?', uuid)!.allocated_expenses_budget : 0,
          allocated_resources_budget: existing ? this.one('SELECT allocated_resources_budget FROM pz_project WHERE uuid=?', uuid)!.allocated_resources_budget : 0,
          integrated_at: value.timeIntegrationDate ?? null });
        this.upsert('pz_activity', root, { project_uuid: uuid, name: value.name, start_date: value.startDate, end_date: value.endDate });
        this.db.prepare('UPDATE pz_project SET activity_root_uuid=? WHERE uuid=?').run(root, uuid);
        break;
      }
      case 'tasks': {
        const projectUuid = this.uuid('projects', value.projectId)!;
        const project = this.one('SELECT activity_root_uuid FROM pz_project WHERE uuid=?', projectUuid);
        if (!project?.activity_root_uuid) throw new Error('Task project has no PZ7 root activity');
        const old = prior && JSON.parse(prior.data) as Row | undefined;
        if (old && (old.kind ?? 'task') !== value.kind) throw new Error('Changing a PZ7 task into a milestone is unsupported');
        if (value.kind !== 'task' && value.kind !== 'milestone') throw new Error('Invalid PZ7 task kind');
        let activity = this.uuid('taskLists', value.listId);
        if (activity && this.get('taskLists', value.listId as string)?.projectId !== value.projectId) throw new Error('Cross-project task list');
        if (!activity && value.phase) {
          const phase = this.one(`SELECT uuid FROM pz_activity a WHERE project_uuid=? AND activity_parent_uuid=? AND name=?
            AND NOT EXISTS (SELECT 1 FROM pz8_identity i WHERE i.entity='taskLists' AND i.uuid=a.uuid)
            ORDER BY a.rowid LIMIT 1`, projectUuid, project.activity_root_uuid as string, value.phase as string);
          activity = phase?.uuid as string | undefined ?? crypto.randomUUID();
          if (!phase) this.upsert('pz_activity', activity, { project_uuid: projectUuid, activity_parent_uuid: project.activity_root_uuid, name: value.phase });
        }
        activity ??= project.activity_root_uuid as string;
        const milestone = value.kind === 'milestone';
        if (milestone) this.upsert('pz_milestone', uuid, { activity_uuid: activity, name: value.title, description: value.description,
          end_date: value.endDate, state: value.status === 'done' ? 1 : 0, key_rank: value.position ?? null });
        else {
          const statusName = `pr_${String(value.status)}`;
          const status = this.one('SELECT uuid FROM pz_status WHERE label=? AND (project_uuid=? OR project_uuid IS NULL) ORDER BY project_uuid DESC LIMIT 1', statusName, projectUuid);
          if (!status) throw new Error(`Unknown PZ7 task status: ${String(value.status)}`);
          this.upsert('pz_task', uuid, { activity_uuid: activity, name: value.title, description: value.description,
            start_date: value.startDate, end_date: value.endDate, percent_complete: value.progress,
            status_uuid: status.uuid, activity_key_rank: value.position ?? null });
          const allocations = this.db.prepare('SELECT uuid FROM pz_allocation WHERE task_uuid=? ORDER BY rowid').all(uuid) as { uuid: string }[];
          if (allocations.length > 1) throw new Error('PZ7 task has multiple allocations; PZ8 cannot safely edit it');
          const allocation = allocations[0];
          if (value.assigneeId) this.upsert('pz_allocation', allocation?.uuid as string ?? crypto.randomUUID(), {
            task_uuid: uuid, resource_uuid: this.uuid('resources', value.assigneeId),
            allocated_hours: value.allocatedHours, percent_complete: value.progress });
          else this.db.prepare('DELETE FROM pz_allocation WHERE task_uuid=?').run(uuid);
        }
        const tagsTable = milestone ? 'pz_milestone_tags' : 'pz_task_tags';
        const column = milestone ? 'milestone_uuid' : 'task_uuid';
        this.db.prepare(`DELETE FROM ${tagsTable} WHERE ${column}=?`).run(uuid);
        for (const tag of value.tags as string[]) this.db.prepare(`INSERT INTO ${tagsTable}(${column},tags) VALUES (?,?)`).run(uuid, tag);
        const constraints = this.db.prepare('SELECT * FROM pz_constraint WHERE target_entity_uuid=?').all(uuid) as Row[];
        if (constraints.length > 1 || constraints.some(c => c.constraint_type !== 0 || c.offset_days !== 0 || c.time_unit !== 'DAY'))
          throw new Error('Unsupported PZ7 task constraints');
        const existingPredecessor = constraints[0] ? this.id('tasks', constraints[0].origin_entity_uuid) : null;
        if (existingPredecessor !== (value.dependsOnId ?? null)) {
          this.db.prepare('DELETE FROM pz_constraint WHERE target_entity_uuid=?').run(uuid);
        if (value.dependsOnId) {
          const before = this.get('tasks', value.dependsOnId as string);
          if (!before || before.projectId !== value.projectId) throw new Error('Invalid PZ7 predecessor');
          this.upsert('pz_constraint', crypto.randomUUID(), { project_uuid: projectUuid, origin_entity_type: before.kind === 'milestone' ? 2 : 1,
            origin_entity_uuid: this.uuid('tasks', value.dependsOnId), target_entity_type: milestone ? 2 : 1,
            target_entity_uuid: uuid, origin_date_type: 0, target_date_type: milestone ? 0 : 1,
            constraint_type: 0, offset_days: 0, time_unit: 'DAY' });
        }
        }
        break;
      }
      case 'taskLists': {
        const project = this.uuid('projects', value.projectId);
        const projectRow = this.one('SELECT activity_root_uuid FROM pz_project WHERE uuid=?', project!);
        if (!projectRow?.activity_root_uuid) throw new Error('Project has no PZ7 root activity');
        const parent = this.uuid('taskLists', value.parentId) ?? projectRow.activity_root_uuid;
        if (value.parentId && this.get('taskLists', value.parentId as string)?.projectId !== value.projectId) throw new Error('Cross-project list parent');
        this.upsert('pz_activity', uuid, { project_uuid: project, activity_parent_uuid: parent, name: value.name, activity_key_rank: value.position ?? null });
        break;
      }
      case 'comments': {
        const task = value.taskId ? this.get('tasks', value.taskId as string) : undefined;
        const projectId = value.projectId ?? task?.projectId;
        if (!projectId || (task && task.projectId !== projectId)) throw new Error('Invalid PZ7 comment context');
        const projectUuid = this.uuid('projects', projectId)!;
        const entityType = task ? (task.kind === 'milestone' ? 2 : 1) : 4;
        const entityUuid = task ? this.uuid('tasks', value.taskId)! : projectUuid;
        const current = prior && this.one('SELECT discussion_uuid FROM pz_comment WHERE uuid=?', uuid);
        const existing = current?.discussion_uuid ? this.one('SELECT project_uuid,entity_type,entity_uuid FROM pz_discussion WHERE uuid=?', current.discussion_uuid as string) : undefined;
        let discussion = existing?.project_uuid === projectUuid && existing.entity_type === entityType && existing.entity_uuid === entityUuid
          ? current!.discussion_uuid as string : undefined;
        if (!discussion) {
          const shared = this.one('SELECT uuid FROM pz_discussion WHERE project_uuid=? AND entity_type=? AND entity_uuid=? ORDER BY rowid LIMIT 1', projectUuid, entityType, entityUuid);
          discussion = shared?.uuid as string | undefined ?? crypto.randomUUID();
          if (!shared) this.upsert('pz_discussion', discussion, { project_uuid: projectUuid, entity_type: entityType, entity_uuid: entityUuid });
        }
        this.upsert('pz_comment', uuid, { discussion_uuid: discussion, content: value.body,
          author_uuid: this.uuid('resources', value.authorId), created_date: value.createdAt,
          last_modified: value.updatedAt ?? null });
        if (task) this.db.prepare(`UPDATE ${task.kind === 'milestone' ? 'pz_milestone' : 'pz_task'} SET discussion_uuid=? WHERE uuid=?`).run(discussion, entityUuid);
        else this.db.prepare('UPDATE pz_project SET log_discussion_uuid=? WHERE uuid=?').run(discussion, projectUuid);
        this.db.prepare('DELETE FROM pz_comment_resource WHERE comment_uuid=?').run(uuid);
        for (const recipient of (value.mentionResourceIds as string[] | undefined) ?? [])
          this.db.prepare('INSERT INTO pz_comment_resource(comment_uuid,recipients_uuid) VALUES (?,?)').run(uuid, this.uuid('resources', recipient));
        break;
      }
      case 'timeEntries': {
        const task = this.get('tasks', value.taskId as string);
        if (!task || task.kind !== 'task') throw new Error('Time entry requires a native task');
        this.upsert('pz_time_record', uuid, { task_uuid: this.uuid('tasks', value.taskId), resource_uuid: this.uuid('resources', value.resourceId),
          recording_date: value.date, time_spent: value.hours });
        break;
      }
      case 'expenses': {
        let kind = this.one('SELECT uuid FROM pz_expense_type WHERE name=? AND planzone_uuid=?', value.category as string, this.workspace());
        if (!kind) {
          const kindUuid = crypto.randomUUID();
          this.upsert('pz_expense_type', kindUuid, { planzone_uuid: this.workspace(), name: value.category });
          kind = { uuid: kindUuid };
        }
        this.upsert('pz_expense', uuid, { project_uuid: this.uuid('projects', value.projectId), expense_type_uuid: kind.uuid,
          name: value.label, quantity: 1, unit_amount: value.amount, planned_date: value.plannedDate, actual_date: value.paidDate });
        break;
      }
      default: throw new Error(`Unsupported PZ7 native put: ${table} (no sidecar-only write)`);
    }
  }
  /** Synchronize project membership, which is explicit in PZ7 but partly inferred in PZ8. */
  private syncProjectMembers(projectId: string, updatedProject?: Records['projects']): void {
    const project = updatedProject ?? this.get('projects', projectId);
    if (!project) return;
    const projectUuid = this.uuid('projects', projectId)!;
    const desired = new Map<string, string>();
    for (const [id, role] of Object.entries(project.projectRoles ?? {})) desired.set(id, role);
    if (project.createdByResourceId && !desired.has(project.createdByResourceId)) desired.set(project.createdByResourceId, 'collaborator');
    for (const resource of this.all('resources')) {
      if (resource.projectIds?.includes(projectId) && !desired.has(resource.id)) desired.set(resource.id, 'collaborator');
    }
    const tasks = this.all('tasks').filter(task => task.projectId === projectId);
    const byId = new Map(tasks.map(task => [task.id, task]));
    for (const task of tasks) if (task.assigneeId && !desired.has(task.assigneeId)) desired.set(task.assigneeId, 'collaborator');
    for (const entry of this.all('timeEntries')) {
      if (byId.has(entry.taskId) && !desired.has(entry.resourceId)) desired.set(entry.resourceId, 'collaborator');
    }
    for (const allocation of this.db.prepare(`SELECT DISTINCT a.resource_uuid FROM pz_allocation a
      JOIN pz_task t ON t.uuid=a.task_uuid JOIN pz_activity activity ON activity.uuid=t.activity_uuid
      WHERE activity.project_uuid=?`).all(projectUuid) as { resource_uuid: string }[]) {
      const id = this.optionalId('resources', allocation.resource_uuid);
      if (id && !desired.has(id)) desired.set(id, 'collaborator');
    }
    const existing = this.db.prepare('SELECT uuid,member_uuid FROM pz_project_member WHERE project_uuid=?').all(projectUuid) as { uuid: string; member_uuid: string }[];
    const retained = new Set<string>();
    const names: Record<string, string> = { manager: 'pr_manager', collaborator: 'pr_worker', observer: 'pr_visitor' };
    for (const [resourceId, role] of desired) {
      const name = names[role];
      const resourceUuid = this.uuid('resources', resourceId);
      const roleUuid = name && this.one('SELECT uuid FROM pz_role WHERE name=?', name)?.uuid;
      if (!name || !roleUuid) throw new Error(`Unknown project role: ${role}`);
      const member = existing.find(item => item.member_uuid === resourceUuid);
      const memberUuid = member?.uuid ?? crypto.randomUUID();
      if (member && !this.one('SELECT 1 FROM pz8_membership_ownership WHERE member_uuid=?', memberUuid)) {
        retained.add(memberUuid); // Externally managed PZ7 member: never rewrite its role.
        continue;
      }
      this.upsert('pz_project_member', memberUuid, { project_uuid: projectUuid, member_uuid: resourceUuid,
        role_uuid: roleUuid, deactivated: 0 });
      if (!member) this.db.prepare('INSERT INTO pz8_membership_ownership(member_uuid) VALUES (?)').run(memberUuid);
      this.db.prepare('INSERT INTO pz_project_project_member(project_uuid,resources_uuid) SELECT ?,? WHERE NOT EXISTS (SELECT 1 FROM pz_project_project_member WHERE project_uuid=? AND resources_uuid=?)')
        .run(projectUuid, memberUuid, projectUuid, memberUuid);
      retained.add(memberUuid);
    }
    for (const member of existing) {
      if (retained.has(member.uuid) || !this.one('SELECT 1 FROM pz8_membership_ownership WHERE member_uuid=?', member.uuid)) continue;
      this.db.prepare('DELETE FROM pz_project_project_member WHERE project_uuid=? AND resources_uuid=?').run(projectUuid, member.uuid);
      this.db.prepare('DELETE FROM pz_project_member WHERE uuid=?').run(member.uuid);
    }
  }
  private workspace(): string {
    const row = this.one('SELECT uuid FROM pz_planzone ORDER BY rowid LIMIT 1');
    if (!row) throw new Error('PZ7 workspace missing');
    return row.uuid as string;
  }
  put<K extends Table>(table: K, value: Records[K]): void {
    if (!TABLES.includes(table)) throw new Error(`Unknown collection: ${table}`);
    this.transaction(() => {
      const old = this.lookup(table, value.id);
      const uuid = old?.uuid ?? crypto.randomUUID();
      if (table in NATIVE) this.nativePut(table as NativeTable, value as unknown as Row, uuid, old);
      else if (PZ7_EXTRA_TABLES.includes(table as Pz7ExtraTable))
        putPz7Extra(this.db, table as Pz7ExtraTable, value as Records[Pz7ExtraTable], uuid, this.extraRefs());
      const position = old?.position ?? (this.one('SELECT coalesce(max(position)+1,0) AS next FROM pz8_identity WHERE entity=?', table)?.next as number);
      this.db.prepare('INSERT INTO pz8_identity(entity,id,uuid,data,position) VALUES (?,?,?,?,?) ON CONFLICT(entity,id) DO UPDATE SET data=excluded.data')
        .run(table, value.id, uuid, JSON.stringify(value), position);
      if (table === 'projects') this.syncProjectMembers(value.id, value as Records['projects']);
      if (table === 'resources') for (const project of this.all('projects')) this.syncProjectMembers(project.id);
      if (table === 'tasks') {
        this.syncProjectMembers((value as Records['tasks']).projectId);
        if (old) {
          const former = (JSON.parse(old.data) as Records['tasks']).projectId;
          if (former !== (value as Records['tasks']).projectId) this.syncProjectMembers(former);
        }
      }
      if (table === 'timeEntries') {
        const task = this.get('tasks', (value as Records['timeEntries']).taskId);
        if (task) this.syncProjectMembers(task.projectId);
      }
    });
  }
  remove(table: Table, id: string): void {
    if (!TABLES.includes(table)) throw new Error(`Unknown collection: ${table}`);
    this.transaction(() => {
      const row = this.lookup(table, id);
      if (!row) return;
      if (table === 'projects' || table === 'resources') {
        const memberships = this.db.prepare(`SELECT uuid,project_uuid FROM pz_project_member WHERE ${table === 'projects' ? 'project_uuid' : 'member_uuid'}=?`).all(row.uuid) as { uuid: string; project_uuid: string }[];
        for (const member of memberships) {
          if (!this.one('SELECT 1 FROM pz8_membership_ownership WHERE member_uuid=?', member.uuid))
            throw new Error('Cannot delete externally managed PZ7 project membership');
          this.db.prepare('DELETE FROM pz_project_project_member WHERE resources_uuid=?').run(member.uuid);
          this.db.prepare('DELETE FROM pz_project_member WHERE uuid=?').run(member.uuid);
        }
      }
      if (PZ7_EXTRA_TABLES.includes(table as Pz7ExtraTable))
        removePz7Extra(this.db, table as Pz7ExtraTable, row.uuid);
      if (table in NATIVE) {
        const native = table === 'tasks' ? (JSON.parse(row.data).kind === 'milestone' ? 'pz_milestone' : 'pz_task') : NATIVE[table as NativeTable];
        if (table === 'projects') {
          const project = this.one('SELECT activity_root_uuid FROM pz_project WHERE uuid=?', row.uuid);
          const root = project?.activity_root_uuid as string | null;
          this.db.prepare('UPDATE pz_project SET activity_root_uuid=NULL,log_discussion_uuid=NULL WHERE uuid=?').run(row.uuid);
          if (root) {
            const descendants = this.db.prepare(`WITH RECURSIVE descendants(uuid,depth) AS (
              SELECT uuid,0 FROM pz_activity WHERE uuid=? UNION ALL
              SELECT child.uuid,parent.depth+1 FROM pz_activity child JOIN descendants parent ON child.activity_parent_uuid=parent.uuid
            ) SELECT uuid FROM descendants ORDER BY depth DESC`).all(root) as { uuid: string }[];
            for (const child of descendants) {
              if (this.one('SELECT 1 FROM pz8_identity WHERE entity=? AND uuid=?', 'taskLists', child.uuid))
                throw new Error('Cannot remove project with PZ8 task lists');
              this.db.prepare('DELETE FROM pz_activity WHERE uuid=?').run(child.uuid);
            }
          }
          this.db.prepare('DELETE FROM pz_status WHERE project_uuid=?').run(row.uuid);
          this.db.prepare(`DELETE FROM pz_discussion WHERE project_uuid=? AND NOT EXISTS
            (SELECT 1 FROM pz_comment WHERE discussion_uuid=pz_discussion.uuid)`).run(row.uuid);
        }
        if (table === 'comments') this.db.prepare('DELETE FROM pz_comment_resource WHERE comment_uuid=?').run(row.uuid);
        if (table === 'profiles') {
          const histories = this.one('SELECT count(*) AS count FROM pz_cost_profile_history WHERE cost_profile_uuid=?', row.uuid);
          if (Number(histories?.count ?? 0) > 1) throw new Error('Cannot delete a PZ7 profile with historical rates');
          this.db.prepare('DELETE FROM pz_cost_profile_history WHERE cost_profile_uuid=?').run(row.uuid);
        }
        if (table === 'tasks') {
          const discussion = this.one('SELECT c.uuid FROM pz_comment c JOIN pz_discussion d ON d.uuid=c.discussion_uuid WHERE d.entity_uuid=? LIMIT 1', row.uuid);
          if (discussion) throw new Error('Cannot delete a task with PZ7 comments');
          const references = this.one('SELECT uuid FROM pz_constraint WHERE origin_entity_uuid=?', row.uuid);
          if (references) throw new Error('Cannot delete a task referenced by PZ7 constraints');
          this.db.prepare('DELETE FROM pz_constraint WHERE target_entity_uuid=?').run(row.uuid);
          this.db.prepare(`DELETE FROM ${native === 'pz_milestone' ? 'pz_milestone_tags WHERE milestone_uuid' : 'pz_task_tags WHERE task_uuid'}=?`).run(row.uuid);
          if (native === 'pz_task') {
            const allocationCount = this.one('SELECT count(*) AS count FROM pz_allocation WHERE task_uuid=?', row.uuid);
            if (Number(allocationCount?.count ?? 0) > 1) throw new Error('Cannot delete a PZ7 task with multiple allocations');
            this.db.prepare('DELETE FROM pz_allocation WHERE task_uuid=?').run(row.uuid);
          }
        }
        const calendar = table === 'resources' ? this.one('SELECT weekly_calendar_uuid FROM pz_resource WHERE uuid=?', row.uuid) : undefined;
        this.db.prepare(`DELETE FROM ${native} WHERE uuid=?`).run(row.uuid);
        if (table === 'tasks') this.db.prepare(`DELETE FROM pz_discussion WHERE entity_uuid=? AND NOT EXISTS
          (SELECT 1 FROM pz_comment WHERE discussion_uuid=pz_discussion.uuid)`).run(row.uuid);
        if (calendar?.weekly_calendar_uuid) this.db.prepare('DELETE FROM pz_weekly_calendar WHERE uuid=?').run(calendar.weekly_calendar_uuid as string);
        if (table === 'comments') {
          // No automatic discussion removal: PZ7 may retain it for other comments or metadata.
        }
      }
      this.db.prepare('DELETE FROM pz8_identity WHERE entity=? AND id=?').run(table, id);
      if (table === 'tasks') this.syncProjectMembers((JSON.parse(row.data) as Records['tasks']).projectId);
      if (table === 'timeEntries') {
        const task = this.get('tasks', (JSON.parse(row.data) as Records['timeEntries']).taskId);
        if (task) this.syncProjectMembers(task.projectId);
      }
      if (table === 'resources') for (const project of this.all('projects')) this.syncProjectMembers(project.id);
    });
  }
  transaction<T>(action: () => T): T {
    const nested = this.depth++;
    const savepoint = `pz7_store_${nested}`;
    try {
      this.db.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
      try {
        const result = action();
        this.db.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT');
        return result;
      } catch (error) {
        this.db.exec(nested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : 'ROLLBACK');
        throw error;
      }
    } finally { this.depth--; }
  }
  close(): void { this.db.close(); }
}
