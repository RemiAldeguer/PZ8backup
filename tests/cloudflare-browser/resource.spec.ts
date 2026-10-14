import { test, expect } from '@playwright/test';
import type { AppData } from '../../shared/types';
import { loginTestAdmin } from '../auth-fixture';

test.beforeEach(async ({ page }) => { await loginTestAdmin(page.request); });

test('Worker D1 : fiche ressource persistée, accès anonyme refusé et compte administrateur partagé entre navigateurs', async ({ page, browser, baseURL }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#resources');
  await page.getByRole('button', { name: /Nouvelle ressource/ }).click();
  await page.getByRole('dialog', { name: 'Nouvelle ressource', exact: true }).getByRole('button', { name: 'Ajouter un membre', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Ajouter un membre', exact: true });
  await dialog.getByLabel('Nom de la ressource', { exact: true }).fill('Camille Cloudflare Fiche');
  await dialog.getByLabel('Adresse e-mail', { exact: true }).fill('camille.cloudflare@example.com');
  await dialog.getByLabel('Fonction dans l’organisation', { exact: true }).fill('Responsable qualité');
  await dialog.getByLabel('Description (optionnelle)', { exact: true }).fill('Les données de cette fiche sont conservées dans D1.');
  await dialog.getByLabel('Capacité du mercredi (h/jour)', { exact: true }).fill('3.5');
  await dialog.getByLabel('Capacité du samedi (h/jour)', { exact: true }).fill('2');
  await dialog.getByLabel(/Calendrier de jours fériés/).selectOption('fr');
  await dialog.getByLabel('Valide les temps de Thomas Bernard', { exact: true }).check();
  const state = await (await page.request.get('/api/state')).json() as AppData;
  const project = state.projects.find(item => item.id === 'project-nova')!;
  await dialog.getByRole('button', { name: 'Associer un projet', exact: true }).click();
  await dialog.getByLabel(`Associer au projet ${project.name}`, { exact: true }).check();
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Ouvrir la fiche de Camille Cloudflare Fiche', exact: true }).click();
  const savedDialog = page.getByRole('dialog', { name: 'Fiche ressource', exact: true });
  await expect(savedDialog.getByLabel('Adresse e-mail', { exact: true })).toHaveValue('camille.cloudflare@example.com');
  await expect(savedDialog.getByLabel('Capacité du samedi (h/jour)', { exact: true })).toHaveValue('2');
  const persisted = await (await page.request.get('/api/state')).json() as AppData;
  const resource = persisted.resources.find(item => item.name === 'Camille Cloudflare Fiche')!;
  expect(resource).toMatchObject({ email: 'camille.cloudflare@example.com', holidayCalendarId: 'fr',
    weeklyCapacityHours: [8, 8, 3.5, 8, 8, 2, 0], projectIds: ['project-nova'], validatesTimeForIds: ['resource-thomas'] });
  const isolated = await browser.newContext({ baseURL, locale: 'fr-FR' });
  try {
    const second = await isolated.newPage();
    await second.goto('/#resources');
    await expect(second.getByRole('button', { name: 'Se connecter', exact: true })).toBeVisible();
    await expect(second.getByRole('button', { name: 'Ouvrir la fiche de Camille Cloudflare Fiche', exact: true })).toHaveCount(0);
    const inaccessible = await second.request.patch(`/api/resources/${resource.id}`, { data: { name: 'Accès autre espace' } });
    expect(inaccessible.status()).toBe(401);
    await loginTestAdmin(second.request);
    await second.reload();
    await expect(second.getByRole('button', { name: 'Ouvrir la fiche de Camille Cloudflare Fiche', exact: true })).toBeVisible();
    const shared = await (await second.request.get('/api/state')).json() as AppData;
    expect(shared.resources.find(item => item.id === resource.id)?.email).toBe('camille.cloudflare@example.com');
  } finally {
    await isolated.close();
  }
  expect(errors).toEqual([]);
});
