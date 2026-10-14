import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { seed } from '../server/seed.ts';
import { Store } from '../server/store.ts';

test('SQLite exposes indexed relational fields without changing persisted JSON', () => {
  const directory = mkdtempSync(join(tmpdir(), 'planzone-domain-'));
  const path = join(directory, 'workspace.sqlite');
  let store = new Store(path);
  try {
    seed(store);
    const task = store.get('tasks', 'task-ateliers')!;
    const original = store.db.prepare('SELECT data FROM tasks WHERE id = ?').get(task.id) as { data: string };
    const row = store.db.prepare('SELECT projectId, assigneeId, status, allocatedHours, endDate FROM tasks WHERE id = ?').get(task.id);
    assert.deepEqual({ ...row }, { projectId: task.projectId, assigneeId: task.assigneeId, status: task.status,
      allocatedHours: task.allocatedHours, endDate: task.endDate });
    assert.deepEqual({ ...store.db.prepare('SELECT resource_id, allocated_hours FROM domain_task_allocations WHERE task_id = ?').get(task.id) },
      { resource_id: task.assigneeId, allocated_hours: task.allocatedHours });
    assert.deepEqual({ ...store.db.prepare('SELECT task_id, resource_id, time_spent, validated FROM domain_time_records WHERE id = ?').get('time-ateliers') },
      { task_id: task.id, resource_id: 'resource-claire', time_spent: 3, validated: 0 });
    assert.equal((store.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 2);
    assert.ok(store.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_tasks_projectId_status_endDate'").get());
    const project = store.get('projects', 'project-nova')!;
    store.put('projects', { ...project, projectRoles: { 'resource-claire': 'manager' } });
    const resource = store.get('resources', 'resource-claire')!;
    store.put('resources', { ...resource, projectIds: [project.id] });
    assert.deepEqual(store.db.prepare('SELECT project_role, source FROM domain_project_memberships WHERE project_id = ? AND resource_id = ? ORDER BY source').all(project.id, resource.id).map(row => ({ ...row })),
      [{ project_role: null, source: 'explicit' }, { project_role: 'manager', source: 'role' }]);
    store.put('projects', project);
    store.put('resources', resource);
    store.put('tasks', { ...task, allocatedHours: 42 });
    assert.equal((store.db.prepare('SELECT allocated_hours FROM domain_task_allocations WHERE task_id = ?').get(task.id) as { allocated_hours: number }).allocated_hours, 42);
    store.put('tasks', task);
    assert.equal((store.db.prepare('SELECT data FROM tasks WHERE id = ?').get(task.id) as { data: string }).data, original.data);

    store.close();
    store = new Store(path);
    assert.deepEqual(store.get('tasks', task.id), task);
    assert.equal((store.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 2);
    assert.equal((store.db.prepare('SELECT count(*) AS count FROM domain_task_allocations').get() as { count: number }).count,
      store.all('tasks').filter(item => item.kind === 'task' && item.assigneeId !== null).length);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('existing version-1 SQLite tables gain projections without re-encoding rows', () => {
  const directory = mkdtempSync(join(tmpdir(), 'planzone-domain-legacy-'));
  const path = join(directory, 'workspace.sqlite');
  const legacy = new DatabaseSync(path);
  const task = JSON.stringify({ id: 'old-task', projectId: 'old-project', assigneeId: 'old-resource',
    title: 'Ancienne tâche', allocatedHours: 7, status: 'todo' });
  try {
    legacy.exec(`
      PRAGMA user_version = 1;
      CREATE TABLE zones (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
      CREATE TABLE projects (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)),
        zoneId TEXT GENERATED ALWAYS AS (json_extract(data, '$.zoneId')) STORED REFERENCES zones(id));
      CREATE TABLE profiles (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
      CREATE TABLE resources (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)),
        profileId TEXT GENERATED ALWAYS AS (json_extract(data, '$.profileId')) STORED REFERENCES profiles(id));
      CREATE TABLE tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)),
        projectId TEXT GENERATED ALWAYS AS (json_extract(data, '$.projectId')) STORED REFERENCES projects(id),
        assigneeId TEXT GENERATED ALWAYS AS (json_extract(data, '$.assigneeId')) STORED REFERENCES resources(id),
        dependsOnId TEXT GENERATED ALWAYS AS (json_extract(data, '$.dependsOnId')) STORED REFERENCES tasks(id));
    `);
    legacy.prepare('INSERT INTO zones (id, data) VALUES (?, ?)').run('old-zone', JSON.stringify({ id: 'old-zone', name: 'Zone' }));
    legacy.prepare('INSERT INTO projects (id, data) VALUES (?, ?)').run('old-project', JSON.stringify({ id: 'old-project', zoneId: 'old-zone' }));
    legacy.prepare('INSERT INTO resources (id, data) VALUES (?, ?)').run('old-resource', JSON.stringify({ id: 'old-resource', name: 'Ancienne ressource' }));
    legacy.prepare('INSERT INTO tasks (id, data) VALUES (?, ?)').run('old-task', task);
  } finally {
    legacy.close();
  }
  const store = new Store(path);
  try {
    assert.equal((store.db.prepare('SELECT data FROM tasks WHERE id = ?').get('old-task') as { data: string }).data, task);
    assert.deepEqual({ ...store.db.prepare('SELECT task_id, resource_id, allocated_hours FROM domain_task_allocations WHERE task_id = ?').get('old-task') },
      { task_id: 'old-task', resource_id: 'old-resource', allocated_hours: 7 });
    assert.equal((store.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 2);
    assert.equal((store.db.prepare('PRAGMA foreign_key_check').all() as unknown[]).length, 0);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
