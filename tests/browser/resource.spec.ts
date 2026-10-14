import { test, expect, type Page } from '@playwright/test';
import type { AppData, Resource } from '../../shared/types';
import { loginTestAdmin } from '../auth-fixture';

test.beforeEach(async ({ page }) => { await loginTestAdmin(page.request); });

async function fixtureResource(page: Page, suffix: string): Promise<Resource> {
  await page.goto('/');
  const created = await page.request.post('/api/resources', {
    data: { name: `Ressource fiche ${suffix}`, jobTitle: 'Responsable de recette', type: 'human', profileId: 'profile-pilot', role: 'visitor' },
  });
  expect(created.ok()).toBeTruthy();
  const resource = await created.json() as Resource;
  const task = await page.request.post('/api/tasks', {
    data: { projectId: 'project-nova', title: `Affectation fiche ${suffix}`, assigneeId: resource.id, allocatedHours: 8 },
  });
  expect(task.ok()).toBeTruthy();
  await page.reload();
  return resource;
}

test('fiche ouverte depuis l’équipe : toutes les données sont enregistrées et les projets associés rejoignent leur équipe', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const resource = await fixtureResource(page, 'complète');
  await page.goto('/#project/project-nova/team');
  await page.getByRole('button', { name: `Ouvrir la fiche de ${resource.name}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Fiche ressource', exact: true });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('Nom de la ressource', { exact: true }).fill('Camille Fiche complète');
  await dialog.getByLabel('Adresse e-mail', { exact: true }).fill('camille.fiche@example.com');
  await dialog.getByLabel('Fonction dans l’organisation', { exact: true }).fill('Responsable produit');
  await dialog.getByRole('combobox', { name: 'Rôle', exact: true }).selectOption('user');
  await dialog.getByLabel('Description (optionnelle)', { exact: true }).fill('Pilote le produit et valide les temps de son équipe.');
  await dialog.getByLabel('Cette ressource est externe', { exact: true }).check();
  await dialog.getByLabel('Unité de capacité', { exact: true }).selectOption('days');
  await dialog.getByLabel('Heures par jour de capacité', { exact: true }).fill('7');
  await dialog.getByLabel('Capacité du lundi (jours/jour)', { exact: true }).fill('1');
  await dialog.getByLabel('Capacité du mardi (jours/jour)', { exact: true }).fill('1');
  await dialog.getByLabel('Capacité du mercredi (jours/jour)', { exact: true }).fill('0.5');
  await dialog.getByLabel('Capacité du jeudi (jours/jour)', { exact: true }).fill('1');
  await dialog.getByLabel('Capacité du vendredi (jours/jour)', { exact: true }).fill('1');
  await dialog.getByLabel('Capacité du samedi (jours/jour)', { exact: true }).fill('0.25');
  await dialog.getByLabel(/Calendrier de jours fériés/).selectOption('fr');
  await dialog.getByLabel('Valide les temps de Thomas Bernard', { exact: true }).check();

  await dialog.getByRole('button', { name: 'Modifier les tags ressource', exact: true }).click();
  await dialog.getByLabel('Nom du tag ressource', { exact: true }).fill('MOE');
  await dialog.getByLabel('Couleur du tag ressource', { exact: true }).fill('#1122aa');
  await dialog.getByRole('button', { name: 'Ajouter le tag ressource', exact: true }).click();
  await dialog.getByRole('button', { name: 'Ajouter un champ', exact: true }).click();
  await dialog.getByLabel('Nom du champ personnalisé 1', { exact: true }).fill('Lien SharePoint');
  await dialog.getByLabel('Type du champ personnalisé 1', { exact: true }).selectOption('url');
  await dialog.getByLabel('Valeur du champ personnalisé 1', { exact: true }).fill('https://example.com/produit');

  const initialState = await (await page.request.get('/api/state')).json() as AppData;
  const mobileProject = initialState.projects.find(project => project.id === 'project-mobile')!;
  await dialog.getByRole('button', { name: 'Associer un projet', exact: true }).click();
  await dialog.getByLabel(`Associer au projet ${mobileProject.name}`, { exact: true }).check();
  const novaProject = initialState.projects.find(project => project.id === 'project-nova')!;
  await expect(dialog.getByLabel(`Associer au projet ${novaProject.name}`, { exact: true })).toBeDisabled();
  await expect(dialog.getByLabel(`Associer au projet ${novaProject.name}`, { exact: true })).toBeChecked();
  await dialog.locator('.rd-scroll').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: 'docs/screenshots/resource-desktop.png', fullPage: false });
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Ouvrir la fiche de Camille Fiche complète', exact: true }).click();
  await expect(dialog.getByLabel('Adresse e-mail', { exact: true })).toHaveValue('camille.fiche@example.com');
  await expect(dialog.getByLabel('Capacité du mercredi (jours/jour)', { exact: true })).toHaveValue('0.5');
  await expect(dialog.getByLabel(/Calendrier de jours fériés/)).toHaveValue('fr');
  await expect(dialog.getByLabel('Valide les temps de Thomas Bernard', { exact: true })).toBeChecked();
  await dialog.getByRole('button', { name: 'Associer un projet', exact: true }).click();
  await expect(dialog.getByLabel(`Associer au projet ${mobileProject.name}`, { exact: true })).toBeChecked();
  const state = await (await page.request.get('/api/state')).json() as AppData;
  expect(state.resources.find(item => item.id === resource.id)).toMatchObject({
    name: 'Camille Fiche complète', email: 'camille.fiche@example.com', jobTitle: 'Responsable produit', role: 'user',
    description: 'Pilote le produit et valide les temps de son équipe.', classification: 'external',
    capacityUnit: 'days', hoursPerDay: 7, weeklyCapacityHours: [7, 7, 3.5, 7, 7, 1.75, 0],
    holidayCalendarId: 'fr', validatesTimeForIds: ['resource-thomas'], projectIds: ['project-mobile'],
    tags: [{ label: 'MOE', color: '#1122aa' }],
    customFields: [{ id: expect.any(String), label: 'Lien SharePoint', type: 'url', value: 'https://example.com/produit' }],
  });
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  await page.goto('/#project/project-mobile/team');
  const memberRow = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Ouvrir la fiche de Camille Fiche complète', exact: true }) });
  await expect(memberRow).toBeVisible();
  await expect(memberRow.getByRole('cell').nth(5)).toHaveText('0');
  expect(state.tasks.some(task => task.projectId === 'project-mobile' && task.assigneeId === resource.id)).toBe(false);
  expect(errors).toEqual([]);
});

test('annuler et Échap ne modifient pas la ressource, fiche utilisable au clavier et sur mobile', async ({ page }) => {
  const resource = await fixtureResource(page, 'annulation');
  await page.goto('/#resources');
  await page.getByRole('button', { name: `Ouvrir la fiche de ${resource.name}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Fiche ressource', exact: true });
  await dialog.getByLabel('Nom de la ressource', { exact: true }).fill('Modification abandonnée');
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: `Ouvrir la fiche de ${resource.name}`, exact: true }).click();
  await dialog.getByLabel('Description (optionnelle)', { exact: true }).fill('Autre modification abandonnée');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: `Ouvrir la fiche de ${resource.name}`, exact: true })).toBeFocused();
  const state = await (await page.request.get('/api/state')).json() as AppData;
  expect(state.resources.find(item => item.id === resource.id)).toMatchObject({ name: resource.name, description: '' });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: `Ouvrir la fiche de ${resource.name}`, exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Nom de la ressource', { exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByLabel('Fonction dans l’organisation', { exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByLabel('Nom de la ressource', { exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const rect = await dialog.boundingBox();
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(391);
  await dialog.getByLabel(/Calendrier de jours fériés/).scrollIntoViewIfNeeded();
  await expect(dialog.getByLabel(/Calendrier de jours fériés/)).toBeVisible();
  const header = await dialog.locator('.rd-header').boundingBox();
  const footer = await dialog.locator('.rd-footer').boundingBox();
  expect(header!.y).toBeGreaterThanOrEqual(0);
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(845);
  expect(await dialog.evaluate(element => element.scrollTop)).toBe(0);
  expect(await dialog.locator('.rd-scroll').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await page.screenshot({ path: 'docs/screenshots/resource-mobile.png', fullPage: false });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});
