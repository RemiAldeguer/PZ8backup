import type { SqliteSync } from './sqlite-sync.ts';
import type { Records, Table } from './contracts.ts';

/** Optional native PZ7 mappings. The caller owns the identity row and the SQLite transaction.
 * Call put/remove BEFORE changing pz8_identity; any failure must roll back both operations.
 * Only values without a defensible PZ7 representation remain in compatibility JSON.
 * A missing native row is an error, never an invitation to return stale JSON. */
export const PZ7_EXTRA_TABLES = [
  'projectStatusDefinitions', 'strategicAxes', 'organizationUnits', 'projectReports',
  'calendarEvents', 'unavailabilities',
] as const;
export type Pz7ExtraTable = typeof PZ7_EXTRA_TABLES[number];
export type ExtraIdentity = { id: string; uuid: string; data: string };
export interface ExtraReferences {
  /** Resolve a PZ8 id to the authoritative PZ7 UUID. Must throw on unknown ids. */
  uuid(entity: Table, id: string): string;
  /** Resolve a native UUID to a PZ8 id. Must throw on unmapped UUIDs. */
  id(entity: Table, uuid: string): string;
  /** The single prepared runtime workspace's pz_planzone.uuid. */
  workspace(): string;
}
type Row = Record<string, unknown>;
type Value = string | number | null;
const native: Record<Pz7ExtraTable, string> = {
  projectStatusDefinitions: 'pz_project_status', strategicAxes: 'pz_strategic_axes',
  organizationUnits: 'pz_organizational_unit', projectReports: 'pz_project_report',
  calendarEvents: 'pz_event', unavailabilities: 'pz_unavailability',
};
function row(db: SqliteSync, sql: string, ...params: Value[]): Row | undefined {
  return db.prepare(sql).get(...params) as Row | undefined;
}
function rows(db: SqliteSync, sql: string, ...params: Value[]): Row[] {
  return db.prepare(sql).all(...params) as Row[];
}
function upsert(db: SqliteSync, table: string, uuid: string, fields: Record<string, Value>): void {
  const names = Object.keys(fields);
  db.prepare(`INSERT INTO ${table}(uuid,${names.join(',')}) VALUES (${Array(names.length + 1).fill('?').join(',')})
    ON CONFLICT(uuid) DO UPDATE SET ${names.map(n => `${n}=excluded.${n}`).join(',')}`)
    .run(uuid, ...Object.values(fields));
}
function optionalId(ref: ExtraReferences, entity: Table, id: string | null): string | null {
  return id == null ? null : ref.uuid(entity, id);
}
function parseDateTime(value: unknown): { date: string; time: string | null } {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value))
    throw new Error(`Unsupported PZ7 datetime: ${String(value)}`);
  return { date: value.slice(0, 10), time: value.slice(11, 16) };
}
function eventTimestamp(date: unknown, time: unknown, allDay: unknown): string {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid PZ8 event date');
  const clock = allDay ? '00:00' : time;
  if (typeof clock !== 'string' || !/^\d{2}:\d{2}$/.test(clock)) throw new Error('A timed PZ7 event requires HH:mm');
  return `${date}T${clock}:00`;
}

/** Merge PZ7 columns with compatibility JSON; does not manufacture an identity for external rows. */
export function readPz7Extra<K extends Pz7ExtraTable>(
  db: SqliteSync, entity: K, identity: ExtraIdentity, refs: ExtraReferences,
): Records[K] {
  const base = JSON.parse(identity.data) as Row;
  const current = row(db, `SELECT * FROM ${native[entity]} WHERE uuid=?`, identity.uuid);
  if (!current && entity === 'calendarEvents' && base.projectId == null) return base as unknown as Records[K];
  if (!current) throw new Error(`Dangling PZ7 identity: ${entity}/${identity.id}`);
  const result: Row = { ...base, id: identity.id };
  switch (entity) {
    case 'projectStatusDefinitions':
      Object.assign(result, { name: current.label, color: current.color, description: current.description ?? '' });
      break;
    case 'strategicAxes': {
      const scale = rows(db, 'SELECT adequacy_possibility FROM pz_strategic_axes_adequacy WHERE strategic_axes_uuid=?', identity.uuid);
      if (scale.length) throw new Error(`Unknown PZ7 strategic adequacy codes: ${identity.id}`);
      // PZ7 adequacy enum ordinals have not been supplied; keep labels in the extension.
      Object.assign(result, { name: current.name, code: current.code, color: current.color, weight: current.weight });
      break;
    }
    case 'organizationUnits': {
      const parent = current.parent_uuid as string | null;
      const resources = rows(db, `SELECT uuid FROM (
        SELECT resource_uuid AS uuid,position AS rank FROM pz8_unit_memberships WHERE unit_uuid=?
        UNION ALL SELECT resource.uuid,1000000+resource.rowid FROM pz_resource AS resource
          WHERE resource.organizational_unit_uuid=? AND NOT EXISTS (
            SELECT 1 FROM pz8_unit_memberships m WHERE m.unit_uuid=? AND m.resource_uuid=resource.uuid)
      ) ORDER BY rank`, identity.uuid, identity.uuid, identity.uuid);
      Object.assign(result, { name: current.name, parentId: parent ? refs.id('organizationUnits', parent) : null,
        resourceIds: resources.map(item => refs.id('resources', item.uuid as string)) });
      break;
    }
    case 'projectReports': {
      const fields = rows(db, 'SELECT uuid FROM pz_project_report_field WHERE report_uuid=?', identity.uuid);
      if (fields.length) throw new Error(`Unsupported native PZ7 report fields: ${identity.id}`);
      Object.assign(result, { title: current.name, projectId: refs.id('projects', current.project_uuid as string),
        reportDate: current.submission_date, createdAt: current.created_date ?? base.createdAt,
        updatedAt: current.last_modified ?? base.updatedAt });
      const author = row(db, 'SELECT name FROM pz_resource WHERE uuid=?', current.author_uuid as string);
      if (!author) throw new Error(`Unmapped PZ7 report author: ${identity.id}`);
      result.authorName = author.name;
      break;
    }
    case 'calendarEvents': {
      const attendees = rows(db, 'SELECT participants_uuid FROM pz_event_resource WHERE event_uuid=? ORDER BY rowid', identity.uuid);
      const start = parseDateTime(current.start_time);
      const end = parseDateTime(current.end_time);
      const allDay = start.time === '00:00' && end.time === '00:00' ? base.allDay : false;
      Object.assign(result, { title: current.name, description: current.description,
        projectId: refs.id('projects', current.project_uuid as string),
        resourceIds: attendees.map(item => refs.id('resources', item.participants_uuid as string)),
        startDate: start.date, endDate: end.date, allDay,
        startTime: allDay ? null : start.time, endTime: allDay ? null : end.time });
      break;
    }
    case 'unavailabilities': {
      const reason = row(db, 'SELECT name FROM pz_unavailability_reason WHERE uuid=?', current.reason_uuid as string);
      if (!reason || !['leave', 'sick', 'other'].includes(String(reason.name))) throw new Error(`Unsupported PZ7 absence reason: ${identity.id}`);
      // PZ7 dates may include time on partial unavailabilities; PZ8 splits date and time.
      const start = String(current.start_date);
      const end = String(current.end_date);
      Object.assign(result, { title: current.label, reason: reason.name,
        resourceId: refs.id('resources', current.resource_uuid as string),
        startDate: start.slice(0, 10), endDate: end.slice(0, 10),
        allDay: !current.partial_unavailability,
        startTime: current.partial_unavailability ? start.slice(11, 16) : null,
        endTime: current.partial_unavailability ? end.slice(11, 16) : null });
      break;
    }
  }
  return result as unknown as Records[K];
}

/** Write native rows only. Caller must upsert pz8_identity inside the SAME transaction. */
export function putPz7Extra<K extends Pz7ExtraTable>(
  db: SqliteSync, entity: K, value: Records[K], uuid: string, refs: ExtraReferences,
): void {
  const v = value as unknown as Row;
  switch (entity) {
    case 'projectStatusDefinitions':
      upsert(db, native[entity], uuid, { label: v.name as string, color: v.color as string,
        description: v.description as string, planzone_uuid: refs.workspace() });
      return;
    case 'strategicAxes': {
      if (!Array.isArray(v.scale) || v.scale.length !== 5 || v.scale.some(s => typeof s !== 'string'))
        throw new Error('A PZ7 strategic axis requires five scale labels');
      upsert(db, native[entity], uuid, { code: v.code as string, name: v.name as string,
        color: v.color as string, weight: v.weight as number, planzone_uuid: refs.workspace() });
      if (row(db, 'SELECT 1 FROM pz_strategic_axes_adequacy WHERE strategic_axes_uuid=? LIMIT 1', uuid))
        throw new Error('PZ7 strategic adequacy codes are unknown; refusing to overwrite existing values');
      return;
    }
    case 'organizationUnits': {
      if (v.parentId === v.id) throw new Error('Self-parented PZ7 organizational unit');
      const parent = optionalId(refs, 'organizationUnits', v.parentId as string | null);
      if (parent) {
        const ancestor = row(db, `WITH RECURSIVE ancestors(uuid,parent_uuid) AS (
          SELECT uuid,parent_uuid FROM pz_organizational_unit WHERE uuid=? UNION ALL
          SELECT p.uuid,p.parent_uuid FROM pz_organizational_unit p JOIN ancestors a ON p.uuid=a.parent_uuid
        ) SELECT uuid FROM ancestors WHERE uuid=?`, parent, uuid);
        if (ancestor) throw new Error('PZ7 organizational unit parent cycle');
      }
      const resourceIds = v.resourceIds as string[];
      if (!Array.isArray(resourceIds) || new Set(resourceIds).size !== resourceIds.length) throw new Error('Invalid unit resources');
      const old = row(db, 'SELECT rank_key FROM pz_organizational_unit WHERE uuid=?', uuid);
      upsert(db, native[entity], uuid, { name: v.name as string, parent_uuid: parent,
        planzone_uuid: refs.workspace(), rank_key: old?.rank_key as string ?? uuid });
      db.prepare('DELETE FROM pz8_unit_memberships WHERE unit_uuid=?').run(uuid);
      for (const [position, id] of resourceIds.entries()) {
        const resourceUuid = refs.uuid('resources', id);
        db.prepare('INSERT INTO pz8_unit_memberships(unit_uuid,resource_uuid,position) VALUES (?,?,?)').run(uuid, resourceUuid, position);
        db.prepare('UPDATE pz_resource SET organizational_unit_uuid=? WHERE uuid=? AND organizational_unit_uuid IS NULL').run(uuid, resourceUuid);
      }
      const removed = rows(db, `SELECT uuid FROM pz_resource WHERE organizational_unit_uuid=? AND NOT EXISTS (
        SELECT 1 FROM pz8_unit_memberships m WHERE m.unit_uuid=? AND m.resource_uuid=pz_resource.uuid)`, uuid, uuid);
      for (const resource of removed) {
        const alternative = row(db, 'SELECT unit_uuid FROM pz8_unit_memberships WHERE resource_uuid=? ORDER BY rowid LIMIT 1', resource.uuid as string);
        db.prepare('UPDATE pz_resource SET organizational_unit_uuid=? WHERE uuid=?').run(alternative?.unit_uuid as string ?? null, resource.uuid as string);
      }
      return;
    }
    case 'projectReports': {
      // PZ7 field/indicator ordinals are not established; preserve them in pz8_identity.
      if (row(db, 'SELECT 1 FROM pz_project_report_field WHERE report_uuid=? LIMIT 1', uuid))
        throw new Error('Unknown existing PZ7 report fields; refusing to overwrite them');
      const author = rows(db, `SELECT r.uuid FROM pz_resource r JOIN pz8_identity i ON i.entity='resources' AND i.uuid=r.uuid
        WHERE r.name=?`, v.authorName as string);
      if (author.length !== 1) throw new Error('PZ7 report author must match exactly one mapped resource name');
      upsert(db, native[entity], uuid, { name: v.title as string, submission_date: v.reportDate as string,
        author_uuid: author[0].uuid as string, project_uuid: refs.uuid('projects', v.projectId as string),
        created_date: v.createdAt as string, last_modified: v.updatedAt as string });
      return;
    }
    case 'calendarEvents': {
      if (!v.projectId) {
        // A global PZ8 event has no legal PZ7 project/activity FK: retain it in pz8_identity only.
        db.prepare('DELETE FROM pz_event_resource WHERE event_uuid=?').run(uuid);
        db.prepare('DELETE FROM pz_event WHERE uuid=?').run(uuid);
        return;
      }
      const project = refs.uuid('projects', v.projectId as string);
      const root = row(db, 'SELECT activity_root_uuid FROM pz_project WHERE uuid=?', project);
      if (!root?.activity_root_uuid) throw new Error('PZ7 event project has no root activity');
      const resourceIds = v.resourceIds as string[];
      if (!Array.isArray(resourceIds) || new Set(resourceIds).size !== resourceIds.length) throw new Error('Invalid event participants');
      upsert(db, native[entity], uuid, { name: v.title as string, description: v.description as string,
        project_uuid: project, parent_activity_uuid: root.activity_root_uuid as string,
        start_time: eventTimestamp(v.startDate, v.startTime, v.allDay), end_time: eventTimestamp(v.endDate, v.endTime, v.allDay) });
      db.prepare('DELETE FROM pz_event_resource WHERE event_uuid=?').run(uuid);
      for (const id of resourceIds) db.prepare('INSERT INTO pz_event_resource(event_uuid,participants_uuid) VALUES (?,?)').run(uuid, refs.uuid('resources', id));
      return;
    }
    case 'unavailabilities': {
      if (!['leave', 'sick', 'other'].includes(String(v.reason))) throw new Error('Unsupported PZ7 absence reason');
      let reason = row(db, 'SELECT uuid FROM pz_unavailability_reason WHERE name=? AND planzone_uuid=? ORDER BY rowid LIMIT 1', v.reason as string, refs.workspace());
      if (!reason) {
        reason = { uuid: crypto.randomUUID() };
        upsert(db, 'pz_unavailability_reason', reason.uuid as string, { name: v.reason as string,
          planzone_uuid: refs.workspace(), key_rank: { leave: 0, sick: 1, other: 2 }[v.reason as 'leave' | 'sick' | 'other'] });
      }
      const start = v.allDay ? v.startDate as string : eventTimestamp(v.startDate, v.startTime, false);
      const end = v.allDay ? v.endDate as string : eventTimestamp(v.endDate, v.endTime, false);
      upsert(db, native[entity], uuid, { label: v.title as string, resource_uuid: refs.uuid('resources', v.resourceId as string),
        reason_uuid: reason.uuid as string, partial_unavailability: v.allDay ? 0 : 1,
        non_worked_hours_count: null, start_date: start, end_date: end });
      return;
    }
  }
}

/** Delete only the native entity (and owned junction rows); caller deletes identity in its transaction. */
export function removePz7Extra(db: SqliteSync, entity: Pz7ExtraTable, uuid: string): void {
  switch (entity) {
    case 'strategicAxes': db.prepare('DELETE FROM pz_strategic_axes_adequacy WHERE strategic_axes_uuid=?').run(uuid); break;
    case 'organizationUnits': {
      db.prepare('DELETE FROM pz8_unit_memberships WHERE unit_uuid=?').run(uuid);
      for (const resource of rows(db, 'SELECT uuid FROM pz_resource WHERE organizational_unit_uuid=?', uuid)) {
        const alternative = row(db, 'SELECT unit_uuid FROM pz8_unit_memberships WHERE resource_uuid=? ORDER BY rowid LIMIT 1', resource.uuid as string);
        db.prepare('UPDATE pz_resource SET organizational_unit_uuid=? WHERE uuid=?').run(alternative?.unit_uuid as string ?? null, resource.uuid as string);
      }
      break;
    }
    case 'calendarEvents': db.prepare('DELETE FROM pz_event_resource WHERE event_uuid=?').run(uuid); break;
    case 'projectReports':
      if (row(db, 'SELECT uuid FROM pz_project_report_field WHERE report_uuid=? LIMIT 1', uuid))
        throw new Error('Cannot delete report with unsupported native PZ7 fields');
      break;
  }
  db.prepare(`DELETE FROM ${native[entity]} WHERE uuid=?`).run(uuid);
}
