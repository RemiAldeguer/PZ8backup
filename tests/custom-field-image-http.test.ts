import { TEST_DATA_KEYS, TEST_KEYS, plaintextRow } from './storage-fixture.ts';
import { encryptWorkspace } from '../server/workspace-crypto.ts';
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
import type { AppData } from '../shared/types.ts';

const admin = { username: 'admin', password: 'Raster-images-http-test-2026!', name: 'Administrateur' };
// Each raster has a PNG signature and a bounded 60 KB payload; together their JSON exceeds the old 100 KB request limit.
const image = `data:image/png;base64,${Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, ...new Uint8Array(60_000)]).toString('base64')}`;
type Request = (method: string, path: string, body?: unknown, cookie?: string) => Promise<{ status: number; headers: { get(name: string): string | null }; json(): Promise<unknown>; text(): Promise<string> }>;

async function addImages(request: Request, cookie: string) {
  const before = await (await request('GET', '/api/state', undefined, cookie)).json() as AppData;
  const project = before.projects.find(record => record.status === 'open')!;
  const ids: string[] = [];
  for (const name of ['Illustration', 'Schéma']) {
    const response = await request('POST', '/api/custom-field-definitions', { name, scope: 'project', type: 'image', options: [] }, cookie);
    assert.equal(response.status, 201);
    ids.push((await response.json() as { id: string }).id);
  }
  const response = await request('PATCH', `/api/projects/${project.id}`, { customValues: { [ids[0]]: image, [ids[1]]: image }, description: 'Rich project metadata retained' }, cookie);
  assert.equal(response.status, 200);
  const saved = await (await request('GET', '/api/state', undefined, cookie)).json() as AppData;
  assert.deepEqual(saved.projects.find(record => record.id === project.id)!.customValues, { [ids[0]]: image, [ids[1]]: image });
  assert.deepEqual(saved.comments, before.comments);
  assert.deepEqual(saved.tasks, before.tasks);
  const invalid = await request('PATCH', `/api/projects/${project.id}`, { customValues: { [ids[0]]: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' } }, cookie);
  assert.equal(invalid.status, 400);
  const oversized = await request('PATCH', `/api/projects/${project.id}`, { customValues: { [ids[0]]: 'A'.repeat(600 * 1024) } }, cookie);
  assert.equal(oversized.status, 413);
  assert.deepEqual(await (await request('GET', '/api/state', undefined, cookie)).json(), saved, 'Rejected image writes leave all existing records intact.');
  return saved;
}

test('Express/SQLite persists two bounded image uploads in one request and after restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'planzone8-field-images-http-'));
  const path = join(directory, 'workspace.sqlite');
  let instance = createApp({ dbPath: path, today: '2026-10-12', admin }); await instance.ready;
  let server = instance.app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const stop = async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); instance.close(); };
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  const request: Request = (method, path, body, cookie) => {
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    return fetch(`http://127.0.0.1:${address.port}${path}`, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  };
  const login = await request('POST', '/api/auth/login', { username: admin.username, password: admin.password });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';', 1)[0];
  const saved = await addImages(request, cookie);
  await stop(); instance = createApp({ dbPath: path, today: '2026-10-12' }); await instance.ready;
  server = instance.app.listen(0, '127.0.0.1'); await once(server, 'listening');
  assert.deepEqual(await (await request('GET', '/api/state', undefined, cookie)).json(), saved);
});

test('Worker/D1 persists two bounded image uploads in one request and after restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'planzone8-field-images-d1-'));
  const bundled = await build({ entryPoints: [resolve('cloudflare/worker.ts')], write: false, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent' });
  const databaseId = randomUUID(); const workspaceId = randomUUID();
  const runtime = () => new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundled.outputFiles[0].text,
    compatibilityDate: '2026-10-06', host: '127.0.0.1', port: 0, cf: false, log: new Log(LogLevel.ERROR),
    resourcePersistencePath: directory, d1Databases: { DB: databaseId }, bindings: { DEMO_TODAY: '2026-10-12', PLANZONE_DATA_KEYS: TEST_DATA_KEYS },
    serviceBindings: { ASSETS: () => new MiniflareResponse('Raster field fixture') } }));
  let instance = runtime(); await instance.ready;
  t.after(async () => { await instance.dispose(); await rm(directory, { recursive: true, force: true }); });
  await new AuthManager(new D1AuthDatabase(await instance.getD1Database('DB') as unknown as D1Database)).createAdmin({ ...admin, workspaceId });
  const request: Request = (method, path, body, cookie) => instance.dispatchFetch(`https://planzone8.test${path}`, { method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const login = await request('POST', '/api/auth/login', { username: admin.username, password: admin.password });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';', 1)[0];
  const saved = await addImages(request, cookie);
  await instance.dispose(); instance = runtime(); await instance.ready;
  assert.deepEqual(await (await request('GET', '/api/state', undefined, cookie)).json(), saved);
});
