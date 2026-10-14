import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { seed } from '../server/seed.ts';
import { Store } from '../server/store.ts';

const script = resolve('scripts/migrate-pz8-to-pz7.py');
const schema = resolve('planzone_pz_sans_recording_day.sqlite');

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'pz7-import-'));
  const source = join(directory, 'source.sqlite');
  const output = join(directory, 'output');
  const store = new Store(source);
  seed(store);
  store.close();
  const run = () => spawnSync('python3', [script, '--source', source, '--schema', schema, '--output', output], { encoding: 'utf8' });
  return { directory, source, output, run };
}

test('PZ8 to PZ7 import preserves source, projects, task history and foreign keys', { skip: !existsSync(schema) && 'PZ7 schema fixture not available' }, () => {
  const { directory, source, output, run } = fixture();
  try {
    const sourceHash = createHash('sha256').update(readFileSync(source)).digest('hex');
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(createHash('sha256').update(readFileSync(source)).digest('hex'), sourceHash);
    const db = new DatabaseSync(join(output, 'workspace.sqlite'), { readOnly: true });
    try {
      const count = (table: string) => (db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count;
      assert.equal(count('pz_project'), 4);
      assert.equal(count('pz_task'), 18);
      assert.equal(count('pz_milestone'), 3);
      assert.equal(count('pz_allocation'), 18);
      assert.equal(count('pz_time_record'), 5);
      assert.equal(count('pz_constraint'), 14);
      assert.equal(count('pz_comment'), 3);
      assert.equal(count('pz_expense'), 4);
      assert.equal(count('pz_project_member'), 13);
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
      assert.equal((db.prepare('PRAGMA quick_check').get() as { quick_check: string }).quick_check, 'ok');
      assert.equal(db.prepare('PRAGMA table_info(pz_time_record)').all().some(row => row.name === 'recording_day'), false);
      assert.deepEqual(db.prepare('SELECT DISTINCT recording_date FROM pz_time_record ORDER BY recording_date').all().map(row => row.recording_date),
        ['2026-10-02', '2026-10-05', '2026-10-06']);
      assert.equal((db.prepare('SELECT count(*) AS count FROM pz_constraint WHERE constraint_type=0 AND origin_date_type=0 AND offset_days=0').get() as { count: number }).count, 14);
      assert.equal((db.prepare("SELECT count(*) AS count FROM pz_resource WHERE type=1").get() as { count: number }).count, 5);
      assert.equal((db.prepare("SELECT count(*) AS count FROM pz_resource WHERE role_uuid='13626807-2fd2-481c-a074-1f16ca51b62c'").get() as { count: number }).count, 1);
      assert.equal((db.prepare("SELECT count(*) AS count FROM pz_resource WHERE role_uuid='46257e2e-754e-4743-86f5-ae542d00506e'").get() as { count: number }).count, 6);
    } finally { db.close(); }
    const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8')) as {
      date_conflicts: unknown[]; imported: Record<string, number>;
      source_to_target_ids: Record<string, Record<string, string>>;
    };
    assert.equal(report.date_conflicts.length, 4);
    assert.equal(report.imported.pz_task, 18);
    const mapped = report.source_to_target_ids;
    const relationships = new DatabaseSync(join(output, 'workspace.sqlite'), { readOnly: true });
    try {
      const arc = relationships.prepare('SELECT origin_entity_type, origin_entity_uuid, target_entity_type, target_entity_uuid, constraint_type, target_date_type FROM pz_constraint WHERE target_entity_uuid=?').get(mapped.tasks['task-ateliers']);
      assert.deepEqual({ ...arc }, { origin_entity_type: 1, origin_entity_uuid: mapped.tasks['task-cadrage'],
        target_entity_type: 1, target_entity_uuid: mapped.tasks['task-ateliers'], constraint_type: 0, target_date_type: 1 });
      const discussion = relationships.prepare('SELECT entity_type, entity_uuid FROM pz_discussion WHERE entity_uuid=?').get(mapped.tasks['task-ateliers']);
      assert.deepEqual({ ...discussion }, { entity_type: 1, entity_uuid: mapped.tasks['task-ateliers'] });
    } finally { relationships.close(); }
    const snapshot = JSON.parse(readFileSync(join(output, 'source-json.json'), 'utf8')) as { timeEntries: unknown[]; tasks: unknown[] };
    assert.equal(snapshot.timeEntries.length, 5);
    assert.equal(snapshot.tasks.length, 21);
    const original = new DatabaseSync(source, { readOnly: true });
    try { assert.equal((original.prepare('SELECT count(*) AS count FROM tasks').get() as { count: number }).count, 21); }
    finally { original.close(); }
    assert.equal(run().status, 2, 'A second run must refuse to overwrite output');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('creator membership is retained and duplicate daily time rolls back entirely', { skip: !existsSync(schema) && 'PZ7 schema fixture not available' }, () => {
  const { directory, source, output, run } = fixture();
  try {
    const store = new Store(source);
    try {
      store.put('projects', { ...store.get('projects', 'project-data')!, createdByResourceId: 'resource-lab' });
    } finally { store.close(); }
    assert.equal(run().status, 0);
    const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8')) as { imported: Record<string, number> };
    assert.equal(report.imported.pz_project_member, 14);
  } finally { rmSync(directory, { recursive: true, force: true }); }

  const other = fixture();
  try {
    const store = new Store(other.source);
    try { store.put('timeEntries', { ...store.get('timeEntries', 'time-ateliers')!, id: 'duplicate-time' }); }
    finally { store.close(); }
    const result = other.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /UNIQUE constraint failed/);
    assert.deepEqual(readdirSync(other.directory).filter(name => name === 'output' || name.startsWith('.pz7-import-')), []);
  } finally { rmSync(other.directory, { recursive: true, force: true }); }
});

test('a nonempty auxiliary schema table is never carried into an import', { skip: !existsSync(schema) && 'PZ7 schema fixture not available' }, () => {
  const { directory, source, output } = fixture();
  try {
    const modifiedSchema = join(directory, 'prefilled.sqlite');
    copyFileSync(schema, modifiedSchema);
    const db = new DatabaseSync(modifiedSchema);
    try { db.prepare('INSERT INTO pz_privilege (uuid, name) VALUES (?, ?)').run('preexisting-privilege', 'inconnu'); }
    finally { db.close(); }
    const result = spawnSync('python3', [script, '--source', source, '--schema', modifiedSchema, '--output', output], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Target schema must be completely empty/);
    assert.equal(existsSync(output), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('concurrent imports cannot replace or delete each other’s completed bundle', { skip: !existsSync(schema) && 'PZ7 schema fixture not available' }, async () => {
  const { directory, source, output } = fixture();
  try {
    const start = () => new Promise<number>((resolve, reject) => {
      const child = spawn('python3', [script, '--source', source, '--schema', schema, '--output', output]);
      child.on('error', reject);
      child.on('close', code => resolve(code ?? -1));
    });
    const statuses = await Promise.all([start(), start()]);
    assert.equal(statuses.filter(code => code === 0).length, 1);
    assert.ok(statuses.some(code => code === 1 || code === 2));
    assert.deepEqual(readdirSync(output).sort(), ['report.json', 'source-json.json', 'workspace.sqlite']);
    const db = new DatabaseSync(join(output, 'workspace.sqlite'), { readOnly: true });
    try { assert.equal((db.prepare('SELECT count(*) AS n FROM pz_task').get() as { n: number }).n, 18); }
    finally { db.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('broken references abort the import and leave no partial output', { skip: !existsSync(schema) && 'PZ7 schema fixture not available' }, () => {
  const { directory, source, output, run } = fixture();
  try {
    const db = new DatabaseSync(source);
    try { db.exec('PRAGMA foreign_keys = OFF'); db.prepare('UPDATE timeEntries SET data=json_set(data, ?, ?) WHERE id=?').run('$.taskId', 'missing-task', 'time-ateliers'); }
    finally { db.close(); }
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Time record references unknown resource or non-task/);
    assert.deepEqual(readdirSync(directory).filter(name => name === 'output' || name.startsWith('.pz7-import-')), []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
