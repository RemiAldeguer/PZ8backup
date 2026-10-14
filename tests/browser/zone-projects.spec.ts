import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import type { AppData, Project, ProjectStatus, Resource, Task, Zone } from '../../shared/types';
import { loginTestAdmin } from '../auth-fixture';

test.beforeEach(async ({ page, request }) => {
  await loginTestAdmin(page.request);
  await loginTestAdmin(request);
});

async function state(request: APIRequestContext): Promise<AppData> {
  const response = await request.get('/api/state');
  expect(response.ok()).toBeTruthy();
  return await response.json() as AppData;
}

async function fixture(request: APIRequestContext, suffix: string) {
  const data = await state(request);
  const zone = data.zones[1];
  const otherZone = data.zones[0];
  const resource = data.resources.find(item => item.id === data.currentUser.id && item.active)!;
  const prefix = `Recette zone ${suffix}`;
  async function project(name: string, projectZone: Zone, endDate = '2028-01-31', weather = 4) {
    const response = await request.post('/api/projects', { data: {
      name: `${prefix} ${name}`, zoneId: projectZone.id, startDate: '2026-01-01',
      endDate, status: 'open', weather,
    } });
    expect(response.ok()).toBeTruthy();
    return await response.json() as Project;
  }
  async function task(project: Project, title: string, allocatedHours: number, progress: number, endDate: string, status = 'todo') {
    const response = await request.post('/api/tasks', { data: {
      projectId: project.id, title: `${prefix} ${title}`, phase: 'Préparation de la zone',
      assigneeId: resource.id, allocatedHours, progress, status,
      startDate: '2026-01-01', endDate, tags: ['Recette'],
    } });
    expect(response.ok()).toBeTruthy();
    return await response.json() as Task;
  }
  async function record(task: Task, hours: number) {
    const response = await request.post('/api/time-entries', { data: {
      taskId: task.id, resourceId: resource.id, date: '2026-10-05', hours,
      note: `${prefix} temps conservé`,
    } });
    expect(response.ok()).toBeTruthy();
  }
  const alpha = await project('Alpha', zone, '2028-01-31', 2);
  const beta = await project('Bêta', zone, '2027-01-31', 5);
  const outside = await project('Hors zone', otherZone);
  await task(alpha, 'achevée', 4, 100, '2026-01-02', 'done');
  await task(alpha, 'en retard', 12, 25, '2026-01-02', 'in_progress');
  const future = await task(alpha, 'future', 4, 50, '2028-01-31', 'in_progress');
  const betaTask = await task(beta, 'ouverte', 10, 0, '2028-01-31');
  const outsideTask = await task(outside, 'exclue', 100, 100, '2026-01-02', 'done');
  await record(future, 21.25);
  await record(betaTask, 1.25);
  await record(outsideTask, 5);
  const memberResponse = await request.post('/api/resources', { data: {
    name: `${prefix} membre sans tâche`, jobTitle: 'Contribution à la zone',
    type: 'human', projectIds: [alpha.id],
  } });
  expect(memberResponse.ok()).toBeTruthy();
  const explicitMember = await memberResponse.json() as Resource;
  return { zone, otherZone, prefix, alpha, beta, outside, explicitMember };
}

function matrix(page: Page) { return page.getByRole('table', { name: 'Projets de la zone', exact: true }); }
function projectRow(page: Page, project: Project) { return matrix(page).locator(`tr[data-project-id="${project.id}"]`); }
function groupRow(page: Page, zone: Zone) { return matrix(page).locator(`tr.zp-zone-summary[data-zone-id="${zone.id}"]`); }
async function expectNumber(cell: Locator, expected: number) {
  await expect.poll(async () => Number((await cell.innerText()).replace(/\s/g, '').replace(',', '.').replace(/[^\d.\-]/g, ''))).toBe(expected);
}
async function filterFixture(page: Page, zone: Zone, prefix: string) {
  await page.goto(`/#zones/${encodeURIComponent(zone.id)}/projects`);
  await expect(page.getByRole('combobox', { name: 'Choisir une zone', exact: true })).toHaveValue(zone.id);
  await page.getByRole('textbox', { name: 'Rechercher un projet', exact: true }).fill(prefix);
}
function screenshotPath(name: string) {
  return test.info().project.testDir.endsWith('cloudflare-browser') ? test.info().outputPath(name) : `docs/screenshots/${name}`;
}

test('table de zone : totaux pondérés, temps réels et dépassement sans inclure les projets d’une autre zone', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const { zone, prefix, alpha, beta, outside, explicitMember } = await fixture(request, 'totaux');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/#projects');
  await expect(projectRow(page, outside)).toBeVisible();
  await page.screenshot({ path: screenshotPath('zone-projects-all.png'), fullPage: true, animations: 'disabled' });
  await filterFixture(page, zone, prefix);
  await expect(matrix(page).locator('tr[data-project-id]')).toHaveCount(2);
  await expect(projectRow(page, outside)).toHaveCount(0);
  // Explicit project membership remains visible before any task is assigned.
  await expect(projectRow(page, alpha).locator('.zp-team')).toContainText(explicitMember.name);
  await expect(projectRow(page, beta).locator('.zp-team')).not.toContainText(explicitMember.name);
  for (const [metric, expected] of Object.entries({ allocated: 20, spent: 21.25, remaining: -1.25, realized: 45, late: 45, open: 10 })) {
    await expectNumber(projectRow(page, alpha).locator(`[data-metric="${metric}"]`), expected);
  }
  for (const [metric, expected] of Object.entries({ allocated: 10, spent: 1.25, remaining: 8.75, realized: 0, late: 0, open: 100 })) {
    await expectNumber(projectRow(page, beta).locator(`[data-metric="${metric}"]`), expected);
  }
  // The group uses its 30 hours of work, not the unweighted mean of 45% and 0%.
  const group = groupRow(page, zone);
  for (const [metric, expected] of Object.entries({ allocated: 30, spent: 22.5, remaining: 7.5, realized: 30, late: 30, open: 40 })) {
    await expectNumber(group.locator(`[data-metric="${metric}"]`), expected);
  }
  await group.getByRole('button', { name: `Réduire ${zone.name}`, exact: true }).click();
  await expect(matrix(page).locator('tr[data-project-id]')).toHaveCount(0);
  await expectNumber(group.locator('[data-metric="spent"]'), 22.5);
  await group.getByRole('button', { name: `Développer ${zone.name}`, exact: true }).click();
  await expect(projectRow(page, alpha)).toBeVisible();
  await expect(projectRow(page, beta)).toBeVisible();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ path: screenshotPath('zone-projects-table.png'), fullPage: true, animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('navigation de zone conservée après rechargement et création préremplie dans la zone active', async ({ page, request }) => {
  const { zone, otherZone, prefix, alpha, outside } = await fixture(request, 'navigation');
  await page.goto('/#projects');
  await expect(page.getByRole('heading', { name: 'Tous les projets', exact: true })).toBeVisible();
  await page.locator('.sidebar-zones').getByRole('button').filter({ hasText: zone.name }).click();
  await expect(page).toHaveURL(new RegExp(`#zones/${zone.id}/projects$`));
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Choisir une zone', exact: true })).toHaveValue(zone.id);
  await expect(projectRow(page, alpha)).toBeVisible();
  await expect(projectRow(page, outside)).toHaveCount(0);

  await page.getByRole('button', { name: 'Nouveau projet', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouveau projet', exact: true });
  await dialog.getByRole('button', { name: 'Depuis zéro', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: 'Zone', exact: true })).toHaveValue(zone.id);
  const createdName = `${prefix} créé depuis la zone`;
  await dialog.getByLabel('Nom du projet', { exact: true }).fill(createdName);
  await dialog.getByLabel('Date de début', { exact: true }).fill('2026-10-12');
  await dialog.getByLabel('Date de fin', { exact: true }).fill('2026-11-12');
  await dialog.getByRole('button', { name: 'Créer le projet', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const created = (await state(request)).projects.find(item => item.name === createdName)!;
  expect(created.zoneId).toBe(zone.id);
  await expect(projectRow(page, created)).toBeVisible();
  await page.reload();
  await projectRow(page, created).getByRole('button', { name: createdName, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#project/${created.id}/summary$`));
  await expect(page.getByRole('heading', { name: createdName, exact: true })).toBeVisible();

  await page.goto(`/#zones/${zone.id}/projects`);
  await page.getByRole('combobox', { name: 'Choisir une zone', exact: true }).selectOption(otherZone.id);
  await expect(page).toHaveURL(new RegExp(`#zones/${otherZone.id}/projects$`));
  await expect(projectRow(page, outside)).toBeVisible();
  await expect(projectRow(page, alpha)).toHaveCount(0);
});

test('tri, filtre de statut et modification réelle : un refus ne change pas la ligne, le succès persiste', async ({ page, request }) => {
  const { zone, prefix, alpha, beta } = await fixture(request, 'statuts');
  await filterFixture(page, zone, prefix);
  const status = () => projectRow(page, alpha).getByRole('combobox', { name: `Statut du projet ${alpha.name}`, exact: true });
  await expect(status()).toHaveValue('open');
  await page.route(`**/api/projects/${alpha.id}`, route => {
    if (route.request().method() === 'PATCH') return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Changement de statut refusé pour la recette.' }) });
    return route.continue();
  });
  await status().selectOption('paused');
  await expect(page.getByRole('status')).toContainText('Changement de statut refusé pour la recette.');
  await expect(status()).toHaveValue('open');
  expect((await state(request)).projects.find(item => item.id === alpha.id)?.status).toBe('open');
  await page.unroute(`**/api/projects/${alpha.id}`);
  await status().selectOption('paused');
  await expect(status()).toHaveValue('paused');
  await expect.poll(async () => (await state(request)).projects.find(item => item.id === alpha.id)?.status).toBe('paused' satisfies ProjectStatus);
  await page.getByRole('combobox', { name: 'Statut des projets', exact: true }).selectOption('paused');
  await expect(projectRow(page, alpha)).toBeVisible();
  await expect(projectRow(page, beta)).toHaveCount(0);
  await expectNumber(groupRow(page, zone).locator('[data-metric="allocated"]'), 20);
  await page.reload();
  await page.getByRole('textbox', { name: 'Rechercher un projet', exact: true }).fill(prefix);
  await expect(status()).toHaveValue('paused');
  await expect(projectRow(page, beta)).toBeVisible();
  await page.getByRole('combobox', { name: 'Trier les projets', exact: true }).selectOption('name');
  await expect(matrix(page).locator('tr[data-project-id]')).toHaveCount(2);
  await expect(matrix(page).locator('tr[data-project-id]').first()).toHaveAttribute('data-project-id', alpha.id);
  await page.getByRole('combobox', { name: 'Trier les projets', exact: true }).selectOption('end');
  await expect(matrix(page).locator('tr[data-project-id]').first()).toHaveAttribute('data-project-id', beta.id);
});

test('vue mobile : tableau défilant dans son cadre et création toujours accessible', async ({ page, request }) => {
  const { zone, prefix, alpha } = await fixture(request, 'mobile');
  await page.setViewportSize({ width: 390, height: 844 });
  await filterFixture(page, zone, prefix);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const scrollRegion = page.getByRole('region', { name: 'Tableau des projets, défilement horizontal', exact: true });
  await expect(scrollRegion).toBeVisible();
  expect(await scrollRegion.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await scrollRegion.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  expect(await scrollRegion.evaluate(element => element.scrollLeft > 0)).toBe(true);
  await expect(projectRow(page, alpha).locator('[data-metric="remaining"]')).toBeVisible();
  await page.screenshot({ path: screenshotPath('zone-projects-mobile.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Nouveau projet', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouveau projet', exact: true });
  await dialog.getByRole('button', { name: 'Depuis zéro', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: 'Zone', exact: true })).toHaveValue(zone.id);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  await page.getByRole('button', { name: 'Ouvrir le menu', exact: true }).click();
  await page.getByRole('button', { name: 'Tous les projets, toutes les zones', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tous les projets', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
