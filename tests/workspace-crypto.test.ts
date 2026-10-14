import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { encryptWorkspace, decryptWorkspace, parseWorkspaceKeys, WorkspaceEncryptionError, isEncryptedWorkspace } from '../server/workspace-crypto.ts';
import { preflightWorkspaceEncryption, migrateWorkspaceEncryption, sealPlaintextWrites, type MigrationDatabase, type MigrationRow } from '../scripts/workspace-encryption.ts';
import { MemoryStore } from '../server/memory-store.ts';
import { seed } from '../server/seed.ts';
import { TEST_KEYS } from './storage-fixture.ts';

test('AES-256-GCM uses fresh nonces, binds workspace identity and authenticates ciphertext/header', async () => {
  const plain = JSON.stringify({ name: 'Projet confidentiel', bytes: 'Pièce jointe privée', unicode: 'é 中文 🔐' });
  const a = await encryptWorkspace(plain, 'workspace-a', TEST_KEYS), b = await encryptWorkspace(plain, 'workspace-a', TEST_KEYS);
  assert.notEqual(a, b); assert.ok(!a.includes('confidentiel')); assert.equal(await decryptWorkspace(a, 'workspace-a', TEST_KEYS), plain);
  await assert.rejects(decryptWorkspace(a, 'workspace-b', TEST_KEYS), WorkspaceEncryptionError);
  for (const changes of [{ version: 2 }, { encoding: 'plain' }, { keyId: 'missing' }, { iv: 'AAAAAAAAAAAAAAAA' }, { ciphertext: JSON.parse(a).ciphertext.replace(/^./, (c: string) => c === 'A' ? 'B' : 'A') }, { extra: 'ignored' }]) {
    await assert.rejects(decryptWorkspace(JSON.stringify({ ...JSON.parse(a), ...changes }), 'workspace-a', TEST_KEYS), WorkspaceEncryptionError);
  }
  await assert.rejects(decryptWorkspace(plain, 'workspace-a', TEST_KEYS), WorkspaceEncryptionError);
});
test('missing/invalid keys fail closed and a keyring supports controlled rotation', async () => {
  for (const value of [undefined, '', '{}', JSON.stringify({ current: 'test', keys: {} }), JSON.stringify({ current: 'test', keys: { test: 'not-a-key' } })]) assert.throws(() => parseWorkspaceKeys(value), WorkspaceEncryptionError);
  const next = { current: 'next', keys: { ...TEST_KEYS.keys, next: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64') } };
  const old = await encryptWorkspace('historique', 'workspace', TEST_KEYS);
  assert.equal(await decryptWorkspace(old, 'workspace', next), 'historique');
  assert.equal(JSON.parse(await encryptWorkspace('nouveau', 'workspace', next)).keyId, 'next');
  await assert.rejects(decryptWorkspace(old, 'workspace', { current: 'test', keys: { test: next.keys.next } }), WorkspaceEncryptionError);
});
test('compression preserves a near-quota workspace containing real random file bytes without base64 expansion exceeding D1 limits', async () => {
  const file = Buffer.alloc(524288); for (let i = 0; i < file.length; i += 65536) crypto.getRandomValues(file.subarray(i, i + 65536));
  const plain = JSON.stringify({ documents: [file.toString('base64'), file.toString('base64')], notes: 'Équipe '.repeat(35000) });
  assert.ok(Buffer.byteLength(plain) < 1_800_000);
  const stored = await encryptWorkspace(plain, 'large', TEST_KEYS);
  assert.ok(Buffer.byteLength(stored) < 2_000_000); assert.equal(await decryptWorkspace(stored, 'large', TEST_KEYS), plain);
});

function fixture() {
  const sql = new DatabaseSync(':memory:'); sql.exec('CREATE TABLE demo_workspaces(id TEXT PRIMARY KEY, data TEXT, revision INTEGER, updated_at TEXT)');
  const store = new MemoryStore(); seed(store); const plain = JSON.stringify(store.snapshot());
  sql.prepare('INSERT INTO demo_workspaces VALUES(?, ?, ?, ?)').run('a', plain, 8, 'retained-date');
  const db: MigrationDatabase = {
    async rows(query, params = []) { return sql.prepare(query).all(...params as (string | number)[]) as unknown as MigrationRow[]; },
    async run(query, params = []) { return { changes: Number(sql.prepare(query).run(...params as (string | number)[]).changes) }; },
  };
  const row = () => sql.prepare('SELECT * FROM demo_workspaces WHERE id = ?').get('a') as unknown as MigrationRow;
  return { sql, db, plain, row };
}
test('migration preflight is read-only, recovery copies are encrypted, CAS retries concurrent updates, and a rerun is idempotent', async () => {
  const f = fixture(); const original = f.row(); const backups: MigrationRow[] = [];
  try {
    assert.deepEqual(await preflightWorkspaceEncryption(f.db, TEST_KEYS, async row => { backups.push(row); }), { total: 1, plaintext: 1 });
    assert.deepEqual(f.row(), original); assert.ok(backups.every(row => isEncryptedWorkspace(row.data)));
    let raced = false; const ordinaryRun = f.db.run;
    f.db.run = async (sql, params) => {
      if (!raced) { raced = true; const snapshot = JSON.parse(f.plain); snapshot.projects[0].description = 'Édition concurrente conservée'; f.sql.prepare('UPDATE demo_workspaces SET data=?,revision=revision+1 WHERE id=?').run(JSON.stringify(snapshot), 'a'); }
      return ordinaryRun(sql, params);
    };
    assert.equal(await migrateWorkspaceEncryption(f.db, TEST_KEYS, async row => { backups.push(row); }), 1);
    assert.equal(f.row().revision, 10); assert.equal(f.row().updated_at, original.updated_at);
    assert.equal(JSON.parse(await decryptWorkspace(f.row().data, 'a', TEST_KEYS)).projects[0].description, 'Édition concurrente conservée');
    const after = f.row(); assert.equal(await migrateWorkspaceEncryption(f.db, TEST_KEYS, async () => {}), 0); assert.deepEqual(f.row(), after);
  } finally { f.sql.close(); }
});
test('an invalid preflight row aborts before any database write and a lost key cannot replace encrypted data', async () => {
  const f = fixture(); try {
    f.sql.prepare('INSERT INTO demo_workspaces VALUES(?,?,?,?)').run('b', '{"format":"unknown"}', 1, 'unchanged');
    const before = await f.db.rows('SELECT * FROM demo_workspaces');
    await assert.rejects(preflightWorkspaceEncryption(f.db, TEST_KEYS, async () => {}));
    assert.deepEqual(await f.db.rows('SELECT * FROM demo_workspaces'), before);
    f.sql.prepare('DELETE FROM demo_workspaces WHERE id=?').run('b');
    await migrateWorkspaceEncryption(f.db, TEST_KEYS, async () => {}); const encrypted = f.row();
    const wrongKeys = parseWorkspaceKeys(JSON.stringify({ current: 'test', keys: { test: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64') } }));
    await assert.rejects(preflightWorkspaceEncryption(f.db, wrongKeys, async () => {}), /ne peut pas être vérifié/); assert.deepEqual(f.row(), encrypted);
  } finally { f.sql.close(); }
});
test('strict cutover migrates a late workspace even with an empty preflight and database guards reject old writers after the final sweep', async () => {
  const f = fixture(); try {
    f.sql.prepare('DELETE FROM demo_workspaces').run();
    assert.deepEqual(await preflightWorkspaceEncryption(f.db, TEST_KEYS, async () => {}), { total: 0, plaintext: 0 });
    f.sql.prepare('INSERT INTO demo_workspaces VALUES(?,?,?,?)').run('late', f.plain, 0, 'preserved');
    await sealPlaintextWrites(f.db);
    assert.equal(await migrateWorkspaceEncryption(f.db, TEST_KEYS, async () => {}), 1);
    const row = (await f.db.rows('SELECT * FROM demo_workspaces'))[0]; assert.equal(await decryptWorkspace(row.data, 'late', TEST_KEYS), f.plain);
    assert.throws(() => f.sql.prepare('INSERT OR IGNORE INTO demo_workspaces VALUES(?,?,?,?)').run('too-late', f.plain, 0, 'old'), /Encrypted workspace writes required/);
    assert.throws(() => f.sql.prepare('UPDATE demo_workspaces SET data=? WHERE id=?').run(f.plain, 'late'), /Encrypted workspace writes required/);
    const newCiphertext = await encryptWorkspace(f.plain, 'late', TEST_KEYS);
    assert.equal((await f.db.run('UPDATE demo_workspaces SET data=?,revision=revision+1 WHERE id=? AND revision=?', [newCiphertext, 'late', row.revision])).changes, 1);
    assert.equal(await migrateWorkspaceEncryption(f.db, TEST_KEYS, async () => {}), 0);
  } finally { f.sql.close(); }
});
