import { test, expect } from '@playwright/test';
import type { AppData } from '../../shared/types';
import { loginTestAdmin } from '../auth-fixture';

test.beforeEach(async ({ page }) => { await loginTestAdmin(page.request); });

test('Worker D1 : tâche et commentaire persistés, accès anonyme refusé puis même compte retrouvé dans un autre navigateur', async ({ page, browser, baseURL }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const title = 'Recette Cloudflare : tâche persistante';
  const comment = 'Ce commentaire est conservé dans mon espace D1.';

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Vue d’ensemble', exact: true })).toBeVisible();
  const health = await page.request.get('/api/health');
  expect(health.ok()).toBeTruthy();
  expect(await health.json()).toMatchObject({ storage: 'd1', mode: 'cloud-demo' });

  await page.getByRole('button', { name: 'Nouvelle tâche', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Nouvelle tâche', exact: true });
  await dialog.getByLabel('Titre', { exact: true }).fill(title);
  await dialog.getByRole('combobox', { name: 'Assigné à', exact: true }).selectOption('resource-claire');
  await dialog.getByLabel('Début', { exact: true }).fill('2026-10-06');
  await dialog.getByLabel('Fin', { exact: true }).fill('2026-10-09');
  await dialog.getByLabel('Travail alloué (heures)').fill('8');
  await dialog.getByRole('button', { name: 'Créer la tâche', exact: true }).click();
  await expect(dialog).not.toBeVisible();

  await page.getByRole('navigation', { name: 'Vues du projet' }).getByRole('button', { name: /^Liste/ }).click();
  await page.getByRole('button', { name: title, exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Détail de la tâche', exact: true });
  await dialog.getByLabel('Votre commentaire').fill(comment);
  await dialog.getByRole('button', { name: 'Envoyer', exact: true }).click();
  await expect(dialog.getByText(comment, { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();

  await page.getByRole('navigation', { name: 'Vues du projet' }).getByRole('button', { name: 'Tableau', exact: true }).click();
  await page.getByLabel(`Statut de ${title}`, { exact: true }).selectOption('done');
  await expect(page.getByLabel(`Statut de ${title}`, { exact: true })).toHaveValue('done');
  await page.reload();
  await expect(page.getByLabel(`Statut de ${title}`, { exact: true })).toHaveValue('done');

  // page.request partage les cookies du BrowserContext, contrairement à la fixture request.
  const state = await (await page.request.get('/api/state')).json() as AppData;
  const task = state.tasks.find(item => item.title === title);
  expect(task).toMatchObject({ status: 'done', progress: 100, allocatedHours: 8 });
  expect(state.comments.some(item => item.taskId === task?.id && item.body === comment)).toBeTruthy();

  await page.getByRole('button', { name: title, exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Détail de la tâche', exact: true });
  await expect(dialog.getByText(comment, { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('cloudflare-desktop.png'), fullPage: true });

  const firstCookie = (await page.context().cookies()).find(cookie => cookie.name === 'planzone8-session-local');
  expect(firstCookie?.httpOnly).toBe(true);
  expect(firstCookie?.sameSite).toBe('Lax');

  const isolatedContext = await browser.newContext({ baseURL, locale: 'fr-FR', timezoneId: 'Europe/Paris' });
  try {
    const isolatedPage = await isolatedContext.newPage();
    await isolatedPage.goto('/#project/project-nova/list');
    await expect(isolatedPage.getByRole('button', { name: 'Se connecter', exact: true })).toBeVisible();
    await expect(isolatedPage.getByRole('button', { name: title, exact: true })).toHaveCount(0);
    expect((await isolatedPage.request.get('/api/state')).status()).toBe(401);
    const inaccessibleTask = await isolatedPage.request.patch(`/api/tasks/${task!.id}`, { data: { status: 'todo' } });
    expect(inaccessibleTask.status()).toBe(401);
    await loginTestAdmin(isolatedPage.request);
    await isolatedPage.reload();
    await expect(isolatedPage.getByRole('heading', { name: 'Liste des tâches', exact: true })).toBeVisible();
    await expect(isolatedPage.getByRole('button', { name: title, exact: true })).toBeVisible();
    const sharedState = await (await isolatedPage.request.get('/api/state')).json() as AppData;
    expect(sharedState.tasks.find(item => item.id === task?.id)?.status).toBe('done');
    expect(sharedState.comments.some(item => item.taskId === task?.id && item.body === comment)).toBe(true);
    const secondCookie = (await isolatedContext.cookies()).find(cookie => cookie.name === 'planzone8-session-local');
    expect(secondCookie?.value).toBeTruthy();
    expect(secondCookie?.value).not.toBe(firstCookie?.value);
  } finally {
    await isolatedContext.close();
  }

  const persisted = await (await page.request.get('/api/state')).json() as AppData;
  expect(persisted.tasks.find(item => item.id === task!.id)?.status).toBe('done');
  expect(errors).toEqual([]);
});

test('Assets Cloudflare : calendrier global et navigation mobile sans débordement', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#calendar');
  await expect(page.getByRole('heading', { name: 'Calendrier global', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Filtrer le calendrier par ressource' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.getByRole('button', { name: 'Ouvrir le menu', exact: true }).click();
  await page.getByRole('button', { name: /^Mes projets/ }).click();
  await expect(page.getByRole('heading', { name: 'Tous les projets', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: test.info().outputPath('cloudflare-mobile.png'), fullPage: true });
});
