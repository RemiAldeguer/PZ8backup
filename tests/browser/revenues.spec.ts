import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import type { AppData, CostProfile, Expense, Project, Resource, Revenue, Task, TimeEntry } from '../../shared/types';
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

async function create<T>(request: APIRequestContext, entity: string, data: Record<string, unknown>): Promise<T> {
  const response = await request.post(`/api/${entity}`, { data });
  expect(response.ok(), `${entity}: ${await response.text()}`).toBeTruthy();
  return await response.json() as T;
}

async function newProject(request: APIRequestContext, name: string, budget = 2000) {
  const data = await state(request);
  return create<Project>(request, 'projects', {
    name, zoneId: data.zones[0].id, budget, status: 'open',
    startDate: '2026-01-01', endDate: '2028-01-31',
  });
}

function newTask(request: APIRequestContext, project: Project, resource: Resource, title: string, allocatedHours: number, progress = 25) {
  return create<Task>(request, 'tasks', {
    projectId: project.id, title, assigneeId: resource.id, allocatedHours, progress,
    kind: 'task', status: 'in_progress', phase: 'Recette budget',
    startDate: '2026-01-01', endDate: '2028-01-31',
  });
}

function newEntry(request: APIRequestContext, task: Task, resource: Resource, hours: number) {
  return create<TimeEntry>(request, 'time-entries', {
    taskId: task.id, resourceId: resource.id, hours, date: '2026-10-05',
  });
}

function newExpense(request: APIRequestContext, project: Project, label: string, amount: number, category: Expense['category'], paid = false) {
  return create<Expense>(request, 'expenses', {
    projectId: project.id, label, amount, category,
    plannedDate: '2026-10-05', paidDate: paid ? '2026-10-06' : null,
  });
}

function amount(text: string) { return Number(text.replace(/\s/g, '').replace(',', '.').replace(/[^\d.\-]/g, '')); }
function revenueMetric(page: Page, label: string) { return page.locator('.budget-revenue-metric').filter({ has: page.getByText(label, { exact: true }) }); }
function costMetric(page: Page, label: string) { return page.locator('.metric-card').filter({ has: page.getByText(label, { exact: true }) }); }

async function expectAmount(locator: Locator, expected: number) {
  await expect.poll(async () => amount(await locator.innerText())).toBe(expected);
}

async function expectRevenueTotals(page: Page, planned: number, received: number, pending: number) {
  for (const [label, expected] of [['Recettes prévues', planned], ['Recettes encaissées', received], ['À encaisser', pending]] as const) {
    await expectAmount(revenueMetric(page, label).locator('strong'), expected);
  }
}

function legendItem(page: Page, chart: Locator, label: string) {
  return chart.locator('.budget-chart-legend li').filter({ has: page.getByText(label, { exact: true }) });
}

async function expectLegend(page: Page, chart: Locator, expected: Record<string, number>) {
  for (const [label, value] of Object.entries(expected)) {
    await expectAmount(legendItem(page, chart, label).locator('strong'), value);
  }
}

async function expectChartLayout(page: Page) {
  for (const selector of ['.budget-expense-chart', '.budget-resource-chart']) {
    const chart = page.locator(selector);
    const card = await chart.boundingBox();
    const heading = await chart.locator('.budget-card-heading').boundingBox();
    const graphic = await chart.getByRole('img').boundingBox();
    expect(graphic!.x).toBeGreaterThanOrEqual(card!.x - 1);
    expect(graphic!.y).toBeGreaterThanOrEqual(heading!.y + heading!.height - 1);
    expect(graphic!.x + graphic!.width).toBeLessThanOrEqual(card!.x + card!.width + 1);
    expect(graphic!.y + graphic!.height).toBeLessThanOrEqual(card!.y + card!.height + 1);
  }
}

function screenshotPath(name: string) {
  return test.info().project.testDir.endsWith('cloudflare-browser') ? test.info().outputPath(name) : `docs/screenshots/${name}`;
}

test('recettes : création, encaissement anticipé, modification, suppression et verrouillage du projet', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const project = await newProject(request, 'Recette encaissement projet', 500);
  const outside = await newProject(request, 'Recette autre projet');
  const outsideRevenue = await create<Revenue>(request, 'revenues', {
    projectId: outside.id, label: 'Recette hors périmètre', amount: 9999,
    plannedDate: '2026-10-05', receivedDate: '2026-10-06', category: 'sales',
  });
  await page.goto(`/#project/${project.id}/budget`);
  await expectRevenueTotals(page, 0, 0, 0);
  await page.getByRole('button', { name: 'Nouvelle recette', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouvelle recette', exact: true });
  await dialog.getByLabel('Libellé', { exact: true }).fill('Acompte de recette');
  await dialog.getByRole('combobox', { name: 'Catégorie', exact: true }).selectOption('services');
  await dialog.getByLabel('Montant (€)', { exact: true }).fill('1000.75');
  await dialog.getByLabel('Date prévue', { exact: true }).fill('2027-01-15');
  await dialog.getByLabel('Date d’encaissement (facultative)', { exact: true }).fill('2026-10-06');
  await dialog.getByRole('button', { name: 'Créer la recette', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expectRevenueTotals(page, 1000.75, 1000.75, 0);
  await expect(page.getByRole('row').filter({ hasText: 'Acompte de recette' })).toContainText('06/10/2026');
  await expect(page.getByRole('row').filter({ hasText: 'Recette hors périmètre' })).toHaveCount(0);
  await expectAmount(costMetric(page, 'Budget alloué').locator('strong'), 500);
  await expectAmount(costMetric(page, 'Coût planifié').locator('strong'), 0);
  await expectAmount(costMetric(page, 'Coût réel').locator('strong'), 0);
  await page.reload();
  await expectRevenueTotals(page, 1000.75, 1000.75, 0);
  await page.getByRole('button', { name: 'Modifier recette Acompte de recette', exact: true }).click();
  const editDialog = page.getByRole('dialog', { name: 'Modifier la recette', exact: true });
  await editDialog.getByLabel('Montant (€)', { exact: true }).fill('1125.55');
  await editDialog.getByLabel('Date d’encaissement (facultative)', { exact: true }).fill('');
  await editDialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(editDialog).not.toBeVisible();
  await expectRevenueTotals(page, 1125.55, 0, 1125.55);
  await page.reload();
  await expectRevenueTotals(page, 1125.55, 0, 1125.55);
  await page.getByRole('button', { name: 'Nouvelle recette', exact: true }).click();
  await dialog.getByLabel('Libellé', { exact: true }).fill('Solde de recette');
  await dialog.getByRole('combobox', { name: 'Catégorie', exact: true }).selectOption('sales');
  await dialog.getByLabel('Montant (€)', { exact: true }).fill('75.45');
  await dialog.getByLabel('Date prévue', { exact: true }).fill('2026-10-05');
  await dialog.getByLabel('Date d’encaissement (facultative)', { exact: true }).fill('2026-10-06');
  await dialog.getByRole('button', { name: 'Créer la recette', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expectRevenueTotals(page, 1201, 75.45, 1125.55);
  page.once('dialog', confirmation => confirmation.accept());
  await page.getByRole('button', { name: 'Supprimer recette Acompte de recette', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Acompte de recette' })).toHaveCount(0);
  await expectRevenueTotals(page, 75.45, 75.45, 0);
  await page.reload();
  await expectRevenueTotals(page, 75.45, 75.45, 0);
  const saved = await state(request);
  const revenue = saved.revenues.find(item => item.projectId === project.id)!;
  expect(revenue).toMatchObject({ label: 'Solde de recette', amount: 75.45, receivedDate: '2026-10-06' });
  expect(saved.revenues.find(item => item.id === outsideRevenue.id)).toEqual(outsideRevenue);
  expect(saved.projects.find(item => item.id === project.id)?.budget).toBe(500);

  for (const status of ['paused', 'closed']) {
    expect((await request.patch(`/api/projects/${project.id}`, { data: { status } })).ok()).toBeTruthy();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Nouvelle recette', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Modifier recette Solde de recette', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Supprimer recette Solde de recette', exact: true })).toBeDisabled();
    await expectRevenueTotals(page, 75.45, 75.45, 0);
    const post = await request.post('/api/revenues', { data: { projectId: project.id, label: 'Ajout interdit', amount: 2, plannedDate: '2026-10-05', category: 'other' } });
    const patch = await request.patch(`/api/revenues/${revenue.id}`, { data: { amount: 999 } });
    const remove = await request.delete(`/api/revenues/${revenue.id}`);
    expect([post.status(), patch.status(), remove.status()]).toEqual([409, 409, 409]);
    expect((await state(request)).revenues.find(item => item.id === revenue.id)).toEqual(revenue);
  }
  expect(errors).toEqual([]);
});

test('budget : répartitions par dépenses et ressources, tarifs historiques et réelle ressource ayant saisi le temps', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const project = await newProject(request, 'Recette répartitions budget exactes', 2000);
  const internalProfile = await create<CostProfile>(request, 'profiles', { name: 'Recette interne 100 €/h', dailyRate: 600, eqjtHours: 6 });
  const oldExternalProfile = await create<CostProfile>(request, 'profiles', { name: 'Recette externe historique 50 €/h', dailyRate: 300, eqjtHours: 6 });
  const newExternalProfile = await create<CostProfile>(request, 'profiles', { name: 'Recette externe courant 60 €/h', dailyRate: 480, eqjtHours: 8 });
  const materialProfile = await create<CostProfile>(request, 'profiles', { name: 'Recette matériel 20 €/h', dailyRate: 100, eqjtHours: 5 });
  const virtualProfile = await create<CostProfile>(request, 'profiles', { name: 'Recette virtuelle 20 €/h', dailyRate: 80, eqjtHours: 4 });
  const internal = await create<Resource>(request, 'resources', { name: 'Recette ressource interne', type: 'human', classification: 'internal', profileId: internalProfile.id });
  const external = await create<Resource>(request, 'resources', { name: 'Recette ressource externe', type: 'human', classification: 'external', profileId: oldExternalProfile.id });
  const material = await create<Resource>(request, 'resources', { name: 'Recette ressource matérielle', type: 'material', classification: 'external', profileId: materialProfile.id });
  const virtual = await create<Resource>(request, 'resources', { name: 'Recette ressource virtuelle', type: 'virtual', classification: 'internal', profileId: virtualProfile.id });
  const internalTask = await newTask(request, project, internal, 'Recette tâche interne', 6, 50);
  const externalTask = await newTask(request, project, external, 'Recette tâche externe', 8);
  const materialTask = await newTask(request, project, material, 'Recette tâche matérielle', 2);
  const virtualTask = await newTask(request, project, virtual, 'Recette tâche virtuelle', 3);
  // The author of recorded time, rather than the current task assignee, owns its real cost.
  const historical = await newEntry(request, internalTask, external, 3);
  expect(historical).toMatchObject({ rateSnapshot: 300, eqjtSnapshot: 6 });
  await newEntry(request, externalTask, internal, 1);
  await newEntry(request, materialTask, material, 1);
  await newEntry(request, virtualTask, virtual, 1.5);
  expect((await request.patch(`/api/resources/${external.id}`, { data: { profileId: newExternalProfile.id } })).ok()).toBeTruthy();
  await newExpense(request, project, 'Recette fournitures réglées', 125.55, 'supplies', true);
  await newExpense(request, project, 'Recette juridique à régler', 80.25, 'legal');
  await newExpense(request, project, 'Recette licence réglée', 25.20, 'software', true);
  await create<Revenue>(request, 'revenues', { projectId: project.id, label: 'Recette contrat encaissé', amount: 500.25, category: 'services', plannedDate: '2026-10-05', receivedDate: '2026-10-06' });
  const outside = await newProject(request, 'Recette ventilation hors périmètre');
  await newExpense(request, outside, 'Recette autre coût', 9999, 'supplies', true);
  const outsideTask = await newTask(request, outside, external, 'Recette autre allocation', 9999);
  await newEntry(request, outsideTask, external, 20);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`/#project/${project.id}/budget`);
  await expectAmount(costMetric(page, 'Coût planifié').locator('strong'), 1411);
  await expectAmount(costMetric(page, 'Coût réel').locator('strong'), 450.75);
  await expectRevenueTotals(page, 500.25, 500.25, 0);
  await expectAmount(revenueMetric(page, 'Résultat prévisionnel').locator('strong'), -910.75);
  await expectAmount(revenueMetric(page, 'Résultat réel').locator('strong'), 49.50);
  const resourceChart = page.locator('.budget-resource-chart');
  const expenseChart = page.locator('.budget-expense-chart');
  const basis = page.getByRole('combobox', { name: 'Répartition des coûts', exact: true });
  await expect(basis).toHaveValue('planned');
  await expectLegend(page, resourceChart, { Internes: 600, Externes: 480, Matérielles: 40, Virtuelles: 60 });
  await expectLegend(page, expenseChart, { Fournitures: 125.55, 'Frais juridiques': 80.25, 'Achat logiciel': 25.20 });
  await expectAmount(legendItem(page, resourceChart, 'Internes').locator('small'), 50.85);
  await expect(resourceChart.getByRole('img')).toHaveAccessibleName(/Planifié/);
  await expectChartLayout(page);
  await page.screenshot({ path: screenshotPath('budget-revenues-desktop.png'), fullPage: true, animations: 'disabled' });
  await basis.selectOption('actual');
  await expectLegend(page, resourceChart, { Internes: 100, Externes: 150, Matérielles: 20, Virtuelles: 30 });
  await expectLegend(page, expenseChart, { Fournitures: 125.55, 'Achat logiciel': 25.20 });
  await expect(legendItem(page, expenseChart, 'Frais juridiques')).toHaveCount(0);
  await expectAmount(legendItem(page, resourceChart, 'Externes').locator('small'), 50);
  await expect(resourceChart.getByRole('img')).toHaveAccessibleName(/Réel/);
  await expectAmount(costMetric(page, 'Coût planifié').locator('strong'), 1411);
  await expectAmount(costMetric(page, 'Coût réel').locator('strong'), 450.75);
  await page.reload();
  await basis.selectOption('actual');
  await expectLegend(page, resourceChart, { Internes: 100, Externes: 150, Matérielles: 20, Virtuelles: 30 });
  const saved = await state(request);
  expect(saved.timeEntries.find(item => item.id === historical.id)).toEqual(historical);
  expect(errors).toEqual([]);
});

test('budget : coûts non chiffrés et tarif zéro explicites, formulaire mobile et suivi temporel direct dans la sidebar', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const project = await newProject(request, 'Recette budget partiel mobile', 0);
  const zeroProfile = await create<CostProfile>(request, 'profiles', { name: 'Recette tarif nul connu', dailyRate: 0, eqjtHours: 8 });
  const zero = await create<Resource>(request, 'resources', { name: 'Recette ressource tarif zéro', profileId: zeroProfile.id });
  const unknown = await create<Resource>(request, 'resources', { name: 'Recette ressource sans tarif', profileId: null });
  const zeroTask = await newTask(request, project, zero, 'Recette allocation tarif nul', 8);
  const unknownTask = await newTask(request, project, unknown, 'Recette allocation sans tarif', 4);
  await newEntry(request, zeroTask, zero, 4);
  const unknownEntry = await newEntry(request, unknownTask, unknown, 2);
  expect(unknownEntry).toMatchObject({ rateSnapshot: null, eqjtSnapshot: null });
  await page.goto(`/#project/${project.id}/budget`);
  await expect(page.locator('.budget-incomplete')).toContainText('La valorisation est incomplète');
  await expect(costMetric(page, 'Coût planifié')).toContainText('≥');
  await expectAmount(costMetric(page, 'Coût planifié').locator('strong'), 0);
  await expectAmount(costMetric(page, 'Coût réel').locator('strong'), 0);
  await expect(page.locator('.budget-resource-chart')).not.toContainText(/100\s*%/);
  await page.getByRole('combobox', { name: 'Répartition des coûts', exact: true }).selectOption('actual');
  await expect(page.locator('.budget-resource-chart')).not.toContainText(/100\s*%/);
  const knownProfile = await create<CostProfile>(request, 'profiles', { name: 'Recette petit tarif connu', dailyRate: 80, eqjtHours: 8 });
  const known = await create<Resource>(request, 'resources', { name: 'Recette ressource tarif 10 €/h', classification: 'external', profileId: knownProfile.id });
  const knownTask = await newTask(request, project, known, 'Recette allocation chiffrée', 2);
  await newEntry(request, knownTask, known, 1);
  await newExpense(request, project, 'Recette dépense mobile', 5.25, 'legal', true);
  await create<Revenue>(request, 'revenues', { projectId: project.id, label: 'Recette mobile reçue', amount: 40.10, category: 'services', plannedDate: '2026-10-05', receivedDate: '2026-10-06' });
  await page.reload();
  await expectAmount(costMetric(page, 'Coût planifié').locator('strong'), 25.25);
  await expectAmount(costMetric(page, 'Coût réel').locator('strong'), 15.25);
  await expect(page.locator('.budget-resource-chart')).toContainText(/coûts connus/i);
  await expectLegend(page, page.locator('.budget-resource-chart'), { Externes: 20 });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expectChartLayout(page);
  await page.screenshot({ path: screenshotPath('budget-revenues-mobile.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Nouvelle recette', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouvelle recette', exact: true });
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await dialog.getByLabel('Libellé', { exact: true }).fill('Recette saisie mobile');
  await dialog.getByLabel('Montant (€)', { exact: true }).fill('19.90');
  await dialog.getByLabel('Date prévue', { exact: true }).fill('2026-10-12');
  await page.screenshot({ path: screenshotPath('budget-revenue-form-mobile.png'), fullPage: true, animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Créer la recette', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expectRevenueTotals(page, 60, 40.10, 19.90);
  await page.getByRole('button', { name: 'Ouvrir le menu', exact: true }).click();
  const sidebar = page.getByRole('complementary', { name: 'Navigation principale', exact: true });
  const personalButton = sidebar.getByRole('button', { name: 'Mon espace', exact: true });
  await expect(personalButton).toHaveCount(1);
  await expect(sidebar.getByRole('button', { name: 'Suivi temporel', exact: true })).toHaveCount(0);
  await personalButton.click();
  await page.getByRole('navigation', { name: 'Vues de mon espace', exact: true }).getByRole('link', { name: 'Suivi temporel', exact: true }).click();
  await expect(page).toHaveURL(/#time$/);
  await expect(page.getByRole('table', { name: 'Suivi temporel hebdomadaire', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Personnel', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Fermer le menu', exact: true })).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole('table', { name: 'Suivi temporel hebdomadaire', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
