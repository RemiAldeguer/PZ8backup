import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { convertV4MiniflareOptions, Log, LogLevel, Miniflare, Response as MiniflareResponse } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { D1AuthDatabase } from '../cloudflare/auth-d1.ts';
import { createApp } from '../server/app.ts';
import { AuthManager } from '../server/auth.ts';
import { TABLES, type CompatibleWorkspaceSnapshot, type WorkspaceSnapshot } from '../server/contracts.ts';
import { MemoryStore } from '../server/memory-store.ts';
import { seed } from '../server/seed.ts';
import { ApiError, ApiService } from '../server/service.ts';
import { Store } from '../server/store.ts';
import type { AppData, Expense, Project, Revenue } from '../shared/types.ts';

const admin = { username: 'admin', password: 'Revenue-test-administrator-2026!', name: 'Administrateur' };
const input = {
  projectId: 'project-nova', label: 'Facturation de la livraison', amount: 1250.75,
  plannedDate: '2026-10-20', category: 'services',
};
function rejectsStatus(status: number, operation: () => unknown) {
  assert.throws(operation, error => error instanceof ApiError && error.status === status);
}

for (const backend of ['sqlite', 'memory'] as const) {
  const fixture = () => {
    const store = backend === 'sqlite' ? new Store(':memory:') : new MemoryStore();
    seed(store);
    return { store, api: new ApiService(store), close: () => { if (store instanceof Store) store.close(); } };
  };

  test(`${backend}: revenue CRUD preserves expense and cost records and supports early or future receipts`, () => {
    const { store, api, close } = fixture();
    try {
      const before = api.readState('2026-10-12');
      assert.deepEqual(before.revenues, []);
      const created = api.mutate('revenues', 'POST', { ...input, label: `  ${input.label}  ` });
      assert.equal(created.status, 201);
      const revenue = created.value as Revenue;
      assert.equal(revenue.label, input.label);
      assert.equal(revenue.receivedDate, null);
      assert.equal(revenue.amount, 1250.75);
      assert.equal(revenue.category, 'services');
      assert.match(revenue.id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);
      const received = api.mutate('revenues', 'PATCH', { receivedDate: '2026-10-01', amount: 1500.50, category: 'sales' }, revenue.id).value as Revenue;
      assert.equal(received.receivedDate, '2026-10-01', 'Early payment may precede the planned receipt.');
      const future = api.mutate('revenues', 'PATCH', { receivedDate: '2026-11-30' }, revenue.id).value as Revenue;
      assert.equal(future.receivedDate, '2026-11-30');
      const pending = api.mutate('revenues', 'PATCH', { receivedDate: null }, revenue.id).value as Revenue;
      assert.equal(pending.receivedDate, null);
      const zero = api.mutate('revenues', 'POST', { ...input, label: 'Acompte sans montant', amount: 0, category: 'grants' }).value as Revenue;
      const state = api.readState('2026-10-12');
      assert.deepEqual(state, { ...before, revenues: [pending, zero] });
      if (store instanceof MemoryStore) {
        const resumed = new ApiService(new MemoryStore(JSON.parse(JSON.stringify(store.snapshot()))));
        assert.deepEqual(resumed.readState('2026-10-12'), state);
      }
      assert.equal(api.mutate('revenues', 'DELETE', undefined, revenue.id).status, 204);
      assert.equal(api.mutate('revenues', 'DELETE', undefined, zero.id).status, 204);
      assert.deepEqual(api.readState('2026-10-12'), before);
    } finally { close(); }
  });

  test(`${backend}: invalid revenue amounts, dates, fields and cross-project reassignment leave records untouched`, () => {
    const { api, close } = fixture();
    try {
      const before = api.readState('2026-10-12');
      for (const patch of [
        { label: ' ' }, { amount: -1 }, { amount: Number.NaN }, { amount: Infinity }, { amount: 1e12 + 1 },
        { amount: '100' }, { plannedDate: '2026-02-29' }, { plannedDate: '12/10/2026' },
        { receivedDate: '2026-02-30' }, { receivedDate: '' }, { category: 'software' }, { unknown: true }, { id: 'forged' },
      ]) rejectsStatus(400, () => api.mutate('revenues', 'POST', { ...input, ...patch }));
      rejectsStatus(404, () => api.mutate('revenues', 'POST', { ...input, projectId: 'missing' }));
      assert.deepEqual(api.readState('2026-10-12'), before);
      const revenue = api.mutate('revenues', 'POST', input).value as Revenue;
      for (const patch of [{}, { projectId: 'project-mobile' }, { receivedDate: '2026-13-01' }, { category: 'unknown' }, { amount: null }, { id: revenue.id }]) {
        rejectsStatus(400, () => api.mutate('revenues', 'PATCH', patch, revenue.id));
      }
      rejectsStatus(404, () => api.mutate('revenues', 'PATCH', { label: 'Absent' }, 'missing'));
      rejectsStatus(404, () => api.mutate('revenues', 'DELETE', undefined, 'missing'));
      assert.deepEqual(api.readState('2026-10-12'), { ...before, revenues: [revenue] });
    } finally { close(); }
  });

  test(`${backend}: paused and closed projects lock every revenue mutation and revenue history blocks project deletion`, () => {
    const { api, close } = fixture();
    try {
      const project = api.mutate('projects', 'POST', {
        name: 'Projet avec recettes', zoneId: 'zone-transformation', startDate: '2026-10-12', endDate: '2026-10-31',
      }).value as Project;
      const revenue = api.mutate('revenues', 'POST', { ...input, projectId: project.id }).value as Revenue;
      rejectsStatus(409, () => api.mutate('projects', 'DELETE', undefined, project.id));
      for (const status of ['paused', 'closed'] as const) {
        api.mutate('projects', 'PATCH', { status }, project.id);
        const before = api.readState('2026-10-12');
        rejectsStatus(409, () => api.mutate('revenues', 'POST', { ...input, projectId: project.id }));
        rejectsStatus(409, () => api.mutate('revenues', 'PATCH', { amount: 99 }, revenue.id));
        rejectsStatus(409, () => api.mutate('revenues', 'DELETE', undefined, revenue.id));
        assert.deepEqual(api.readState('2026-10-12'), before);
      }
      api.mutate('projects', 'PATCH', { status: 'open' }, project.id);
      api.mutate('revenues', 'DELETE', undefined, revenue.id);
      assert.equal(api.mutate('projects', 'DELETE', undefined, project.id).status, 204);
    } finally { close(); }
  });

  test(`${backend}: supplies and legal expense types coexist with all existing categories`, () => {
    const { api, close } = fixture();
    try {
      const before = api.readState('2026-10-12');
      for (const category of ['software', 'training', 'equipment', 'supplies', 'legal', 'other'] as const) {
        const expense = api.mutate('expenses', 'POST', {
          projectId: 'project-nova', label: `Dépense ${category}`, amount: 10, plannedDate: '2026-10-12', category,
        }).value as Expense;
        assert.equal(expense.category, category);
      }
      assert.deepEqual(api.readState('2026-10-12').expenses.slice(0, before.expenses.length), before.expenses);
      assert.deepEqual(api.readState('2026-10-12').revenues, []);
    } finally { close(); }
  });
}

test('MemoryStore accepts an absent legacy revenue collection but rejects malformed provided values', () => {
  const store = new MemoryStore();
  seed(store);
  const snapshot = store.snapshot();
  const { revenues: _revenues, ...legacy } = snapshot;
  const before = structuredClone(legacy);
  const resumed = new MemoryStore(legacy);
  assert.deepEqual(resumed.snapshot(), { ...before, revenues: [] });
  assert.deepEqual(legacy, before, 'In-memory compatibility must not alter its source object.');
  for (const revenues of [null, undefined, {}, 'invalid', [null], [{}], [{ ...input, id: 'r', receivedDate: null, amount: -1 }], [{ ...input, id: 'r', receivedDate: '2026-02-30' }]]) {
    assert.throws(() => new MemoryStore({ ...legacy, revenues } as unknown as CompatibleWorkspaceSnapshot));
  }
  assert.throws(() => new MemoryStore({ ...snapshot, revenues: [{ ...input, id: 'r', category: 'services', receivedDate: null }, { ...input, id: 'r', category: 'services', receivedDate: null }] }));
});

test('SQLite creates only its missing revenues table and persists receipts without rewriting previous tables', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'planzone8-revenue-upgrade-'));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const path = join(directory, 'workspace.sqlite');
  let store = new Store(path);
  seed(store);
  const previousTables = TABLES.filter(table => table !== 'revenues');
  const before = Object.fromEntries(previousTables.map(table => [table, store.all(table)]));
  store.db.exec('DROP TABLE revenues');
  store.close();
  store = new Store(path);
  try {
    assert.deepEqual(Object.fromEntries(previousTables.map(table => [table, store.all(table)])), before);
    const revenue = new ApiService(store).mutate('revenues', 'POST', { ...input, receivedDate: '2026-10-10' }).value as Revenue;
    assert.throws(() => store.put('revenues', { ...revenue, id: 'bad-ref', projectId: 'missing' }), /FOREIGN KEY/);
    store.close();
    store = new Store(path);
    assert.deepEqual(store.all('revenues'), [revenue]);
    assert.deepEqual(Object.fromEntries(previousTables.map(table => [table, store.all(table)])), before);
    new ApiService(store).mutate('revenues', 'DELETE', undefined, revenue.id);
    assert.deepEqual(store.all('revenues'), []);
  } finally { store.close(); }
});

test('revenue HTTP CRUD requires a valid session and same origin, then survives server restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'planzone8-revenue-http-'));
  const dbPath = join(directory, 'workspace.sqlite');
  let instance = createApp({ dbPath, today: '2026-10-12', admin });
  await instance.ready;
  let server = instance.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = () => {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    return `http://127.0.0.1:${address.port}`;
  };
  const stop = async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    instance.close();
  };
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  const request = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => fetch(`${url()}${path}`, {
    method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  for (const [method, path, body] of [['POST', '/api/revenues', input], ['PATCH', '/api/revenues/missing', { amount: 10 }], ['DELETE', '/api/revenues/missing', undefined]] as const) {
    assert.equal((await request(method, path, body)).status, 401);
    assert.equal((await request(method, path, body, { Cookie: 'planzone8-session-local=forged' })).status, 401);
  }
  const login = await request('POST', '/api/auth/login', { username: admin.username, password: admin.password });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';', 1)[0]!;
  const headers = { Cookie: cookie };
  const before = await (await request('GET', '/api/state', undefined, headers)).json() as AppData;
  for (const [method, path, body] of [['POST', '/api/revenues', input], ['PATCH', '/api/revenues/missing', { amount: 10 }], ['DELETE', '/api/revenues/missing', undefined]] as const) {
    assert.equal((await request(method, path, body, { ...headers, Origin: 'https://untrusted.example' })).status, 403);
    assert.equal((await request(method, path, body, { ...headers, 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  }
  assert.deepEqual(await (await request('GET', '/api/state', undefined, headers)).json(), before);
  const createdResponse = await request('POST', '/api/revenues', input, { ...headers, Origin: url() });
  assert.equal(createdResponse.status, 201);
  const revenue = await createdResponse.json() as Revenue;
  assert.equal((await request('PATCH', `/api/revenues/${revenue.id}`, { projectId: 'project-mobile' }, headers)).status, 400);
  const updatedResponse = await request('PATCH', `/api/revenues/${revenue.id}`, { receivedDate: '2026-10-01', amount: 2000 }, headers);
  assert.equal(updatedResponse.status, 200);
  const updated = await updatedResponse.json() as Revenue;
  await stop();
  instance = createApp({ dbPath, today: '2026-10-12' });
  await instance.ready;
  server = instance.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  assert.deepEqual(await (await request('GET', '/api/state', undefined, headers)).json(), { ...before, revenues: [updated] });
  assert.equal((await request('DELETE', `/api/revenues/${revenue.id}`, undefined, headers)).status, 204);
  assert.deepEqual(await (await request('GET', '/api/state', undefined, headers)).json(), before);
  assert.equal((await request('POST', '/api/auth/logout', {}, headers)).status, 204);
  assert.equal((await request('POST', '/api/revenues', input, headers)).status, 401);
});

test('actual Worker/D1 preserves a legacy snapshot on read and persists revenue CRUD across restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'planzone8-revenue-d1-'));
  const bundled = await build({
    entryPoints: [resolve('cloudflare/worker.ts')], write: false, bundle: true, format: 'esm',
    platform: 'browser', target: 'es2022', logLevel: 'silent',
  });
  const databaseId = randomUUID();
  const workspaceId = randomUUID();
  const runtime = () => new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-10-06',
    host: '127.0.0.1', port: 0, cf: false, log: new Log(LogLevel.ERROR),
    resourcePersistencePath: directory, d1Databases: { DB: databaseId }, bindings: { DEMO_TODAY: '2026-10-12' },
    serviceBindings: { ASSETS: () => new MiniflareResponse('Revenue fixture') },
  }));
  let instance = runtime();
  t.after(async () => { await instance.dispose(); await rm(directory, { recursive: true, force: true }); });
  await instance.ready;
  const db = () => instance.getD1Database('DB');
  await new AuthManager(new D1AuthDatabase(await db() as unknown as D1Database)).createAdmin({ ...admin, workspaceId });
  const request = (method: string, path: string, body?: unknown, cookie?: string, headers: Record<string, string> = {}) => instance.dispatchFetch(`https://planzone8.test${path}`, {
    method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  for (const [method, path, body] of [['POST', '/api/revenues', input], ['PATCH', '/api/revenues/missing', { amount: 10 }], ['DELETE', '/api/revenues/missing', undefined]] as const) {
    assert.equal((await request(method, path, body)).status, 401);
    assert.equal((await request(method, path, body, '__Host-planzone8-session=forged')).status, 401);
  }
  const login = await request('POST', '/api/auth/login', { username: admin.username, password: admin.password });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';', 1)[0]!;
  assert.equal((await request('GET', '/api/state', undefined, cookie)).status, 200);
  const row = async () => {
    const value = await (await db()).prepare('SELECT data, revision FROM demo_workspaces WHERE id = ?')
      .bind(workspaceId).first<{ data: string; revision: number }>();
    assert.ok(value);
    return value;
  };
  const initial = await row();
  const legacy = JSON.parse(initial.data) as CompatibleWorkspaceSnapshot;
  delete legacy.revenues;
  legacy.projects[0].description = 'Description existante personnalisée';
  legacy.tasks[0].description = 'Tâche existante personnalisée';
  const legacyData = JSON.stringify(legacy);
  await (await db()).prepare('UPDATE demo_workspaces SET data = ? WHERE id = ?').bind(legacyData, workspaceId).run();
  const oldRow = await row();
  const displayedResponse = await request('GET', '/api/state', undefined, cookie);
  assert.equal(displayedResponse.status, 200);
  const before = await displayedResponse.json() as AppData;
  assert.deepEqual(before.revenues, []);
  assert.deepEqual(await row(), oldRow, 'An old snapshot GET cannot write new collections or increment revision.');
  for (const [method, path, body] of [['POST', '/api/revenues', input], ['PATCH', '/api/revenues/missing', { amount: 10 }], ['DELETE', '/api/revenues/missing', undefined]] as const) {
    assert.equal((await request(method, path, body, cookie, { Origin: 'https://untrusted.example' })).status, 403);
    assert.equal((await request(method, path, body, cookie, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  }
  assert.equal((await request('POST', '/api/revenues', { ...input, receivedDate: '2026-02-30' }, cookie)).status, 400);
  assert.deepEqual(await row(), oldRow);
  const createdResponse = await request('POST', '/api/revenues', input, cookie);
  assert.equal(createdResponse.status, 201, await createdResponse.clone().text());
  const revenue = await createdResponse.json() as Revenue;
  const savedRow = await row();
  assert.equal(savedRow.revision, oldRow.revision + 1);
  const saved = JSON.parse(savedRow.data) as WorkspaceSnapshot;
  for (const table of TABLES.filter(table => table !== 'revenues')) assert.deepEqual(saved[table], legacy[table], `${table} must survive revenue upgrade unchanged`);
  assert.deepEqual(saved.revenues, [revenue]);
  assert.equal((await request('PATCH', `/api/revenues/${revenue.id}`, { projectId: 'project-mobile' }, cookie)).status, 400);
  assert.deepEqual(await row(), savedRow);
  assert.equal((await request('PATCH', `/api/projects/${revenue.projectId}`, { status: 'paused' }, cookie)).status, 200);
  const locked = await row();
  for (const [method, path, body] of [['POST', '/api/revenues', input], ['PATCH', `/api/revenues/${revenue.id}`, { amount: 10 }], ['DELETE', `/api/revenues/${revenue.id}`, undefined]] as const) {
    assert.equal((await request(method, path, body, cookie)).status, 409);
  }
  assert.deepEqual(await row(), locked);
  assert.equal((await request('PATCH', `/api/projects/${revenue.projectId}`, { status: 'open' }, cookie)).status, 200);
  const updatedResponse = await request('PATCH', `/api/revenues/${revenue.id}`, { receivedDate: '2026-10-01', category: 'grants' }, cookie);
  assert.equal(updatedResponse.status, 200);
  const updated = await updatedResponse.json() as Revenue;
  const resumedRow = await row();
  await instance.dispose();
  instance = runtime();
  await instance.ready;
  const restoredResponse = await request('GET', '/api/state', undefined, cookie);
  assert.equal(restoredResponse.status, 200);
  assert.deepEqual(await restoredResponse.json(), { ...before, revenues: [updated] });
  assert.deepEqual(await row(), resumedRow);
  assert.equal((await request('DELETE', `/api/revenues/${revenue.id}`, undefined, cookie)).status, 204);
  assert.deepEqual(await (await request('GET', '/api/state', undefined, cookie)).json(), before);
  assert.equal((await request('POST', '/api/auth/logout', {}, cookie)).status, 204);
  assert.equal((await request('POST', '/api/revenues', input, cookie)).status, 401);
});
