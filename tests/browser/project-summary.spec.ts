import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import type { AppData, Project, ProjectReport, Resource, Task } from '../../shared/types';
import type { StrategicAxis } from '../../shared/customization';
import { loginTestAdmin } from '../auth-fixture';

test.beforeEach(async ({ page, request }) => { await loginTestAdmin(page.request); await loginTestAdmin(request); });
async function state(request: APIRequestContext): Promise<AppData> { const response = await request.get('/api/state'); expect(response.ok()).toBeTruthy(); return response.json(); }
async function create<T>(request: APIRequestContext, entity: string, data: unknown): Promise<T> { const response = await request.post('/api/' + entity, { data }); expect(response.ok(), await response.text()).toBeTruthy(); return response.json(); }
async function fixture(request: APIRequestContext, prefix: string) {
  const data = await state(request); const own = data.resources.find(item => item.id === data.currentUser.id)!;
  const other = await create<Resource>(request, 'resources', { name: prefix + ' Collègue' });
  const project = await create<Project>(request, 'projects', { zoneId: data.zones[0].id, name: prefix + ' Projet', startDate: '2026-10-01', endDate: '2026-11-30', description: ('Objectif : préparer le déploiement et accompagner les équipes.\n\nDescription détaillée du projet et des livrables attendus.\n\n').repeat(7), weather: 5, budget: 5000 });
  const foreign = await create<Project>(request, 'projects', { zoneId: data.zones[0].id, name: prefix + ' Hors périmètre', startDate: '2026-01-01', endDate: '2027-01-01' });
  const task = (title: string, extra: Record<string, unknown> = {}) => create<Task>(request, 'tasks', { projectId: project.id, title: prefix + ' ' + title, phase: 'Préparation', assigneeId: own.id, allocatedHours: 0, status: 'todo', progress: 0, startDate: '2026-10-01', endDate: '2026-10-20', ...extra });
  const done = await task('Achevée', { allocatedHours: 4, status: 'done', progress: 100, endDate: '2026-10-02' });
  const late = await task('Retard personnel', { allocatedHours: 12, status: 'in_progress', progress: 25, endDate: '2026-10-05' });
  const future = await task('À venir personnelle', { allocatedHours: 8, status: 'in_progress', progress: 50 });
  const peerFuture = await task('À venir collègue', { allocatedHours: 4, assigneeId: other.id });
  const peerLate = await task('Retard collègue', { assigneeId: other.id, endDate: '2026-10-03' });
  const undated = await task('Non planifiée', { assigneeId: null, startDate: null, endDate: null });
  const milestone = await task('Jalon en retard', { kind: 'milestone', startDate: null, endDate: '2026-10-03' });
  await task('Jalon réalisé', { kind: 'milestone', status: 'done', progress: 100, startDate: null, endDate: '2026-10-02' });
  await task('Jalon à venir', { kind: 'milestone', startDate: null, endDate: '2026-10-30' });
  await task('Jalon sans date', { kind: 'milestone', startDate: null, endDate: null });
  await create(request, 'time-entries', { taskId: future.id, resourceId: own.id, date: '2026-10-05', hours: 5 });
  await create(request, 'tasks', { projectId: foreign.id, title: 'Tâche étrangère invisible', allocatedHours: 1000, startDate: '2026-01-01', endDate: '2026-01-02' });
  const axes: StrategicAxis[] = [];
  for (const [index, color] of ['#31113c', '#492395', '#243238', '#126ba1'].entries()) axes.push(await create<StrategicAxis>(request, 'strategic-axes', { code: prefix + ' AXE ' + index, name: 'Axe ' + index, color, weight: index + 2, scale: ['Très incohérent', 'Peu cohérent', 'Neutre', 'Cohérent', 'Très cohérent'] }));
  expect((await request.patch('/api/projects/' + project.id, { data: { strategicRatings: Object.fromEntries(axes.map((axis, index) => [axis.id, [1, 2, -1, 0][index]])) } })).ok()).toBeTruthy();
  const report = (owner: Project, title: string, date: string) => create<ProjectReport>(request, 'project-reports', { projectId: owner.id, title, templateId: null, templateName: 'Modèle simple', reportDate: date, indicators: [{ id: 'quality', label: 'Qualité', rating: 4 }], fields: [{ id: 'facts', label: 'Faits marquants', type: 'text', value: 'Décisions conservées.' }] });
  const latest = await report(project, prefix + ' Compte rendu récent', '2026-10-06'); await report(project, prefix + ' Compte rendu ancien', '2026-10-02'); const foreignReport = await report(foreign, 'Compte rendu étranger invisible', '2026-10-06');
  return { project, foreign, own, other, done, late, future, peerFuture, peerLate, undated, milestone, latest, foreignReport };
}
function card(page: Page, name: string) { return page.getByRole('region', { name, exact: true }); }
async function screenshot(page: Page, name: string) { const filename = 'project-summary-' + name + '.png'; await page.screenshot({ path: test.info().project.testDir.endsWith('cloudflare-browser') ? test.info().outputPath(filename) : 'docs/screenshots/' + filename, fullPage: true, animations: 'disabled' }); }

test('synthèse projet : cartes chiffrées, comptes rendus et jalons du seul projet, filtres personnels indépendants et coches persistantes', async ({ page, request }) => {
  const f = await fixture(request, 'Synthèse cartes'); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await page.setViewportSize({ width: 1920, height: 1080 }); await page.goto('/#project/' + f.project.id + '/summary');
  const reports = card(page, 'Derniers comptes rendus'); await expect(reports.getByRole('button', { name: f.latest.title, exact: true })).toBeVisible(); await expect(reports.getByRole('button', { name: f.foreignReport.title, exact: true })).toHaveCount(0);
  await expect(card(page, 'Stratégie du projet').locator('.ci-score-pill')).toHaveText('4'); await page.getByRole('button', { name: 'Afficher les autres axes stratégiques', exact: true }).click(); await expect(card(page, 'Stratégie du projet').locator('.pzs-axis-tag')).toHaveCount(4); await page.getByRole('button', { name: 'Réduire les axes stratégiques', exact: true }).click();
  const activity = card(page, 'Suivi de l’activité'); await expect(activity.locator('[data-metric="allocated"]')).toHaveText('28 h'); await expect(activity.locator('[data-metric="spent"]')).toHaveText('5 h'); await expect(activity.locator('[data-metric="remaining"]')).toHaveText('23 h'); await expect(activity.locator('[data-metric="completed"]')).toHaveText('1 / 6'); await expect(activity.locator('[data-metric="milestones"]')).toHaveText('1 / 4');
  await expect(activity.locator('[data-metric="realized"] strong')).toHaveText('39,29 %'); await expect(activity.locator('[data-metric="late"] strong')).toHaveText('32,14 %'); await expect(activity.locator('[data-metric="open"] strong')).toHaveText('28,57 %');
  const upcoming = card(page, 'Tâches à venir'); const late = card(page, 'Tâches en retard'); await expect(upcoming.locator('[data-task-id]')).toHaveCount(3); await expect(late.locator('[data-task-id]')).toHaveCount(2);
  await upcoming.getByRole('switch', { name: 'Voir uniquement mes tâches à venir', exact: true }).check(); await expect(upcoming.locator('[data-task-id]')).toHaveCount(1); await expect(late.locator('[data-task-id]')).toHaveCount(2); await late.getByRole('switch', { name: 'Voir uniquement mes tâches en retard', exact: true }).check(); await expect(late.locator('[data-task-id]')).toHaveCount(1); await expect(activity.locator('[data-metric="allocated"]')).toHaveText('28 h');
  await upcoming.getByRole('switch', { name: 'Voir uniquement mes tâches à venir', exact: true }).uncheck(); await late.getByRole('switch', { name: 'Voir uniquement mes tâches en retard', exact: true }).uncheck(); await screenshot(page, 'desktop');
  await card(page, 'Jalons du projet').getByRole('button').filter({ hasText: f.milestone.title }).click(); let dialog = page.getByRole('dialog', { name: 'Détail de la tâche', exact: true }); await expect(dialog).toContainText(f.project.name); await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
  await upcoming.getByRole('checkbox', { name: 'Terminer ' + f.future.title, exact: true }).click(); await expect(upcoming.locator('[data-task-id]')).toHaveCount(2); await expect(activity.locator('[data-metric="completed"]')).toHaveText('2 / 6');
  const data = await state(request); expect(data.tasks.find(task => task.id === f.future.id)).toMatchObject({ status: 'done', progress: 100, projectId: f.project.id }); await page.reload(); await expect(activity.locator('[data-metric="completed"]')).toHaveText('2 / 6'); expect(errors).toEqual([]);
});

test('synthèse projet : édition réelle, barre d’accès projet, lecture de compte rendu et actions bleu/orange', async ({ page, request }) => {
  const f = await fixture(request, 'Synthèse actions'); await page.goto('/#project/' + f.project.id + '/summary');
  await page.getByRole('button', { name: 'Modifier la description du projet', exact: true }).click(); let dialog = page.getByRole('dialog', { name: 'Paramètres du projet', exact: true }); await dialog.getByRole('textbox', { name: 'Description', exact: true }).fill('Description actualisée depuis la synthèse.'); await dialog.getByRole('button', { name: 'Enregistrer le projet', exact: true }).click(); await expect(dialog).not.toBeVisible(); await expect(card(page, 'Description du projet')).toContainText('Description actualisée depuis la synthèse.');
  await page.getByRole('button', { name: 'Modifier l’évaluation stratégique', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'Paramètres du projet', exact: true }); await expect(dialog.getByRole('combobox', { name: /^Évaluation Synthèse actions AXE/i })).toHaveCount(4); await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  await card(page, 'Derniers comptes rendus').getByRole('button', { name: f.latest.title, exact: true }).click(); dialog = page.getByRole('dialog', { name: 'Compte rendu du projet', exact: true }); await expect(dialog).toContainText('Décisions conservées.'); await dialog.getByRole('button', { name: 'Fermer le compte rendu', exact: true }).click();
  await page.getByRole('button', { name: 'Créer un compte rendu', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'Créer un compte rendu', exact: true }); await expect(dialog).toContainText(f.project.name); await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  await page.getByRole('button', { name: 'Rapport flash', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'Rapport flash', exact: true }); await expect(dialog).toContainText(f.project.name); await expect(dialog).not.toContainText(f.foreign.name); await dialog.getByRole('button', { name: 'Fermer le rapport flash', exact: true }).click();
  for (const [label, path] of [['Équipe', 'team'], ['Discussions', 'discussions'], ['Documents', 'documents'], ['Budget', 'budget'], ['Rapports', 'reports']]) {
    const link = page.getByRole('navigation', { name: 'Accès du projet', exact: true }).getByRole('link', { name: new RegExp(label) }); await link.click(); await expect(page).toHaveURL(new RegExp(path === 'reports' ? '#reports/' + f.project.id + '$' : '#project/' + f.project.id + '/' + path + '$')); await page.goto('/#project/' + f.project.id + '/summary');
  }
});

test('synthèse projet : vide, sans allocation, projet verrouillé et mise en page mobile accessible', async ({ page, request }) => {
  const f = await fixture(request, 'Synthèse mobile'); await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/#project/' + f.project.id + '/summary'); await expect(card(page, 'Tâches à venir')).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); await screenshot(page, 'mobile');
  expect((await request.patch('/api/projects/' + f.project.id, { data: { status: 'paused' } })).ok()).toBeTruthy(); await page.reload(); await expect(page.getByRole('button', { name: 'Créer un compte rendu', exact: true })).toBeDisabled(); await expect(card(page, 'Tâches en retard').getByRole('checkbox', { name: 'Terminer ' + f.late.title, exact: true })).toBeDisabled(); await expect(page.getByRole('button', { name: 'Rapport flash', exact: true })).toBeEnabled();
  const data = await state(request); const empty = await create<Project>(request, 'projects', { zoneId: data.zones[0].id, name: 'Synthèse vide', startDate: '2026-10-01', endDate: '2026-10-01' }); await page.goto('/#project/' + empty.id + '/summary'); await page.reload(); await expect(card(page, 'Suivi de l’activité').locator('[data-metric="realized"] strong')).toHaveText('—'); await expect(card(page, 'Jalons du projet')).toContainText('Aucun jalon défini.'); await expect(card(page, 'Derniers comptes rendus')).toContainText('Aucun compte rendu enregistré'); await expect(card(page, 'Description du projet')).toContainText('Aucune description');
  await create(request, 'tasks', { projectId: empty.id, title: 'Sans allocation', allocatedHours: 0, progress: 50, status: 'in_progress', startDate: '2026-10-01', endDate: '2026-10-05' }); await page.reload(); await expect(card(page, 'Suivi de l’activité').locator('[data-metric="realized"] strong')).toHaveText('50 %'); await expect(card(page, 'Suivi de l’activité')).toContainText('Activité calculée par tâche'); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
