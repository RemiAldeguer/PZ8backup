import { test, expect } from '@playwright/test';
import { loginTestAdmin } from '../auth-fixture';

test('Un projet sans dates affiche son état non planifié et conserve les dates vides après renommage', async ({ page }) => {
  await loginTestAdmin(page.request);
  const state = await (await page.request.get('/api/state')).json();
  const response = await page.request.post('/api/projects', { data: { name: 'Projet sans dates exportées', zoneId: state.zones[0].id, startDate: null, endDate: null, weather: 0 } });
  expect(response.status()).toBe(201); const project = await response.json();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#project/' + project.id + '/summary');
  await expect(page.locator('.pzs-timeline')).toContainText('Dates du projet à renseigner');
  await page.getByRole('button', { name: 'Paramètres du projet', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Date de début', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('Date de fin', { exact: true })).toHaveValue('');
  await dialog.getByLabel('Nom du projet', { exact: true }).fill('Projet sans dates renommé');
  await dialog.getByRole('button', { name: 'Enregistrer le projet', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const saved = (await (await page.request.get('/api/state')).json()).projects.find((p: { id: string }) => p.id === project.id);
  expect(saved.startDate).toBeNull(); expect(saved.endDate).toBeNull();
  await page.goto('/#project/' + project.id + '/gantt');
  await expect(page.locator('.pzg-scroll')).toBeVisible(); await expect(page.locator('.pzg-bar')).toHaveCount(0);
  expect(errors).toEqual([]);
  expect((await page.request.delete('/api/projects/' + project.id)).status()).toBe(204);
});
