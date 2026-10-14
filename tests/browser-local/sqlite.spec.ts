import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, expect } from '@playwright/test';
import { createApp } from '../../server/app.ts';

const schema = resolve('planzone_pz_sans_recording_day.sqlite');
function run(script: string, ...args: string[]) {
  const result = spawnSync('python3', [resolve('scripts', script), ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
async function fixture(dir: string): Promise<string> {
  const source = join(dir, 'legacy.sqlite');
  const application = createApp({ dbPath: source, admin: { username: 'admin', password: 'Browser-E2E-Test-2026!' } });
  try { await application.ready; } finally { application.close(); }
  const bundle = join(dir, 'bundle');
  const runtime = join(dir, 'runtime.sqlite');
  const output = join(dir, 'manual-import.sqlite');
  run('migrate-pz8-to-pz7.py', '--source', source, '--schema', schema, '--output', bundle);
  run('prepare-pz7-runtime.py', '--source', source, '--bundle', bundle, '--output', runtime);
  run('export-pz7-browser.py', '--source', runtime, '--output', output);
  return output;
}

test('static client starts without server API or private data', async ({ page }) => {
  const apiRequests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api')) apiRequests.push(request.url()); });
  await page.goto('/');
  await expect(page.getByText('Ouvrir un espace local')).toBeVisible();
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  expect(apiRequests).toEqual([]);
});

test('manual PZ7 import, persistent mutation, safe export and re-import', async ({ page, browser }) => {
  test.skip(!existsSync(schema), 'The supplied PZ7 schema template is unavailable.');
  const dir = mkdtempSync(join(tmpdir(), 'pz8-local-e2e-'));
  let second: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    const source = await fixture(dir);
    const apiRequests: string[] = [];
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api')) apiRequests.push(request.url()); });
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles(source);
    await expect(page.getByText('4 projets', { exact: true }).first()).toBeVisible();
    await page.evaluate(() => { location.hash = 'project/project-nova/summary'; });
    await page.getByTitle('Ajouter une tâche').click();
    await page.getByPlaceholder('Ex. : Préparer le pilote').fill('Vérification SQLite locale');
    await page.getByRole('button', { name: 'Créer la tâche' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.reload();
    await expect(page.getByText('Vérification SQLite locale', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Votre espace et votre profil' }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Exporter une sauvegarde .sqlite' }).click();
    const download = await downloadPromise;
    const exported = join(dir, 'exported.sqlite');
    await download.saveAs(exported);
    const db = new DatabaseSync(exported, { readOnly: true });
    try {
      assert.equal((db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'auth_%'").get() as { n: number }).n, 0);
      assert.equal((db.prepare("SELECT count(*) AS n FROM pz8_identity WHERE entity='tasks'").get() as { n: number }).n, 22);
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { db.close(); }
    second = await browser.newContext();
    const restored = await second.newPage();
    await restored.goto('/');
    await restored.locator('input[type=file]').setInputFiles(exported);
    await expect(restored.getByText('4 projets', { exact: true }).first()).toBeVisible();
    await restored.evaluate(() => { location.hash = 'project/project-nova/summary'; });
    await expect(restored.getByText('Vérification SQLite locale', { exact: true })).toBeVisible();
    expect(apiRequests).toEqual([]);
  } finally { await second?.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('creating a project updates PZ7 and survives a reload', async ({ page }) => {
  test.skip(!existsSync(schema), 'The supplied PZ7 schema template is unavailable.');
  const dir = mkdtempSync(join(tmpdir(), 'pz8-project-e2e-'));
  try {
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles(await fixture(dir));
    await expect(page.getByText('4 projets', { exact: true }).first()).toBeVisible();
    await page.getByTitle('Créer un projet dans Transformation').click();
    await page.getByText('Depuis zéro', { exact: true }).click();
    await page.getByPlaceholder('Nommer votre projet').fill('Projet client SQLite');
    await page.getByRole('button', { name: 'Créer le projet' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.reload();
    await expect(page.getByText('5 projets', { exact: true }).first()).toBeVisible();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a lost active OPFS file can be restored from a manual backup', async ({ page }) => {
  test.skip(!existsSync(schema), 'The supplied PZ7 schema template is unavailable.');
  const dir = mkdtempSync(join(tmpdir(), 'pz8-recovery-'));
  try {
    const source = await fixture(dir);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Importer une base .sqlite' })).toBeVisible();
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('planzone8-browser-storage', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction('settings', 'readwrite');
          transaction.objectStore('settings').put('/missing-backup.sqlite', 'active-database');
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
        });
      } finally { db.close(); }
    });
    await page.reload();
    await expect(page.getByText('Ouvrir un espace local')).toBeVisible();
    await expect(page.getByRole('alert').first()).toContainText('base locale précédente est inaccessible');
    await page.locator('input[type=file]').setInputFiles(source);
    await expect(page.getByText('4 projets', { exact: true }).first()).toBeVisible();
    await page.reload();
    await expect(page.getByText('4 projets', { exact: true }).first()).toBeVisible();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('replacing a workspace removes its old OPFS copy', async ({ page }) => {
  test.skip(!existsSync(schema), 'The supplied PZ7 schema template is unavailable.');
  const dir = mkdtempSync(join(tmpdir(), 'pz8-replace-'));
  try {
    const source = await fixture(dir);
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles(source);
    await expect(page.getByText('4 projets', { exact: true }).first()).toBeVisible();
    const copies = () => page.evaluate(async () => {
      const names: string[] = [];
      for await (const name of (await navigator.storage.getDirectory()).keys())
        if (name.startsWith('planzone8-') && name.endsWith('.sqlite')) names.push(name);
      return names;
    });
    const [original] = await copies();
    expect(original).toBeTruthy();
    page.on('dialog', dialog => { void dialog.accept(); });
    await page.locator('input[type=file]').setInputFiles(source);
    await expect.poll(async () => (await copies()).filter(name => name !== original).length).toBe(1);
    await expect.poll(async () => (await copies()).includes(original)).toBe(false);
    await page.reload();
    await expect(page.getByText('4 projets', { exact: true }).first()).toBeVisible();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('bad replacement never destroys the current workspace', async ({ page }) => {
  test.skip(!existsSync(schema), 'The supplied PZ7 schema template is unavailable.');
  const dir = mkdtempSync(join(tmpdir(), 'pz8-bad-import-'));
  try {
    const source = await fixture(dir);
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles(source);
    await expect(page.getByText('4 projets', { exact: true }).first()).toBeVisible();
    page.on('dialog', dialog => { void dialog.accept(); });
    await page.locator('input[type=file]').setInputFiles({ name: 'broken.sqlite', mimeType: 'application/vnd.sqlite3', buffer: Buffer.alloc(150, 88) });
    await expect(page.getByRole('alert').first()).toBeVisible();
    await page.reload();
    await expect(page.getByText('4 projets', { exact: true }).first()).toBeVisible();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
