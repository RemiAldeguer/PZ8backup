import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { AUTH_SCHEMA } from '../server/auth.ts';
import { seed } from '../server/seed.ts';
import { Store } from '../server/store.ts';

const schema = resolve('planzone_pz_sans_recording_day.sqlite');
const importScript = resolve('scripts/migrate-pz8-to-pz7.py');
const prepareScript = resolve('scripts/prepare-pz7-runtime.py');

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'pz7-runtime-'));
  const source = join(directory, 'source.sqlite');
  const bundle = join(directory, 'bundle');
  const output = join(directory, 'runtime.sqlite');
  const store = new Store(source);
  try {
    seed(store);
    for (const statement of AUTH_SCHEMA) store.db.exec(statement);
    store.db.prepare(`INSERT INTO auth_users (id, username, name, password_hash, workspace_id, resource_id)
      VALUES ('user-id','demo','Demo','hash-from-source','workspace-id','resource-claire')`).run();
    store.db.prepare(`INSERT INTO auth_sessions (token_hash, user_id, auth_version, expires_at)
      VALUES ('token-hash','user-id',1,9999999999999)`).run();
  } finally { store.close(); }
  const migrate = () => spawnSync('python3', [importScript, '--source', source, '--schema', schema, '--output', bundle], { encoding: 'utf8' });
  const prepare = () => spawnSync('python3', [prepareScript, '--source', source, '--bundle', bundle, '--output', output], { encoding: 'utf8' });
  return { directory, source, bundle, output, migrate, prepare };
}

test('PZ7 runtime preserves auth hashes, sessions, IDs and original records', { skip: !existsSync(schema) && 'PZ7 schema fixture unavailable' }, () => {
  const f = fixture();
  try {
    assert.equal(f.migrate().status, 0);
    const result = f.prepare();
    assert.equal(result.status, 0, result.stderr);
    const db = new DatabaseSync(f.output, { readOnly: true });
    try {
      assert.equal((db.prepare('SELECT password_hash FROM auth_users').get() as { password_hash: string }).password_hash, 'hash-from-source');
      assert.deepEqual({ ...db.prepare('SELECT token_hash, user_id, auth_version, expires_at FROM auth_sessions').get() },
        { token_hash: 'token-hash', user_id: 'user-id', auth_version: 1, expires_at: 9999999999999 });
      assert.equal((db.prepare("SELECT count(*) AS n FROM pz8_identity WHERE entity='tasks'").get() as { n: number }).n, 21);
      assert.equal((db.prepare("SELECT json_extract(data, '$.title') AS title FROM pz8_identity WHERE entity='tasks' AND id='task-ateliers'").get() as { title: string }).title, 'Animer les ateliers métiers');
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
      assert.equal((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok');
    } finally { db.close(); }
    assert.notEqual(f.prepare().status, 0);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('runtime refuses forged mappings and orphaned authenticated resources', { skip: !existsSync(schema) && 'PZ7 schema fixture unavailable' }, () => {
  const f = fixture();
  try {
    assert.equal(f.migrate().status, 0);
    const reportPath = join(f.bundle, 'report.json');
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    const oldId = report.source_to_target_ids.tasks['task-ateliers'];
    report.source_to_target_ids.tasks['task-ateliers'] = '00000000-0000-4000-8000-000000000000';
    writeFileSync(reportPath, JSON.stringify(report));
    let result = f.prepare();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ID mapping points to missing/);
    assert.equal(existsSync(f.output), false);
    report.source_to_target_ids.tasks['task-ateliers'] = oldId;
    writeFileSync(reportPath, JSON.stringify(report));
    const db = new DatabaseSync(f.source);
    try { db.prepare("UPDATE auth_users SET resource_id='missing-resource' WHERE id='user-id'").run(); }
    finally { db.close(); }
    result = f.prepare();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Account points to missing resource/);
    assert.equal(existsSync(f.output), false);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test('runtime preparation rejects changed workspaces without creating output', { skip: !existsSync(schema) && 'PZ7 schema fixture unavailable' }, () => {
  const f = fixture();
  try {
    assert.equal(f.migrate().status, 0);
    const store = new Store(f.source);
    try { store.put('projects', { ...store.get('projects', 'project-nova')!, name: 'Édité après export' }); }
    finally { store.close(); }
    const result = f.prepare();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Workspace changed after migration snapshot/);
    assert.equal(existsSync(f.output), false);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});
