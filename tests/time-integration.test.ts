import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/store.ts';
import { MemoryStore } from '../server/memory-store.ts';
import { ApiError, ApiService } from '../server/service.ts';
import { seed } from '../server/seed.ts';
import { createApp } from '../server/app.ts';
import { TABLES, type StoreLike, type WorkspaceSnapshot } from '../server/contracts.ts';
import { MAX_CORE_WORKSPACE_BYTES } from '../server/collaboration-validation.ts';
import { isCivilDate, timeIntegrationIndex } from '../shared/time-integration.ts';
import { buildTimeSheet } from '../shared/time-sheets.ts';
import type { Project, Resource, Task, TimeEntry } from '../shared/types.ts';

const admin = { id: 'resource-claire', name: 'Administrateur', role: 'Administrateur' as const };
const snapshot = (store: StoreLike) => structuredClone(Object.fromEntries(TABLES.map(table => [table, store.all(table)]))) as WorkspaceSnapshot;
function rejected(status: number, action: () => unknown) { assert.throws(action, error => error instanceof ApiError && error.status === status); }
function fixture(backend: 'sqlite' | 'memory') {
  const store = backend === 'sqlite' ? new Store(':memory:') : new MemoryStore(); seed(store);
  const api = new ApiService(store, admin);
  const project = (name: string) => api.mutate('projects', 'POST', { name, zoneId: store.all('zones')[0].id, startDate: '2026-01-01', endDate: '2027-12-31' }).value as Project;
  const p = project('Projet intégré'); const other = project('Projet distinct');
  const a = store.get('resources', admin.id)!; const b = store.all('resources').find(resource => resource.active && resource.id !== a.id)!;
  const task = (project: Project, resource: Resource) => api.mutate('tasks', 'POST', { projectId: project.id, title: 'Tâche ' + resource.name, assigneeId: resource.id, allocatedHours: 30 }).value as Task;
  const ta = task(p, a); const tb = task(p, b); const outsideA = task(other, a); const outsideB = task(other, b);
  const entry = (task: Task, resource: Resource, date: string, validated = false) => api.mutate('time-entries', 'POST', { taskId: task.id, resourceId: resource.id, date, hours: 2, note: 'Historique et tarif conservés', validated }).value as TimeEntry;
  const early = entry(ta, a, '2026-09-01'); const before = entry(ta, a, '2026-10-05'); const boundary = entry(ta, a, '2026-10-06');
  const after = entry(ta, a, '2026-10-07'); const peer = entry(tb, b, '2026-10-06'); const outside = entry(outsideA, a, '2026-10-06');
  const distinct = entry(outsideB, b, '2026-10-06'); const manual = entry(ta, a, '2026-10-04', true);
  return { store, api, p, other, a, b, ta, tb, early, before, boundary, after, peer, outside, distinct, manual, close: () => { if (store instanceof Store) store.close(); } };
}
function projectDate(api: ApiService, p: Project, date: string | null) { return api.mutate('time-integrations', 'POST', { scope: 'project', projectId: p.id, date }); }
function resourceDate(api: ApiService, r: Resource, date: string | null) { return api.mutate('time-integrations', 'POST', { scope: 'resource', resourceId: r.id, date }); }
function publicEntry(api: ApiService, entry: TimeEntry) { return api.readState().timeEntries.find(item => item.id === entry.id)!; }

for (const backend of ['sqlite', 'memory'] as const) {
  test(backend + ': project cutoff validates all resources inclusively, including history outside the week, without rewriting entries', () => {
    const f = fixture(backend);
    try {
      const saved = snapshot(f.store); projectDate(f.api, f.p, '2026-10-06');
      for (const entry of [f.early, f.before, f.boundary, f.peer]) {
        assert.equal(publicEntry(f.api, entry).validated, true); assert.equal(publicEntry(f.api, entry).integrationValidated, true);
      }
      for (const entry of [f.after, f.outside, f.distinct]) assert.equal(publicEntry(f.api, entry).validated, false);
      assert.equal(f.store.get('resources', f.a.id)!.timeIntegrationDate, undefined);
      for (const table of TABLES.filter(table => table !== 'projects')) assert.deepEqual(f.store.all(table), saved[table]);
      assert.deepEqual(f.store.get('projects', f.other.id), f.other);
      const filtered = buildTimeSheet(f.api.readState(), { weekStart: '2026-10-05', projectId: f.p.id, validation: 'validated' });
      assert.ok(filtered.flatMap(row => row.entries).some(entry => entry.id === f.boundary.id));
      assert.ok(!filtered.flatMap(row => row.entries).some(entry => entry.id === f.after.id));
    } finally { f.close(); }
  });
  test(backend + ': resource cutoff applies across projects to that resource only', () => {
    const f = fixture(backend);
    try {
      resourceDate(f.api, f.a, '2026-10-06');
      for (const entry of [f.before, f.boundary, f.outside]) assert.equal(publicEntry(f.api, entry).validated, true);
      for (const entry of [f.after, f.peer, f.distinct]) assert.equal(publicEntry(f.api, entry).validated, false);
      assert.equal(f.store.get('projects', f.p.id)!.timeIntegrationDate, undefined);
      assert.equal(f.store.get('projects', f.other.id)!.timeIntegrationDate, undefined);
      assert.equal(f.store.get('resources', f.b.id)!.timeIntegrationDate, undefined);
    } finally { f.close(); }
  });
  test(backend + ': integrated periods reject creation, edits, backdating, unvalidation and deletion, even on days with no entries', () => {
    const f = fixture(backend);
    try {
      projectDate(f.api, f.p, '2026-10-06'); const before = snapshot(f.store);
      rejected(409, () => f.api.mutate('time-entries', 'POST', { taskId: f.ta.id, resourceId: f.a.id, date: '2026-10-03', hours: 1 }));
      for (const patch of [{ hours: 3 }, { note: 'Correction' }, { validated: false }, { date: '2026-10-09' }]) rejected(409, () => f.api.mutate('time-entries', 'PATCH', patch, f.boundary.id));
      rejected(409, () => f.api.mutate('time-entries', 'PATCH', { date: '2026-10-06' }, f.after.id));
      rejected(409, () => f.api.mutate('time-entries', 'DELETE', undefined, f.before.id));
      assert.deepEqual(snapshot(f.store), before);
      f.api.mutate('time-entries', 'PATCH', { hours: 3 }, f.after.id); f.api.mutate('time-entries', 'PATCH', { hours: 4 }, f.outside.id);
      assert.equal(f.store.get('timeEntries', f.after.id)!.hours, 3);
    } finally { f.close(); }
  });
  test(backend + ': lowering or removing independent dates preserves other cutoffs and individual validations', () => {
    const f = fixture(backend);
    try {
      const entries = f.store.all('timeEntries'); projectDate(f.api, f.p, '2026-10-06'); resourceDate(f.api, f.a, '2026-10-08');
      assert.equal(publicEntry(f.api, f.after).validated, true);
      resourceDate(f.api, f.a, '2026-10-05');
      assert.equal(publicEntry(f.api, f.after).validated, false); assert.equal(publicEntry(f.api, f.boundary).validated, true); assert.equal(publicEntry(f.api, f.outside).validated, false);
      projectDate(f.api, f.p, null); assert.equal(publicEntry(f.api, f.boundary).validated, false); assert.equal(publicEntry(f.api, f.before).validated, true);
      resourceDate(f.api, f.a, null); assert.equal(publicEntry(f.api, f.before).validated, false); assert.equal(publicEntry(f.api, f.manual).validated, true);
      assert.deepEqual(f.store.all('timeEntries'), entries);
      f.api.mutate('time-entries', 'PATCH', { hours: 1 }, f.boundary.id);
    } finally { f.close(); }
  });
  test(backend + ': resource delegation follows the authenticated validator; visitors and resource delegates cannot set project cutoffs', () => {
    const f = fixture(backend);
    try {
      f.store.put('resources', { ...f.b, role: 'user', validatesTimeForIds: [f.a.id] });
      const delegate = new ApiService(f.store, { id: f.b.id, name: f.b.name, role: 'Usager' });
      resourceDate(delegate, f.a, '2026-10-06'); rejected(403, () => resourceDate(delegate, f.b, '2026-10-06')); rejected(403, () => projectDate(delegate, f.p, '2026-10-06'));
      const visitor = new ApiService(f.store, { ...admin, role: 'Visiteur' });
      rejected(403, () => resourceDate(visitor, f.a, null)); rejected(403, () => projectDate(visitor, f.p, '2026-10-06'));
      assert.equal(f.store.get('resources', f.a.id)!.timeIntegrationDate, '2026-10-06');
    } finally { f.close(); }
  });
  test(backend + ': strict scope/date input and dedicated endpoint prevent bypass; project locks remain enforced', () => {
    const f = fixture(backend);
    try {
      const saved = snapshot(f.store);
      for (const date of ['2026-02-30', '06/10/2026', '', 42]) rejected(400, () => projectDate(f.api, f.p, date as string));
      rejected(400, () => f.api.mutate('time-integrations', 'POST', { scope: 'project', projectId: f.p.id, resourceId: f.a.id, date: '2026-10-06' }));
      rejected(400, () => f.api.mutate('projects', 'PATCH', { timeIntegrationDate: '2026-10-06' }, f.p.id));
      rejected(400, () => f.api.mutate('resources', 'PATCH', { timeIntegrationDate: '2026-10-06' }, f.a.id));
      rejected(405, () => f.api.mutate('time-integrations', 'PATCH', {}, f.p.id));
      rejected(404, () => resourceDate(f.api, { ...f.a, id: 'missing' }, '2026-10-06'));
      assert.deepEqual(snapshot(f.store), saved);
      f.api.mutate('projects', 'PATCH', { status: 'paused' }, f.p.id); rejected(409, () => projectDate(f.api, f.p, '2026-10-06'));
      resourceDate(f.api, f.a, '2026-10-06'); rejected(409, () => f.api.mutate('time-entries', 'PATCH', { hours: 1 }, f.boundary.id));
    } finally { f.close(); }
  });
  test(backend + ': reads and restores preserve legacy records, while normal project/resource forms keep managed dates', () => {
    const f = fixture(backend);
    try {
      const original = snapshot(f.store); f.api.readState(); assert.deepEqual(snapshot(f.store), original);
      projectDate(f.api, f.p, '2026-10-06'); resourceDate(f.api, f.a, '2026-10-05');
      f.api.mutate('projects', 'PATCH', { name: 'Nouveau nom' }, f.p.id); f.api.mutate('resources', 'PATCH', { name: 'Ressource renommée' }, f.a.id);
      assert.equal(f.store.get('projects', f.p.id)!.timeIntegrationDate, '2026-10-06'); assert.equal(f.store.get('resources', f.a.id)!.timeIntegrationDate, '2026-10-05');
      const saved = snapshot(f.store); const restored = new MemoryStore(saved); const api = new ApiService(restored, admin);
      assert.equal(publicEntry(api, f.boundary).validated, true); assert.deepEqual(restored.snapshot(), saved);
      const malformed = structuredClone(saved); malformed.projects.find(project => project.id === f.p.id)!.timeIntegrationDate = '2026-02-30';
      assert.throws(() => new MemoryStore(malformed), /Invalid workspace table: projects/);
    } finally { f.close(); }
  });
  test(backend + ': cutoff storage growth is atomic and rolls back when the workspace quota is exceeded', () => {
    const f = fixture(backend);
    try {
      f.store.put('projects', { ...f.p, description: 'x'.repeat(MAX_CORE_WORKSPACE_BYTES) }); const saved = snapshot(f.store);
      rejected(413, () => projectDate(f.api, f.p, '2026-10-06')); assert.deepEqual(snapshot(f.store), saved);
    } finally { f.close(); }
  });
}

test('civil integration dates preserve leap days and inclusive boundaries around daylight-saving changes', () => {
  assert.equal(isCivilDate('2024-02-29'), true); assert.equal(isCivilDate('2026-02-29'), false);
  assert.equal(isCivilDate('2026-03-29T00:00:00Z'), false);
  const f = fixture('memory');
  try {
    f.store.put('resources', { ...f.a, timeIntegrationDate: '2026-03-29' }); const index = timeIntegrationIndex(f.api.readState());
    assert.equal(index.covers('2026-03-28', f.a.id), true); assert.equal(index.covers('2026-03-29', f.a.id), true); assert.equal(index.covers('2026-03-30', f.a.id), false);
  } finally { f.close(); }
});

test('SQLite integration dates survive reopening without altering original time flags or rates', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'planzone8-integration-')); const path = join(directory, 'test.sqlite');
  let store = new Store(path);
  try {
    seed(store); const api = new ApiService(store, admin); const before = store.get('timeEntries', 'time-ateliers')!;
    projectDate(api, store.get('projects', 'project-nova')!, '2026-10-06'); store.close(); store = new Store(path);
    assert.equal(new ApiService(store, admin).readState().timeEntries.find(entry => entry.id === before.id)!.validated, true);
    assert.deepEqual(store.get('timeEntries', before.id), before);
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});

test('Express integration actions require authentication and trusted origin, then expose effective validation', async () => {
  const app = createApp({ dbPath: ':memory:', admin: { username: 'admin', password: 'Time-integration-test-2026!' } }); await app.ready;
  const server = app.app.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = 'http://127.0.0.1:' + address.port;
  const body = { scope: 'project', projectId: 'project-nova', date: '2026-10-06' };
  try {
    const write = (cookie = '', origin = base) => fetch(base + '/api/time-integrations', { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await write()).status, 401);
    const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ username: 'admin', password: 'Time-integration-test-2026!' }) }); assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await write(cookie, 'https://foreign.example')).status, 403); assert.equal((await write(cookie)).status, 200);
    const state = await (await fetch(base + '/api/state', { headers: { Cookie: cookie } })).json();
    assert.equal(state.projects.find((project: Project) => project.id === 'project-nova').timeIntegrationDate, '2026-10-06');
    assert.equal(state.timeEntries.find((entry: TimeEntry) => entry.id === 'time-ateliers').validated, true);
  } finally { server.close(); await once(server, 'close'); app.close(); }
});
