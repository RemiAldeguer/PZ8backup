import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { build } from 'esbuild';
import { convertV4MiniflareOptions, Log, LogLevel, Miniflare, Response as MiniflareResponse } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { D1AuthDatabase } from '../cloudflare/auth-d1.ts';
import { createApp } from '../server/app.ts';
import { AuthManager } from '../server/auth.ts';
import { TABLES, type CompatibleWorkspaceSnapshot, type StoreLike, type Table, type WorkspaceSnapshot } from '../server/contracts.ts';
import { MemoryStore } from '../server/memory-store.ts';
import { seed } from '../server/seed.ts';
import { ApiError, ApiService } from '../server/service.ts';
import { Store } from '../server/store.ts';
import { MAX_TASK_LIST_DEPTH } from '../server/task-list-validation.ts';
import { MAX_CORE_WORKSPACE_BYTES, workspaceStorageUsage } from '../server/collaboration-validation.ts';
import type { AppData, Project, ProjectTaskList, Task } from '../shared/types.ts';
import type { ProjectTemplate } from '../shared/customization.ts';

const actor = { id: 'resource-claire', name: 'Administrateur', role: 'Administrateur' as const };
const admin = { username: 'admin', password: 'Nested-list-local-tests-2026!', name: actor.name };
const listPayload = { projectId: 'project-nova', name: 'Documentation' };
const snapshot = (store: StoreLike) => Object.fromEntries(TABLES.map(table => [table, store.all(table)])) as WorkspaceSnapshot;
const rejection = (status: number, action: () => unknown) => assert.throws(action, error => error instanceof ApiError && error.status === status);
const taskPayload = (overrides: Record<string, unknown> = {}) => ({ projectId: 'project-nova', title: 'Nouvelle tâche', ...overrides });
const templatePayload = () => ({ name: 'Arbre complet', description: 'Modèle avec listes vides et phases', budget: 125, color: '#123456',
  taskLists: [{ key: 'child', name: 'Sous-liste', parentKey: 'parent' }, { key: 'parent', name: 'Parent', parentKey: null }, { key: 'empty', name: 'Vide', parentKey: 'child' }],
  tasks: [
    { key: 'first', title: 'Tâche listée', listKey: 'child', phase: 'Phase conservée', allocatedHours: 8, startOffsetDays: 0, endOffsetDays: 1 },
    { key: 'second', title: 'Racine explicite', listKey: null, phase: 'Sans phase', dependsOnKey: 'first', startOffsetDays: 2, endOffsetDays: 3 },
    { key: 'third', title: 'Phase historique', phase: 'Préparation' },
  ],
});

for (const backend of ['sqlite', 'memory'] as const) {
  const fixture = () => {
    const store = backend === 'sqlite' ? new Store(':memory:') : new MemoryStore(); seed(store);
    return { store, api: new ApiService(store, actor), close: () => { if (store instanceof Store) store.close(); } };
  };
  test(`${backend}: nested task lists persist moves and renames, retain explicit membership on phase edits and refuse nonempty deletion`, () => {
    const { store, api, close } = fixture();
    try {
      const before = snapshot(store);
      const parent = api.mutate('task-lists', 'POST', { ...listPayload, name: ' Parent ' }).value as ProjectTaskList;
      const child = api.mutate('task-lists', 'POST', { ...listPayload, parentId: parent.id }).value as ProjectTaskList;
      assert.equal(parent.name, 'Parent'); assert.equal(parent.parentId, null);
      const task = api.mutate('tasks', 'POST', taskPayload({ listId: child.id, phase: 'Ancienne phase' })).value as Task;
      const updated = api.mutate('tasks', 'PATCH', { phase: 'Autre phase' }, task.id).value as Task;
      assert.equal(updated.listId, child.id); assert.equal(updated.phase, 'Autre phase');
      rejection(409, () => api.mutate('task-lists', 'DELETE', undefined, parent.id));
      rejection(409, () => api.mutate('task-lists', 'DELETE', undefined, child.id));
      api.mutate('task-lists', 'PATCH', { name: 'Déplacée', parentId: null }, child.id);
      api.mutate('task-lists', 'DELETE', undefined, parent.id);
      api.mutate('tasks', 'PATCH', { listId: null }, task.id); api.mutate('task-lists', 'DELETE', undefined, child.id); api.mutate('tasks', 'DELETE', undefined, task.id);
      assert.deepEqual(snapshot(store), before);
    } finally { close(); }
  });
  test(`${backend}: phase conversion and parent materialization preserve task history and every unrelated collection atomically`, () => {
    const { store, api, close } = fixture();
    try {
      const phase = 'Ateliers'; const sourceTasks = store.all('tasks').filter(task => task.projectId === 'project-nova');
      for (const task of sourceTasks) store.put('tasks', { ...task, phase: ` ${phase} ` });
      const foreignTask = api.mutate('tasks', 'POST', taskPayload({ projectId: 'project-mobile', phase })).value as Task;
      const explicit = api.mutate('task-lists', 'POST', { ...listPayload, name: 'Explicite' }).value as ProjectTaskList;
      api.mutate('tasks', 'PATCH', { listId: explicit.id }, sourceTasks[0].id);
      const before = snapshot(store);
      const converted = api.mutate('task-lists', 'POST', { ...listPayload, name: 'Phase renommée', sourcePhase: ` ${phase} ` }).value as ProjectTaskList;
      assert.equal(Object.hasOwn(converted, 'sourcePhase'), false);
      for (const task of before.tasks) {
        const moved = store.get('tasks', task.id)!;
        const expectedMove = task.projectId === 'project-nova' && !task.listId;
        assert.deepEqual(moved, expectedMove ? { ...task, listId: converted.id } : task);
      }
      assert.deepEqual(store.get('tasks', foreignTask.id), foreignTask);
      for (const table of TABLES.filter(table => !['tasks', 'taskLists'].includes(table))) assert.deepEqual(snapshot(store)[table], before[table]);
      const rootTask = api.mutate('tasks', 'POST', taskPayload({ phase: 'Préparation' })).value as Task;
      const sub = api.mutate('task-lists', 'POST', { ...listPayload, name: 'Réunion', parentPhase: ' Préparation ' }).value as ProjectTaskList;
      const parent = store.get('taskLists', sub.parentId!)!;
      assert.equal(parent.name, 'Préparation'); assert.equal(parent.parentId, null); assert.equal(store.get('tasks', rootTask.id)!.listId, parent.id);
      const next = api.mutate('task-lists', 'POST', { ...listPayload, name: 'Compte rendu', parentPhase: 'Préparation' }).value as ProjectTaskList;
      assert.equal(next.parentId, parent.id, 'A materialized legacy parent is reused for a second child.');
      const stable = snapshot(store);
      rejection(409, () => api.mutate('task-lists', 'POST', { ...listPayload, parentPhase: 'Phase inexistante' }));
      rejection(409, () => api.mutate('task-lists', 'POST', { ...listPayload, sourcePhase: phase }));
      rejection(400, () => api.mutate('task-lists', 'POST', { ...listPayload, parentPhase: 'Préparation', parentId: parent.id }));
      rejection(400, () => api.mutate('task-lists', 'POST', { ...listPayload, sourcePhase: 'Sans phase' }));
      assert.deepEqual(snapshot(store), stable);
      const rollbackTask = api.mutate('tasks', 'POST', taskPayload({ phase: 'À convertir' })).value as Task;
      const rollbackBefore = snapshot(store);
      rejection(409, () => api.mutate('task-lists', 'POST', { ...listPayload, parentPhase: 'À convertir', sourcePhase: 'Non existante' }));
      assert.deepEqual(snapshot(store), rollbackBefore); assert.equal(store.get('tasks', rollbackTask.id)!.listId, undefined);
    } finally { close(); }
  });
  test(`${backend}: task lists reject cycles, cross-project membership, malformed contracts and excessive descendant depth`, () => {
    const { store, api, close } = fixture();
    try {
      const root = api.mutate('task-lists', 'POST', listPayload).value as ProjectTaskList;
      const child = api.mutate('task-lists', 'POST', { ...listPayload, parentId: root.id }).value as ProjectTaskList;
      const foreign = api.mutate('task-lists', 'POST', { ...listPayload, projectId: 'project-mobile' }).value as ProjectTaskList;
      const before = snapshot(store);
      for (const payload of [{ ...listPayload, id: 'forged' }, { ...listPayload, name: ' ' }, { ...listPayload, parentId: foreign.id }]) rejection(400, () => api.mutate('task-lists', 'POST', payload));
      rejection(404, () => api.mutate('task-lists', 'POST', { ...listPayload, projectId: 'missing' }));
      rejection(404, () => api.mutate('task-lists', 'POST', { ...listPayload, parentId: 'missing' }));
      for (const patch of [{}, { projectId: 'project-mobile' }, { id: 'forged' }]) rejection(400, () => api.mutate('task-lists', 'PATCH', patch, root.id));
      rejection(409, () => api.mutate('task-lists', 'PATCH', { parentId: root.id }, root.id));
      rejection(409, () => api.mutate('task-lists', 'PATCH', { parentId: child.id }, root.id));
      rejection(400, () => api.mutate('task-lists', 'PATCH', { parentId: foreign.id }, child.id));
      rejection(400, () => api.mutate('tasks', 'POST', taskPayload({ listId: foreign.id })));
      rejection(404, () => api.mutate('tasks', 'POST', taskPayload({ listId: 'missing' })));
      rejection(400, () => api.mutate('tasks', 'PATCH', { listId: foreign.id }, 'task-ateliers'));
      rejection(400, () => api.mutate('tasks', 'PATCH', { listId: '' }, 'task-ateliers'));
      assert.deepEqual(snapshot(store), before);
      let parent = child;
      for (let depth = 3; depth <= MAX_TASK_LIST_DEPTH; depth++) parent = api.mutate('task-lists', 'POST', { ...listPayload, parentId: parent.id }).value as ProjectTaskList;
      const atLimit = snapshot(store); rejection(409, () => api.mutate('task-lists', 'POST', { ...listPayload, parentId: parent.id }));
      const newRoot = api.mutate('task-lists', 'POST', listPayload).value as ProjectTaskList;
      rejection(409, () => api.mutate('task-lists', 'PATCH', { parentId: newRoot.id }, root.id));
      api.mutate('task-lists', 'DELETE', undefined, newRoot.id); assert.deepEqual(snapshot(store), atLimit);
    } finally { close(); }
  });
  test(`${backend}: project locks and project deletion preserve empty lists and existing history`, () => {
    const { store, api, close } = fixture();
    try {
      const project = api.mutate('projects', 'POST', { name: 'Liste seule', zoneId: 'zone-transformation', startDate: '2026-10-12', endDate: '2026-10-31' }).value as Project;
      const list = api.mutate('task-lists', 'POST', { ...listPayload, projectId: project.id }).value as ProjectTaskList;
      rejection(409, () => api.mutate('projects', 'DELETE', undefined, project.id));
      for (const status of ['paused', 'closed']) {
        api.mutate('projects', 'PATCH', { status }, project.id); const before = snapshot(store);
        rejection(409, () => api.mutate('task-lists', 'POST', { ...listPayload, projectId: project.id }));
        rejection(409, () => api.mutate('task-lists', 'PATCH', { name: 'Interdit' }, list.id));
        rejection(409, () => api.mutate('task-lists', 'DELETE', undefined, list.id));
        rejection(409, () => api.mutate('tasks', 'POST', taskPayload({ projectId: project.id, listId: list.id })));
        assert.deepEqual(snapshot(store), before);
      }
      api.mutate('projects', 'PATCH', { status: 'open' }, project.id); api.mutate('task-lists', 'DELETE', undefined, list.id); api.mutate('projects', 'DELETE', undefined, project.id);
    } finally { close(); }
  });
  test(`${backend}: storage limits roll back phase materialization, newly nested lists and every task membership together`, () => {
    const { store, api, close } = fixture();
    try {
      const phase = store.get('tasks', 'task-ateliers')!.phase.trim();
      const project = store.get('projects', 'project-nova')!;
      store.put('projects', { ...project, description: '' });
      const core = workspaceStorageUsage(snapshot(store)).core;
      store.put('projects', { ...project, description: 'x'.repeat(MAX_CORE_WORKSPACE_BYTES - core - 50) });
      const before = snapshot(store); assert.ok(workspaceStorageUsage(before).core < MAX_CORE_WORKSPACE_BYTES);
      rejection(413, () => api.mutate('task-lists', 'POST', { ...listPayload, parentPhase: phase }));
      assert.deepEqual(snapshot(store), before);
      assert.equal(store.get('tasks', 'task-ateliers')!.listId, undefined);
    } finally { close(); }
  });
  test(`${backend}: template clones remap nested lists and dependencies, preserve absent/null membership and roll back all inserted records`, () => {
    const { store, api, close } = fixture();
    try {
      const template = api.mutate('project-templates', 'POST', templatePayload()).value as ProjectTemplate;
      const project = api.mutate('projects', 'POST', { name: 'Clone', zoneId: 'zone-transformation', startDate: '2026-10-12', endDate: '2026-11-12', templateId: template.id }).value as Project;
      const lists = store.all('taskLists').filter(list => list.projectId === project.id); assert.equal(lists.length, 3);
      const parent = lists.find(list => list.name === 'Parent')!, child = lists.find(list => list.name === 'Sous-liste')!, empty = lists.find(list => list.name === 'Vide')!;
      assert.equal(parent.parentId, null); assert.equal(child.parentId, parent.id); assert.equal(empty.parentId, child.id); assert.ok(lists.every(list => !['parent', 'child', 'empty'].includes(list.id)));
      const tasks = store.all('tasks').filter(task => task.projectId === project.id);
      const first = tasks.find(task => task.title === 'Tâche listée')!, second = tasks.find(task => task.title === 'Racine explicite')!, third = tasks.find(task => task.title === 'Phase historique')!;
      assert.equal(first.listId, child.id); assert.equal(first.phase, 'Phase conservée'); assert.equal(second.listId, null); assert.equal(second.dependsOnId, first.id);
      assert.equal(Object.hasOwn(third, 'listId'), false); assert.equal(first.startDate, '2026-10-12'); assert.equal(second.endDate, '2026-10-15');
      assert.equal(store.all('tasks').some(task => task.listId === empty.id), false); assert.ok(tasks.every(task => task.progress === 0 && task.status === 'todo' && task.assigneeId === null));
      const stable = snapshot(store);
      rejection(400, () => api.mutate('project-templates', 'PATCH', { taskLists: [{ key: 'child', name: 'Cycle', parentKey: 'child' }] }, template.id));
      rejection(400, () => api.mutate('project-templates', 'PATCH', { taskLists: [] }, template.id)); assert.deepEqual(snapshot(store), stable);
      const bad = api.mutate('project-templates', 'POST', { ...templatePayload(), name: 'Dates hors limite', tasks: [{ key: 'bad', title: 'Impossible', listKey: 'child', startOffsetDays: 1, endOffsetDays: 2 }] }).value as ProjectTemplate;
      const before = snapshot(store);
      rejection(400, () => api.mutate('projects', 'POST', { name: 'Ne doit pas persister', zoneId: 'zone-transformation', startDate: '9999-12-31', endDate: '9999-12-31', templateId: bad.id }));
      assert.deepEqual(snapshot(store), before);
    } finally { close(); }
  });
}

test('legacy snapshots default only absent task lists, preserve task phase bytes and reject malformed or cross-project trees', () => {
  const store = new MemoryStore(); seed(store); const api = new ApiService(store, actor);
  const { taskLists: _lists, ...legacy } = store.snapshot(); const original = structuredClone(legacy);
  assert.deepEqual(new MemoryStore(legacy).snapshot(), { ...legacy, taskLists: [] }); assert.deepEqual(legacy, original);
  for (const invalid of [undefined, null, {}, [null], [{}]]) assert.throws(() => new MemoryStore({ ...legacy, taskLists: invalid } as unknown as CompatibleWorkspaceSnapshot));
  const root = api.mutate('task-lists', 'POST', listPayload).value as ProjectTaskList;
  for (const patch of [{ parentId: root.id }, { parentId: 'missing' }, { projectId: 'missing' }]) assert.throws(() => new MemoryStore({ ...legacy, taskLists: [{ ...root, ...patch }] }));
  for (const listId of ['missing', '', 123]) assert.throws(() => new MemoryStore({ ...legacy, taskLists: [root], tasks: [{ ...legacy.tasks[0], listId }, ...legacy.tasks.slice(1)] } as unknown as CompatibleWorkspaceSnapshot));
});

test('SQLite adds task lists and nullable task references without rewriting nineteen collections and preserves membership after restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'planzone8-task-lists-sql-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'workspace.sqlite'); let store = new Store(path); seed(store);
  const before = snapshot(store); const rawTasks = store.db.prepare('SELECT id, data FROM tasks ORDER BY rowid').all() as { id: string; data: string }[]; store.close();
  const legacyDb = new DatabaseSync(path);
  legacyDb.exec("PRAGMA foreign_keys = OFF; DROP TABLE tasks; DROP TABLE taskLists; CREATE TABLE tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)), projectId TEXT GENERATED ALWAYS AS (json_extract(data, '$.projectId')) STORED REFERENCES projects(id), assigneeId TEXT GENERATED ALWAYS AS (json_extract(data, '$.assigneeId')) STORED REFERENCES resources(id), dependsOnId TEXT GENERATED ALWAYS AS (json_extract(data, '$.dependsOnId')) STORED REFERENCES tasks(id));");
  for (const task of rawTasks) legacyDb.prepare('INSERT INTO tasks (id,data) VALUES (?,?)').run(task.id, task.data); legacyDb.close(); store = new Store(path);
  try {
    assert.deepEqual(snapshot(store), before); assert.deepEqual(store.db.prepare('SELECT id,data FROM tasks ORDER BY rowid').all(), rawTasks);
    const api = new ApiService(store, actor); const list = api.mutate('task-lists', 'POST', listPayload).value as ProjectTaskList;
    assert.throws(() => store.put('taskLists', { ...list, id: 'orphan', projectId: 'missing' }), /FOREIGN KEY/);
    assert.throws(() => store.put('taskLists', { ...list, id: 'orphan', parentId: 'missing' }), /FOREIGN KEY/);
    assert.throws(() => store.put('tasks', { ...before.tasks[0], listId: 'missing' }), /FOREIGN KEY/);
    api.mutate('tasks', 'PATCH', { listId: list.id }, 'task-ateliers'); const saved = api.readState('2026-10-12');
    store.close(); store = new Store(path); assert.deepEqual(new ApiService(store, actor).readState('2026-10-12'), saved);
    for (const table of TABLES.filter(table => !['taskLists', 'tasks'].includes(table))) assert.deepEqual(snapshot(store)[table], before[table]);
  } finally { store.close(); }
});

test('SQLite HTTP authenticates task-list writes, enforces origins and body bounds, and includes twenty-two collections', async t => {
  const instance = createApp({ dbPath: ':memory:', today: '2026-10-12', admin }); await instance.ready;
  const server = instance.app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); instance.close(); });
  const address = server.address(); assert.ok(address && typeof address !== 'string'); const origin = `http://127.0.0.1:${address.port}`;
  const request = (method: string, path: string, body?: unknown, cookie?: string, extraHeaders?: Record<string, string>) => fetch(`${origin}${path}`, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  for (const method of ['POST', 'PATCH', 'DELETE']) assert.equal((await request(method, `/api/task-lists${method === 'POST' ? '' : '/missing'}`, method === 'POST' ? listPayload : method === 'PATCH' ? { name: 'Other' } : undefined)).status, 401);
  const login = await request('POST', '/api/auth/login', { username: admin.username, password: admin.password }); assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie')!.split(';', 1)[0];
  assert.equal((await request('POST', '/api/task-lists', listPayload, cookie, { Origin: 'https://other.test' })).status, 403);
  assert.equal((await request('POST', '/api/task-lists', { ...listPayload, name: 'x'.repeat(110000) }, cookie)).status, 413);
  const create = await request('POST', '/api/task-lists', listPayload, cookie); assert.equal(create.status, 201);
  const state = await (await request('GET', '/api/state', undefined, cookie)).json() as AppData;
  assert.equal(TABLES.length, 22); for (const table of TABLES) assert.ok(Array.isArray(state[table])); assert.equal(state.taskLists!.length, 1);
});

test('actual Worker/D1 reads absent task lists without revision changes and atomically preserves nineteen collections through conversion and restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'planzone8-task-lists-d1-'));
  const bundled = await build({ entryPoints: [resolve('cloudflare/worker.ts')], write: false, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent' });
  const databaseId = randomUUID(), workspaceId = randomUUID();
  const runtime = () => new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-10-06', host: '127.0.0.1', port: 0, cf: false, log: new Log(LogLevel.ERROR), resourcePersistencePath: directory, d1Databases: { DB: databaseId }, bindings: { DEMO_TODAY: '2026-10-12' }, serviceBindings: { ASSETS: () => new MiniflareResponse('Task lists fixture') } }));
  let instance = runtime(); await instance.ready; t.after(async () => { await instance.dispose(); await rm(directory, { recursive: true, force: true }); });
  const db = () => instance.getD1Database('DB'); await new AuthManager(new D1AuthDatabase(await db() as unknown as D1Database)).createAdmin({ ...admin, workspaceId });
  const request = (method: string, path: string, body?: unknown, cookie?: string, extraHeaders?: Record<string, string>) => instance.dispatchFetch(`https://planzone8.test${path}`, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  for (const method of ['POST', 'PATCH', 'DELETE']) assert.equal((await request(method, `/api/task-lists${method === 'POST' ? '' : '/missing'}`, method === 'POST' ? listPayload : method === 'PATCH' ? { name: 'Other' } : undefined)).status, 401);
  const login = await request('POST', '/api/auth/login', { username: admin.username, password: admin.password }); assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie')!.split(';', 1)[0]; await request('GET', '/api/state', undefined, cookie);
  const initial = new MemoryStore(); seed(initial); const { taskLists: _lists, ...legacy } = initial.snapshot(); legacy.projects[0].description = 'Donnée conservée';
  await (await db()).prepare('UPDATE demo_workspaces SET data = ? WHERE id = ?').bind(JSON.stringify(legacy), workspaceId).run();
  const row = async () => { const value = await (await db()).prepare('SELECT data,revision FROM demo_workspaces WHERE id = ?').bind(workspaceId).first<{ data: string; revision: number }>(); assert.ok(value); return value; };
  const before = await row(); const state = await (await request('GET', '/api/state', undefined, cookie)).json() as AppData; assert.deepEqual(state.taskLists, []); assert.deepEqual(await row(), before);
  assert.equal((await request('POST', '/api/task-lists', listPayload, cookie, { Origin: 'https://other.test' })).status, 403);
  assert.equal((await request('POST', '/api/task-lists', { ...listPayload, id: 'forged' }, cookie)).status, 400); assert.deepEqual(await row(), before);
  const phase = legacy.tasks.find(task => task.projectId === 'project-nova' && task.phase.trim() && task.phase.trim() !== 'Sans phase')!.phase.trim();
  const create = await request('POST', '/api/task-lists', { ...listPayload, sourcePhase: phase }, cookie); assert.equal(create.status, 201); const list = await create.json() as ProjectTaskList;
  const first = await row(); assert.equal(first.revision, before.revision + 1); const firstSnapshot = JSON.parse(first.data) as WorkspaceSnapshot;
  for (const table of TABLES.filter((table): table is Exclude<Table, 'taskLists' | 'tasks'> => table !== 'taskLists' && table !== 'tasks')) assert.deepEqual(firstSnapshot[table], legacy[table]);
  for (const task of legacy.tasks) assert.deepEqual(firstSnapshot.tasks.find(value => value.id === task.id), task.projectId === list.projectId && task.phase.trim() === phase ? { ...task, listId: list.id } : task);
  assert.equal((await request('PATCH', `/api/task-lists/${list.id}`, { parentId: list.id }, cookie)).status, 409);
  assert.equal((await request('DELETE', `/api/task-lists/${list.id}`, undefined, cookie)).status, 409); assert.deepEqual(await row(), first);
  const persisted = await (await request('GET', '/api/state', undefined, cookie)).json(); await instance.dispose(); instance = runtime(); await instance.ready;
  assert.deepEqual(await (await request('GET', '/api/state', undefined, cookie)).json(), persisted); assert.deepEqual(await row(), first);
  assert.equal((await request('POST', '/api/auth/logout', {}, cookie)).status, 204);
  assert.equal((await request('PATCH', `/api/task-lists/${list.id}`, { name: 'Interdit' }, cookie)).status, 401);
});
