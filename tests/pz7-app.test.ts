import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { createApp } from '../server/app.ts';
import type { AppData } from '../shared/types.ts';

const schema = resolve('planzone_pz_sans_recording_day.sqlite');
const migrate = resolve('scripts/migrate-pz8-to-pz7.py');
const prepare = resolve('scripts/prepare-pz7-runtime.py');
const admin = { username: 'admin', password: 'Pz7-Integration-Test-2026!' };

test('HTTP application uses PZ7 schema and preserves the existing administrator login', { skip: !existsSync(schema) && 'PZ7 schema fixture unavailable' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pz7-app-'));
  const source = join(dir, 'source.sqlite');
  const bundle = join(dir, 'bundle');
  const runtime = join(dir, 'runtime.sqlite');
  const oldApp = createApp({ dbPath: source, admin });
  let server: Server | undefined;
  let newApp: ReturnType<typeof createApp> | undefined;
  try {
    await oldApp.ready;
    oldApp.close();
    let command = spawnSync('python3', [migrate, '--source', source, '--schema', schema, '--output', bundle], { encoding: 'utf8' });
    assert.equal(command.status, 0, command.stderr);
    command = spawnSync('python3', [prepare, '--source', source, '--bundle', bundle, '--output', runtime], { encoding: 'utf8' });
    assert.equal(command.status, 0, command.stderr);
    newApp = createApp({ dbPath: runtime, storage: 'pz7' });
    await newApp.ready;
    server = newApp.app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;
    const login = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(admin) });
    assert.equal(login.status, 200, login.ok ? '' : await login.text());
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
    assert.ok(cookie);
    const state = await fetch(`${origin}/api/state`, { headers: { Cookie: cookie } });
    assert.equal(state.status, 200, state.ok ? '' : await state.text());
    const before = await state.json() as AppData;
    assert.equal(before.projects.length, 4);
    assert.equal(before.tasks.length, 21);
    const response = await fetch(`${origin}/api/projects/project-nova`, { method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Projet migré' }) });
    assert.equal(response.status, 200, response.ok ? '' : await response.text());
    const after = await (await fetch(`${origin}/api/state`, { headers: { Cookie: cookie } })).json() as AppData;
    assert.equal(after.projects.find(project => project.id === 'project-nova')?.name, 'Projet migré');
    const createTask = await fetch(`${origin}/api/tasks`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'project-nova', title: 'Tâche PZ7', assigneeId: 'resource-claire', allocatedHours: 2 }) });
    assert.equal(createTask.status, 201, createTask.ok ? '' : await createTask.text());
    const addedTask = await createTask.json() as { id: string };
    const createTime = await fetch(`${origin}/api/time-entries`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: addedTask.id, resourceId: 'resource-claire', date: '2026-10-06', hours: 1, note: 'PZ7' }) });
    assert.equal(createTime.status, 201, createTime.ok ? '' : await createTime.text());
    const addedTime = await createTime.json() as { id: string };
    const withNewRecords = await (await fetch(`${origin}/api/state`, { headers: { Cookie: cookie } })).json() as AppData;
    assert.equal(withNewRecords.tasks.find(task => task.id === addedTask.id)?.title, 'Tâche PZ7');
    assert.equal(withNewRecords.timeEntries.find(time => time.id === addedTime.id)?.note, 'PZ7');
    // No former PZ8 business tables may have been created by the HTTP application.
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(runtime, { readOnly: true });
    try {
      assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='projects'").get(), undefined);
      assert.equal((db.prepare("SELECT name FROM pz_project WHERE name='Projet migré'").get() as { name: string }).name, 'Projet migré');
      assert.equal((db.prepare("SELECT count(*) AS n FROM pz_task WHERE name='Tâche PZ7'").get() as { n: number }).n, 1);
      assert.equal((db.prepare('SELECT count(*) AS n FROM pz_time_record WHERE time_spent=1 AND recording_date=?').get('2026-10-06') as { n: number }).n >= 1, true);
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { db.close(); }
  } finally {
    if (server) await new Promise<void>((resolveClose, reject) => server!.close(error => error ? reject(error) : resolveClose()));
    newApp?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
