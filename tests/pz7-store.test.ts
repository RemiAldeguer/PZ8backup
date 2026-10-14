import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { Pz7Store } from '../server/pz7-store.ts';
import { AUTH_SCHEMA } from '../server/auth.ts';
import { seed } from '../server/seed.ts';
import { ApiService } from '../server/service.ts';
import { Store } from '../server/store.ts';

const runtime = resolve('data/pz7-runtime.sqlite');
function fixture(action: (path: string, store: Pz7Store) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'pz7-store-'));
  const path = join(dir, 'runtime.sqlite');
  try {
    copyFileSync(runtime, path);
    const store = new Pz7Store(path);
    try { action(path, store); } finally { store.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('requires an existing, prepared PZ7 runtime and refuses legacy DB', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pz7-store-invalid-'));
  try {
    assert.throws(() => new Pz7Store(join(dir, 'absent.sqlite')), /prepared PZ7 runtime/);
    assert.equal(existsSync(join(dir, 'absent.sqlite')), false);
    const path = join(dir, 'legacy.sqlite');
    const db = new DatabaseSync(path);
    db.exec('CREATE TABLE projects(id TEXT, data TEXT)');
    db.close();
    assert.throws(() => new Pz7Store(path), /Not a prepared PZ7 runtime|Legacy PZ8/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('native rows override compatibility JSON and extension-only collections round-trip', { skip: !existsSync(runtime) }, () => fixture((path, store) => {
  const zone = store.all('zones')[0];
  assert.ok(zone);
  const project = store.all('projects')[0];
  const task = store.all('tasks')[0];
  const resource = store.all('resources')[0];
  const profile = store.all('profiles')[0];
  store.put('taskLists', { id: 'test-list', projectId: project.id, name: 'New list', parentId: null, position: 0 });
  const list = store.all('taskLists')[0];
  const time = store.all('timeEntries')[0];
  const comment = store.all('comments')[0];
  const expense = store.all('expenses')[0];
  assert.ok(project && task && resource && profile && list && time && comment && expense);
  const db = new DatabaseSync(path);
  try {
    const uuid = (entity: string, id: string) => (db.prepare('SELECT uuid FROM pz8_identity WHERE entity=? AND id=?').get(entity, id) as {uuid: string}).uuid;
    db.prepare('UPDATE pz_zone SET name=? WHERE uuid=?').run('SQL zone', uuid('zones', zone.id));
    db.prepare('UPDATE pz_project SET name=? WHERE uuid=?').run('SQL project', uuid('projects', project.id));
    db.prepare(`UPDATE ${task.kind === 'milestone' ? 'pz_milestone' : 'pz_task'} SET name=? WHERE uuid=?`).run('SQL task', uuid('tasks', task.id));
    db.prepare('UPDATE pz_resource SET name=? WHERE uuid=?').run('SQL resource', uuid('resources', resource.id));
    db.prepare('UPDATE pz_cost_profile SET name=? WHERE uuid=?').run('SQL profile', uuid('profiles', profile.id));
    db.prepare('UPDATE pz_activity SET name=? WHERE uuid=?').run('SQL list', uuid('taskLists', list.id));
    db.prepare('UPDATE pz_time_record SET time_spent=? WHERE uuid=?').run(4.5, uuid('timeEntries', time.id));
    db.prepare('UPDATE pz_comment SET content=? WHERE uuid=?').run('SQL comment', uuid('comments', comment.id));
    db.prepare('UPDATE pz_expense SET unit_amount=? WHERE uuid=?').run(17, uuid('expenses', expense.id));
  } finally { db.close(); }
  assert.equal(store.get('zones', zone.id)?.name, 'SQL zone');
  assert.equal(store.get('projects', project.id)?.name, 'SQL project');
  assert.equal(store.get('tasks', task.id)?.title, 'SQL task');
  assert.equal(store.get('resources', resource.id)?.name, 'SQL resource');
  assert.equal(store.get('profiles', profile.id)?.name, 'SQL profile');
  assert.equal(store.get('taskLists', list.id)?.name, 'SQL list');
  assert.equal(store.get('timeEntries', time.id)?.hours, 4.5);
  assert.equal(store.get('comments', comment.id)?.body, 'SQL comment');
  assert.equal(store.get('expenses', expense.id)?.amount, 17);
  const extension = { id: 'extension-test', projectId: project.id, label: 'sidecar' } as unknown as ReturnType<typeof store.all<'revenues'>>[number];
  store.put('revenues', extension);
  assert.deepEqual(store.get('revenues', extension.id), extension);
  store.remove('revenues', extension.id);
  assert.equal(store.get('revenues', extension.id), undefined);
}));

test('original PZ7 data projects to the same API state as PZ8', { skip: !existsSync(resolve('planzone_pz_sans_recording_day.sqlite')) }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'pz7-parity-'));
  const legacyPath = join(dir, 'legacy.sqlite');
  const bundle = join(dir, 'bundle');
  const newPath = join(dir, 'prepared.sqlite');
  const legacy = new Store(legacyPath);
  let closed = false;
  try {
    seed(legacy);
    for (const statement of AUTH_SCHEMA) legacy.db.exec(statement);
    const expected = new ApiService(legacy).readState('2026-10-06');
    legacy.close(); closed = true;
    let command = spawnSync('python3', [resolve('scripts/migrate-pz8-to-pz7.py'), '--source', legacyPath,
      '--schema', resolve('planzone_pz_sans_recording_day.sqlite'), '--output', bundle], { encoding: 'utf8' });
    assert.equal(command.status, 0, command.stderr);
    command = spawnSync('python3', [resolve('scripts/prepare-pz7-runtime.py'), '--source', legacyPath,
      '--bundle', bundle, '--output', newPath], { encoding: 'utf8' });
    assert.equal(command.status, 0, command.stderr);
    const store = new Pz7Store(newPath);
    try { assert.deepEqual(new ApiService(store).readState('2026-10-06'), expected); }
    finally { store.close(); }
  } finally { if (!closed) legacy.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('create and delete native project, resource, task, comment, and dependent rows', { skip: !existsSync(runtime) }, () => fixture((_path, store) => {
  const profile = { ...store.all('profiles')[0], id: 'new-profile' };
  const resource = { ...store.all('resources')[0], id: 'new-resource', profileId: profile.id, managerId: null };
  const project = { ...store.all('projects')[0], id: 'new-project' };
  const list = { id: 'new-list', projectId: project.id, name: 'Sprint', parentId: null, position: 0 };
  const task = { ...store.all('tasks').find(item => item.kind === 'task')!, id: 'new-task', projectId: project.id,
    listId: list.id, assigneeId: resource.id, dependsOnId: null };
  const comment = { ...store.all('comments')[0], id: 'new-comment', taskId: task.id, projectId: project.id, authorId: resource.id };
  const entry = { ...store.all('timeEntries')[0], id: 'new-time', taskId: task.id, resourceId: resource.id };
  store.put('profiles', profile);
  store.put('resources', resource);
  store.put('projects', project);
  store.put('taskLists', list);
  store.put('tasks', task);
  store.put('comments', comment);
  store.put('timeEntries', entry);
  assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(store.get('tasks', task.id)?.listId, list.id);
  assert.equal(store.get('comments', comment.id)?.authorId, resource.id);
  assert.throws(() => store.remove('tasks', task.id), /FOREIGN KEY constraint failed|PZ7 comments/);
  store.remove('timeEntries', entry.id);
  store.remove('comments', comment.id);
  store.remove('tasks', task.id);
  store.remove('taskLists', list.id);
  store.remove('projects', project.id);
  store.remove('resources', resource.id);
  store.remove('profiles', profile.id);
  assert.equal(store.get('tasks', task.id), undefined);
  assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
}));

test('time integration dates use native project and resource columns', { skip: !existsSync(runtime) }, () => fixture((_path, store) => {
  const project = store.get('projects', 'project-nova')!;
  const resource = store.get('resources', 'resource-claire')!;
  store.put('projects', { ...project, timeIntegrationDate: '2026-10-06' });
  store.put('resources', { ...resource, timeIntegrationDate: '2026-10-07' });
  assert.equal(store.get('projects', project.id)?.timeIntegrationDate, '2026-10-06');
  assert.equal(store.get('resources', resource.id)?.timeIntegrationDate, '2026-10-07');
  assert.equal((store.db.prepare("SELECT integrated_at FROM pz_project WHERE name=?").get(project.name) as { integrated_at: string }).integrated_at, '2026-10-06');
  assert.equal((store.db.prepare("SELECT integrated_at FROM pz_resource WHERE name=?").get(resource.name) as { integrated_at: string }).integrated_at, '2026-10-07');
}));

test('custom project statuses use native PZ7 references', { skip: !existsSync(runtime) }, () => fixture((_path, store) => {
  store.put('projectStatusDefinitions', { id: 'custom-status', name: 'Pilote', description: '', color: '#112233', baseStatus: 'open' });
  const project = store.get('projects', 'project-nova')!;
  store.put('projects', { ...project, customStatusId: 'custom-status' });
  const uuid = (store.db.prepare("SELECT status_uuid FROM pz_project WHERE uuid=(SELECT uuid FROM pz8_identity WHERE entity='projects' AND id=?)")
    .get(project.id) as { status_uuid: string }).status_uuid;
  assert.equal(uuid, (store.db.prepare("SELECT uuid FROM pz8_identity WHERE entity='projectStatusDefinitions' AND id='custom-status'").get() as { uuid: string }).uuid);
  assert.equal(store.get('projects', project.id)?.customStatusId, 'custom-status');
}));

test('project roles and explicit memberships synchronize with PZ7 membership rows', { skip: !existsSync(runtime) }, () => fixture((_path, store) => {
  const project = store.get('projects', 'project-nova')!;
  const lab = store.get('resources', 'resource-lab')!;
  store.put('projects', { ...project, projectRoles: { 'resource-claire': 'manager' } });
  store.put('resources', { ...lab, projectIds: ['project-nova'] });
  const rows = store.db.prepare(`SELECT r.name, role.name AS role FROM pz_project_member member
    JOIN pz_project p ON p.uuid=member.project_uuid JOIN pz_resource r ON r.uuid=member.member_uuid
    JOIN pz_role role ON role.uuid=member.role_uuid WHERE p.name=? AND r.name IN (?,?) ORDER BY r.name`)
    .all(project.name, lab.name, store.get('resources', 'resource-claire')!.name) as { name: string; role: string }[];
  assert.deepEqual(rows.map(row => ({ ...row })), [{ name: 'Claire Martin', role: 'pr_manager' },
    { name: 'Laboratoire de test', role: 'pr_worker' }]);
  store.db.prepare(`UPDATE pz_project_member SET role_uuid=(SELECT uuid FROM pz_role WHERE name='pr_visitor')
    WHERE project_uuid=(SELECT uuid FROM pz_project WHERE name=?) AND member_uuid=(SELECT uuid FROM pz_resource WHERE name=?)`)
    .run(project.name, 'Claire Martin');
  assert.equal(store.get('projects', project.id)?.projectRoles?.['resource-claire'], 'observer');
  store.put('resources', { ...lab, projectIds: [] });
  assert.equal((store.db.prepare('SELECT count(*) AS n FROM pz_project_member WHERE member_uuid=(SELECT uuid FROM pz_resource WHERE name=?) AND project_uuid=(SELECT uuid FROM pz_project WHERE name=?)')
    .get(lab.name, project.name) as { n: number }).n, 0);
  const nativeOnly = randomUUID();
  store.db.prepare(`INSERT INTO pz_project_member(uuid,project_uuid,member_uuid,role_uuid,deactivated)
    SELECT ?,p.uuid,r.uuid,role.uuid,0 FROM pz_project p,pz_resource r,pz_role role
    WHERE p.name=? AND r.name=? AND role.name='pr_visitor'`).run(nativeOnly, project.name, lab.name);
  assert.equal(store.get('projects', project.id)?.projectRoles?.[lab.id], 'observer');
  store.put('projects', { ...project, name: 'Rôle conservé' });
  store.put('resources', { ...lab, name: 'Ressource conservée' });
  assert.equal((store.db.prepare('SELECT uuid FROM pz_project_member WHERE uuid=?').get(nativeOnly) as { uuid: string }).uuid, nativeOnly);
  assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
}));

test('multiple native allocations and cost histories cannot be overwritten', { skip: !existsSync(runtime) }, () => fixture((_path, store) => {
  const task = store.all('tasks').find(item => item.kind === 'task' && item.assigneeId)!;
  const other = store.all('resources').find(resource => resource.id !== task.assigneeId)!;
  const taskUuid = (store.db.prepare("SELECT uuid FROM pz8_identity WHERE entity='tasks' AND id=?").get(task.id) as { uuid: string }).uuid;
  const resourceUuid = (store.db.prepare("SELECT uuid FROM pz8_identity WHERE entity='resources' AND id=?").get(other.id) as { uuid: string }).uuid;
  const extra = randomUUID();
  store.db.prepare('INSERT INTO pz_allocation(uuid,task_uuid,resource_uuid,allocated_hours) VALUES (?,?,?,?)')
    .run(extra, taskUuid, resourceUuid, 3);
  assert.throws(() => store.put('tasks', { ...task, title: 'ne doit pas changer' }), /multiple allocations/);
  assert.throws(() => store.remove('tasks', task.id), /multiple allocations|PZ7 comments|PZ7 constraints/);
  assert.equal((store.db.prepare('SELECT allocated_hours FROM pz_allocation WHERE uuid=?').get(extra) as { allocated_hours: number }).allocated_hours, 3);
  const profile = store.all('profiles')[0];
  const profileUuid = (store.db.prepare("SELECT uuid FROM pz8_identity WHERE entity='profiles' AND id=?").get(profile.id) as { uuid: string }).uuid;
  const history = randomUUID();
  store.db.prepare('INSERT INTO pz_cost_profile_history(uuid,cost_profile_uuid,cost,start_date) VALUES (?,?,?,?)')
    .run(history, profileUuid, profile.dailyRate + 25, '2026-10-01');
  assert.throws(() => store.put('profiles', { ...profile, dailyRate: profile.dailyRate + 100 }), /historical rates/);
  assert.equal((store.db.prepare('SELECT cost FROM pz_cost_profile_history WHERE uuid=?').get(history) as { cost: number }).cost, profile.dailyRate + 25);
  assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
}));

test('atomic native updates, FK failure and unsupported native mutations fail closed', { skip: !existsSync(runtime) }, () => fixture((_path, store) => {
  const zone = store.all('zones')[0];
  const original = store.get('zones', zone.id)!;
  store.put('zones', { ...zone, name: 'renamed' });
  assert.equal(store.get('zones', zone.id)?.name, 'renamed');
  const project = store.all('projects')[0];
  store.put('projects', { ...project, name: 'native project' });
  assert.equal(store.get('projects', project.id)?.name, 'native project');
  const resource = store.all('resources')[0];
  store.put('resources', { ...resource, name: 'native resource' });
  assert.equal(store.get('resources', resource.id)?.name, 'native resource');
  assert.throws(() => store.remove('projects', project.id), /FOREIGN KEY constraint failed/);
  assert.ok(store.get('projects', project.id));
  assert.throws(() => store.transaction(() => { store.put('zones', original); throw new Error('abort'); }), /abort/);
  assert.equal(store.get('zones', zone.id)?.name, 'renamed');
  const task = store.all('tasks').find(item => item.kind === 'task')!;
  store.put('tasks', { ...task, title: 'native task update', progress: 47 });
  assert.equal(store.get('tasks', task.id)?.title, 'native task update');
  assert.equal(store.get('tasks', task.id)?.progress, 47);
  const comment = store.all('comments')[0];
  store.put('comments', { ...comment, body: 'native comment update' });
  assert.equal(store.get('comments', comment.id)?.body, 'native comment update');
  const time = store.all('timeEntries')[0];
  assert.throws(() => store.put('timeEntries', { ...time, id: 'duplicate-time' }), /UNIQUE constraint failed/);
  assert.equal(store.get('timeEntries', 'duplicate-time'), undefined);
}));
