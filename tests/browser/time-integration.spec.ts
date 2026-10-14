import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { loginTestAdmin } from '../auth-fixture';
import type { AppData, Project, Resource, Task, TimeEntry } from '../../shared/types';

test.beforeEach(async ({ page, request }) => { await loginTestAdmin(page.request); await loginTestAdmin(request); });
async function state(request: APIRequestContext): Promise<AppData> { const response = await request.get('/api/state'); expect(response.ok()).toBeTruthy(); return response.json(); }
async function create<T>(request: APIRequestContext, entity: string, body: unknown): Promise<T> { const response = await request.post('/api/' + entity, { data: body }); expect(response.ok(), await response.text()).toBeTruthy(); return response.json(); }
async function fixture(request: APIRequestContext, name: string) {
  const data = await state(request); const a = data.resources.find(resource => resource.id === data.currentUser.id)!; const b = data.resources.find(resource => resource.active && resource.id !== a.id)!;
  for (const resource of [a, b]) expect((await request.post('/api/time-integrations', { data: { scope: 'resource', resourceId: resource.id, date: null } })).ok()).toBeTruthy();
  const project = (suffix: string) => create<Project>(request, 'projects', { name: name + suffix, zoneId: data.zones[0].id, startDate: '2026-01-01', endDate: '2027-12-31' });
  const p = await project(' principal'); const other = await project(' autre');
  const task = (p: Project, r: Resource, title: string) => create<Task>(request, 'tasks', { projectId: p.id, assigneeId: r.id, title: name + title, phase: 'Période de validation', allocatedHours: 12 });
  const ta = await task(p, a, ' personnelle'); const tb = await task(p, b, ' collègue'); const oa = await task(other, a, ' personnelle hors filtre'); const ob = await task(other, b, ' collègue hors filtre');
  const entry = (t: Task, r: Resource, date: string) => create<TimeEntry>(request, 'time-entries', { taskId: t.id, resourceId: r.id, date, hours: 2, note: name });
  const before = await entry(ta, a, '2026-10-05'); const boundary = await entry(ta, a, '2026-10-06'); const after = await entry(ta, a, '2026-10-07'); const peer = await entry(tb, b, '2026-10-06');
  const outside = await entry(oa, a, '2026-10-06'); const distinct = await entry(ob, b, '2026-10-06'); const early = await entry(ta, a, '2026-09-01');
  return { p, other, a, b, ta, tb, before, boundary, after, peer, outside, distinct, early };
}
test.afterEach(async ({ request }) => {
  const data = await state(request);
  for (const resource of data.resources.filter(resource => resource.timeIntegrationDate)) expect((await request.post('/api/time-integrations', { data: { scope: 'resource', resourceId: resource.id, date: null } })).ok()).toBeTruthy();
});
function row(page: Page, task: Task, resource: Resource) { return page.getByRole('table', { name: 'Suivi temporel hebdomadaire', exact: true }).locator('tr[data-task-id="' + task.id + '"][data-resource-id="' + resource.id + '"]'); }
async function week(page: Page) { await page.getByLabel('Date de la semaine', { exact: true }).fill('2026-10-06'); }
async function cutoff(page: Page, label: string, date: string) { const form = page.getByRole('form', { name: label, exact: true }); await form.getByLabel(label, { exact: true }).fill(date); await form.getByRole('button', { name: 'Valider jusqu’à cette date', exact: true }).click(); await expect(form).toContainText('Journées validées jusqu’au'); return form; }
async function screenshot(page: Page, name: string) { const filename = 'time-integration-' + name + '.png'; await page.screenshot({ path: test.info().project.testDir.endsWith('cloudflare-browser') ? test.info().outputPath(filename) : 'docs/screenshots/' + filename, fullPage: true, animations: 'disabled' }); }

test('dates intégration : projet inclusif sur toutes ses ressources, filtres et semaine indépendants, consultation et retrait', async ({ page, request }) => {
  const f = await fixture(request, 'Intégration projet'); await page.goto('/#project/' + f.p.id + '/time'); await week(page);
  await page.getByLabel('Ressource du suivi temporel', { exact: true }).selectOption(f.a.id);
  const form = await cutoff(page, 'Date d’intégration projet', '2026-10-06');
  let data = await state(request);
  for (const entry of [f.before, f.boundary, f.peer, f.early]) expect(data.timeEntries.find(item => item.id === entry.id)!.validated).toBe(true);
  for (const entry of [f.after, f.outside, f.distinct]) expect(data.timeEntries.find(item => item.id === entry.id)!.validated).toBe(false);
  expect(data.resources.find(resource => resource.id === f.a.id)!.timeIntegrationDate).toBeFalsy();
  await expect(row(page, f.ta, f.a).locator('[data-date="2026-10-06"]')).toHaveAttribute('data-integrated', 'true');
  await expect(row(page, f.ta, f.a).locator('[data-date="2026-10-07"]')).not.toHaveAttribute('data-integrated');
  await row(page, f.ta, f.a).locator('[data-date="2026-10-06"]').getByRole('button').click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  const history = page.getByRole('table', { name: 'Saisies de la semaine', exact: true });
  await expect(history.getByRole('button', { name: 'Modifier la saisie du 2026-10-06 pour ' + f.a.name, exact: true })).toBeDisabled();
  await expect(history.getByRole('button', { name: 'Retirer la validation : ' + f.a.name + ', 2 heures le 2026-10-06', exact: true })).toBeDisabled();
  await history.getByRole('button', { name: 'Consulter la saisie du 2026-10-06 pour ' + f.a.name, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Consulter la saisie de temps', exact: true }); await expect(dialog).toContainText('date d’intégration'); await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
  await page.getByRole('button', { name: 'Toutes les saisies de la semaine', exact: true }).click(); await page.getByLabel('Filtrer la validation des temps', { exact: true }).selectOption('pending');
  await expect(history.getByRole('button', { name: 'Modifier la saisie du 2026-10-06 pour ' + f.a.name, exact: true })).toHaveCount(0);
  await expect(history.getByRole('button', { name: 'Modifier la saisie du 2026-10-07 pour ' + f.a.name, exact: true })).toBeEnabled();
  await page.getByLabel('Filtrer la validation des temps', { exact: true }).selectOption('all'); await screenshot(page, 'project-desktop');
  await page.getByLabel('Date de la semaine', { exact: true }).fill('2026-09-01'); await expect(form.getByLabel('Date d’intégration projet', { exact: true })).toHaveValue('2026-10-06');
  await expect(row(page, f.ta, f.a).locator('[data-date="2026-09-01"]')).toHaveAttribute('data-integrated', 'true');
  await page.reload(); await expect(form.getByLabel('Date d’intégration projet', { exact: true })).toHaveValue('2026-10-06');
  expect((await request.post('/api/time-entries', { data: { taskId: f.ta.id, resourceId: f.a.id, date: '2026-10-03', hours: 1 } })).status()).toBe(409);
  await form.getByRole('button', { name: 'Retirer la date', exact: true }).click(); await expect(form).toContainText('Aucune date d’intégration définie.');
  data = await state(request); expect(data.timeEntries.find(item => item.id === f.boundary.id)!.validated).toBe(false);
});

test('dates intégration : feuille personnelle valide uniquement sa ressource sur tous les projets et garde les dates projet indépendantes', async ({ page, request }) => {
  const f = await fixture(request, 'Intégration personnelle'); await page.goto('/#time/' + f.p.id); await week(page);
  const form = await cutoff(page, 'Date d’intégration ressource', '2026-10-06'); await expect(form).toContainText('Uniquement ' + f.a.name);
  let data = await state(request); for (const entry of [f.before, f.boundary, f.outside]) expect(data.timeEntries.find(item => item.id === entry.id)!.validated).toBe(true);
  for (const entry of [f.after, f.peer, f.distinct]) expect(data.timeEntries.find(item => item.id === entry.id)!.validated).toBe(false);
  expect(data.projects.find(project => project.id === f.p.id)!.timeIntegrationDate).toBeFalsy();
  await expect(row(page, f.ta, f.a).locator('[data-date="2026-10-06"]')).toHaveAttribute('data-integrated', 'true');
  await page.getByLabel('Projet', { exact: true }).selectOption(f.other.id); await expect(row(page, data.tasks.find(task => task.id === f.outside.taskId)!, f.a).locator('[data-date="2026-10-06"]')).toHaveAttribute('data-integrated', 'true');
  await page.reload(); await expect(form.getByLabel('Date d’intégration ressource', { exact: true })).toHaveValue('2026-10-06');
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); await screenshot(page, 'personal-mobile');
  await form.getByRole('button', { name: 'Retirer la date', exact: true }).click(); await expect(form).toContainText('Aucune date d’intégration définie.');
  data = await state(request); expect(data.timeEntries.find(item => item.id === f.outside.id)!.validated).toBe(false);
});

test('dates intégration : feuille équipe choisit une seule ressource, dates projet et ressource se cumulent sans dévalider les autres périodes', async ({ page, request }) => {
  const f = await fixture(request, 'Intégration équipe'); await page.goto('/#time/' + f.p.id); await week(page); await page.getByRole('button', { name: 'Équipe', exact: true }).click();
  await page.getByRole('button', { name: 'Date d’intégration de ' + f.b.name, exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Date d’intégration ressource', exact: true }); await expect(dialog).toBeVisible();
  const form = dialog.getByRole('form', { name: 'Date d’intégration ressource', exact: true }); await form.getByLabel('Date d’intégration ressource', { exact: true }).fill('2026-10-07'); await screenshot(page, 'team-dialog-desktop');
  await form.getByRole('button', { name: 'Valider jusqu’à cette date', exact: true }).click(); await expect(dialog).not.toBeVisible();
  let data = await state(request); expect(data.timeEntries.find(item => item.id === f.peer.id)!.validated).toBe(true); expect(data.timeEntries.find(item => item.id === f.distinct.id)!.validated).toBe(true); expect(data.timeEntries.find(item => item.id === f.boundary.id)!.validated).toBe(false);
  await expect(row(page, f.tb, f.b).locator('[data-date="2026-10-06"]')).toHaveAttribute('data-integrated', 'true'); await expect(row(page, f.ta, f.a).locator('[data-date="2026-10-06"]')).not.toHaveAttribute('data-integrated');
  await page.getByLabel('Ressource du suivi temporel', { exact: true }).selectOption(f.b.id); await expect(page.getByRole('form', { name: 'Date d’intégration ressource', exact: true }).getByLabel('Date d’intégration ressource', { exact: true })).toHaveValue('2026-10-07');
  expect((await request.post('/api/time-integrations', { data: { scope: 'project', projectId: f.p.id, date: '2026-10-06' } })).ok()).toBeTruthy(); await page.reload();
  await page.getByRole('button', { name: 'Équipe', exact: true }).click(); await page.getByRole('button', { name: 'Date d’intégration de ' + f.b.name, exact: true }).click();
  await dialog.getByRole('button', { name: 'Retirer la date', exact: true }).click(); await expect(dialog).not.toBeVisible();
  data = await state(request); expect(data.timeEntries.find(item => item.id === f.peer.id)!.validated).toBe(true); expect(data.timeEntries.find(item => item.id === f.distinct.id)!.validated).toBe(false); expect(data.timeEntries.find(item => item.id === f.boundary.id)!.validated).toBe(true);
  await page.goto('/#project/' + f.p.id + '/time'); await week(page); await screenshot(page, 'project-overlap-desktop');
});

function dayTotal(page: Page, date: string) { return page.getByRole('table', { name: 'Suivi temporel hebdomadaire', exact: true }).locator('tfoot [data-date="' + date + '"]'); }
function resourceTotal(page: Page, resource: Resource, date: string) { return page.getByRole('table', { name: 'Suivi temporel hebdomadaire', exact: true }).locator('tbody tr[data-row-kind="resource"][data-resource-id="' + resource.id + '"] [data-date="' + date + '"]'); }
function projectTotal(page: Page, project: Project, resource: Resource, date: string) { return page.getByRole('table', { name: 'Suivi temporel hebdomadaire', exact: true }).locator('tbody tr[data-row-kind="project"][data-project-id="' + project.id + '"][data-resource-id="' + resource.id + '"] [data-date="' + date + '"]'); }
async function applyTotal(page: Page, date: string, scope: 'projet' | 'ressource') {
  const dialog = page.getByRole('dialog', { name: 'Date d’intégration ' + scope, exact: true });
  await expect(dialog.getByRole('form', { name: 'Date d’intégration ' + scope, exact: true }).getByLabel('Date d’intégration ' + scope, { exact: true })).toHaveValue(date);
  await dialog.getByRole('button', { name: 'Valider jusqu’à cette date', exact: true }).click(); await expect(dialog).not.toBeVisible();
}

test('totaux journaliers : footer et ligne ressource du projet préremplissent la bonne date et gardent le périmètre projet', async ({ page, request }) => {
  const f = await fixture(request, 'Totaux projet'); await page.goto('/#project/' + f.p.id + '/time'); await week(page);
  await page.getByLabel('Ressource du suivi temporel', { exact: true }).selectOption(f.a.id);
  await dayTotal(page, '2026-10-06').getByRole('button').focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Date d’intégration projet', exact: true }); await expect(dialog).toContainText('Toutes les ressources du projet');
  expect((await state(request)).projects.find(project => project.id === f.p.id)!.timeIntegrationDate).toBeFalsy();
  await applyTotal(page, '2026-10-06', 'projet');
  let data = await state(request); for (const entry of [f.boundary, f.peer, f.early]) expect(data.timeEntries.find(item => item.id === entry.id)!.validated).toBe(true);
  expect(data.timeEntries.find(item => item.id === f.outside.id)!.validated).toBe(false); expect(data.resources.find(resource => resource.id === f.a.id)!.timeIntegrationDate).toBeFalsy();
  await resourceTotal(page, f.a, '2026-10-07').getByRole('button').click(); await applyTotal(page, '2026-10-07', 'projet');
  data = await state(request); expect(data.timeEntries.find(item => item.id === f.after.id)!.validated).toBe(true);
  await dayTotal(page, '2026-10-10').getByRole('button').click(); await applyTotal(page, '2026-10-10', 'projet');
  await expect(dayTotal(page, '2026-10-10')).toContainText('0'); await screenshot(page, 'daily-totals-project-desktop');
  await page.reload(); await expect(page.getByRole('form', { name: 'Date d’intégration projet', exact: true }).getByLabel('Date d’intégration projet', { exact: true })).toHaveValue('2026-10-10');
  expect((await request.patch('/api/projects/' + f.p.id, { data: { status: 'paused' } })).ok()).toBeTruthy(); await page.reload(); await week(page);
  await expect(dayTotal(page, '2026-10-06').getByRole('button')).toBeDisabled(); await expect(resourceTotal(page, f.a, '2026-10-06').getByRole('button')).toBeDisabled();
});

test('totaux journaliers : footer personnel ouvre la date de sa ressource et conserve les heures après intégration', async ({ page, request }) => {
  const f = await fixture(request, 'Totaux personnels'); await page.goto('/#time/' + f.p.id); await week(page);
  const amount = await dayTotal(page, '2026-10-06').innerText(); await dayTotal(page, '2026-10-06').getByRole('button').click();
  await expect(page.getByRole('dialog', { name: 'Date d’intégration ressource', exact: true })).toContainText('Uniquement ' + f.a.name);
  await applyTotal(page, '2026-10-06', 'ressource');
  const data = await state(request); expect(data.timeEntries.find(item => item.id === f.outside.id)!.validated).toBe(true); expect(data.timeEntries.find(item => item.id === f.peer.id)!.validated).toBe(false);
  expect(data.projects.find(project => project.id === f.p.id)!.timeIntegrationDate).toBeFalsy(); await expect(dayTotal(page, '2026-10-06')).toHaveText(amount);
  await page.setViewportSize({ width: 390, height: 844 }); await screenshot(page, 'daily-totals-personal-mobile');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('totaux journaliers : footer équipe choisit explicitement une seule ressource avant validation', async ({ page, request }) => {
  const f = await fixture(request, 'Totaux équipe'); await page.goto('/#time/' + f.p.id); await week(page); await page.getByRole('button', { name: 'Équipe', exact: true }).click();
  let writes = 0; page.on('request', req => { if (req.url().endsWith('/api/time-integrations') && req.method() === 'POST') writes++; });
  await dayTotal(page, '2026-10-06').getByRole('button').click();
  const dialog = page.getByRole('dialog', { name: 'Date d’intégration ressource', exact: true }); await expect(dialog.getByRole('combobox', { name: 'Ressource à intégrer', exact: true })).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Valider jusqu’à cette date', exact: true })).toHaveCount(0); expect(writes).toBe(0);
  await dialog.getByRole('combobox', { name: 'Ressource à intégrer', exact: true }).selectOption(f.b.id);
  await expect(dialog).toContainText('Uniquement ' + f.b.name); await screenshot(page, 'daily-totals-team-dialog-desktop');
  await applyTotal(page, '2026-10-06', 'ressource'); expect(writes).toBe(1);
  const data = await state(request); expect(data.timeEntries.find(item => item.id === f.peer.id)!.validated).toBe(true); expect(data.timeEntries.find(item => item.id === f.distinct.id)!.validated).toBe(true); expect(data.timeEntries.find(item => item.id === f.boundary.id)!.validated).toBe(false);
  expect(data.projects.find(project => project.id === f.p.id)!.timeIntegrationDate).toBeFalsy();
});

test('totaux journaliers : ligne projet de la feuille équipe cible sa ressource, puis footer filtré reste individuel', async ({ page, request }) => {
  const f = await fixture(request, 'Totaux par personne'); await page.goto('/#time/' + f.p.id); await week(page); await page.getByRole('button', { name: 'Équipe', exact: true }).click();
  await projectTotal(page, f.p, f.a, '2026-10-05').getByRole('button').click();
  const dialog = page.getByRole('dialog', { name: 'Date d’intégration ressource', exact: true }); await expect(dialog.getByRole('combobox', { name: 'Ressource à intégrer', exact: true })).toHaveCount(0);
  await applyTotal(page, '2026-10-05', 'ressource');
  let data = await state(request); expect(data.timeEntries.find(item => item.id === f.before.id)!.validated).toBe(true); expect(data.timeEntries.find(item => item.id === f.boundary.id)!.validated).toBe(false);
  await page.getByLabel('Ressource du suivi temporel', { exact: true }).selectOption(f.b.id); await dayTotal(page, '2026-10-07').getByRole('button').click();
  await expect(dialog.getByRole('combobox', { name: 'Ressource à intégrer', exact: true })).toHaveCount(0); await expect(dialog).toContainText('Uniquement ' + f.b.name);
  await applyTotal(page, '2026-10-07', 'ressource'); data = await state(request);
  expect(data.resources.find(resource => resource.id === f.a.id)!.timeIntegrationDate).toBe('2026-10-05'); expect(data.resources.find(resource => resource.id === f.b.id)!.timeIntegrationDate).toBe('2026-10-07');
  expect(data.timeEntries.find(item => item.id === f.boundary.id)!.validated).toBe(false); expect(data.projects.find(project => project.id === f.p.id)!.timeIntegrationDate).toBeFalsy();
});
