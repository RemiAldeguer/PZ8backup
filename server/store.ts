import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Records, StoreLike, Table } from './contracts.ts';
export type { Records, StoreLike, Table } from './contracts.ts';

/** JSON keeps the public contract readable; generated references are enforced by SQLite. */
export class Store implements StoreLike {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS zones (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
      CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)),
        zoneId TEXT GENERATED ALWAYS AS (json_extract(data, '$.zoneId')) STORED REFERENCES zones(id)
      );
      CREATE TABLE IF NOT EXISTS resources (
        id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)),
        profileId TEXT GENERATED ALWAYS AS (json_extract(data, '$.profileId')) STORED REFERENCES profiles(id)
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)),
        projectId TEXT GENERATED ALWAYS AS (json_extract(data, '$.projectId')) STORED REFERENCES projects(id),
        assigneeId TEXT GENERATED ALWAYS AS (json_extract(data, '$.assigneeId')) STORED REFERENCES resources(id),
        dependsOnId TEXT GENERATED ALWAYS AS (json_extract(data, '$.dependsOnId')) STORED REFERENCES tasks(id)
      );
      CREATE TABLE IF NOT EXISTS taskLists (
        id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)),
        projectId TEXT GENERATED ALWAYS AS (json_extract(data, '$.projectId')) STORED REFERENCES projects(id),
        parentId TEXT GENERATED ALWAYS AS (json_extract(data, '$.parentId')) STORED REFERENCES taskLists(id)
      );
      CREATE TABLE IF NOT EXISTS timeEntries (
        id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)),
        taskId TEXT GENERATED ALWAYS AS (json_extract(data, '$.taskId')) STORED REFERENCES tasks(id),
        resourceId TEXT GENERATED ALWAYS AS (json_extract(data, '$.resourceId')) STORED REFERENCES resources(id)
      );
      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)),
        taskId TEXT GENERATED ALWAYS AS (json_extract(data, '$.taskId')) STORED REFERENCES tasks(id)
      );
      CREATE TABLE IF NOT EXISTS expenses (
        id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)),
        projectId TEXT GENERATED ALWAYS AS (json_extract(data, '$.projectId')) STORED REFERENCES projects(id)
      );
      CREATE TABLE IF NOT EXISTS revenues (
        id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)),
        projectId TEXT GENERATED ALWAYS AS (json_extract(data, '$.projectId')) STORED REFERENCES projects(id)
      );
      CREATE TABLE IF NOT EXISTS calendarEvents (
        id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)),
        projectId TEXT GENERATED ALWAYS AS (json_extract(data, '$.projectId')) STORED REFERENCES projects(id)
      );
      CREATE TABLE IF NOT EXISTS unavailabilities (
        id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)),
        resourceId TEXT GENERATED ALWAYS AS (json_extract(data, '$.resourceId')) STORED REFERENCES resources(id)
      );
      CREATE TABLE IF NOT EXISTS projectTemplates (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
      CREATE TABLE IF NOT EXISTS customFieldDefinitions (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
      CREATE TABLE IF NOT EXISTS reportTemplates (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
      CREATE TABLE IF NOT EXISTS projectStatusDefinitions (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
      CREATE TABLE IF NOT EXISTS permissionPolicies (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
      CREATE TABLE IF NOT EXISTS strategicAxes (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
      CREATE TABLE IF NOT EXISTS projectReports (
        id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)),
        projectId TEXT GENERATED ALWAYS AS (json_extract(data, '$.projectId')) STORED REFERENCES projects(id)
      );
      CREATE TABLE IF NOT EXISTS documentFolders (
        id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)),
        projectId TEXT GENERATED ALWAYS AS (json_extract(data, '$.projectId')) STORED REFERENCES projects(id),
        parentId TEXT GENERATED ALWAYS AS (json_extract(data, '$.parentId')) STORED REFERENCES documentFolders(id)
      );
      CREATE TABLE IF NOT EXISTS projectDocuments (
        id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)),
        projectId TEXT GENERATED ALWAYS AS (json_extract(data, '$.projectId')) STORED REFERENCES projects(id),
        folderId TEXT GENERATED ALWAYS AS (json_extract(data, '$.folderId')) VIRTUAL REFERENCES documentFolders(id)
      );
      CREATE TABLE IF NOT EXISTS organizationUnits (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)),
        parentId TEXT GENERATED ALWAYS AS (json_extract(data, '$.parentId')) STORED REFERENCES organizationUnits(id));
      PRAGMA user_version = 1;
    `);
    // SQLite allows additive virtual generated columns: legacy document JSON stays byte-for-byte intact.
    const documentColumns = this.db.prepare('PRAGMA table_xinfo(projectDocuments)').all() as { name: string }[];
    if (!documentColumns.some(column => column.name === 'folderId')) {
      this.db.exec("ALTER TABLE projectDocuments ADD COLUMN folderId TEXT GENERATED ALWAYS AS (json_extract(data, '$.folderId')) VIRTUAL REFERENCES documentFolders(id)");
    }
    const taskColumns = this.db.prepare('PRAGMA table_xinfo(tasks)').all() as { name: string }[];
    if (!taskColumns.some(column => column.name === 'listId')) {
      this.db.exec("ALTER TABLE tasks ADD COLUMN listId TEXT GENERATED ALWAYS AS (json_extract(data, '$.listId')) VIRTUAL REFERENCES taskLists(id)");
    }
  }
  all<K extends Table>(table: K): Records[K][] {
    return (this.db.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all() as { data: string }[]).map(row => JSON.parse(row.data) as Records[K]);
  }
  get<K extends Table>(table: K, id: string): Records[K] | undefined {
    const row = this.db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) as Records[K] : undefined;
  }
  put<K extends Table>(table: K, value: Records[K]): void {
    this.db.prepare(`INSERT INTO ${table} (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`).run(value.id, JSON.stringify(value));
  }
  remove(table: Table, id: string): void { this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id); }
  transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = action(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close(): void { this.db.close(); }
}
