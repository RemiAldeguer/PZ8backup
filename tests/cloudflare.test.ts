import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { before, type TestContext } from 'node:test';
import { build } from 'esbuild';
import { convertV4MiniflareOptions, Log, LogLevel, Miniflare, Request as MiniflareRequest, Response as MiniflareResponse } from 'miniflare';
import type { AppData, CalendarEvent, Resource, Task, Unavailability } from '../shared/types.ts';
import type { CompatibleWorkspaceSnapshot, WorkspaceSnapshot } from '../server/contracts.ts';
import type { D1Database } from '@cloudflare/workers-types';
import { AuthManager, readSessionToken } from '../server/auth.ts';
import { D1AuthDatabase } from '../cloudflare/auth-d1.ts';
import { MemoryStore } from '../server/memory-store.ts';
import { seed } from '../server/seed.ts';

const ADMIN_PASSWORD = 'Worker-test-administrator-2026!';

let bundledScript: string;
before(async () => {
  const bundle = await build({
    stdin: {
      resolveDir: resolve('.'), sourcefile: 'cloudflare-test-entry.ts', loader: 'ts',
      contents: `import worker from './cloudflare/worker.ts';
        export default {
          fetch(request, env) {
            // This fixture-only barrier interleaves a competing login at the final D1 write.
            const nextWorkspace = request.headers.get('X-Test-Workspace-Switch');
            if (!nextWorkspace) return worker.fetch(request, env);
            const database = {
              prepare(sql) {
                const statement = env.DB.prepare(sql);
                if (!sql.startsWith('UPDATE demo_workspaces SET data')) return statement;
                return {
                  bind(...params) {
                    const bound = statement.bind(...params);
                    return {
                      async run() {
                        await env.DB.prepare('UPDATE auth_users SET workspace_id = ?, legacy_adopted = 1 WHERE username = ?')
                          .bind(nextWorkspace, 'admin').run();
                        return bound.run();
                      },
                    };
                  },
                };
              },
            };
            return worker.fetch(request, { ...env, DB: database });
          },
        };`,
    }, write: false,
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent',
  });
  bundledScript = bundle.outputFiles[0].text;
});

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'planzone8-d1-tests-'));
  const databaseId = randomUUID();
  function runtime() {
    return new Miniflare(convertV4MiniflareOptions({
      modules: true, script: bundledScript, compatibilityDate: '2026-10-06',
      host: '127.0.0.1', port: 0, cf: false, log: new Log(LogLevel.ERROR),
      resourcePersistencePath: directory,
      d1Databases: { DB: databaseId }, bindings: { DEMO_TODAY: '2026-10-06' },
      serviceBindings: {
        ASSETS: (request: MiniflareRequest) => new MiniflareResponse(`<html><body>Asset: ${new URL(request.url).pathname}</body></html>`, {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Test-Asset': 'yes' },
        }),
      },
    }));
  }
  let instance = runtime();
  t.after(async () => { await instance.dispose(); await rm(directory, { recursive: true, force: true }); });
  await instance.ready;
  const adminWorkspaceId = randomUUID();
  async function auth() { return new AuthManager(new D1AuthDatabase(await instance.getD1Database('DB') as unknown as D1Database)); }
  await (await auth()).createAdmin({ username: 'admin', password: ADMIN_PASSWORD, name: 'Administrateur', workspaceId: adminWorkspaceId });

  async function raw(method: string, path: string, body?: string, cookie?: string, headers: Record<string, string> = {}, scheme = 'https') {
    return instance.dispatchFetch(`${scheme}://planzone8.test${path}`, {
      method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers },
      ...(body === undefined ? {} : { body }),
    });
  }
  async function request(method: string, path: string, body?: unknown, cookie?: string, headers: Record<string, string> = {}, scheme = 'https') {
    return raw(method, path, body === undefined ? undefined : JSON.stringify(body), cookie, {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers,
    }, scheme);
  }
  async function state(cookie?: string, scheme = 'https') {
    const session = cookie ? undefined : await login(undefined, undefined, scheme);
    const currentCookie = cookie ?? session!.cookie;
    const response = await request('GET', '/api/state', undefined, currentCookie, {}, scheme);
    assert.equal(response.status, 200, await response.clone().text());
    const setCookie = session?.setCookie ?? response.headers.get('set-cookie');
    return { data: await response.json() as AppData, cookie: currentCookie, setCookie };
  }
  async function login(password = ADMIN_PASSWORD, legacyCookie?: string, scheme = 'https') {
    const response = await request('POST', '/api/auth/login', { username: 'admin', password }, legacyCookie, {}, scheme);
    assert.equal(response.status, 200, await response.clone().text());
    const setCookie = response.headers.get('set-cookie');
    assert.ok(setCookie);
    return { response, setCookie, cookie: setCookie.split(';')[0] };
  }
  async function db() { return instance.getD1Database('DB'); }
  async function row(cookie: string) {
    const token = readSessionToken(cookie, cookie.startsWith('__Host-'));
    assert.ok(token);
    const principal = await (await auth()).authenticate(token);
    assert.ok(principal);
    const result = await (await db()).prepare('SELECT data, revision FROM demo_workspaces WHERE id = ?')
      .bind(principal.workspaceId).first<{ data: string; revision: number }>();
    assert.ok(result);
    return result;
  }
  async function restart() { await instance.dispose(); instance = runtime(); await instance.ready; }
  async function succeeds(method: string, path: string, body: unknown, cookie: string) {
    const response = await request(method, path, body, cookie);
    assert.ok(response.ok, `${method} ${path}: ${response.status} ${await response.clone().text()}`);
    return response;
  }
  return { request, raw, state, db, row, restart, succeeds, auth, login, adminWorkspaceId };
}

test('the bundled Worker serves health and delegates non-API paths to assets without creating a workspace', async t => {
  const api = await fixture(t);
  const health = await api.request('GET', '/api/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok', storage: 'd1', mode: 'cloud-demo', authentication: true });
  assert.equal(health.headers.get('set-cookie'), null);
  assert.equal(health.headers.get('cache-control'), 'no-store');
  const page = await api.request('GET', '/projects/project-nova');
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('x-test-asset'), 'yes');
  assert.match(await page.text(), /Asset: \/projects\/project-nova/);
  assert.equal((await api.request('GET', '/api/unknown')).status, 404);
  const tables = await (await api.db()).prepare("SELECT name FROM sqlite_master WHERE name = 'demo_workspaces'").all();
  assert.equal(tables.results.length, 0);
});

test('authenticated sessions share the administrator workspace and HTTP cookies cannot authenticate over HTTPS', async t => {
  const api = await fixture(t);
  const first = await api.state();
  const second = await api.state();
  assert.notEqual(first.cookie, second.cookie);
  assert.match(first.setCookie!, /^__Host-planzone8-session=/);
  assert.match(first.setCookie!, /HttpOnly/);
  assert.match(first.setCookie!, /SameSite=Lax/);
  assert.match(first.setCookie!, /Secure/);
  await api.succeeds('PATCH', '/api/projects/project-nova', { name: 'Projet du premier visiteur' }, first.cookie);
  assert.equal((await api.state(first.cookie)).data.projects.find(project => project.id === 'project-nova')?.name, 'Projet du premier visiteur');
  assert.equal((await api.state(second.cookie)).data.projects.find(project => project.id === 'project-nova')?.name, 'Projet du premier visiteur');
  assert.equal((await api.state(first.cookie)).setCookie, null);

  const local = await api.state(undefined, 'http');
  assert.match(local.cookie, /^planzone8-session-local=/);
  assert.ok(!local.setCookie?.includes('; Secure'));
  const localEdit = await api.request('PATCH', '/api/projects/project-mobile', { name: 'Projet HTTP isolé' }, local.cookie, {}, 'http');
  assert.equal(localEdit.status, 200);
  assert.equal((await api.state(local.cookie, 'http')).data.projects.find(project => project.id === 'project-mobile')?.name, 'Projet HTTP isolé');
  assert.equal((await api.request('GET', '/api/state', undefined, local.cookie)).status, 401);
  assert.equal((await api.request('GET', '/api/state', undefined, '__Host-planzone8-session=not-a-session-id')).status, 401);
  assert.equal((await api.request('GET', '/api/state', undefined, `__Host-planzone8-demo=${randomUUID()}`)).status, 401);
});

test('authentication rejects anonymous reads and writes, wrong credentials and forged session cookies', async t => {
  const api = await fixture(t);
  const anonymous = await api.request('GET', '/api/auth/session');
  assert.deepEqual(await anonymous.json(), { authenticated: false });
  assert.equal(anonymous.headers.get('set-cookie'), null);
  for (const [method, path, body] of [
    ['GET', '/api/state', undefined],
    ['POST', '/api/tasks', { projectId: 'project-nova', title: 'Interdit sans connexion' }],
    ['PATCH', '/api/resources/resource-claire', { role: 'administrator' }],
    ['DELETE', '/api/tasks/task-ateliers', undefined],
  ] as const) {
    const response = await api.request(method, path, body, `__Host-planzone8-demo=${randomUUID()}`);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  const wrongPassword = await api.request('POST', '/api/auth/login', { username: 'admin', password: 'Incorrect-password-2026!' });
  const unknownUser = await api.request('POST', '/api/auth/login', { username: 'unknown-user', password: ADMIN_PASSWORD });
  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownUser.status, 401);
  assert.deepEqual(await wrongPassword.json(), await unknownUser.json());
  assert.equal(wrongPassword.headers.get('set-cookie'), null);
  assert.equal((await api.request('GET', '/api/state', undefined, `__Host-planzone8-session=${'0'.repeat(64)}`)).status, 401);
  const signedIn = await api.login();
  const authState = await (await api.request('GET', '/api/auth/session', undefined, signedIn.cookie)).json() as { authenticated: boolean; user: { username: string; role: string } };
  assert.equal(authState.authenticated, true);
  assert.equal(authState.user.username, 'admin');
  assert.equal(authState.user.role, 'administrator');
  assert.ok(!JSON.stringify(authState).includes('password'));
  assert.ok(!JSON.stringify(authState).includes('workspace'));
  const token = signedIn.cookie.split('=')[1];
  const stored = await (await api.db()).prepare('SELECT * FROM auth_sessions').all();
  assert.ok(stored.results.length > 0);
  assert.ok(!JSON.stringify(stored.results).includes(token), 'Only a session-token hash should be stored in D1.');
  assert.equal((await api.request('GET', '/api/state', undefined, `${signedIn.cookie}; ${signedIn.cookie}`)).status, 401);
});

test('logout revokes the server session and an expired session cannot be replayed', async t => {
  const api = await fixture(t);
  const signedIn = await api.login();
  assert.equal((await api.request('POST', '/api/auth/logout', {}, signedIn.cookie, { Origin: 'https://elsewhere.test' })).status, 403);
  assert.equal((await api.request('GET', '/api/state', undefined, signedIn.cookie)).status, 200);
  const logout = await api.request('POST', '/api/auth/logout', {}, signedIn.cookie, { Origin: 'https://planzone8.test' });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get('set-cookie')!, /Max-Age=0/);
  assert.match(logout.headers.get('set-cookie')!, /HttpOnly/);
  assert.match(logout.headers.get('set-cookie')!, /Secure/);
  assert.equal(await logout.text(), '');
  assert.equal((await api.request('GET', '/api/state', undefined, signedIn.cookie)).status, 401);
  assert.deepEqual(await (await api.request('GET', '/api/auth/session', undefined, signedIn.cookie)).json(), { authenticated: false });
  const expires = await api.login();
  await (await api.db()).prepare('UPDATE auth_sessions SET expires_at = ?').bind(Date.now() - 1).run();
  assert.equal((await api.request('GET', '/api/state', undefined, expires.cookie)).status, 401);
});

test('password changes require the current password, rotate the cookie and revoke other administrator sessions', async t => {
  const api = await fixture(t);
  const primary = await api.login();
  const other = await api.login();
  const nextPassword = 'New-worker-administrator-password-2026!';
  const before = await (await api.db()).prepare('SELECT password_hash, auth_version FROM auth_users WHERE username = ?').bind('admin').first();
  const wrongCurrent = await api.request('POST', '/api/auth/password', { currentPassword: 'Wrong-password-2026!', newPassword: nextPassword }, primary.cookie);
  assert.equal(wrongCurrent.status, 400);
  assert.equal((await api.request('POST', '/api/auth/password', { currentPassword: ADMIN_PASSWORD, newPassword: 'short' }, primary.cookie)).status, 400);
  assert.deepEqual(await (await api.db()).prepare('SELECT password_hash, auth_version FROM auth_users WHERE username = ?').bind('admin').first(), before);
  const changed = await api.request('POST', '/api/auth/password', { currentPassword: ADMIN_PASSWORD, newPassword: nextPassword }, primary.cookie);
  assert.equal(changed.status, 200, await changed.clone().text());
  const freshCookie = changed.headers.get('set-cookie')!.split(';')[0];
  assert.notEqual(freshCookie, primary.cookie);
  assert.equal((await api.request('GET', '/api/state', undefined, primary.cookie)).status, 401);
  assert.equal((await api.request('GET', '/api/state', undefined, other.cookie)).status, 401);
  assert.equal((await api.request('GET', '/api/state', undefined, freshCookie)).status, 200);
  assert.equal((await api.request('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PASSWORD })).status, 401);
  const reconnected = await api.login(nextPassword);
  assert.equal((await api.request('GET', '/api/state', undefined, reconnected.cookie)).status, 200);
});

test('login rate limits persist in D1 across Worker restarts and another client can still authenticate', async t => {
  const api = await fixture(t);
  for (let index = 0; index < 10; index++) {
    assert.equal((await api.request('POST', '/api/auth/login', { username: 'admin', password: 'Wrong-password-2026!' }, undefined, { 'CF-Connecting-IP': '192.0.2.10' })).status, 401);
  }
  await api.restart();
  assert.equal((await api.request('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PASSWORD }, undefined, { 'CF-Connecting-IP': '192.0.2.10' })).status, 429);
  const independent = await api.request('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PASSWORD }, undefined, { 'CF-Connecting-IP': '192.0.2.11' });
  assert.equal(independent.status, 200);
  const records = await (await api.db()).prepare('SELECT * FROM auth_attempts').all();
  assert.ok(!JSON.stringify(records.results).includes('192.0.2.10'));
  assert.ok(!JSON.stringify(records.results).includes(ADMIN_PASSWORD));
});

async function legacyWorkspace(api: Awaited<ReturnType<typeof fixture>>, name: string) {
  const id = randomUUID();
  const store = new MemoryStore();
  seed(store);
  const snapshot = store.snapshot();
  snapshot.projects.find(project => project.id === 'project-nova')!.name = name;
  const data = JSON.stringify(snapshot);
  await (await api.db()).prepare(`CREATE TABLE IF NOT EXISTS demo_workspaces (
    id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)), revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
  )`).run();
  await (await api.db()).prepare('INSERT INTO demo_workspaces (id, data, revision, updated_at) VALUES (?, ?, ?, ?)')
    .bind(id, data, 4, '2026-10-06T12:00:00.000Z').run();
  return { id, data, cookie: `__Host-planzone8-demo=${id}` };
}

test('verified administrator login preserves the existing browser workspace and shares it with other authenticated sessions', async t => {
  const api = await fixture(t);
  const pristine = await api.state();
  const legacy = await legacyWorkspace(api, 'Projet déjà modifié avant authentification');
  assert.equal((await api.request('GET', '/api/state', undefined, legacy.cookie)).status, 401);
  const wrongLogin = await api.request('POST', '/api/auth/login', { username: 'admin', password: 'Wrong-password-2026!' }, legacy.cookie);
  assert.equal(wrongLogin.status, 401);
  assert.equal((await (await api.db()).prepare('SELECT workspace_id FROM auth_users WHERE username = ?').bind('admin').first<{ workspace_id: string }>())?.workspace_id, api.adminWorkspaceId);
  const signedIn = await api.login(undefined, legacy.cookie);
  const preserved = await api.state(signedIn.cookie);
  assert.equal(preserved.data.projects.find(project => project.id === 'project-nova')?.name, 'Projet déjà modifié avant authentification');
  assert.equal((await api.row(signedIn.cookie)).data, legacy.data);
  assert.equal((await api.row(signedIn.cookie)).revision, 4);
  const otherBrowser = await api.state();
  assert.deepEqual(otherBrowser.data, preserved.data);
  assert.deepEqual((await api.state(pristine.cookie)).data, preserved.data);
  await api.restart();
  assert.deepEqual((await api.state(signedIn.cookie)).data, preserved.data);
});

test('a legacy browser cookie cannot replace an administrator workspace that already contains changes', async t => {
  const api = await fixture(t);
  const account = await api.state();
  await api.succeeds('PATCH', '/api/projects/project-nova', { name: 'Projet administrateur récent' }, account.cookie);
  const legacy = await legacyWorkspace(api, 'Projet historique du navigateur');
  const signedIn = await api.login(undefined, legacy.cookie);
  assert.equal((await api.state(signedIn.cookie)).data.projects.find(project => project.id === 'project-nova')?.name, 'Projet administrateur récent');
  const retained = await (await api.db()).prepare('SELECT data, revision FROM demo_workspaces WHERE id = ?').bind(legacy.id).first<{ data: string; revision: number }>();
  assert.deepEqual(retained, { data: legacy.data, revision: 4 });
});

test('a mutation racing legacy workspace adoption cannot commit an edit to the abandoned fallback workspace', async t => {
  const api = await fixture(t);
  const signedIn = await api.state();
  const fallbackBefore = await api.row(signedIn.cookie);
  assert.equal(fallbackBefore.revision, 0);
  const legacy = await legacyWorkspace(api, 'Projet historique conservé pendant la course');
  const response = await api.request('PATCH', '/api/projects/project-nova', { name: 'Édition qui doit être refusée' }, signedIn.cookie, {
    'X-Test-Workspace-Switch': legacy.id,
  });
  assert.equal(response.status, 409, await response.clone().text());
  assert.match((await response.json() as { error: string }).error, /espace de travail a changé/);
  const fallbackAfter = await (await api.db()).prepare('SELECT data, revision FROM demo_workspaces WHERE id = ?')
    .bind(api.adminWorkspaceId).first();
  assert.deepEqual(fallbackAfter, fallbackBefore);
  assert.deepEqual(await api.row(signedIn.cookie), { data: legacy.data, revision: 4 });
  assert.equal((await api.state(signedIn.cookie)).data.projects.find(project => project.id === 'project-nova')?.name, 'Projet historique conservé pendant la course');
});

test('authentication mutations reject cross-site requests and invalid JSON without creating or revoking sessions', async t => {
  const api = await fixture(t);
  for (const headers of [{ Origin: 'https://elsewhere.test' }, { 'Sec-Fetch-Site': 'cross-site' }] as Record<string, string>[]) {
    assert.equal((await api.request('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PASSWORD }, undefined, headers)).status, 403);
  }
  assert.equal((await api.raw('POST', '/api/auth/login', '{}', undefined, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await api.raw('POST', '/api/auth/login', '{', undefined, { 'Content-Type': 'application/json' })).status, 400);
  assert.equal((await api.request('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PASSWORD, role: 'administrator' })).status, 400);
  assert.equal((await api.request('POST', '/api/auth/login', { username: 'admin', password: 'x'.repeat(103000) })).status, 413);
  const signedIn = await api.login();
  assert.equal((await api.request('POST', '/api/auth/password', { currentPassword: ADMIN_PASSWORD, newPassword: 'New-worker-password-2026!' }, signedIn.cookie, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await api.request('POST', '/api/auth/logout', {}, signedIn.cookie, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await api.request('GET', '/api/state', undefined, signedIn.cookie)).status, 200);
});

test('a D1 workspace survives disposal and a new Worker runtime with the same persisted database', async t => {
  const api = await fixture(t);
  const visitor = await api.state();
  const created = await api.succeeds('POST', '/api/tasks', { projectId: 'project-nova', title: 'Tâche persistée dans D1' }, visitor.cookie);
  const task = await created.json() as Task;
  await api.succeeds('PATCH', `/api/tasks/${task.id}`, { allocatedHours: 16, description: 'Conservée après rechargement' }, visitor.cookie);
  const before = await api.state(visitor.cookie);
  const previousRow = await api.row(visitor.cookie);
  assert.equal(previousRow.revision, 2);
  await api.restart();
  const after = await api.state(visitor.cookie);
  assert.deepEqual(after.data, before.data);
  assert.deepEqual(await api.row(visitor.cookie), previousRow);
  assert.equal(after.setCookie, null);
});

test('concurrent mutations of one D1 workspace preserve both updates through the revision comparison', async t => {
  const api = await fixture(t);
  const visitor = await api.state();
  const before = await api.row(visitor.cookie);
  const writes = await Promise.all([
    api.request('POST', '/api/tasks', { projectId: 'project-nova', title: 'Création concurrente A' }, visitor.cookie),
    api.request('POST', '/api/tasks', { projectId: 'project-nova', title: 'Création concurrente B' }, visitor.cookie),
    api.request('PATCH', '/api/projects/project-mobile', { budget: 76543 }, visitor.cookie),
  ]);
  for (const response of writes) assert.ok(response.ok, `${response.status} ${await response.clone().text()}`);
  const after = await api.state(visitor.cookie);
  assert.equal(after.data.tasks.filter(task => task.title.startsWith('Création concurrente')).length, 2);
  assert.equal(after.data.projects.find(project => project.id === 'project-mobile')?.budget, 76543);
  assert.equal((await api.row(visitor.cookie)).revision, before.revision + 3);
});

test('the Worker applies dependency, archived-project and validated-time invariants before persisting D1', async t => {
  const api = await fixture(t);
  const visitor = await api.state();
  const before = await api.row(visitor.cookie);
  assert.equal((await api.request('PATCH', '/api/tasks/task-cadrage', { status: 'todo', progress: 0 }, visitor.cookie)).status, 409);
  assert.equal((await api.request('PATCH', '/api/tasks/task-portail', { status: 'in_progress' }, visitor.cookie)).status, 409);
  assert.equal((await api.request('PATCH', '/api/time-entries/time-cadrage', { hours: 2 }, visitor.cookie)).status, 409);
  assert.equal((await api.request('DELETE', '/api/time-entries/time-cadrage', undefined, visitor.cookie)).status, 409);
  assert.deepEqual(await api.row(visitor.cookie), before);

  await api.succeeds('PATCH', '/api/time-entries/time-cadrage', { validated: false }, visitor.cookie);
  await api.succeeds('PATCH', '/api/profiles/profile-pilot', { dailyRate: 800, eqjtHours: 7 }, visitor.cookie);
  await api.succeeds('PATCH', '/api/time-entries/time-cadrage', { hours: 2 }, visitor.cookie);
  const corrected = (await api.state(visitor.cookie)).data.timeEntries.find(entry => entry.id === 'time-cadrage')!;
  assert.equal(corrected.rateSnapshot, 650);
  assert.equal(corrected.eqjtSnapshot, 8);
  assert.equal(corrected.hours, 2);
  await api.succeeds('PATCH', '/api/projects/project-nova', { status: 'closed' }, visitor.cookie);
  const closedRow = await api.row(visitor.cookie);
  for (const [method, path, body] of [
    ['POST', '/api/tasks', { projectId: 'project-nova', title: 'Interdite' }],
    ['PATCH', '/api/time-entries/time-cadrage', { hours: 3 }],
    ['POST', '/api/comments', { taskId: 'task-ateliers', body: 'Interdit' }],
    ['POST', '/api/expenses', { projectId: 'project-nova', label: 'Interdite', amount: 10, plannedDate: '2026-10-06' }],
  ] as const) assert.equal((await api.request(method, path, body, visitor.cookie)).status, 409);
  assert.deepEqual(await api.row(visitor.cookie), closedRow);
});

test('origin, content type, malformed JSON and byte limits reject requests without changing the workspace', async t => {
  const api = await fixture(t);
  const visitor = await api.state();
  const before = await api.row(visitor.cookie);
  const payload = { projectId: 'project-nova', title: 'Requête refusée' };
  assert.equal((await api.request('POST', '/api/tasks', payload, visitor.cookie, { Origin: 'https://elsewhere.test' })).status, 403);
  assert.equal((await api.request('POST', '/api/tasks', payload, visitor.cookie, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await api.raw('POST', '/api/tasks', JSON.stringify(payload), visitor.cookie, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await api.raw('POST', '/api/tasks', '{', visitor.cookie, { 'Content-Type': 'application/json' })).status, 400);
  assert.equal((await api.raw('POST', '/api/tasks', JSON.stringify({ title: 'x'.repeat(103000) }), visitor.cookie, { 'Content-Type': 'application/json' })).status, 413);
  assert.equal((await api.raw('POST', '/api/tasks', JSON.stringify({ title: 'é'.repeat(60000) }), visitor.cookie, { 'Content-Type': 'application/json' })).status, 413);
  assert.deepEqual(await api.row(visitor.cookie), before);
  const accepted = await api.request('POST', '/api/tasks', { ...payload, title: 'Requête de la même origine' }, visitor.cookie, { Origin: 'https://planzone8.test' });
  assert.equal(accepted.status, 201);
});

test('a workspace reaching its byte quota refuses a valid mutation without replacing D1 data or revision', async t => {
  const api = await fixture(t);
  const visitor = await api.state();
  const initialRow = await api.row(visitor.cookie);
  const snapshot = JSON.parse(initialRow.data) as WorkspaceSnapshot;
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  for (let index = 0; bytes(snapshot) < 999000; index++) {
    const available = 999500 - bytes(snapshot) - 250;
    if (available <= 0) break;
    snapshot.comments.push({
      id: `quota-comment-${index}`, taskId: 'task-ateliers', authorName: 'Claire Martin',
      createdAt: '2026-10-06T10:00:00.000Z', body: 'x'.repeat(Math.min(10000, available)),
    });
  }
  assert.ok(bytes(snapshot) < 1_000_000 && bytes(snapshot) > 995000);
  await (await api.db()).prepare('UPDATE demo_workspaces SET data = ? WHERE id = ?')
    .bind(JSON.stringify(snapshot), api.adminWorkspaceId).run();
  const before = await api.row(visitor.cookie);
  const response = await api.request('POST', '/api/comments', { taskId: 'task-ateliers', body: 'q'.repeat(10000) }, visitor.cookie);
  assert.equal(response.status, 413);
  assert.match((await response.json() as { error: string }).error, /limite de stockage/);
  assert.deepEqual(await api.row(visitor.cookie), before);
});

test('resource sheet defaults leave a legacy D1 snapshot intact and saved sheets survive a Worker restart', async t => {
  const api = await fixture(t);
  const visitor = await api.state();
  const legacyRow = await api.row(visitor.cookie);
  const legacy = JSON.parse(legacyRow.data) as WorkspaceSnapshot;
  assert.equal(legacy.resources.find(resource => resource.id === 'resource-claire')?.weeklyCapacityHours, undefined);
  const displayed = (await api.state(visitor.cookie)).data.resources.find(resource => resource.id === 'resource-claire')!;
  assert.deepEqual(displayed.weeklyCapacityHours, [7, 8, 8, 8, 8, 0, 0]);
  assert.equal(displayed.role, 'administrator');
  assert.deepEqual(await api.row(visitor.cookie), legacyRow);

  const payload = {
    name: 'Claire de la fiche ressource', email: 'claire@example.org', description: 'Coordination des projets', role: 'administrator',
    tags: [{ label: 'MOE', color: '#2563EB' }], validatesTimeForIds: ['resource-thomas'],
    weeklyCapacityHours: [8, 4, 6, 4, 8, 2, 0], capacityUnit: 'days', hoursPerDay: 8,
    holidayCalendarId: 'fr', projectIds: ['project-mobile'],
    customFields: [{ id: 'lien', label: 'Lien SharePoint', type: 'url', value: 'https://docs.example.org/claire' }],
  };
  const response = await api.succeeds('PATCH', '/api/resources/resource-claire', payload, visitor.cookie);
  const resource = await response.json() as Resource;
  assert.equal(resource.dailyHours, 4);
  assert.equal(resource.mondayHours, 8);
  const saved = await api.state(visitor.cookie);
  assert.equal(saved.data.currentUser.name, 'Administrateur');
  assert.equal(saved.data.currentUser.role, 'Administrateur');
  assert.deepEqual(saved.data.resources.find(item => item.id === resource.id), resource);
  const savedRow = await api.row(visitor.cookie);
  await api.restart();
  assert.deepEqual((await api.state(visitor.cookie)).data, saved.data);
  assert.deepEqual(await api.row(visitor.cookie), savedRow);
});

test('resource reference failures preserve D1 and editing a resource role does not change the authenticated administrator authority', async t => {
  const api = await fixture(t);
  const visitor = await api.state();
  assert.equal((await api.request('PATCH', '/api/resources/resource-claire', { role: 'user' }, visitor.cookie)).status, 409);
  await api.succeeds('PATCH', '/api/resources/resource-claire', { validatesTimeForIds: ['resource-thomas'] }, visitor.cookie);
  const before = await api.row(visitor.cookie);
  for (const [path, payload, status] of [
    ['/api/resources/resource-claire', { projectIds: ['missing-project'] }, 404],
    ['/api/resources/resource-claire', { validatesTimeForIds: ['missing-resource'] }, 404],
    ['/api/resources/resource-claire', { weeklyCapacityHours: [8, 8] }, 400],
    ['/api/resources/resource-claire', { customFields: [{ id: 'lien', label: 'Lien', type: 'url', value: 'javascript:alert(1)' }] }, 400],
  ] as const) {
    assert.equal((await api.request('PATCH', path, payload, visitor.cookie)).status, status);
    assert.deepEqual(await api.row(visitor.cookie), before);
  }
  await api.succeeds('PATCH', '/api/time-entries/time-cadrage', { validated: false }, visitor.cookie);
  const allowed = await api.request('POST', '/api/time-entries', {
    taskId: 'task-ateliers', resourceId: 'resource-thomas', date: '2026-10-06', hours: 1, validated: true,
  }, visitor.cookie);
  assert.equal(allowed.status, 201, await allowed.clone().text());
  assert.equal((await allowed.json() as { validated: boolean }).validated, true);
  assert.equal((await api.row(visitor.cookie)).revision, before.revision + 2);
});

test('calendar records upgrade a deployed legacy D1 snapshot only on mutation and survive a Worker restart', async t => {
  const api = await fixture(t);
  const visitor = await api.state();
  await api.succeeds('PATCH', '/api/projects/project-nova', { name: 'Projet existant avant calendrier' }, visitor.cookie);
  await api.succeeds('PATCH', '/api/tasks/task-ateliers', { description: 'Description déjà enregistrée dans D1' }, visitor.cookie);
  const persisted = await api.row(visitor.cookie);
  const legacy = JSON.parse(persisted.data) as CompatibleWorkspaceSnapshot;
  delete legacy.calendarEvents;
  delete legacy.unavailabilities;
  const legacyData = JSON.stringify(legacy);
  await (await api.db()).prepare('UPDATE demo_workspaces SET data = ? WHERE id = ?')
    .bind(legacyData, api.adminWorkspaceId).run();
  const before = await api.row(visitor.cookie);
  assert.equal(before.data, legacyData);
  assert.equal(before.revision, persisted.revision);

  // Reading an old deployed workspace supplies new empty lists without rewriting its JSON or revision.
  const displayed = await api.state(visitor.cookie);
  assert.deepEqual(displayed.data.calendarEvents, []);
  assert.deepEqual(displayed.data.unavailabilities, []);
  assert.deepEqual(displayed.data.projects, legacy.projects);
  assert.deepEqual(displayed.data.tasks, legacy.tasks);
  assert.deepEqual(await api.row(visitor.cookie), before);

  const eventPayload = {
    title: 'Événement après mise à jour', description: 'Atelier conservé', projectId: 'project-nova',
    resourceIds: ['resource-claire'], startDate: '2026-10-06', endDate: '2026-10-06',
    allDay: false, startTime: '09:30', endTime: '11:00',
  };
  const absencePayload = {
    title: 'Indisponibilité partielle après mise à jour', resourceId: 'resource-claire', reason: 'other',
    startDate: '2026-10-07', endDate: '2026-10-07', allDay: false, startTime: '14:00', endTime: '16:30',
  };
  const event = await (await api.succeeds('POST', '/api/calendar-events', eventPayload, visitor.cookie)).json() as CalendarEvent;
  const absence = await (await api.succeeds('POST', '/api/unavailabilities', absencePayload, visitor.cookie)).json() as Unavailability;
  const saved = await api.state(visitor.cookie);
  assert.deepEqual(saved.data.calendarEvents, [event]);
  assert.deepEqual(saved.data.unavailabilities, [absence]);
  assert.deepEqual(saved.data.projects, legacy.projects);
  assert.deepEqual(saved.data.tasks, legacy.tasks);
  const savedRow = await api.row(visitor.cookie);
  assert.equal(savedRow.revision, before.revision + 2);
  const upgraded = JSON.parse(savedRow.data) as WorkspaceSnapshot;
  for (const table of ['zones', 'projects', 'tasks', 'resources', 'profiles', 'timeEntries', 'comments', 'expenses'] as const) {
    assert.deepEqual(upgraded[table], legacy[table], `${table} must survive the calendar upgrade unchanged`);
  }

  await api.restart();
  const restored = await api.state(visitor.cookie);
  assert.deepEqual(restored.data, saved.data);
  assert.deepEqual(await api.row(visitor.cookie), savedRow);
  assert.equal(restored.setCookie, null);
});
