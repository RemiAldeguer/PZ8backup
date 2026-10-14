import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { Store } from '../server/store.ts';
import { MemoryStore } from '../server/memory-store.ts';
import { seed } from '../server/seed.ts';
import { ApiService, ApiError } from '../server/service.ts';
import { TABLES, type StoreLike, type WorkspaceSnapshot } from '../server/contracts.ts';
import { createApp } from '../server/app.ts';
import { MAX_CORE_WORKSPACE_BYTES } from '../server/collaboration-validation.ts';
import { buildProjectTaskListTree, orderedTaskListItems } from '../shared/task-lists.ts';
import { templateFromProject } from '../shared/customization.ts';
import { planProjectItemMove, ProjectItemMoveError, type ProjectItemReference, type ProjectItemTarget, type ProjectItemPlacement } from '../shared/project-item-moves.ts';
import type { Project, ProjectTaskList, Task } from '../shared/types.ts';

const actor = { id: 'resource-claire', name: 'Administrateur', role: 'Administrateur' as const };
const admin = { username: 'admin', password: 'Moves-Isolated-Tests-2026!', name: actor.name };
const snapshot = (store: StoreLike) => Object.fromEntries(TABLES.map(table => [table, store.all(table)])) as WorkspaceSnapshot;
function names(api: ApiService, projectId: string, parentId?: string) {
  const tree = buildProjectTaskListTree(api.readState(), projectId);
  const parent = parentId ? tree.nodes.get(parentId)! : null;
  return orderedTaskListItems(parent?.tasks ?? tree.rootTasks, parent?.children ?? tree.roots).map(item => item.type === 'task' ? item.task.title : item.node.name);
}
function owner(api: ApiService, name = 'Ordre du projet') {
  return api.mutate('projects', 'POST', { name, zoneId: api.readState().zones[0].id, startDate: '2026-10-01', endDate: '2027-10-01' }).value as Project;
}
const list = (api: ApiService, project: Project, name: string, parentId: string | null = null) => api.mutate('task-lists', 'POST', { projectId: project.id, name, parentId }).value as ProjectTaskList;
const task = (api: ApiService, project: Project, title: string, extra: Record<string, unknown> = {}) => api.mutate('tasks', 'POST', { projectId: project.id, title, phase: 'Sans phase', ...extra }).value as Task;
const move = (api: ApiService, project: Project, source: ProjectItemReference, target: ProjectItemTarget, placement: ProjectItemPlacement) => api.mutate('project-item-moves', 'POST', { projectId: project.id, source, target, placement });
const reject = (status: number, action: () => unknown) => assert.throws(action, error => error instanceof ApiError && error.status === status);

for (const backend of ['sqlite', 'memory'] as const) {
  const fixture = () => { const store = backend === 'sqlite' ? new Store(':memory:') : new MemoryStore(); seed(store); return { store, api: new ApiService(store, actor), close: () => { if (store instanceof Store) store.close(); } }; };
  test(`${backend}: project items mix tasks and lists before/inside/after, preserve descendants, and persist their shared order`, () => {
    const { store, api, close } = fixture();
    try {
      const project = owner(api); const a = list(api, project, 'Liste A'); const b = list(api, project, 'Liste B');
      const child = list(api, project, 'Enfant', a.id); const nested = task(api, project, 'Tâche enfant', { listId: child.id, allocatedHours: 20 });
      const t = task(api, project, 'Tâche déplacée', { allocatedHours: 7.5 }); const milestone = task(api, project, 'Jalon', { kind: 'milestone' });
      const before = snapshot(store);
      move(api, project, { type: 'task', id: t.id }, { type: 'list', id: a.id }, 'after');
      assert.deepEqual(names(api, project.id), ['Jalon', 'Liste A', 'Tâche déplacée', 'Liste B']);
      move(api, project, { type: 'task', id: milestone.id }, { type: 'list', id: a.id }, 'inside');
      move(api, project, { type: 'task', id: t.id }, { type: 'list', id: child.id }, 'before');
      assert.deepEqual(names(api, project.id, a.id), ['Tâche déplacée', 'Enfant', 'Jalon']);
      move(api, project, { type: 'list', id: a.id }, { type: 'list', id: b.id }, 'inside');
      assert.equal(store.get('taskLists', a.id)!.parentId, b.id);
      assert.equal(store.get('taskLists', child.id)!.parentId, a.id);
      assert.equal(store.get('tasks', nested.id)!.listId, child.id);
      move(api, project, { type: 'list', id: a.id }, { type: 'list', id: b.id }, 'before');
      assert.deepEqual(names(api, project.id), ['Liste A', 'Liste B']);
      move(api, project, { type: 'task', id: milestone.id }, { type: 'root' }, 'inside');
      assert.deepEqual(names(api, project.id), ['Liste A', 'Liste B', 'Jalon']);
      assert.equal(store.get('tasks', milestone.id)!.phase, 'Sans phase');
      for (const table of TABLES.filter(table => table !== 'tasks' && table !== 'taskLists')) assert.deepEqual(snapshot(store)[table], before[table]);
      const restored = new MemoryStore(snapshot(store)); assert.deepEqual(names(new ApiService(restored, actor), project.id), ['Liste A', 'Liste B', 'Jalon']);
      if (store instanceof Store) assert.equal(store.db.prepare('SELECT count(*) AS n FROM tasks WHERE listId = ?').get(child.id)!.n, 1);
    } finally { close(); }
  });
  test(`${backend}: moving legacy phases preserves task history and order, and keeps all unrelated records intact`, () => {
    const { store, api, close } = fixture();
    try {
      const project = owner(api); const a = task(api, project, 'Atelier', { phase: 'Préparation', allocatedHours: 12, status: 'done', progress: 100 });
      const b = task(api, project, 'Recette', { phase: 'Livraison' }); const root = task(api, project, 'Hors liste');
      api.mutate('comments', 'POST', { taskId: a.id, body: 'Historique conservé' });
      const before = snapshot(store);
      move(api, project, { type: 'phase', phase: 'Préparation' }, { type: 'phase', phase: 'Livraison' }, 'inside');
      const lists = store.all('taskLists').filter(item => item.projectId === project.id); const prepared = lists.find(item => item.name === 'Préparation')!; const delivery = lists.find(item => item.name === 'Livraison')!;
      assert.equal(prepared.parentId, delivery.id);
      assert.deepEqual(names(api, project.id), ['Hors liste', 'Livraison']);
      for (const original of [a, b, root]) { const current = store.get('tasks', original.id)!; const { position: _position, listId: _list, ...business } = current; assert.deepEqual(business, original); }
      assert.deepEqual(store.all('comments'), before.comments);
      for (const table of TABLES.filter(table => table !== 'tasks' && table !== 'taskLists')) assert.deepEqual(snapshot(store)[table], before[table]);
    } finally { close(); }
  });
  test(`${backend}: invalid, foreign, cyclic and locked moves leave every record unchanged`, () => {
    const { store, api, close } = fixture();
    try {
      const project = owner(api); const foreign = owner(api, 'Étranger'); const a = list(api, project, 'Parent'); const child = list(api, project, 'Enfant', a.id); const t = task(api, project, 'Tâche'); const destination = task(api, project, 'Destination'); const other = task(api, foreign, 'Autre');
      let stable = snapshot(store);
      reject(409, () => move(api, project, { type: 'list', id: a.id }, { type: 'list', id: child.id }, 'inside'));
      reject(409, () => move(api, project, { type: 'list', id: a.id }, { type: 'list', id: child.id }, 'after'));
      reject(409, () => move(api, project, { type: 'task', id: t.id }, { type: 'task', id: t.id }, 'before'));
      reject(404, () => move(api, project, { type: 'task', id: other.id }, { type: 'list', id: a.id }, 'inside'));
      reject(400, () => move(api, project, { type: 'task', id: t.id }, { type: 'task', id: destination.id }, 'inside'));
      reject(400, () => api.mutate('project-item-moves', 'POST', { projectId: project.id, source: { type: 'task', id: t.id }, target: { type: 'root' }, placement: 'inside', position: 99 }));
      reject(405, () => api.mutate('project-item-moves', 'PATCH', {}, 'x'));
      assert.deepEqual(snapshot(store), stable);
      api.mutate('projects', 'PATCH', { status: 'paused' }, project.id); stable = snapshot(store);
      reject(409, () => move(api, project, { type: 'task', id: t.id }, { type: 'list', id: a.id }, 'inside')); assert.deepEqual(snapshot(store), stable);
    } finally { close(); }
  });
  test(`${backend}: manual parent changes append the item, and templates preserve the mixed positions`, () => {
    const { store, api, close } = fixture();
    try {
      const project = owner(api); const a = list(api, project, 'A'); const b = list(api, project, 'B'); const t = task(api, project, 'T');
      move(api, project, { type: 'task', id: t.id }, { type: 'list', id: a.id }, 'after');
      const template = templateFromProject(project, store.all('tasks'), store.all('taskLists'));
      const saved = api.mutate('project-templates', 'POST', template).value!;
      const clone = api.mutate('projects', 'POST', { name: 'Copie', zoneId: project.zoneId, startDate: project.startDate, endDate: project.endDate, templateId: saved.id }).value as Project;
      assert.deepEqual(names(api, clone.id), ['A', 'T', 'B']);
      api.mutate('tasks', 'PATCH', { listId: b.id }, t.id); assert.equal(store.get('tasks', t.id)!.position, undefined);
      api.mutate('task-lists', 'PATCH', { parentId: b.id }, a.id); assert.equal(store.get('taskLists', a.id)!.position, undefined);
      assert.deepEqual(names(api, project.id, b.id), ['T', 'A']);
    } finally { close(); }
  });
  test(`${backend}: excessive depth and storage growth roll back the entire move and phase conversion`, () => {
    const { store, api, close } = fixture();
    try {
      const project = owner(api); const source = list(api, project, 'Branche'); list(api, project, 'Descendant', source.id);
      task(api, project, 'Phase historique', { phase: 'À conserver' });
      let destination: ProjectTaskList | null = null;
      for (let index = 0; index < 19; index++) destination = list(api, project, `Niveau ${index}`, destination?.id ?? null);
      const before = snapshot(store);
      reject(409, () => move(api, project, { type: 'list', id: source.id }, { type: 'list', id: destination!.id }, 'inside'));
      assert.deepEqual(snapshot(store), before);
      store.put('projects', { ...store.get('projects', project.id)!, description: 'x'.repeat(MAX_CORE_WORKSPACE_BYTES) });
      const oversized = snapshot(store);
      reject(413, () => move(api, project, { type: 'list', id: source.id }, { type: 'root' }, 'inside'));
      assert.deepEqual(snapshot(store), oversized);
    } finally { close(); }
  });
}

test('move planner is read-only, respects mixed order and rejects list descendants before materializing phases', () => {
  const store = new MemoryStore(); seed(store); const api = new ApiService(store, actor); const project = owner(api); const a = list(api, project, 'A'); const child = list(api, project, 'Child', a.id); task(api, project, 'Legacy', { phase: 'Ancienne' });
  const data = api.readState(); const before = structuredClone(data); let generated = 0;
  assert.throws(() => planProjectItemMove(data, { projectId: project.id, source: { type: 'list', id: a.id }, target: { type: 'list', id: child.id }, placement: 'inside' }, () => { generated++; return 'new'; }), ProjectItemMoveError);
  assert.equal(generated, 0); assert.deepEqual(data, before);
});

test('SQLite move positions survive closing and reopening the database', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'planzone8-moves-')); const path = join(dir, 'moves.sqlite');
  let store = new Store(path);
  try {
    seed(store); let api = new ApiService(store, actor); const project = owner(api); const a = list(api, project, 'A'); const t = task(api, project, 'T');
    move(api, project, { type: 'task', id: t.id }, { type: 'list', id: a.id }, 'after'); store.close(); store = new Store(path); api = new ApiService(store, actor);
    assert.deepEqual(names(api, project.id), ['A', 'T']);
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

test('Express protects project-item moves with authentication, origin and strict validation', async () => {
  const instance = createApp({ dbPath: ':memory:', admin }); await instance.ready; const server = instance.app.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
  const request = (path: string, payload: unknown, cookie?: string, origin = base) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(payload) });
  try {
    assert.equal((await request('/api/project-item-moves', {})).status, 401);
    const login = await request('/api/auth/login', { username: admin.username, password: admin.password }); assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const data = await (await fetch(base + '/api/state', { headers: { Cookie: cookie } })).json();
    const selected = data.tasks.find((item: Task) => item.projectId === 'project-nova');
    const body = { projectId: 'project-nova', source: { type: 'task', id: selected.id }, target: { type: 'root' }, placement: 'inside' };
    assert.equal((await request('/api/project-item-moves', body, cookie, 'https://foreign.test')).status, 403);
    assert.equal((await request('/api/project-item-moves', { ...body, placement: 'invalid' }, cookie)).status, 400);
    assert.equal((await request('/api/project-item-moves', body, cookie)).status, 200);
    const after = await (await fetch(base + '/api/state', { headers: { Cookie: cookie } })).json();
    assert.equal(after.tasks.find((item: Task) => item.id === selected.id).listId, null);
    assert.equal(after.tasks.find((item: Task) => item.id === selected.id).phase, 'Sans phase');
  } finally { server.close(); await once(server, 'close'); instance.close(); }
});
