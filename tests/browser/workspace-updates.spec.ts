import { test, expect } from '@playwright/test';
import type { AppData } from '../../shared/types';
import { loginTestAdmin } from '../auth-fixture';

test('accueil sans projet historique et reprise des lectures après erreur de connexion', async ({ page }) => {
  await loginTestAdmin(page.request);
  let sessionUnavailable = true, stateUnavailable = true;
  await page.route('**/api/auth/session', async route => {
    if (sessionUnavailable) await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Temporarily unavailable"}' }); else await route.continue();
  });
  await page.route('**/api/state', async route => {
    if (stateUnavailable) { await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Temporarily unavailable"}' }); return; }
    const response = await route.fetch(); const data = await response.json() as AppData;
    data.projects = data.projects.filter(project => project.id !== 'project-nova');
    await route.fulfill({ response, json: data });
  });
  await page.goto('/');
  await expect(page.getByText('Impossible de vérifier votre connexion pour le moment.', { exact: true })).toBeVisible();
  sessionUnavailable = false; await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('alert')).toContainText('Impossible de charger votre espace');
  stateUnavailable = false; await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('heading', { name: 'Ma synthèse', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Accès réservé', exact: true })).toHaveCount(0);
});

test('ordre des zones par flèches et glisser-déposer, conservé après rechargement', async ({ page }) => {
  await loginTestAdmin(page.request); await page.goto('/#projects');
  const before = await (await page.request.get('/api/state')).json() as AppData;
  await page.getByRole('button', { name: 'Organiser les zones', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Organiser les zones', exact: true });
  const last = before.zones.at(-1)!;
  await dialog.getByRole('button', { name: 'Monter ' + last.name, exact: true }).click();
  const first = dialog.locator('[data-zone-id]').first(); const lastRow = dialog.locator('[data-zone-id]').last();
  const firstId = await first.getAttribute('data-zone-id');
  await first.dragTo(lastRow, { targetPosition: { x: 20, y: 45 } });
  const expected = await dialog.locator('[data-zone-id]').evaluateAll(rows => rows.map(row => row.getAttribute('data-zone-id')));
  expect(expected.at(-1)).toBe(firstId);
  await dialog.getByRole('button', { name: 'Enregistrer l’ordre', exact: true }).click();
  await expect(dialog).not.toBeVisible(); await page.reload();
  const sidebar = page.getByRole('complementary', { name: 'Navigation principale', exact: true });
  await expect(sidebar.locator('.pz-sidebar-zone')).toHaveCount(before.zones.length);
  expect(await sidebar.locator('.pz-sidebar-zone').evaluateAll(rows => rows.map(row => row.getAttribute('data-zone-id')))).toEqual(expected);
  const after = await (await page.request.get('/api/state')).json() as AppData;
  expect(after.projects).toEqual(before.projects); expect(after.tasks).toEqual(before.tasks);
});
