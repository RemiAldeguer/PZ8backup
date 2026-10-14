import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { AuthError, AuthManager, clearSessionCookie, hashPassword, publicAuthUser, readSessionToken, sessionCookie, type AuthDatabase } from '../server/auth.ts';
import { SQLiteAuthDatabase } from '../server/auth-sqlite.ts';

const PASSWORD = 'Planzone8-Test-Admin!2026';
const NEXT_PASSWORD = 'Changed-Admin-Password!2026';

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'planzone8-auth-tests-'));
  const path = join(directory, 'auth.sqlite');
  let now = Date.UTC(2026, 9, 11);
  let database = new DatabaseSync(path);
  let manager = new AuthManager(new SQLiteAuthDatabase(database), { now: () => now });
  t.after(async () => { database.close(); await rm(directory, { recursive: true, force: true }); });
  await manager.createAdmin({ username: 'admin', password: PASSWORD });
  return {
    get manager() { return manager; },
    get database() { return database; },
    advance(milliseconds: number) { now += milliseconds; },
    restart() {
      database.close();
      database = new DatabaseSync(path);
      manager = new AuthManager(new SQLiteAuthDatabase(database), { now: () => now });
    },
  };
}

function authError(status: number, message?: string) {
  return (error: unknown) => error instanceof AuthError && error.status === status && (message === undefined || error.message === message);
}

test('passwords have independent salts and provisioning never overwrites an existing account', async t => {
  const first = await hashPassword(PASSWORD);
  const second = await hashPassword(PASSWORD);
  assert.match(first, /^pbkdf2-sha256\$100000\$[a-f0-9]{32}\$[a-f0-9]{64}$/);
  assert.notEqual(first, second);
  assert.ok(!first.includes(PASSWORD));
  const api = await fixture(t);
  const saved = api.database.prepare('SELECT * FROM auth_users WHERE username = ?').get('admin');
  assert.equal(await api.manager.createAdmin({ username: 'ADMIN', password: NEXT_PASSWORD, name: 'Replacement' }), false);
  assert.deepEqual(api.database.prepare('SELECT * FROM auth_users WHERE username = ?').get('admin'), saved);
  assert.equal((await api.manager.login(' ADMIN ', PASSWORD, 'test-client')).principal.username, 'admin');
  await assert.rejects(api.manager.login('admin', NEXT_PASSWORD, 'test-client'), authError(401));
  await assert.rejects(hashPassword('too-short'), authError(400));
  await assert.rejects(hashPassword('x'.repeat(129)), authError(400));
});

test('wrong credentials are generic and raw bearer tokens never enter the persistent session table', async t => {
  const api = await fixture(t);
  await assert.rejects(api.manager.login('admin', 'incorrect', 'client-one'), authError(401, 'Identifiant ou mot de passe incorrect.'));
  await assert.rejects(api.manager.login('unknown', PASSWORD, 'client-one'), authError(401, 'Identifiant ou mot de passe incorrect.'));
  const session = await api.manager.login('admin', PASSWORD, 'client-one');
  const secondSession = await api.manager.login('admin', PASSWORD, 'client-two');
  assert.match(session.token, /^[a-f0-9]{64}$/);
  assert.notEqual(session.token, secondSession.token);
  assert.deepEqual(await api.manager.authenticate(session.token), session.principal);
  const row = api.database.prepare('SELECT * FROM auth_sessions WHERE token_hash = ?').get(createHash('sha256').update(session.token).digest('hex'))!;
  assert.equal(row.user_id, session.principal.id);
  assert.ok(!JSON.stringify(row).includes(session.token));
  assert.deepEqual(publicAuthUser(session.principal), {
    id: session.principal.id, username: 'admin', name: 'Administrateur', role: 'administrator',
  });
  assert.equal('workspaceId' in publicAuthUser(session.principal), false);
  assert.equal(await api.manager.authenticate('a'.repeat(64)), null);
  assert.equal(await api.manager.authenticate('not-a-token'), null);
  assert.equal(await api.manager.authenticate(), null);
});

test('authentication and rate limits survive restart; each session expires after seven days', async t => {
  const api = await fixture(t);
  const session = await api.manager.login('admin', PASSWORD, 'persistent-client');
  for (let index = 0; index < 10; index++) await assert.rejects(api.manager.login('admin', 'incorrect', 'blocked-client'), authError(401));
  api.restart();
  assert.deepEqual(await api.manager.authenticate(session.token), session.principal);
  await assert.rejects(api.manager.login('admin', PASSWORD, 'blocked-client'), authError(429));
  const otherClient = await api.manager.login('admin', PASSWORD, 'different-client');
  assert.ok(await api.manager.authenticate(otherClient.token));
  api.advance(15 * 60 * 1000);
  assert.ok((await api.manager.login('admin', PASSWORD, 'blocked-client')).token);
  api.advance(7 * 24 * 60 * 60 * 1000 - 15 * 60 * 1000);
  assert.equal(await api.manager.authenticate(session.token), null);
  assert.equal(await api.manager.authenticate(otherClient.token), null);
});

test('logout revokes replay and password change invalidates every earlier session', async t => {
  const api = await fixture(t);
  const loggedOut = await api.manager.login('admin', PASSWORD, 'client');
  await api.manager.logout(loggedOut.token);
  assert.equal(await api.manager.authenticate(loggedOut.token), null);
  await api.manager.logout(loggedOut.token);
  await api.manager.logout('not-a-token');
  const first = await api.manager.login('admin', PASSWORD, 'client');
  const second = await api.manager.login('admin', PASSWORD, 'other-client');
  await assert.rejects(api.manager.changePassword(first.token, 'incorrect', NEXT_PASSWORD), authError(400));
  await assert.rejects(api.manager.changePassword(first.token, PASSWORD, 'short'), authError(400));
  assert.ok(await api.manager.authenticate(first.token));
  const changed = await api.manager.changePassword(first.token, PASSWORD, NEXT_PASSWORD);
  assert.notEqual(changed.token, first.token);
  assert.equal(await api.manager.authenticate(first.token), null);
  assert.equal(await api.manager.authenticate(second.token), null);
  assert.deepEqual(await api.manager.authenticate(changed.token), changed.principal);
  assert.equal(api.database.prepare('SELECT COUNT(*) AS count FROM auth_sessions').get()?.count, 1);
  await assert.rejects(api.manager.login('admin', PASSWORD, 'client'), authError(401));
  assert.ok((await api.manager.login('admin', NEXT_PASSWORD, 'client')).token);
  await assert.rejects(api.manager.changePassword(first.token, NEXT_PASSWORD, PASSWORD), authError(401));
  api.restart();
  assert.ok(await api.manager.authenticate(changed.token));
  assert.equal(await api.manager.createAdmin({ username: 'admin', password: PASSWORD }), false);
  assert.ok((await api.manager.login('admin', NEXT_PASSWORD, 'client')).token);
});

test('cookie security isolates HTTPS from local HTTP and rejects duplicate or malformed cookie values', () => {
  const token = 'a'.repeat(64);
  const secure = sessionCookie(token, true);
  assert.equal(secure, `__Host-planzone8-session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure`);
  assert.equal(readSessionToken(`other=present; ${secure}`, true), token);
  assert.equal(readSessionToken(secure, false), undefined);
  const local = sessionCookie(token, false);
  assert.ok(local.startsWith('planzone8-session-local='));
  assert.ok(!local.includes('; Secure'));
  assert.equal(readSessionToken(local, false), token);
  assert.equal(readSessionToken(local, true), undefined);
  assert.equal(readSessionToken(`__Host-planzone8-session=${token}; __Host-planzone8-session=${token}`, true), undefined);
  assert.equal(readSessionToken('__Host-planzone8-session=%61', true), undefined);
  assert.ok(clearSessionCookie(true).endsWith('Max-Age=0; Secure'));
  assert.equal(readSessionToken(clearSessionCookie(true), true), undefined);
});

test('a password change cannot acquire a valid later session if another password change intervenes before its reread', async t => {
  const api = await fixture(t);
  const initial = await api.manager.login('admin', PASSWORD, 'client');
  const adapter = new SQLiteAuthDatabase(api.database);
  const laterPasswordHash = await hashPassword('Second-Password-Change!2026');
  const laterToken = 'b'.repeat(64);
  let racePending = false;
  let intervened = false;
  const racingDatabase: AuthDatabase = {
    async run(sql, params = []) {
      const result = await adapter.run(sql, params);
      if (sql.startsWith('UPDATE auth_users SET password_hash') && result.changes === 1) racePending = true;
      return result;
    },
    async first<T>(sql: string, params: unknown[] = []): Promise<T | null> {
      if (racePending && sql.startsWith('SELECT * FROM auth_users WHERE id = ?')) {
        racePending = false;
        intervened = true;
        // A second completed password change wins before the first change rereads its updated account.
        await adapter.run('UPDATE auth_users SET password_hash = ?, auth_version = auth_version + 1 WHERE id = ?', [laterPasswordHash, initial.principal.id]);
        await adapter.run('DELETE FROM auth_sessions WHERE user_id = ?', [initial.principal.id]);
        await adapter.run(`INSERT INTO auth_sessions (token_hash, user_id, auth_version, expires_at)
          SELECT ?, id, auth_version, ? FROM auth_users WHERE id = ?`,
        [createHash('sha256').update(laterToken).digest('hex'), Date.UTC(2026, 9, 12), initial.principal.id]);
      }
      return adapter.first<T>(sql, params);
    },
  };
  const racingManager = new AuthManager(racingDatabase, { now: () => Date.UTC(2026, 9, 11) });
  await assert.rejects(racingManager.changePassword(initial.token, PASSWORD, NEXT_PASSWORD), authError(409));
  assert.equal(intervened, true);
  assert.equal(await api.manager.authenticate(initial.token), null);
  assert.ok(await api.manager.authenticate(laterToken));
  assert.equal(api.database.prepare('SELECT COUNT(*) AS count FROM auth_sessions').get()?.count, 1);
  assert.equal(api.database.prepare('SELECT auth_version FROM auth_users WHERE id = ?').get(initial.principal.id)?.auth_version, 3);
});

test('legacy adoption preserves both old workspaces and makes every existing session follow the adopted workspace', async t => {
  const api = await fixture(t);
  api.database.exec('CREATE TABLE demo_workspaces (id TEXT PRIMARY KEY, data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0)');
  const session = await api.manager.login('admin', PASSWORD, 'client');
  const legacyId = randomUUID();
  const secondLegacyId = randomUUID();
  const legacyData = JSON.stringify({ projects: [{ name: 'Projet déjà enregistré' }] });
  api.database.prepare('INSERT INTO demo_workspaces (id, data, revision) VALUES (?, ?, ?)').run(legacyId, legacyData, 42);
  api.database.prepare('INSERT INTO demo_workspaces (id, data, revision) VALUES (?, ?, ?)').run(secondLegacyId, '{"different":true}', 5);
  api.database.prepare('INSERT INTO demo_workspaces (id, data, revision) VALUES (?, ?, ?)').run(session.principal.workspaceId, '{}', 0);
  const before = api.database.prepare('SELECT * FROM demo_workspaces ORDER BY id').all();
  const adopted = await api.manager.adoptLegacyWorkspace(session.principal, legacyId);
  assert.equal(adopted.workspaceId, legacyId);
  assert.equal((await api.manager.authenticate(session.token))?.workspaceId, legacyId);
  assert.deepEqual(api.database.prepare('SELECT * FROM demo_workspaces ORDER BY id').all(), before);
  assert.equal((await api.manager.adoptLegacyWorkspace(adopted, secondLegacyId)).workspaceId, legacyId);
  assert.equal((await api.manager.adoptLegacyWorkspace(adopted, 'invalid')).workspaceId, legacyId);
  api.restart();
  assert.equal((await api.manager.authenticate(session.token))?.workspaceId, legacyId);
});

test('a modified account workspace prevents automatic legacy replacement and a missing legacy row is never adopted', async t => {
  const api = await fixture(t);
  const session = await api.manager.login('admin', PASSWORD, 'client');
  assert.deepEqual(await api.manager.adoptLegacyWorkspace(session.principal, randomUUID()), session.principal);
  api.database.exec('CREATE TABLE demo_workspaces (id TEXT PRIMARY KEY, data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0)');
  const legacyId = randomUUID();
  api.database.prepare('INSERT INTO demo_workspaces (id, data, revision) VALUES (?, ?, ?)').run(legacyId, '{"legacy":true}', 6);
  api.database.prepare('INSERT INTO demo_workspaces (id, data, revision) VALUES (?, ?, ?)').run(session.principal.workspaceId, '{"new":true}', 1);
  assert.equal((await api.manager.adoptLegacyWorkspace(session.principal, legacyId)).workspaceId, session.principal.workspaceId);
  assert.equal((await api.manager.adoptLegacyWorkspace(session.principal, randomUUID())).workspaceId, session.principal.workspaceId);
  assert.equal(api.database.prepare('SELECT legacy_adopted FROM auth_users WHERE id = ?').get(session.principal.id)?.legacy_adopted, 0);
  assert.equal(api.database.prepare('SELECT COUNT(*) AS count FROM demo_workspaces').get()?.count, 2);
});
