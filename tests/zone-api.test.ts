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
import { MemoryStore } from '../server/memory-store.ts';
import { seed } from '../server/seed.ts';
import { ApiError, ApiService } from '../server/service.ts';
import { Store } from '../server/store.ts';
import { RESOURCE_ROLE_LABELS, type AppData, type Project, type Resource, type Zone } from '../shared/types.ts';
import { TEST_DATA_KEYS } from './storage-fixture.ts';

const admin = { username: 'admin', password: 'Zone-test-administrator-2026!', name: 'Administrateur' };
const projectInput = {
  name: 'Projet nouvelle zone', startDate: '2026-10-12', endDate: '2026-10-30',
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

  test(`${backend}: zones are persisted and accept project associations without changing existing projects`, () => {
    const { store, api, close } = fixture();
    try {
      const before = api.readState('2026-10-12');
      const created = api.mutate('zones', 'POST', { name: '  Nouvelle zone  ' });
      assert.equal(created.status, 201);
      const zone = created.value as Zone;
      assert.match(zone.id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);
      assert.equal(zone.name, 'Nouvelle zone');
      assert.equal(zone.color, '#0F766E');
      const changed = api.mutate('zones', 'PATCH', { color: '#AABBCC' }, zone.id).value as Zone;
      assert.equal(changed.name, zone.name);
      const renamed = api.mutate('zones', 'PATCH', { name: ' Zone renommée ' }, zone.id).value as Zone;
      assert.deepEqual(renamed, { id: zone.id, name: 'Zone renommée', color: '#AABBCC' });
      const withZone = api.readState('2026-10-12');
      assert.deepEqual(withZone, { ...before, zones: [...before.zones, renamed] });
      const project = api.mutate('projects', 'POST', { ...projectInput, zoneId: zone.id }).value as Project;
      assert.equal(project.zoneId, zone.id);
      const finalState = api.readState('2026-10-12');
      assert.deepEqual(finalState.projects.slice(0, before.projects.length), before.projects);
      rejectsStatus(409, () => api.mutate('zones', 'DELETE', undefined, zone.id));
      assert.deepEqual(api.readState('2026-10-12'), finalState);
      if (store instanceof MemoryStore) {
        assert.deepEqual(new ApiService(new MemoryStore(store.snapshot())).readState('2026-10-12'), finalState);
      }
    } finally { close(); }
  });

  test(`${backend}: invalid zones and partial updates fail without altering state or zone identity`, () => {
    const { api, close } = fixture();
    try {
      const before = api.readState('2026-10-12');
      for (const body of [
        {}, { name: '' }, { name: '   ' }, { name: 'x'.repeat(201) }, { name: 12 },
        { name: 'Zone', color: 'red' }, { name: 'Zone', color: '#123' }, { name: 'Zone', color: '#GGGGGG' },
        { name: 'Zone', color: null }, { name: 'Zone', id: 'client-id' }, { name: 'Zone', unknown: true },
      ]) rejectsStatus(400, () => api.mutate('zones', 'POST', body));
      assert.deepEqual(api.readState('2026-10-12'), before);
      const zone = api.mutate('zones', 'POST', { name: 'Conservée', color: '#336699' }).value as Zone;
      const after = api.readState('2026-10-12');
      for (const body of [{}, { name: ' ' }, { color: '#00' }, { id: 'another' }, { unknown: true }]) {
        rejectsStatus(400, () => api.mutate('zones', 'PATCH', body, zone.id));
      }
      rejectsStatus(404, () => api.mutate('zones', 'PATCH', { name: 'Absente' }, 'missing'));
      rejectsStatus(404, () => api.mutate('zones', 'DELETE', undefined, 'missing'));
      assert.deepEqual(api.readState('2026-10-12'), after);
    } finally { close(); }
  });

  test(`${backend}: only administrators delete empty zones, removing memberships but preserving other data`, () => {
    const { store, api, close } = fixture();
    try {
      const zone = api.mutate('zones', 'POST', { name: 'Zone vide à supprimer' }).value as Zone;
      const resource = api.mutate('resources', 'POST', { name: 'Membre de la zone', role: 'user', zoneIds: [zone.id, 'zone-transformation'], projectIds: ['project-nova'] }).value as Resource;
      api.mutate('resources', 'POST', { name: 'Ancien membre', active: false, zoneIds: [zone.id] });
      const before = api.readState('2026-10-12');
      const memberApi = new ApiService(store, { id: resource.id, name: resource.name, role: RESOURCE_ROLE_LABELS.user });
      rejectsStatus(403, () => memberApi.mutate('zones', 'PATCH', { name: 'Interdit' }, zone.id));
      rejectsStatus(403, () => memberApi.mutate('zones', 'DELETE', undefined, zone.id));
      assert.deepEqual(api.readState('2026-10-12'), before);
      assert.equal(api.mutate('zones', 'DELETE', undefined, zone.id).status, 204);
      const expected = { ...before, zones: before.zones.filter(item => item.id !== zone.id), resources: before.resources.map(item => item.zoneIds?.includes(zone.id) ? { ...item, zoneIds: item.zoneIds.filter(id => id !== zone.id) } : item) };
      assert.deepEqual(api.readState('2026-10-12'), expected);
      rejectsStatus(404, () => api.mutate('zones', 'DELETE', undefined, zone.id));
      if (store instanceof MemoryStore) assert.deepEqual(new ApiService(new MemoryStore(store.snapshot())).readState('2026-10-12'), expected);
    } finally { close(); }
  });
}

test('SQLite HTTP zone mutations require a session and allowed origin, and survive application restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'planzone8-zone-http-'));
  const dbPath = join(directory, 'zones.sqlite');
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
  for (const [method, path, body] of [
    ['POST', '/api/zones', { name: 'Zone interdite' }],
    ['PATCH', '/api/zones/missing', { name: 'Interdit' }],
    ['DELETE', '/api/zones/missing', undefined],
  ] as const) assert.equal((await request(method, path, body)).status, 401);
  const login = await request('POST', '/api/auth/login', { username: admin.username, password: admin.password });
  assert.equal(login.status, 200);
  const headers = { Cookie: login.headers.get('set-cookie')!.split(';', 1)[0]! };
  const beforeResponse = await request('GET', '/api/state', undefined, headers);
  assert.equal(beforeResponse.status, 200);
  const before = await beforeResponse.json() as AppData;
  assert.equal((await request('POST', '/api/zones', { name: 'Interdite' }, { ...headers, Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await request('POST', '/api/zones', { name: 'Interdite' }, { ...headers, 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await request('POST', '/api/zones', { name: 'Zone', unknown: true }, headers)).status, 400);
  const createdResponse = await request('POST', '/api/zones', { name: 'Nouvelle zone HTTP', color: '#DE7733' }, headers);
  assert.equal(createdResponse.status, 201);
  const zone = await createdResponse.json() as Zone;
  assert.equal((await request('PATCH', `/api/zones/${zone.id}`, { name: 'Zone HTTP renommée' }, headers)).status, 200);
  await stop();
  instance = createApp({ dbPath, today: '2026-10-12' });
  await instance.ready;
  server = instance.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const stateResponse = await request('GET', '/api/state', undefined, headers);
  assert.equal(stateResponse.status, 200);
  assert.deepEqual(await stateResponse.json(), {
    ...before, zones: [...before.zones, { ...zone, name: 'Zone HTTP renommée' }],
  });
  const projectResponse = await request('POST', '/api/projects', { ...projectInput, zoneId: zone.id }, headers);
  assert.equal(projectResponse.status, 201);
  const project = await projectResponse.json() as Project;
  const confirmation = { deleteProjects: true, expectedProjectIds: [project.id] };
  assert.equal((await request('DELETE', `/api/zones/${zone.id}`, undefined, { ...headers, Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await request('DELETE', `/api/zones/${zone.id}`, { ...confirmation, expectedProjectIds: [] }, headers)).status, 409);
  assert.equal((await request('DELETE', `/api/zones/${zone.id}`, confirmation, headers)).status, 204);
  assert.deepEqual(await (await request('GET', '/api/state', undefined, headers)).json(), before);
});

test('the actual Worker persists zone mutations in D1 and leaves rejected writes and unrelated data untouched', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'planzone8-zone-d1-'));
  const bundled = await build({
    entryPoints: [resolve('cloudflare/worker.ts')], write: false, bundle: true, format: 'esm',
    platform: 'browser', target: 'es2022', logLevel: 'silent',
  });
  const databaseId = randomUUID();
  const workspaceId = randomUUID();
  const runtime = () => new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-10-06',
    host: '127.0.0.1', port: 0, cf: false, log: new Log(LogLevel.ERROR),
    resourcePersistencePath: directory, d1Databases: { DB: databaseId }, bindings: { DEMO_TODAY: '2026-10-12', PLANZONE_DATA_KEYS: TEST_DATA_KEYS },
    serviceBindings: { ASSETS: () => new MiniflareResponse('Zone fixture') },
  }));
  let instance = runtime();
  t.after(async () => { await instance.dispose(); await rm(directory, { recursive: true, force: true }); });
  await instance.ready;
  const database = await instance.getD1Database('DB');
  await new AuthManager(new D1AuthDatabase(database as unknown as D1Database)).createAdmin({ ...admin, workspaceId });
  const request = (method: string, path: string, body?: unknown, cookie?: string, headers: Record<string, string> = {}) => instance.dispatchFetch(`https://planzone8.test${path}`, {
    method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal((await request('POST', '/api/zones', { name: 'Interdite' })).status, 401);
  const login = await request('POST', '/api/auth/login', { username: admin.username, password: admin.password });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';', 1)[0]!;
  const beforeResponse = await request('GET', '/api/state', undefined, cookie);
  assert.equal(beforeResponse.status, 200);
  const before = await beforeResponse.json() as AppData;
  const row = async () => {
    const db = await instance.getD1Database('DB');
    const value = await db.prepare('SELECT data, revision FROM demo_workspaces WHERE id = ?')
      .bind(workspaceId).first<{ data: string; revision: number }>();
    assert.ok(value);
    return value;
  };
  const initialRow = await row();
  assert.equal((await request('POST', '/api/zones', { name: 'Interdite' }, cookie, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await request('POST', '/api/zones', { name: 'Interdite' }, cookie, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await request('POST', '/api/zones', { name: 'Zone', color: 'orange' }, cookie)).status, 400);
  assert.deepEqual(await row(), initialRow);
  const createdResponse = await request('POST', '/api/zones', { name: '  Nouvelle zone D1  ', color: '#112233' }, cookie);
  assert.equal(createdResponse.status, 201);
  const zone = await createdResponse.json() as Zone;
  assert.equal(zone.name, 'Nouvelle zone D1');
  const renamedResponse = await request('PATCH', `/api/zones/${zone.id}`, { name: 'Zone D1 renommée' }, cookie);
  assert.equal(renamedResponse.status, 200);
  const renamed = await renamedResponse.json() as Zone;
  const savedRow = await row();
  assert.equal(savedRow.revision, initialRow.revision + 2);
  assert.equal((await request('PATCH', `/api/zones/${zone.id}`, { id: 'changed' }, cookie)).status, 400);
  assert.deepEqual(await row(), savedRow);
  await instance.dispose();
  instance = runtime();
  await instance.ready;
  const stateResponse = await request('GET', '/api/state', undefined, cookie);
  assert.equal(stateResponse.status, 200);
  assert.deepEqual(await stateResponse.json(), { ...before, zones: [...before.zones, renamed] });
  assert.deepEqual(await row(), savedRow);
  const projectResponse = await request('POST', '/api/projects', { ...projectInput, zoneId: zone.id }, cookie);
  assert.equal(projectResponse.status, 201);
  const project = await projectResponse.json() as Project;
  assert.equal(project.zoneId, zone.id);
  const occupiedRow = await row();
  assert.equal((await request('DELETE', `/api/zones/${zone.id}`, undefined, cookie)).status, 409);
  assert.deepEqual(await row(), occupiedRow);
  assert.equal((await request('DELETE', `/api/zones/${zone.id}`, { deleteProjects: true, expectedProjectIds: [] }, cookie)).status, 409);
  assert.deepEqual(await row(), occupiedRow);
  assert.equal((await request('DELETE', `/api/zones/${zone.id}`, { deleteProjects: true, expectedProjectIds: [project.id] }, cookie)).status, 204);
  assert.equal((await row()).revision, occupiedRow.revision + 1);
  assert.deepEqual(await (await request('GET', '/api/state', undefined, cookie)).json(), before);
  const zoneIds = before.zones.map(item => item.id).reverse();
  const preOrderRow = await row();
  assert.equal((await request('POST', '/api/zone-order', { zoneIds }, cookie)).status, 204);
  assert.equal((await row()).revision, preOrderRow.revision + 1);
  assert.deepEqual((await (await request('GET', '/api/state', undefined, cookie)).json() as AppData).zones, zoneIds.map((id, position) => ({ ...before.zones.find(zone => zone.id === id), position })));
});
