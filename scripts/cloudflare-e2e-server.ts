import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { AUTH_SCHEMA, hashPassword } from '../server/auth.ts';
import { TEST_ADMIN } from '../tests/auth-fixture.ts';

const execute = promisify(execFile);
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'planzone8-cloudflare-browser-'));
const persistDirectory = join(temporaryDirectory, 'persist');
const wrangler = resolve('node_modules/.bin/wrangler');
const env = {
  ...process.env,
  XDG_CONFIG_HOME: join(temporaryDirectory, 'config'),
  WRANGLER_LOG_PATH: join(temporaryDirectory, 'logs'),
  WRANGLER_SEND_METRICS: 'false',
};
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

try {
  // This database is independent from the developer's local D1 data and production.
  const migrationDirectory = resolve('cloudflare/migrations');
  const migrations = (await readdir(migrationDirectory)).filter(name => name.endsWith('.sql')).sort();
  const migrationSql = await Promise.all(migrations.map(name => readFile(join(migrationDirectory, name), 'utf8')));
  const passwordHash = await hashPassword(TEST_ADMIN.password);
  const adminSql = `INSERT INTO auth_users (id, username, name, password_hash, workspace_id) VALUES (${[
    crypto.randomUUID(), TEST_ADMIN.username, TEST_ADMIN.name, passwordHash, crypto.randomUUID(),
  ].map(quote).join(', ')});`;
  const schemaPath = join(temporaryDirectory, 'fixture.sql');
  await writeFile(schemaPath, [...migrationSql, ...AUTH_SCHEMA.map(statement => `${statement};`), adminSql].join('\n'), { mode: 0o600 });
  await execute(wrangler, ['d1', 'execute', 'DB', '--local', '--persist-to', persistDirectory, '--file', schemaPath], {
    env, maxBuffer: 1024 * 1024,
  });
  const worker = spawn(wrangler, ['dev', '--local', '--ip', '127.0.0.1', '--port', '8787', '--persist-to', persistDirectory], {
    env, stdio: 'inherit',
  });
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
    stopping = true;
    worker.kill('SIGTERM');
  });
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    worker.once('error', reject);
    worker.once('exit', code => resolveExit(stopping ? 0 : code ?? 1));
  });
  await rm(temporaryDirectory, { recursive: true, force: true });
  process.exitCode = exitCode;
} catch (error) {
  await rm(temporaryDirectory, { recursive: true, force: true });
  console.error('Le serveur Cloudflare de test n’a pas pu démarrer.', error instanceof Error ? error.message : 'Erreur inconnue');
  process.exitCode = 1;
}
