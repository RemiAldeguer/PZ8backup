import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import type { AppData, CostProfile, Expense, Project, Resource, Task, TimeEntry, Zone } from '../../shared/types';
import { loginTestAdmin } from '../auth-fixture';

test.beforeEach(async ({ page, request }) => {
  await loginTestAdmin(page.request);
  await loginTestAdmin(request);
});

const metricNames = ['allocated', 'planned', 'actual', 'planned-margin', 'actual-margin', 'earned'] as const;
type BudgetAmounts = Record<typeof metricNames[number], number>;

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

function newProject(request: APIRequestContext, zone: Zone, name: string, budget: number) {
  return create<Project>(request, 'projects', {
    name, zoneId: zone.id, budget, status: 'open',
    startDate: '2026-01-01', endDate: '2028-01-31',
  });
}

function newTask(request: APIRequestContext, project: Project, resource: Resource, title: string, allocatedHours: number, progress: number) {
  return create<Task>(request, 'tasks', {
    projectId: project.id, title, assigneeId: resource.id, allocatedHours, progress,
    kind: 'task', status: progress === 100 ? 'done' : 'in_progress',
    phase: 'Recette budget', startDate: '2026-01-01', endDate: '2028-01-31',
  });
}

function newEntry(request: APIRequestContext, task: Task, resource: Resource, hours: number) {
  return create<TimeEntry>(request, 'time-entries', {
    taskId: task.id, resourceId: resource.id, hours, date: '2026-10-05',
  });
}

function newExpense(request: APIRequestContext, project: Project, label: string, amount: number, paid = false) {
  return create<Expense>(request, 'expenses', {
    projectId: project.id, label, amount, category: 'other',
    plannedDate: '2026-10-05', paidDate: paid ? '2026-10-05' : null,
  });
}

function table(page: Page) { return page.getByRole('table', { name: 'Projets de la zone', exact: true }); }
function projectRow(page: Page, project: Project) { return table(page).locator(`tr[data-project-id="${project.id}"]`); }
function zoneRow(page: Page, zone: Zone) { return table(page).locator(`tr.zp-zone-summary[data-zone-id="${zone.id}"]`); }
function cell(row: Locator, metric: typeof metricNames[number]) { return row.locator(`[data-metric="budget-${metric}"]`); }
function amount(text: string) { return Number(text.replace(/\s/g, '').replace(',', '.').replace(/[^\d.\-]/g, '')); }

async function expectBudget(row: Locator, expected: BudgetAmounts) {
  for (const metric of metricNames) {
    await expect.poll(async () => amount(await cell(row, metric).innerText()), metric).toBe(expected[metric]);
  }
}

async function filterFixture(page: Page, zone: Zone, prefix: string) {
  await page.goto(`/#zones/${encodeURIComponent(zone.id)}/projects`);
  await expect(page.getByRole('combobox', { name: 'Choisir une zone', exact: true })).toHaveValue(zone.id);
  await page.getByRole('textbox', { name: 'Rechercher un projet', exact: true }).fill(prefix);
}

function screenshotPath(name: string) {
  return test.info().project.testDir.endsWith('cloudflare-browser') ? test.info().outputPath(name) : `docs/screenshots/${name}`;
}

test('budget de zone : six colonnes, coûts historiques, acquis pondéré et synthèse des seuls projets affichés', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const data = await state(request);
  const zone = data.zones[1];
  const prefix = 'Recette budget exact';
  const oldProfile = await create<CostProfile>(request, 'profiles', { name: `${prefix} historique`, dailyRate: 300, eqjtHours: 6 });
  const currentProfile = await create<CostProfile>(request, 'profiles', { name: `${prefix} courant`, dailyRate: 480, eqjtHours: 8 });
  const fractionalProfile = await create<CostProfile>(request, 'profiles', { name: `${prefix} fraction`, dailyRate: 333.33, eqjtHours: 7 });
  const resource = await create<Resource>(request, 'resources', { name: `${prefix} ressource`, profileId: oldProfile.id });
  const secondResource = await create<Resource>(request, 'resources', { name: `${prefix} seconde ressource`, profileId: fractionalProfile.id });
  const alpha = await newProject(request, zone, `${prefix} Alpha`, 2000.50);
  const beta = await newProject(request, zone, `${prefix} Bêta`, 400.10);
  const outside = await newProject(request, data.zones[0], `${prefix} Hors zone`, 9999);
  await newTask(request, alpha, resource, `${prefix} terminée`, 6, 100);
  const partial = await newTask(request, alpha, resource, `${prefix} partielle`, 12, 25);
  const historical = await newEntry(request, partial, resource, 3.25);
  expect(historical).toMatchObject({ rateSnapshot: 300, eqjtSnapshot: 6 });
  const profileChange = await request.patch(`/api/resources/${resource.id}`, { data: { profileId: currentProfile.id } });
  expect(profileChange.ok()).toBeTruthy();
  const betaTask = await newTask(request, beta, secondResource, `${prefix} fraction`, 7, 50);
  await newEntry(request, betaTask, secondResource, 1.5);
  const paid = await newExpense(request, alpha, `${prefix} dépense réglée`, 120.25, true);
  await newExpense(request, alpha, `${prefix} dépense prévue`, 80.30);
  const betaExpense = await newExpense(request, beta, `${prefix} facture en attente`, 10.10);
  const outsideTask = await newTask(request, outside, resource, `${prefix} exclue`, 1000, 100);
  await newEntry(request, outsideTask, resource, 2);
  await newExpense(request, outside, `${prefix} hors périmètre`, 1234, true);

  await page.setViewportSize({ width: 1920, height: 1080 });
  await filterFixture(page, zone, prefix);
  await expect(table(page).locator('tr[data-project-id]')).toHaveCount(2);
  await expect(projectRow(page, outside)).toHaveCount(0);
  // Planned work uses the current 60 €/h profile; recorded time keeps its historical 50 €/h.
  // Earned value is 6 × 60 + 12 × 60 × 25%, rather than an unweighted mean of task progress.
  const alphaBudget = { allocated: 2000.50, planned: 1280.55, actual: 282.75, 'planned-margin': 719.95, 'actual-margin': 1717.75, earned: 540 };
  const betaBudget = { allocated: 400.10, planned: 343.43, actual: 71.43, 'planned-margin': 56.67, 'actual-margin': 328.67, earned: 166.67 };
  await expectBudget(projectRow(page, alpha), alphaBudget);
  await expectBudget(projectRow(page, beta), betaBudget);
  await expectBudget(zoneRow(page, zone), { allocated: 2400.60, planned: 1623.98, actual: 354.18, 'planned-margin': 776.62, 'actual-margin': 2046.42, earned: 706.67 });
  await expect(table(page).locator('.zp-group-heading')).toContainText('Budget');
  const overviewColumns = await table(page).locator('.zp-overview-head th').count();
  const span = await zoneRow(page, zone).locator('th, td').evaluateAll(cells => cells.reduce((sum, item) => sum + (item as HTMLTableCellElement).colSpan, 0));
  expect(span).toBe(overviewColumns);
  expect(await projectRow(page, alpha).locator('th, td').count()).toBe(overviewColumns);
  const metricOrder = await projectRow(page, alpha).locator('[data-metric]').evaluateAll(cells => cells.map(item => item.getAttribute('data-metric')));
  expect(metricOrder.slice(-7)).toEqual(['remaining', ...metricNames.map(metric => `budget-${metric}`)]);
  for (const metric of metricNames) await expect(cell(projectRow(page, alpha), metric)).not.toContainText(/[≥≤]/);

  await page.getByRole('textbox', { name: 'Rechercher un projet', exact: true }).fill(alpha.name);
  await expect(table(page).locator('tr[data-project-id]')).toHaveCount(1);
  await expectBudget(zoneRow(page, zone), alphaBudget);
  await page.reload();
  await page.getByRole('textbox', { name: 'Rechercher un projet', exact: true }).fill(prefix);
  await expectBudget(projectRow(page, alpha), alphaBudget);
  const persisted = await state(request);
  expect(persisted.timeEntries.find(item => item.id === historical.id)).toMatchObject({ rateSnapshot: 300, eqjtSnapshot: 6 });
  expect(persisted.expenses.find(item => item.id === paid.id)).toMatchObject({ amount: 120.25, paidDate: '2026-10-05' });

  // Once the second project's existing invoice is paid, only its actual cost and actual margin change.
  const payment = await request.patch(`/api/expenses/${betaExpense.id}`, { data: { paidDate: '2026-10-06' } });
  expect(payment.ok()).toBeTruthy();
  await page.reload();
  await page.getByRole('textbox', { name: 'Rechercher un projet', exact: true }).fill(prefix);
  await expectBudget(projectRow(page, beta), { ...betaBudget, actual: 81.53, 'actual-margin': 318.57 });
  await expectBudget(zoneRow(page, zone), { allocated: 2400.60, planned: 1623.98, actual: 364.28, 'planned-margin': 776.62, 'actual-margin': 2036.32, earned: 706.67 });
  const scroll = page.getByRole('region', { name: 'Tableau des projets, défilement horizontal', exact: true });
  await scroll.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await page.screenshot({ path: screenshotPath('zone-budget-desktop.png'), fullPage: true, animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('budget sans tarif : bornes explicites conservées après rechargement et colonnes accessibles sur mobile', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const data = await state(request);
  const zone = data.zones[1];
  const prefix = 'Recette budget incomplet';
  const project = await newProject(request, zone, prefix, 100);
  const pricedProfile = await create<CostProfile>(request, 'profiles', { name: `${prefix} profil connu`, dailyRate: 80, eqjtHours: 8 });
  const pricedResource = await create<Resource>(request, 'resources', { name: `${prefix} tarif connu`, profileId: pricedProfile.id });
  const unknownResource = await create<Resource>(request, 'resources', { name: `${prefix} tarif absent`, profileId: null });
  const knownTask = await newTask(request, project, pricedResource, `${prefix} tâche chiffrée`, 2, 100);
  const unknownTask = await newTask(request, project, unknownResource, `${prefix} tâche à chiffrer`, 8, 25);
  await newEntry(request, knownTask, pricedResource, 1);
  const unknownEntry = await newEntry(request, unknownTask, unknownResource, 2);
  expect(unknownEntry).toMatchObject({ rateSnapshot: null, eqjtSnapshot: null });
  await newExpense(request, project, `${prefix} achat réglé`, 10.50, true);
  // A real nonzero cost below half a cent must not appear as a red negative zero.
  const tinyProject = await newProject(request, zone, `${prefix} arrondi au centime`, 0);
  const tinyProfile = await create<CostProfile>(request, 'profiles', { name: `${prefix} tarif fractionnaire`, dailyRate: 1, eqjtHours: 3 });
  const tinyResource = await create<Resource>(request, 'resources', { name: `${prefix} ressource fractionnaire`, profileId: tinyProfile.id });
  const tinyTask = await newTask(request, tinyProject, tinyResource, `${prefix} allocation de 0,01 heure`, 0.01, 0);
  await newEntry(request, tinyTask, tinyResource, 0.01);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await filterFixture(page, zone, prefix);
  const expected = { allocated: 100, planned: 30.50, actual: 20.50, 'planned-margin': 69.50, 'actual-margin': 79.50, earned: 20 };
  for (const row of [projectRow(page, project), zoneRow(page, zone)]) {
    await expectBudget(row, expected);
    for (const metric of ['planned', 'actual', 'earned'] as const) await expect(cell(row, metric)).toContainText('≥');
    for (const metric of ['planned-margin', 'actual-margin'] as const) await expect(cell(row, metric)).toContainText('≤');
    for (const metric of ['planned', 'actual', 'earned'] as const) {
      await expect(cell(row, metric)).toHaveAttribute('title', /1.*(?:tarif|profil|non chiffr|inconnu)/i);
    }
    await expect(cell(row, 'allocated')).not.toContainText(/[≥≤]/);
  }
  await expectBudget(projectRow(page, tinyProject), { allocated: 0, planned: 0, actual: 0, 'planned-margin': 0, 'actual-margin': 0, earned: 0 });
  for (const metric of ['actual', 'planned-margin', 'actual-margin'] as const) {
    const tinyCell = cell(projectRow(page, tinyProject), metric);
    await expect(tinyCell).not.toContainText(/[−-]\s*0,00/);
    await expect(tinyCell).not.toHaveClass(/zp-late|zp-realized/);
  }
  await page.reload();
  await page.getByRole('textbox', { name: 'Rechercher un projet', exact: true }).fill(prefix);
  await expectBudget(projectRow(page, project), expected);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const scroll = page.getByRole('region', { name: 'Tableau des projets, défilement horizontal', exact: true });
  expect(await scroll.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await scroll.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  expect(await scroll.evaluate(element => element.scrollLeft > 0)).toBe(true);
  await expect(cell(projectRow(page, project), 'earned')).toBeVisible();
  await expectBudget(projectRow(page, project), expected);
  await page.screenshot({ path: screenshotPath('zone-budget-mobile.png'), fullPage: true, animations: 'disabled' });
  expect(errors).toEqual([]);
});
