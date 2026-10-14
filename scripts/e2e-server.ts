import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.ts';
import { TEST_ADMIN } from '../tests/auth-fixture.ts';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'planzone8-browser-'));
const { app, close, ready } = createApp({ dbPath: join(temporaryDirectory, 'test.sqlite'), today: '2026-10-06', admin: TEST_ADMIN });
await ready;
const server = app.listen(4174, '127.0.0.1', () => console.log('Serveur navigateur de test prêt.'));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  server.close(() => { close(); rmSync(temporaryDirectory, { recursive: true, force: true }); process.exit(0); });
});
