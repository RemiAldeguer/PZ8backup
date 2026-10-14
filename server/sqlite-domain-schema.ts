import type { DatabaseSync } from 'node:sqlite';

/**
 * Relational projections of the workspace JSON. The JSON remains the source of truth
 * for the HTTP API and for old databases; generated columns cannot get out of sync
 * when records are updated. This is deliberately an additive migration.
 */
const projections: Record<string, Record<string, string>> = {
  zones: { name: 'TEXT' },
  profiles: { name: 'TEXT', dailyRate: 'REAL' },
  projects: {
    name: 'TEXT', status: 'TEXT', startDate: 'TEXT', endDate: 'TEXT', budget: 'REAL',
    customStatusId: 'TEXT', createdByResourceId: 'TEXT',
  },
  resources: {
    name: 'TEXT', email: 'TEXT', type: 'TEXT', classification: 'TEXT', role: 'TEXT',
    active: 'INTEGER', managerId: 'TEXT',
  },
  tasks: {
    title: 'TEXT', kind: 'TEXT', status: 'TEXT', progress: 'REAL',
    startDate: 'TEXT', endDate: 'TEXT', allocatedHours: 'REAL', position: 'INTEGER',
  },
  taskLists: { name: 'TEXT', position: 'INTEGER' },
  timeEntries: { date: 'TEXT', hours: 'REAL', validated: 'INTEGER', rateSnapshot: 'REAL' },
  comments: { projectId: 'TEXT', authorId: 'TEXT', createdAt: 'TEXT' },
  expenses: { amount: 'REAL', plannedDate: 'TEXT', paidDate: 'TEXT' },
  revenues: { amount: 'REAL', plannedDate: 'TEXT', receivedDate: 'TEXT' },
  calendarEvents: { startDate: 'TEXT', endDate: 'TEXT' },
  unavailabilities: { startDate: 'TEXT', endDate: 'TEXT' },
  projectReports: { reportDate: 'TEXT', templateId: 'TEXT' },
  documentFolders: { name: 'TEXT' },
  projectDocuments: { name: 'TEXT', kind: 'TEXT', createdAt: 'TEXT' },
  organizationUnits: { name: 'TEXT' },
  projectTemplates: { name: 'TEXT' },
  customFieldDefinitions: { name: 'TEXT' },
  reportTemplates: { name: 'TEXT' },
  projectStatusDefinitions: { name: 'TEXT' },
  strategicAxes: { name: 'TEXT' },
};

const indexes: Record<string, string[][]> = {
  projects: [['zoneId', 'status'], ['customStatusId']],
  resources: [['profileId'], ['managerId'], ['email']],
  tasks: [['projectId', 'listId', 'position'], ['assigneeId', 'status'], ['dependsOnId'], ['projectId', 'status', 'endDate']],
  taskLists: [['projectId', 'parentId', 'position']],
  timeEntries: [['taskId', 'date'], ['resourceId', 'date']],
  comments: [['taskId', 'createdAt'], ['projectId', 'createdAt'], ['authorId']],
  expenses: [['projectId', 'plannedDate']],
  revenues: [['projectId', 'plannedDate']],
  calendarEvents: [['projectId', 'startDate']],
  unavailabilities: [['resourceId', 'startDate']],
  projectReports: [['projectId', 'reportDate']],
  documentFolders: [['projectId', 'parentId']],
  projectDocuments: [['projectId', 'folderId']],
  organizationUnits: [['parentId']],
};

/** Compatibility views expose allocation, time record and project membership projections.
 * A task currently has one assignee; unassigned tasks have no allocation row.
 * Explicit project membership and project roles remain distinct from task assignment.
 */
const views = `
  CREATE VIEW IF NOT EXISTS domain_task_allocations AS
    SELECT id AS task_id, projectId AS project_id, assigneeId AS resource_id,
           allocatedHours AS allocated_hours, progress
    FROM tasks WHERE assigneeId IS NOT NULL AND (kind IS NULL OR kind = 'task');
  CREATE VIEW IF NOT EXISTS domain_time_records AS
    SELECT id, taskId AS task_id, resourceId AS resource_id, date,
           hours AS time_spent, validated, rateSnapshot AS rate_snapshot
    FROM timeEntries;
  CREATE VIEW IF NOT EXISTS domain_project_memberships AS
    SELECT p.id AS project_id, member.key AS resource_id,
           member.value AS project_role, 'role' AS source
    FROM projects AS p, json_each(p.data, '$.projectRoles') AS member
    UNION ALL
    SELECT project.value AS project_id, r.id AS resource_id,
           NULL AS project_role, 'explicit' AS source
    FROM resources AS r, json_each(r.data, '$.projectIds') AS project;
  CREATE VIEW IF NOT EXISTS domain_organization_memberships AS
    SELECT unit.id AS unit_id, member.value AS resource_id
    FROM organizationUnits AS unit, json_each(unit.data, '$.resourceIds') AS member;
  CREATE VIEW IF NOT EXISTS domain_event_participants AS
    SELECT event.id AS event_id, participant.value AS resource_id
    FROM calendarEvents AS event, json_each(event.data, '$.resourceIds') AS participant;
  CREATE VIEW IF NOT EXISTS domain_comment_mentions AS
    SELECT comment.id AS comment_id, mention.value AS resource_id
    FROM comments AS comment, json_each(comment.data, '$.mentionResourceIds') AS mention;
`;

export function migrateDomainSchema(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [table, fields] of Object.entries(projections)) {
      const columns = new Set((db.prepare(`PRAGMA table_xinfo("${table}")`).all() as { name: string }[]).map(column => column.name));
      for (const [field, type] of Object.entries(fields)) {
        if (!columns.has(field)) {
          db.exec(`ALTER TABLE "${table}" ADD COLUMN "${field}" ${type} GENERATED ALWAYS AS (json_extract(data, '$.${field}')) VIRTUAL`);
        }
      }
    }
    for (const [table, groups] of Object.entries(indexes)) {
      for (const group of groups) {
        db.exec(`CREATE INDEX IF NOT EXISTS "idx_${table}_${group.join('_')}" ON "${table}" (${group.map(field => `"${field}"`).join(', ')})`);
      }
    }
    db.exec(views);
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (version < 2) db.exec('PRAGMA user_version = 2');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
