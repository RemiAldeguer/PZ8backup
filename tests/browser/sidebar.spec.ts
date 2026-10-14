import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import type { AppData, Project, Task, Zone } from '../../shared/types';
import { loginTestAdmin, TEST_ADMIN } from '../auth-fixture';

test.beforeEach(async ({ page, request }) => {
  await loginTestAdmin(page.request);
  await loginTestAdmin(request);
});

async function state(request: APIRequestContext): Promise<AppData> {
  const response = await request.get('/api/state');
  expect(response.ok()).toBeTruthy();
  return await response.json() as AppData;
}

async function create<T>(request: APIRequestContext, entity: string, data: Record<string, unknown>): Promise<T> {
  const response = await request.post(`/api/${entity}`, { data });
  expect(response.ok(), `${entity}: ${await response.text()}`).toBeTruthy();
  return await response.json() as T;
}

function project(request: APIRequestContext, zone: Zone, name: string) {
  return create<Project>(request, 'projects', {
    name, zoneId: zone.id, status: 'open', startDate: '2026-01-01', endDate: '2028-01-31',
  });
}

function sidebar(page: Page) { return page.getByRole('complementary', { name: 'Navigation principale', exact: true }); }
function sidebarProject(page: Page, item: Project) { return sidebar(page).getByRole('button', { name: item.name, exact: true }); }
function table(page: Page) { return page.getByRole('table', { name: 'Projets de la zone', exact: true }); }
function screenshotPath(name: string) {
  return test.info().project.testDir.endsWith('cloudflare-browser') ? test.info().outputPath(name) : `docs/screenshots/${name}`;
}

async function expandZone(page: Page, zone: Zone) {
  const expand = sidebar(page).getByRole('button', { name: `Développer les projets de ${zone.name}`, exact: true });
  if (await expand.count()) await expand.click();
}

test('sidebar : arbre des zones, comptes réels, projets récents conservés et repli de la navigation', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const data = await state(request);
  const zone = data.zones[1];
  const alpha = await project(request, zone, 'Recette sidebar Alpha');
  const beta = await project(request, zone, 'Recette sidebar Bêta');
  for (const [title, kind] of [['Première tâche', 'task'], ['Seconde tâche', 'task'], ['Jalon de recette', 'milestone']]) {
    await create<Task>(request, 'tasks', {
      projectId: alpha.id, title, kind, phase: 'Recette sidebar', allocatedHours: kind === 'task' ? 2 : 0,
      startDate: '2026-10-12', endDate: '2026-10-13',
    });
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/#projects');
  await expect(sidebar(page)).toBeVisible();
  await sidebar(page).locator('.sidebar-zones').getByRole('button').filter({ hasText: zone.name }).click();
  await expect(page).toHaveURL(new RegExp(`#zones/${zone.id}/projects$`));
  await expandZone(page, zone);
  await expect(sidebarProject(page, alpha)).toBeVisible();
  await expect(sidebarProject(page, alpha)).toContainText('3');
  await expect(sidebarProject(page, beta)).toContainText('0');
  await sidebar(page).getByRole('button', { name: `Réduire les projets de ${zone.name}`, exact: true }).click();
  await expect(sidebarProject(page, alpha)).not.toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#zones/${zone.id}/projects$`));
  await expandZone(page, zone);
  await sidebarProject(page, alpha).click();
  await expect(page).toHaveURL(new RegExp(`#project/${alpha.id}/summary$`));
  await sidebarProject(page, beta).click();
  await expect(page).toHaveURL(new RegExp(`#project/${beta.id}/summary$`));
  const recent = sidebar(page).getByRole('combobox', { name: 'Projets récents', exact: true });
  // Closed native selects expose only the selected option in Chromium's accessibility tree.
  const recentOptions = recent.locator('optgroup[label="Projets récemment ouverts"] option');
  await expect(recentOptions.first()).toHaveAttribute('value', beta.id);
  await page.reload();
  await expect(recentOptions).toHaveCount(2);
  await recent.selectOption(alpha.id);
  await expect(page).toHaveURL(new RegExp(`#project/${alpha.id}/summary$`));
  await expect(page.getByRole('heading', { name: alpha.name, exact: true })).toBeVisible();
  await sidebar(page).getByRole('button', { name: 'Réduire la barre latérale', exact: true }).click();
  await expect(sidebar(page).getByRole('button', { name: 'Développer la barre latérale', exact: true })).toBeVisible();
  expect(await sidebar(page).evaluate(element => element.getBoundingClientRect().width)).toBeLessThan(100);
  await page.reload();
  await expect(sidebar(page).getByRole('button', { name: 'Développer la barre latérale', exact: true })).toBeVisible();
  expect(await sidebar(page).evaluate(element => element.getBoundingClientRect().width)).toBeLessThan(100);
  await sidebar(page).getByRole('button', { name: `Ouvrir le menu du compte ${TEST_ADMIN.name}`, exact: true }).click();
  const accountMenu = page.getByRole('menu', { name: 'Mon compte', exact: true });
  await expect(accountMenu).toBeVisible();
  await expect(accountMenu.getByRole('menuitem', { name: 'Changer le mot de passe', exact: true })).toBeVisible();
  const accountBounds = await accountMenu.boundingBox();
  const viewport = page.viewportSize()!;
  expect(accountBounds!.x).toBeGreaterThanOrEqual(0);
  expect(accountBounds!.y).toBeGreaterThanOrEqual(0);
  expect(accountBounds!.x + accountBounds!.width).toBeLessThanOrEqual(viewport.width);
  expect(accountBounds!.y + accountBounds!.height).toBeLessThanOrEqual(viewport.height);
  await page.keyboard.press('Escape');
  await expect(accountMenu).not.toBeVisible();
  await sidebar(page).getByRole('button', { name: 'Développer la barre latérale', exact: true }).click();
  await expect(recent).toBeVisible();
  await page.goto(`/#zones/${zone.id}/projects`);
  await page.getByRole('region', { name: 'Tableau des projets, défilement horizontal', exact: true }).evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await page.screenshot({ path: screenshotPath('sidebar-desktop.png'), fullPage: true, animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('sidebar : création d’une zone et d’un projet dans cette zone, persistants après rechargement', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#projects');
  await sidebar(page).getByRole('button', { name: 'Créer une zone', exact: true }).click();
  const zoneDialog = page.getByRole('dialog', { name: 'Nouvelle zone', exact: true });
  await expect(zoneDialog).toBeVisible();
  const zoneName = 'Recette sidebar nouvelle zone';
  await zoneDialog.getByLabel('Nom de la zone', { exact: true }).fill(zoneName);
  await zoneDialog.getByLabel('Couleur', { exact: true }).fill('#078675');
  await zoneDialog.getByRole('button', { name: 'Créer la zone', exact: true }).click();
  await expect(zoneDialog).not.toBeVisible();
  const zone = (await state(request)).zones.find(item => item.name === zoneName)!;
  expect(zone).toMatchObject({ name: zoneName, color: '#078675' });
  await sidebar(page).locator('.sidebar-zones').getByRole('button').filter({ hasText: zoneName }).click();
  await expect(page).toHaveURL(new RegExp(`#zones/${zone.id}/projects$`));
  await expect(table(page).locator('tr[data-project-id]')).toHaveCount(0);
  await sidebar(page).getByRole('button', { name: `Créer un projet dans ${zoneName}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouveau projet', exact: true });
  await dialog.getByRole('button', { name: 'Depuis zéro', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: 'Zone', exact: true })).toHaveValue(zone.id);
  const name = 'Recette sidebar projet de la nouvelle zone';
  await dialog.getByLabel('Nom du projet', { exact: true }).fill(name);
  await dialog.getByLabel('Date de début', { exact: true }).fill('2026-10-12');
  await dialog.getByLabel('Date de fin', { exact: true }).fill('2026-11-12');
  await dialog.getByRole('button', { name: 'Créer le projet', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const created = (await state(request)).projects.find(item => item.name === name)!;
  expect(created.zoneId).toBe(zone.id);
  await expect(table(page).locator(`tr[data-project-id="${created.id}"]`)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Choisir une zone', exact: true })).toHaveValue(zone.id);
  await expandZone(page, zone);
  await expect(sidebarProject(page, created)).toBeVisible();
  await sidebarProject(page, created).click();
  await expect(page).toHaveURL(new RegExp(`#project/${created.id}/summary$`));
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('sidebar mobile : sous-menus et navigation restent utilisables sans débordement de la page', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const data = await state(request);
  const zone = data.zones[1];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/#zones/${zone.id}/projects`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Ouvrir le menu', exact: true }).click();
  await expect(sidebar(page)).toBeVisible();
  const management = sidebar(page).getByRole('button', { name: 'Gestion', exact: true });
  if (await management.getAttribute('aria-expanded') !== 'true') await management.click();
  await sidebar(page).getByRole('button', { name: 'Ressources', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Les bonnes personnes, au bon moment', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fermer le menu', exact: true })).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Returning through the sidebar must open the requested view after an internal tab change.
  await page.getByRole('button', { name: 'Ouvrir le menu', exact: true }).click();
  await sidebar(page).getByRole('button', { name: 'Ouvrir les profils de coûts', exact: true }).click();
  await expect(page).toHaveURL(/#resources\/profiles$/);
  await expect(page.getByRole('columnheader', { name: 'Tarif par Eqjt', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Annuaire', exact: true }).click();
  await expect(page).toHaveURL(/#resources\/directory$/);
  await expect(page.getByRole('columnheader', { name: 'Nature / classification', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ouvrir le menu', exact: true }).click();
  await sidebar(page).getByRole('button', { name: 'Ouvrir les profils de coûts', exact: true }).click();
  await expect(page).toHaveURL(/#resources\/profiles$/);
  await expect(page.getByRole('columnheader', { name: 'Tarif par Eqjt', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ouvrir le menu', exact: true }).click();
  await sidebar(page).getByRole('button', { name: 'Calendrier', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Calendrier global', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ouvrir le menu', exact: true }).click();
  await sidebar(page).getByRole('button', { name: 'Tous les projets, toutes les zones', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tous les projets', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ouvrir le menu', exact: true }).click();
  await page.screenshot({ path: screenshotPath('sidebar-mobile.png'), fullPage: true, animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const scrim = page.getByRole('button', { name: 'Fermer le menu', exact: true });
  const bounds = await scrim.boundingBox();
  // The centre of this full-screen backdrop is covered by the sidebar itself.
  await scrim.click({ position: { x: bounds!.width - 10, y: 20 } });
  await expect(scrim).not.toBeVisible();
  expect(errors).toEqual([]);
});
