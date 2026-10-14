import { test, expect, type APIRequestContext, type Dialog, type Locator, type Page } from '@playwright/test';
import type { AppData, CostProfile, Project, Resource, Task, TimeEntry } from '../../shared/types';
import type { ReportTemplate } from '../../shared/customization';
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

async function patch(request: APIRequestContext, entity: string, id: string, data: Record<string, unknown>) {
  const response = await request.patch(`/api/${entity}/${id}`, { data });
  expect(response.ok(), `${entity}: ${await response.text()}`).toBeTruthy();
}

async function project(request: APIRequestContext, name: string, budget = 500.75) {
  const data = await state(request);
  return create<Project>(request, 'projects', {
    name, zoneId: data.zones[0].id, budget, status: 'open',
    startDate: '2026-10-01', endDate: '2028-01-31',
    description: `Description conservée pour ${name}.`,
  });
}

function task(request: APIRequestContext, owner: Project, title: string, extra: Record<string, unknown> = {}) {
  return create<Task>(request, 'tasks', {
    projectId: owner.id, title, kind: 'task', status: 'in_progress', progress: 25,
    phase: 'Phase des actions projet', allocatedHours: 12,
    startDate: '2026-10-05', endDate: '2028-01-31', ...extra,
  });
}

function record(request: APIRequestContext, item: Task, resource: Resource, hours: number, note: string, date = '2026-10-05') {
  return create<TimeEntry>(request, 'time-entries', { taskId: item.id, resourceId: resource.id, hours, note, date });
}

function screenshotPath(name: string) {
  return test.info().project.testDir.endsWith('cloudflare-browser') ? test.info().outputPath(name) : `docs/screenshots/${name}`;
}

const matrix = (page: Page) => page.getByRole('table', { name: 'Suivi temporel hebdomadaire', exact: true });
const history = (page: Page) => page.getByRole('table', { name: 'Saisies de la semaine', exact: true });
const resourceRow = (page: Page, resource: Resource) => matrix(page).locator(`tbody tr[data-row-kind="resource"][data-resource-id="${resource.id}"]`);
const taskRow = (page: Page, item: Task, resource: Resource) => matrix(page).locator(`tbody tr[data-row-kind="task"][data-task-id="${item.id}"][data-resource-id="${resource.id}"]`);
const numericText = (value: string) => Number(value.replace(/\s/g, '').replace(',', '.').replace(/[^\d.\-]/g, ''));
async function expectNumber(locator: Locator, expected: number) {
  await expect.poll(async () => numericText(await locator.innerText())).toBe(expected);
}
async function noPageOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
async function withinViewport(page: Page, locator: Locator) {
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(-1);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
}
async function expectActionColors(page: Page) {
  const blue = await page.getByRole('button', { name: 'Créer un compte rendu', exact: true }).evaluate(element => getComputedStyle(element).backgroundColor);
  const yellow = await page.getByRole('button', { name: 'Rapport flash', exact: true }).evaluate(element => getComputedStyle(element).backgroundColor);
  const components = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
  const [br, bg, bb] = components(blue);
  const [yr, yg, yb] = components(yellow);
  expect(bb).toBeGreaterThan(br + 40);
  expect(bg).toBeGreaterThan(br);
  expect(yr).toBeGreaterThan(200);
  expect(yg).toBeGreaterThan(110);
  expect(yg).toBeLessThan(230);
  expect(yb).toBeLessThan(120);
}

async function selectReportTemplate(page: Page, composer: Locator, id: string) {
  const accept = (dialog: Dialog) => void dialog.accept();
  page.on('dialog', accept);
  try { await composer.getByRole('combobox', { name: /^Modèle du compte rendu/ }).selectOption(id); }
  finally { page.off('dialog', accept); }
}

test('actions projet : suivi des membres, historique réaffecté et inactif, saisie et validation dans le seul projet', async ({ page, request }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const owner = await project(request, 'Actions projet équipe suivie');
  const other = await project(request, 'Actions projet suivi hors périmètre');
  const explicit = await create<Resource>(request, 'resources', { name: 'Actions membre explicite sans affectation', projectIds: [owner.id] });
  const assigned = await create<Resource>(request, 'resources', { name: 'Actions membre affecté' });
  const former = await create<Resource>(request, 'resources', { name: 'Actions ancien membre historique' });
  const material = await create<Resource>(request, 'resources', { name: 'Actions matériel du jalon', type: 'material' });
  const foreign = await create<Resource>(request, 'resources', { name: 'Actions ressource étrangère' });
  const work = await task(request, owner, 'Actions travail suivi', { assigneeId: former.id });
  const milestone = await task(request, owner, 'Actions jalon matériel', { assigneeId: material.id, kind: 'milestone', allocatedHours: 0 });
  await record(request, work, former, 2.5, 'Actions historique semaine');
  await record(request, work, former, 1.5, 'Actions historique avant semaine', '2026-09-28');
  await patch(request, 'tasks', work.id, { assigneeId: assigned.id });
  await patch(request, 'resources', former.id, { active: false });
  await record(request, work, assigned, 3, 'Actions temps équipe actuel', '2026-10-06');
  const outside = await task(request, other, 'Actions tâche étrangère', { assigneeId: foreign.id, allocatedHours: 999 });
  await record(request, outside, foreign, 9, 'Actions temps étranger');
  await record(request, outside, assigned, 8, 'Actions temps du membre dans un autre projet');

  await page.goto(`/#project/${owner.id}/time`);
  await page.getByLabel('Date de la semaine', { exact: true }).fill('2026-10-06');
  await expect(page.getByRole('heading', { name: 'Suivi temporel du projet', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Projet', exact: true })).toHaveCount(0);
  await expect(matrix(page).locator('tbody tr[data-row-kind="resource"]')).toHaveCount(4);
  await expect(resourceRow(page, explicit)).toBeVisible();
  await expect(resourceRow(page, assigned)).toBeVisible();
  await expect(resourceRow(page, former)).toContainText('Inactive');
  await expect(resourceRow(page, material)).toBeVisible();
  await expect(resourceRow(page, foreign)).toHaveCount(0);
  await expectNumber(resourceRow(page, explicit).locator('[data-summary="allocated"]'), 0);
  await expectNumber(resourceRow(page, explicit).locator('[data-summary="week"]'), 0);
  await expectNumber(resourceRow(page, former).locator('[data-summary="allocated"]'), 0);
  await expectNumber(resourceRow(page, former).locator('[data-summary="spent"]'), 4);
  await expectNumber(resourceRow(page, assigned).locator('[data-summary="allocated"]'), 12);
  await expectNumber(resourceRow(page, assigned).locator('[data-summary="spent"]'), 3);
  await expectNumber(matrix(page).locator('tfoot [data-summary="allocated"]'), 12);
  await expectNumber(matrix(page).locator('tfoot [data-summary="spent"]'), 7);
  await expectNumber(matrix(page).locator('tfoot [data-summary="week"]'), 5.5);
  await expectNumber(matrix(page).locator('tfoot [data-summary="remaining"]'), 5);
  await expect(history(page)).not.toContainText('Actions temps étranger');
  await expect(history(page)).not.toContainText('Actions temps du membre dans un autre projet');

  await page.getByRole('button', { name: 'Saisir du temps', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Saisir du temps', exact: true });
  const taskChoices = await dialog.getByRole('combobox', { name: 'Tâche', exact: true }).locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value).filter(Boolean));
  expect(taskChoices).toEqual([work.id]);
  expect(taskChoices).not.toContain(milestone.id);
  const resourceChoices = await dialog.getByRole('combobox', { name: 'Ressource', exact: true }).locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
  expect(new Set(resourceChoices)).toEqual(new Set([explicit.id, assigned.id, material.id]));
  await dialog.getByRole('combobox', { name: 'Tâche', exact: true }).selectOption(work.id);
  await dialog.getByRole('combobox', { name: 'Ressource', exact: true }).selectOption(explicit.id);
  await dialog.getByLabel('Date', { exact: true }).fill('2026-10-07');
  await dialog.getByLabel('Temps passé (heures)', { exact: true }).fill('2.25');
  await dialog.getByLabel('Note', { exact: true }).fill('Actions saisie du membre explicite');
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expectNumber(taskRow(page, work, explicit).locator('[data-date="2026-10-07"]'), 2.25);
  let entry = history(page).getByRole('row').filter({ hasText: 'Actions saisie du membre explicite' });
  await entry.getByRole('button', { name: /^Valider :/ }).click();
  await expect(entry.getByRole('button', { name: /^Modifier la saisie/ })).toBeDisabled();
  await entry.getByRole('button', { name: /^Retirer la validation :/ }).click();
  await entry.getByRole('button', { name: /^Modifier la saisie/ }).click();
  dialog = page.getByRole('dialog', { name: 'Modifier la saisie de temps', exact: true });
  await dialog.getByLabel('Temps passé (heures)', { exact: true }).fill('3.75');
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await page.getByLabel('Date de la semaine', { exact: true }).fill('2026-10-06');
  await expectNumber(matrix(page).locator('tfoot [data-summary="week"]'), 9.25);
  await expectNumber(matrix(page).locator('tfoot [data-summary="spent"]'), 10.75);
  await expectNumber(matrix(page).locator('tfoot [data-summary="remaining"]'), 1.25);
  entry = history(page).getByRole('row').filter({ hasText: 'Actions saisie du membre explicite' });
  await expect(entry).toBeVisible();
  const saved = await state(request);
  expect(saved.timeEntries.find(item => item.note === 'Actions saisie du membre explicite')).toMatchObject({ taskId: work.id, resourceId: explicit.id, hours: 3.75, validated: false });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('.time-matrix-scroll')!.scrollLeft = 0; });
  await page.screenshot({ path: screenshotPath('project-actions-time-desktop.png'), fullPage: true, animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('actions projet : compte rendu sans modèle puis modèle figé, édition, rechargement et projet verrouillé', async ({ page, request }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const owner = await project(request, 'Actions projet comptes rendus');
  await page.goto(`/#project/${owner.id}/summary`);
  await expectActionColors(page);
  await page.getByRole('button', { name: 'Créer un compte rendu', exact: true }).click();
  let composer = page.getByRole('dialog', { name: 'Créer un compte rendu', exact: true });
  await selectReportTemplate(page, composer, '');
  await composer.getByLabel('Titre du compte rendu', { exact: true }).fill('Actions compte rendu sans modèle');
  await composer.getByLabel('Date du compte rendu', { exact: true }).fill('2026-10-06');
  await composer.getByRole('combobox', { name: 'Évaluation : Qualité', exact: true }).selectOption('4');
  await composer.getByLabel('Faits marquants', { exact: true }).fill('Premier compte rendu sauvegardé sans modèle de l’espace.');
  await composer.getByRole('button', { name: 'Enregistrer le compte rendu', exact: true }).click();
  await expect(composer).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Actions compte rendu sans modèle', exact: true })).toBeVisible();
  let saved = await state(request);
  const fallback = saved.projectReports!.find(item => item.title === 'Actions compte rendu sans modèle')!;
  expect(fallback).toMatchObject({ projectId: owner.id, templateId: null, reportDate: '2026-10-06' });
  expect(fallback.authorName).toBeTruthy();
  expect(fallback.indicators).toEqual([expect.objectContaining({ label: 'Qualité', rating: 4 })]);
  expect(fallback.fields).toEqual([expect.objectContaining({ label: 'Faits marquants', value: 'Premier compte rendu sauvegardé sans modèle de l’espace.' })]);

  const template = await create<ReportTemplate>(request, 'report-templates', {
    name: 'Actions modèle comité', titlePattern: 'Actions comité du {date}',
    indicators: [{ id: 'actions-quality', label: 'Qualité comité' }],
    fields: [
      { id: 'actions-text', label: 'Décisions comité', type: 'text' },
      { id: 'actions-number', label: 'Résultat comité', type: 'number' },
      { id: 'actions-date', label: 'Livraison comité', type: 'date' },
      { id: 'actions-url', label: 'Lien comité', type: 'url' },
    ],
  });
  await page.reload();
  await page.getByRole('button', { name: 'Créer un compte rendu', exact: true }).click();
  composer = page.getByRole('dialog', { name: 'Créer un compte rendu', exact: true });
  await selectReportTemplate(page, composer, template.id);
  await composer.getByLabel('Titre du compte rendu', { exact: true }).fill('Actions compte rendu comité');
  await composer.getByLabel('Date du compte rendu', { exact: true }).fill('2026-10-12');
  await composer.getByRole('combobox', { name: 'Évaluation : Qualité comité', exact: true }).selectOption('5');
  await composer.getByLabel('Décisions comité', { exact: true }).fill('Décision du comité conservée avec son modèle initial.');
  await composer.getByLabel('Résultat comité', { exact: true }).fill('125.55');
  await composer.getByLabel('Livraison comité', { exact: true }).fill('2026-10-16');
  await composer.getByLabel('Lien comité', { exact: true }).fill('https://example.com/actions-comite');
  await composer.getByRole('button', { name: 'Enregistrer le compte rendu', exact: true }).click();
  await expect(composer).not.toBeVisible();
  saved = await state(request);
  const report = saved.projectReports!.find(item => item.title === 'Actions compte rendu comité')!;
  expect(report).toMatchObject({ projectId: owner.id, templateId: template.id, templateName: template.name, reportDate: '2026-10-12' });
  expect(report.fields.map(item => [item.label, item.type, item.value])).toEqual([
    ['Décisions comité', 'text', 'Décision du comité conservée avec son modèle initial.'],
    ['Résultat comité', 'number', '125.55'], ['Livraison comité', 'date', '2026-10-16'],
    ['Lien comité', 'url', 'https://example.com/actions-comite'],
  ]);
  await patch(request, 'report-templates', template.id, { name: 'Actions modèle comité changé', fields: [{ id: 'actions-replaced', label: 'Nouveau champ du modèle', type: 'text' }], indicators: [] });
  await page.reload();
  await page.getByRole('button', { name: 'Actions compte rendu comité', exact: true }).click();
  let reader = page.getByRole('dialog', { name: 'Compte rendu du projet', exact: true });
  await expect(reader).toContainText('Décisions comité');
  await expect(reader).toContainText('Décision du comité conservée avec son modèle initial.');
  await expect(reader).not.toContainText('Nouveau champ du modèle');
  await reader.getByRole('button', { name: 'Modifier le compte rendu', exact: true }).click();
  await reader.getByLabel('Titre du compte rendu', { exact: true }).fill('Actions compte rendu comité corrigé');
  await reader.getByLabel('Résultat comité', { exact: true }).fill('175.75');
  await reader.getByRole('button', { name: 'Enregistrer les modifications', exact: true }).click();
  await expect(reader).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Actions compte rendu comité corrigé', exact: true }).click();
  reader = page.getByRole('dialog', { name: 'Compte rendu du projet', exact: true });
  await expect(reader).toContainText('175.75');
  saved = await state(request);
  const updated = saved.projectReports!.find(item => item.id === report.id)!;
  expect(updated.createdAt).toBe(report.createdAt);
  expect(updated.authorName).toBe(report.authorName);
  expect(updated.templateName).toBe(template.name);
  expect(updated.fields.find(item => item.id === 'actions-number')?.value).toBe('175.75');
  await page.screenshot({ path: screenshotPath('project-actions-report-desktop.png'), fullPage: true, animations: 'disabled' });
  await reader.getByRole('button', { name: /Fermer/ }).click();

  for (const status of ['paused', 'closed']) {
    await patch(request, 'projects', owner.id, { status });
    await page.reload();
    await expect(page.getByRole('button', { name: 'Créer un compte rendu', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: updated.title, exact: true }).click();
    reader = page.getByRole('dialog', { name: 'Compte rendu du projet', exact: true });
    await expect(reader.getByRole('button', { name: 'Modifier le compte rendu', exact: true })).toBeDisabled();
    await expect(reader.getByRole('button', { name: 'Supprimer le compte rendu', exact: true })).toBeDisabled();
    await reader.getByRole('button', { name: /Fermer/ }).click();
    const post = await request.post('/api/project-reports', { data: { projectId: owner.id, title: 'Actions écriture interdite', reportDate: '2026-10-12' } });
    const edit = await request.patch(`/api/project-reports/${report.id}`, { data: { title: 'Actions correction interdite' } });
    const remove = await request.delete(`/api/project-reports/${report.id}`);
    expect([post.status(), edit.status(), remove.status()]).toEqual([409, 409, 409]);
    expect((await state(request)).projectReports!.find(item => item.id === report.id)).toEqual(updated);
  }
  await patch(request, 'projects', owner.id, { status: 'open' });
  await page.reload();
  await page.getByRole('button', { name: 'Actions compte rendu sans modèle', exact: true }).click();
  reader = page.getByRole('dialog', { name: 'Compte rendu du projet', exact: true });
  page.once('dialog', confirmation => confirmation.accept());
  await reader.getByRole('button', { name: 'Supprimer le compte rendu', exact: true }).click();
  await expect(reader).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Actions compte rendu sans modèle', exact: true })).toHaveCount(0);
  expect((await state(request)).projectReports!.some(item => item.id === fallback.id)).toBe(false);
  expect(errors).toEqual([]);
});

test('actions projet : budget alloué édité depuis le KPI, rapport flash chiffré et impression du seul projet', async ({ page, request }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const owner = await project(request, 'Actions projet rapport flash');
  const profile = await create<CostProfile>(request, 'profiles', { name: 'Actions tarif 10 €/h', dailyRate: 80, eqjtHours: 8 });
  const member = await create<Resource>(request, 'resources', { name: 'Actions équipe flash', profileId: profile.id, projectIds: [owner.id] });
  const work = await task(request, owner, 'Actions tâche flash', { assigneeId: member.id });
  await record(request, work, member, 2.5, 'Actions temps flash');
  await task(request, owner, 'Actions jalon flash', { kind: 'milestone', allocatedHours: 0, assigneeId: member.id });
  await create(request, 'expenses', { projectId: owner.id, label: 'Actions dépense flash payée', amount: 40, category: 'other', plannedDate: '2026-10-05', paidDate: '2026-10-06' });
  await create(request, 'expenses', { projectId: owner.id, label: 'Actions dépense flash prévue', amount: 10, category: 'software', plannedDate: '2026-10-05' });
  await create(request, 'revenues', { projectId: owner.id, label: 'Actions recette flash indépendante', amount: 999, category: 'services', plannedDate: '2026-10-05' });
  const other = await project(request, 'Actions projet flash étranger', 9999);
  await task(request, other, 'Actions tâche flash étrangère', { assigneeId: member.id, allocatedHours: 999 });
  await create(request, 'expenses', { projectId: other.id, label: 'Actions dépense flash étrangère', amount: 7777, category: 'equipment', plannedDate: '2026-10-05', paidDate: '2026-10-06' });

  await page.goto(`/#project/${owner.id}/budget`);
  const budgetCard = page.locator('.metric-card').filter({ has: page.getByText('Budget alloué', { exact: true }) });
  await expectNumber(budgetCard.locator('strong'), 500.75);
  await page.getByRole('button', { name: 'Modifier le budget alloué', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Modifier le budget alloué', exact: true });
  await expect(editor.getByLabel('Budget alloué (€)', { exact: true })).toHaveValue('500.75');
  await editor.getByLabel('Budget alloué (€)', { exact: true }).fill('750.55');
  await editor.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expectNumber(budgetCard.locator('strong'), 750.55);
  await page.reload();
  await expectNumber(budgetCard.locator('strong'), 750.55);
  const saved = await state(request);
  expect(saved.projects.find(item => item.id === owner.id)?.budget).toBe(750.55);
  expect(saved.projects.find(item => item.id === other.id)?.budget).toBe(9999);

  await page.goto(`/#project/${owner.id}/summary`);
  await expectActionColors(page);
  await page.getByRole('button', { name: 'Rapport flash', exact: true }).click();
  const flash = page.getByRole('dialog', { name: 'Rapport flash', exact: true });
  const preview = flash.locator('.fr-preview .fr-report-document');
  await expect(preview).toContainText(owner.name);
  await expect(preview).toContainText(owner.description);
  await expect(preview).toContainText(work.title);
  await expect(preview).toContainText('Actions jalon flash');
  await expect(preview).not.toContainText(other.name);
  await expect(preview).not.toContainText('Actions tâche flash étrangère');
  const budget = preview.getByRole('region', { name: 'Budget du projet', exact: true });
  for (const [label, expected] of [['Alloué', 750.55], ['Planifié', 170], ['Réel', 65], ['Marge planifiée', 580.55], ['Marge réelle', 685.55], ['Acquis', 30]] as const) {
    await expectNumber(budget.locator('.fr-budget-kpis > div').filter({ has: page.getByText(label, { exact: true }) }).locator('strong'), expected);
  }
  await page.screenshot({ path: screenshotPath('project-actions-flash-desktop.png'), fullPage: true, animations: 'disabled' });
  await page.evaluate(() => { window.print = () => { document.documentElement.dataset.projectFlashPrintRequested = 'true'; window.dispatchEvent(new Event('beforeprint')); }; });
  await flash.getByRole('button', { name: 'Imprimer / enregistrer en PDF', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-project-flash-print-requested', 'true');
  await page.emulateMedia({ media: 'print' });
  const printDocument = page.locator('body > .fr-print-report .fr-report-document');
  await expect(printDocument).toBeVisible();
  await expect(printDocument).toContainText(owner.name);
  await expect(printDocument).not.toContainText(other.name);
  await expect(page.locator('.sidebar')).not.toBeVisible();
  await expect(page.locator('.topbar')).not.toBeVisible();
  await expect(flash).not.toBeVisible();
  await page.screenshot({ path: screenshotPath('project-actions-flash-print.png'), fullPage: true, animations: 'disabled' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.emulateMedia({ media: 'screen' });
  await expect(flash).toBeVisible();
  await flash.getByRole('button', { name: 'Fermer le rapport flash', exact: true }).click();
  expect(errors).toEqual([]);
});

test('actions projet : boutons, onglet suivi et formulaires sur mobile sans débordement de page', async ({ page, request }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const owner = await project(request, 'Actions projet mobile');
  const member = await create<Resource>(request, 'resources', { name: 'Actions ressource mobile', projectIds: [owner.id] });
  const work = await task(request, owner, 'Actions tâche mobile', { assigneeId: member.id });
  await record(request, work, member, 1.25, 'Actions saisie mobile');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/#project/${owner.id}/summary`);
  await expectActionColors(page);
  await withinViewport(page, page.getByRole('button', { name: 'Créer un compte rendu', exact: true }));
  await withinViewport(page, page.getByRole('button', { name: 'Rapport flash', exact: true }));
  await noPageOverflow(page);
  await page.screenshot({ path: screenshotPath('project-actions-summary-mobile.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Créer un compte rendu', exact: true }).click();
  const reportForm = page.getByRole('dialog', { name: 'Créer un compte rendu', exact: true });
  await withinViewport(page, reportForm);
  await selectReportTemplate(page, reportForm, '');
  await reportForm.getByLabel('Titre du compte rendu', { exact: true }).fill('Actions compte rendu mobile');
  await reportForm.getByLabel('Faits marquants', { exact: true }).fill('Le formulaire reste utilisable sur téléphone.');
  await page.screenshot({ path: screenshotPath('project-actions-report-form-mobile.png'), fullPage: true, animations: 'disabled' });
  await reportForm.getByRole('button', { name: 'Enregistrer le compte rendu', exact: true }).click();
  await expect(reportForm).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Actions compte rendu mobile', exact: true })).toBeVisible();
  const timeTab = page.getByRole('navigation', { name: 'Vues du projet', exact: true }).getByRole('button', { name: 'Suivi temporel', exact: true });
  await timeTab.click();
  await expect(page).toHaveURL(new RegExp(`#project/${owner.id}/time$`));
  await page.getByLabel('Date de la semaine', { exact: true }).fill('2026-10-06');
  await expectNumber(matrix(page).locator('tfoot [data-summary="week"]'), 1.25);
  await noPageOverflow(page);
  const scrolling = await page.getByRole('region', { name: 'Grille hebdomadaire défilante', exact: true }).evaluate(element => {
    element.scrollLeft = 150;
    return { left: element.scrollLeft, width: element.clientWidth, content: element.scrollWidth };
  });
  expect(scrolling.left).toBeGreaterThan(0);
  expect(scrolling.content).toBeGreaterThan(scrolling.width);
  await page.getByRole('region', { name: 'Grille hebdomadaire défilante', exact: true }).evaluate(element => { element.scrollLeft = 0; });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: screenshotPath('project-actions-time-mobile.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Saisir du temps', exact: true }).click();
  const timeForm = page.getByRole('dialog', { name: 'Saisir du temps', exact: true });
  await withinViewport(page, timeForm);
  await timeForm.getByRole('combobox', { name: 'Tâche', exact: true }).selectOption(work.id);
  await timeForm.getByLabel('Date', { exact: true }).fill('2026-10-07');
  await timeForm.getByLabel('Temps passé (heures)', { exact: true }).fill('2.25');
  await timeForm.getByLabel('Note', { exact: true }).fill('Actions nouvelle saisie mobile');
  await timeForm.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(timeForm).not.toBeVisible();
  await expectNumber(matrix(page).locator('tfoot [data-summary="week"]'), 3.5);
  await page.goto(`/#project/${owner.id}/budget`);
  await page.getByRole('button', { name: 'Modifier le budget alloué', exact: true }).click();
  const budgetForm = page.getByRole('dialog', { name: 'Modifier le budget alloué', exact: true });
  await withinViewport(page, budgetForm);
  await budgetForm.getByLabel('Budget alloué (€)', { exact: true }).fill('1234.56');
  await budgetForm.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(budgetForm).not.toBeVisible();
  await noPageOverflow(page);
  expect((await state(request)).projects.find(item => item.id === owner.id)?.budget).toBe(1234.56);
  expect(errors).toEqual([]);
});
