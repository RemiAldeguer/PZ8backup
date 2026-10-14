import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import type { AppData, Project, ProjectTaskList, Task, Zone } from '../../shared/types';
import { loginTestAdmin } from '../auth-fixture';

test.beforeEach(async ({ page, request }) => { await loginTestAdmin(page.request); await loginTestAdmin(request); });
async function state(request: APIRequestContext): Promise<AppData> { const response = await request.get('/api/state'); expect(response.ok()).toBeTruthy(); return response.json(); }
async function create<T>(request: APIRequestContext, entity: string, data: unknown): Promise<T> { const response = await request.post('/api/' + entity, { data }); expect(response.ok(), await response.text()).toBeTruthy(); return response.json(); }
async function fixture(request: APIRequestContext, prefix: string) {
  const data = await state(request); const resource = data.resources.find(item => item.id === data.currentUser.id)!;
  const zone = await create<Zone>(request, 'zones', { name: prefix + ' Zone', color: '#087578' });
  const otherZone = await create<Zone>(request, 'zones', { name: prefix + ' Autre zone', color: '#784cac' });
  const project = (name: string, zoneId: string) => create<Project>(request, 'projects', { name: prefix + ' ' + name, zoneId, startDate: '2026-10-01', endDate: '2026-11-30', status: 'open' });
  const a = await project('Alpha', zone.id); const b = await project('Bêta', zone.id); const outside = await project('Hors zone', otherZone.id);
  const parent = await create<ProjectTaskList>(request, 'task-lists', { projectId: a.id, name: prefix + ' Préparation' });
  const child = await create<ProjectTaskList>(request, 'task-lists', { projectId: a.id, name: prefix + ' Sous-liste', parentId: parent.id });
  const task = (projectId: string, title: string, extra: Record<string, unknown> = {}) => create<Task>(request, 'tasks', { projectId, title: prefix + ' ' + title, allocatedHours: 8, startDate: '2026-10-05', endDate: '2026-10-15', assigneeId: resource.id, phase: 'Phase commune', tags: ['Client'], ...extra });
  const nested = await task(a.id, 'Imbriquée', { listId: child.id });
  const milestone = await task(a.id, 'Jalon', { listId: child.id, kind: 'milestone', allocatedHours: 0, startDate: null, endDate: '2026-10-10' });
  const legacyA = await task(a.id, 'Ancienne A'); const legacyB = await task(b.id, 'Ancienne B');
  const undated = await task(a.id, 'Sans date', { phase: '', startDate: null, endDate: null, assigneeId: null });
  const foreign = await task(outside.id, 'Exclue');
  expect((await request.patch('/api/projects/' + b.id, { data: { status: 'paused' } })).ok()).toBeTruthy();
  return { zone, otherZone, a, b, outside, parent, child, nested, milestone, legacyA, legacyB, undated, foreign, resource };
}
function navigation(page: Page) { return page.getByRole('navigation', { name: 'Vues de la zone', exact: true }); }
function matrix(page: Page, mode: 'list' | 'gantt' = 'list') { return page.getByRole('table', { name: mode === 'list' ? 'Éléments de la zone' : 'Gantt de la zone', exact: true }); }
function taskRow(page: Page, task: Task, mode: 'list' | 'gantt' = 'list') { return matrix(page, mode).locator('tr[data-task-id="' + task.id + '"]'); }
async function screenshot(page: Page, name: string) { const filename = 'zone-views-' + name + '.png'; await page.screenshot({ path: test.info().project.testDir.endsWith('cloudflare-browser') ? test.info().outputPath(filename) : 'docs/screenshots/' + filename, fullPage: true, animations: 'disabled' }); }

test('vues de zone : liste hiérarchique multi-projets, filtres et validation dans le bon projet', async ({ page, request }) => {
  const f = await fixture(request, 'Liste zone'); const before = await state(request); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#zones/' + f.zone.id + '/projects'); await navigation(page).getByRole('link', { name: 'Liste', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('#zones/' + f.zone.id + '/list$')); await expect(navigation(page).getByRole('link', { name: 'Liste', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(taskRow(page, f.nested)).toHaveAttribute('data-depth', '3'); await expect(taskRow(page, f.foreign)).toHaveCount(0); await expect(taskRow(page, f.legacyB)).toBeVisible();
  const parent = matrix(page).locator('tr[data-list-id="' + f.parent.id + '"]'); await parent.getByRole('button', { name: 'Replier ' + f.parent.name, exact: true }).click(); await expect(taskRow(page, f.nested)).toHaveCount(0); await expect(taskRow(page, f.legacyA)).toBeVisible();
  await parent.getByRole('button', { name: 'Développer ' + f.parent.name, exact: true }).click(); await page.getByLabel('Rechercher un élément de la zone', { exact: true }).fill('Imbriquée'); await expect(matrix(page).locator('tr[data-task-id]')).toHaveCount(1); await expect(parent).toBeVisible();
  await page.getByRole('button', { name: 'Réinitialiser les filtres', exact: true }).click(); await page.getByLabel('Type des éléments de la zone', { exact: true }).selectOption('milestone'); await expect(matrix(page).locator('tr[data-task-id]')).toHaveCount(1); await expect(taskRow(page, f.milestone)).toBeVisible();
  await page.getByRole('button', { name: 'Réinitialiser les filtres', exact: true }).click(); await page.getByLabel('Ressource des éléments de la zone', { exact: true }).selectOption('unassigned'); await expect(matrix(page).locator('tr[data-task-id]')).toHaveCount(1); await expect(taskRow(page, f.undated)).toBeVisible();
  await page.getByRole('button', { name: 'Réinitialiser les filtres', exact: true }).click(); await expect(taskRow(page, f.legacyB).getByRole('checkbox', { name: 'Terminer ' + f.legacyB.title, exact: true })).toBeDisabled();
  await taskRow(page, f.nested).getByRole('checkbox', { name: 'Terminer ' + f.nested.title, exact: true }).click(); await expect(taskRow(page, f.nested).getByRole('checkbox', { name: 'Rouvrir ' + f.nested.title, exact: true })).toBeChecked();
  const after = await state(request); expect(after.tasks.find(task => task.id === f.nested.id)).toMatchObject({ projectId: f.a.id, status: 'done', progress: 100, listId: f.child.id }); expect(after.tasks.find(task => task.id === f.foreign.id)).toEqual(before.tasks.find(task => task.id === f.foreign.id)); expect(after.taskLists).toEqual(before.taskLists);
  await taskRow(page, f.nested).getByRole('button', { name: f.nested.title, exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Détail de la tâche', exact: true }); await expect(dialog).toContainText(f.a.name); await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
  await screenshot(page, 'list-desktop'); await page.reload(); await expect(taskRow(page, f.nested).getByRole('checkbox', { name: 'Rouvrir ' + f.nested.title, exact: true })).toBeChecked(); expect(errors).toEqual([]);
});

test('vues de zone : Gantt commun, jalons, phases indépendantes, échelles et éléments sans date', async ({ page, request }) => {
  const f = await fixture(request, 'Gantt zone'); const edge = await create<Task>(request, 'tasks', { projectId: f.a.id, title: 'Borne de fin du Gantt', phase: '', startDate: '2026-10-20', endDate: '2026-10-23', allocatedHours: 0 }); const before = await state(request); await page.goto('/#zones/' + f.zone.id + '/gantt');
  await expect(taskRow(page, f.foreign, 'gantt')).toHaveCount(0); await expect(taskRow(page, f.nested, 'gantt').getByRole('button', { name: 'Ouvrir ' + f.nested.title + ' dans le Gantt', exact: true })).toBeVisible(); await expect(taskRow(page, f.milestone, 'gantt').locator('.zv-milestone')).toBeVisible(); await expect(taskRow(page, f.undated, 'gantt')).toContainText('Sans date planifiée');
  const phase = matrix(page, 'gantt').locator('tr[data-row-kind="list"][data-project-id="' + f.a.id + '"]').filter({ hasText: 'Phase commune' }); await phase.getByRole('button', { name: 'Replier Phase commune', exact: true }).click(); await expect(taskRow(page, f.legacyA, 'gantt')).toHaveCount(0); await expect(taskRow(page, f.legacyB, 'gantt')).toBeVisible();
  await page.getByRole('button', { name: 'Tout déplier', exact: true }).click(); await taskRow(page, f.milestone, 'gantt').getByRole('button', { name: 'Ouvrir ' + f.milestone.title + ' dans le Gantt', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Détail de la tâche', exact: true }); await expect(dialog).toContainText(f.a.name); await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
  await page.getByLabel('Échelle du Gantt de zone', { exact: true }).selectOption('30'); const period = await page.locator('.zv-gantt-controls strong').innerText(); await page.getByRole('button', { name: 'Période suivante du Gantt de zone', exact: true }).click(); await expect(page.locator('.zv-gantt-controls strong')).not.toHaveText(period); await expect(taskRow(page, edge, 'gantt').getByRole('button', { name: 'Ouvrir ' + edge.title + ' dans le Gantt', exact: true })).toHaveCount(0); await expect(taskRow(page, f.nested, 'gantt').getByRole('button', { name: 'Ouvrir ' + f.nested.title + ' dans le Gantt', exact: true })).toHaveCount(0); await page.getByRole('button', { name: 'Période précédente du Gantt de zone', exact: true }).click(); await expect(page.locator('.zv-gantt-controls strong')).toHaveText(period);
  await page.getByLabel('Échelle du Gantt de zone', { exact: true }).selectOption('zone'); await screenshot(page, 'gantt-desktop'); expect(await matrix(page, 'gantt').locator('[style]').evaluateAll(nodes => nodes.every(node => !/NaN|Infinity/.test(node.getAttribute('style') ?? '')))).toBe(true);
  await page.getByLabel('Choisir une zone', { exact: true }).selectOption(''); await expect(page).toHaveURL(/#projects\/gantt$/); await expect(taskRow(page, f.foreign, 'gantt')).toBeVisible();
  const after = await state(request); expect(after.tasks).toEqual(before.tasks); expect(after.projects).toEqual(before.projects); expect(after.taskLists).toEqual(before.taskLists);
});

test('vues de zone : route et zone conservées, clavier, création et vues mobiles défilantes', async ({ page, request }) => {
  const f = await fixture(request, 'Mobile zone'); await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/#zones/' + f.zone.id + '/list'); await expect(matrix(page)).toBeVisible(); await screenshot(page, 'list-mobile'); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await navigation(page).getByRole('link', { name: 'Gantt', exact: true }).focus(); await page.keyboard.press('Enter'); await expect(page).toHaveURL(new RegExp('#zones/' + f.zone.id + '/gantt$')); await page.reload(); await expect(navigation(page).getByRole('link', { name: 'Gantt', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByLabel('Choisir une zone', { exact: true }).selectOption(f.otherZone.id); await expect(page).toHaveURL(new RegExp('#zones/' + f.otherZone.id + '/gantt$')); await expect(taskRow(page, f.foreign, 'gantt')).toBeVisible(); await expect(taskRow(page, f.nested, 'gantt')).toHaveCount(0); await page.getByRole('region', { name: 'Éléments de zone, défilement horizontal', exact: true }).evaluate(element => { element.scrollLeft = 260; }); await screenshot(page, 'gantt-mobile'); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('region', { name: 'Planning Gantt de la zone', exact: true }).getByRole('button', { name: 'Projet', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Nouveau projet', exact: true }); await dialog.getByRole('button', { name: 'Depuis zéro', exact: true }).click(); await expect(dialog.getByRole('combobox', { name: 'Zone', exact: true })).toHaveValue(f.otherZone.id); await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  const empty = await create<Zone>(request, 'zones', { name: 'Zone de planning vide', color: '#218273' }); await page.goto('/#zones/' + empty.id + '/list'); await page.reload(); await expect(page.getByRole('heading', { name: 'Aucun projet dans cette zone', exact: true })).toBeVisible(); await navigation(page).getByRole('link', { name: 'Projets', exact: true }).click(); await expect(page).toHaveURL(new RegExp('#zones/' + empty.id + '/projects$'));
});
