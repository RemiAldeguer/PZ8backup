import { createApp } from './app.ts';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT doit être un numéro de port valide.');
const storage = process.env.STORAGE_BACKEND === 'legacy' ? 'legacy' : 'pz7';
const dbPath = process.env.DB_PATH ?? resolve(storage === 'legacy' ? 'data/planzone.sqlite' : 'data/pz7-runtime-active.sqlite');
const credentialsPath = resolve(dbPath === ':memory:' ? 'data' : dirname(dbPath), 'admin-credentials.json');
let saveCredentials = false;
let admin = {
  username: process.env.PLANZONE_ADMIN_USERNAME ?? 'admin',
  password: process.env.PLANZONE_ADMIN_PASSWORD ?? '',
  name: 'Administrateur',
};
if (!admin.password) {
  try {
    const stored = JSON.parse(await readFile(credentialsPath, 'utf8')) as { username?: unknown; password?: unknown };
    if (typeof stored.username !== 'string' || typeof stored.password !== 'string') throw new Error('Le fichier des identifiants administrateur locaux est invalide.');
    admin = { username: stored.username, password: stored.password, name: 'Administrateur' };
  } catch (error) {
    if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error;
    admin.password = Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join('');
    saveCredentials = true;
  }
}
const { app, close, ready } = createApp({
  dbPath, storage, today: process.env.DEMO_TODAY,
  allowedOrigins: process.env.APP_ORIGIN ? [new URL(process.env.APP_ORIGIN).origin] : [],
  admin,
});
const adminCreated = await ready;
if (adminCreated && saveCredentials) {
  await mkdir(dirname(credentialsPath), { recursive: true });
  await writeFile(credentialsPath, `${JSON.stringify({ username: admin.username, password: admin.password }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  console.log(`Identifiants administrateur initiaux conservés dans le fichier privé ${credentialsPath}`);
} else if (!adminCreated && saveCredentials) {
  console.log('Le compte administrateur existe déjà. Son mot de passe est conservé ; utilisez vos identifiants existants.');
}
const host = process.env.HOST ?? '127.0.0.1';
const server = app.listen(port, host, () => {
  console.log(`Planzone 8 · connexion requise sur http://${host}:${port}`);
});
let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(() => { close(); process.exit(0); });
  });
}
