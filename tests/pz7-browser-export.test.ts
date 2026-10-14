import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const script = resolve('scripts/export-pz7-browser.py');
const required = ['pz_zone', 'pz_project', 'pz_activity', 'pz_task', 'pz_milestone',
  'pz_resource', 'pz_cost_profile', 'pz_time_record', 'pz_comment', 'pz_expense'];
const secret = 'test-only-secret-password-and-token-DO-NOT-PUBLISH';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'pz7-browser-export-'));
  const source = join(dir, 'runtime.sqlite');
  const output = join(dir, 'browser.sqlite');
  const db = new DatabaseSync(source);
  for (const name of required) db.exec(`CREATE TABLE ${name} (uuid TEXT PRIMARY KEY)`);
  db.exec(`CREATE TABLE pz8_identity (
    entity TEXT NOT NULL, id TEXT NOT NULL, uuid TEXT NOT NULL, data TEXT NOT NULL,
    position INTEGER NOT NULL, PRIMARY KEY(entity,id), UNIQUE(entity,uuid));
    CREATE TABLE auth_users (id TEXT PRIMARY KEY, password_hash TEXT);
    CREATE TABLE auth_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT REFERENCES auth_users(id));
    CREATE TABLE auth_attempts (key TEXT PRIMARY KEY);
    CREATE INDEX auth_sessions_user ON auth_sessions(user_id);
    CREATE TRIGGER auth_users_audit AFTER INSERT ON auth_users BEGIN SELECT 1; END;`);
  for (let i = 0; i < 50; i++) db.prepare('INSERT INTO pz8_identity VALUES (?,?,?,?,?)')
    .run('resources', `id-${i}`, `uuid-${i}`, JSON.stringify({ name: `Person ${i}` }), i);
  db.prepare('INSERT INTO auth_users VALUES (?,?)').run('u', secret);
  db.prepare('INSERT INTO auth_sessions VALUES (?,?)').run(secret, 'u');
  db.prepare('INSERT INTO auth_attempts VALUES (?)').run(secret);
  db.exec('PRAGMA journal_mode=WAL');
  db.close();
  chmodSync(source, 0o600);
  const execute = (destination = output, from = source) => spawnSync('python3', [script, '--source', from, '--output', destination], { encoding: 'utf8', timeout: 15000 });
  return { dir, source, output, execute };
}

test('coherent private browser export removes auth and preserves 50 identities without changing source', () => {
  const f = fixture();
  try {
    const before = readFileSync(f.source);
    const result = f.execute();
    assert.equal(result.status, 0, `${result.stderr} ${result.error ?? ''}`);
    assert.equal(statSync(f.output).mode & 0o777, 0o600);
    assert.equal(statSync(f.source).mode & 0o777, 0o600);
    assert.deepEqual(readFileSync(f.source), before);
    assert.equal(readFileSync(f.output).includes(Buffer.from(secret)), false);
    assert.deepEqual(readdirSync(f.dir).filter(name => !name.endsWith('-wal') && !name.endsWith('-shm')).sort(),
      ['browser.sqlite', 'runtime.sqlite']);
    assert.equal(readdirSync(f.dir).some(name => name.startsWith('.pz7-browser-') || name.startsWith('browser.sqlite-')), false);
    const browser = new DatabaseSync(f.output, { readOnly: true });
    const source = new DatabaseSync(f.source, { readOnly: true });
    try {
      assert.deepEqual(browser.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'auth_%' OR tbl_name LIKE 'auth_%'").all(), []);
      assert.equal((browser.prepare('SELECT count(*) AS n FROM pz8_identity').get() as { n: number }).n, 50);
      assert.deepEqual(browser.prepare('SELECT id,uuid,data,position FROM pz8_identity ORDER BY position').all(),
        source.prepare('SELECT id,uuid,data,position FROM pz8_identity ORDER BY position').all());
      assert.equal((source.prepare('SELECT password_hash FROM auth_users').get() as { password_hash: string }).password_hash, secret);
      assert.equal((browser.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok');
      assert.deepEqual(browser.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { browser.close(); source.close(); }
    const second = f.execute();
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /Refusing to overwrite/);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('backs up committed active WAL changes without modifying the source database', () => {
  const f = fixture();
  const writer = new DatabaseSync(f.source);
  try {
    writer.exec('PRAGMA journal_mode=WAL');
    writer.prepare('INSERT INTO pz8_identity VALUES (?,?,?,?,?)')
      .run('resources', 'wal-id', 'wal-uuid', '{"name":"Committed in WAL"}', 50);
    const original = readFileSync(f.source);
    const result = f.execute();
    assert.equal(result.status, 0, `${result.stderr} ${result.error ?? ''}`);
    assert.deepEqual(readFileSync(f.source), original);
    const browser = new DatabaseSync(f.output, { readOnly: true });
    try {
      assert.equal((browser.prepare('SELECT count(*) AS n FROM pz8_identity').get() as { n: number }).n, 51);
      assert.equal((browser.prepare("SELECT data FROM pz8_identity WHERE id='wal-id'").get() as { data: string }).data,
        '{"name":"Committed in WAL"}');
    } finally { browser.close(); }
  } finally { writer.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('refuses unprepared source and occupied output without publishing data', () => {
  const f = fixture();
  try {
    const invalid = join(f.dir, 'unprepared.sqlite');
    const db = new DatabaseSync(invalid);
    db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY)');
    db.close();
    const rejected = f.execute(f.output, invalid);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /not a prepared PZ7 runtime/);
    assert.deepEqual(readdirSync(f.dir).sort(), ['runtime.sqlite', 'unprepared.sqlite']);
    assert.equal(f.execute(join(f.dir, 'public', 'export.sqlite')).status, 1);
    assert.equal(f.execute(join(f.dir, 'dist', 'export.sqlite')).status, 1);
    assert.deepEqual(readdirSync(f.dir).sort(), ['runtime.sqlite', 'unprepared.sqlite']);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
