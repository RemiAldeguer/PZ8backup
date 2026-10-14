import { mkdirSync } from 'node:fs';
import { test, expect, type APIRequestContext, type Page, type Locator } from '@playwright/test';
import type { AppData, Project, Task, ProjectTaskList, Resource, ProjectReport } from '../../shared/types';
import type { CustomFieldDefinition } from '../../shared/customization';
import { loginTestAdmin } from '../auth-fixture';

async function state(request: APIRequestContext): Promise<AppData> { const r = await request.get('/api/state'); expect(r.ok()).toBe(true); return r.json(); }
async function create<T>(request: APIRequestContext, entity: string, data: unknown): Promise<T> { const r = await request.post('/api/' + entity, { data }); expect(r.ok(), await r.text()).toBe(true); return r.json(); }
async function patch(request: APIRequestContext, entity: string, id: string, data: unknown) { const r = await request.patch('/api/' + entity + '/' + id, { data }); expect(r.ok(), await r.text()).toBe(true); }
async function fixture(request: APIRequestContext, name: string) {
  const data = await state(request);
  const project = await create<Project>(request, 'projects', { name, zoneId: data.zones[0].id, startDate: '2026-10-01', endDate: '2026-10-31', description: 'Projet de recette des gestes et du rapport.', portfolioNames: ['Portefeuille pilote'], weather: 5, budget: 600 });
  const list = await create<ProjectTaskList>(request, 'task-lists', { projectId: project.id, name: 'Préparation ' + name });
  const a = await create<Task>(request, 'tasks', { projectId: project.id, listId: list.id, title: 'Cadrage ' + name, startDate: '2026-10-03', endDate: '2026-10-06', allocatedHours: 12, tags: ['Pilote'], progress: 25 });
  const b = await create<Task>(request, 'tasks', { projectId: project.id, listId: list.id, title: 'Recette ' + name, startDate: '2026-10-12', endDate: '2026-10-16', allocatedHours: 20 });
  const milestone = await create<Task>(request, 'tasks', { projectId: project.id, title: 'Jalon ' + name, kind: 'milestone', endDate: '2026-10-08' });
  return { project, list, a, b, milestone };
}
const row = (page: Page, task: Task) => page.locator(`.pzg-row[data-task-id="${task.id}"]`);
async function openGantt(page: Page, project: Project) { await page.setViewportSize({ width: 1920, height: 1080 }); await page.goto('/#project/' + project.id + '/gantt'); await page.getByRole('combobox', { name: 'Échelle du Gantt', exact: true }).selectOption('month'); }
async function dragDays(page: Page, handle: Locator, days: number, beforeRelease?: () => Promise<void>) {
  await handle.scrollIntoViewIfNeeded(); const box = await handle.boundingBox(); expect(box).not.toBeNull();
  const pixels = await page.locator('.pzg-track').first().evaluate(element => element.getBoundingClientRect().width / 31);
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2); await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + pixels * days, box!.y + box!.height / 2, { steps: 8 });
  if (beforeRelease) await beforeRelease(); await page.mouse.up();
}
async function currentTask(request: APIRequestContext, task: Task) { return (await state(request)).tasks.find(item => item.id === task.id)!; }
async function screenshot(page: Page, name: string) { mkdirSync('docs/screenshots', { recursive: true }); await page.screenshot({ path: test.info().project.testDir.endsWith('cloudflare-browser') ? test.info().outputPath(name + '.png') : 'docs/screenshots/' + name + '.png', fullPage: true, animations: 'disabled' }); }
test.beforeEach(async ({ page, request }) => { await loginTestAdmin(page.request); await loginTestAdmin(request); });

test('Gantt graphique : étendre, réduire et déplacer les dates sans modifier les autres données, avec Liste synchronisée', async ({ page, request }) => {
  const f = await fixture(request, 'Dates graphiques'); await openGantt(page, f.project);
  const end = page.getByRole('button', { name: 'Modifier la fin de ' + f.a.title, exact: true });
  await dragDays(page, end, 3, async () => { await expect(page.locator('.pzg-date-preview')).toContainText('09 oct.'); });
  await expect.poll(async () => (await currentTask(request, f.a)).endDate).toBe('2026-10-09');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await dragDays(page, page.getByRole('button', { name: 'Modifier le début de ' + f.a.title, exact: true }), 2);
  await expect.poll(async () => (await currentTask(request, f.a)).startDate).toBe('2026-10-05');
  await dragDays(page, row(page, f.a).locator('.pzg-bar'), 2);
  await expect.poll(async () => (await currentTask(request, f.a)).endDate).toBe('2026-10-11');
  const saved = await currentTask(request, f.a); expect(saved.startDate).toBe('2026-10-07'); expect(saved.allocatedHours).toBe(12); expect(saved.tags).toEqual(['Pilote']); expect(saved.progress).toBe(25); expect(saved.dependsOnId).toBeNull();
  await page.goto('/#project/' + f.project.id + '/list'); const dates = page.locator(`.nlv-task-row[data-task-id="${f.a.id}"] [data-column="dates"]`); await expect(dates).toContainText('07/10/2026'); await expect(dates).toContainText('11/10/2026');
  await page.goto('/#project/' + f.project.id + '/gantt'); await expect(row(page, f.a).locator('.pzg-bar')).toHaveAttribute('title', /07 oct\. 2026.*11 oct\. 2026/);
  await screenshot(page, 'gantt-graphical-dates');
});

test('Gantt graphique : annulation, rejet serveur, minimum un jour, clavier, jalon et liaison directe des barres', async ({ page, request }) => {
  const f = await fixture(request, 'Gestes isolés'); await openGantt(page, f.project);
  let writes = 0; page.on('request', req => { if (req.method() === 'PATCH' && req.url().includes('/api/tasks/')) writes++; });
  await dragDays(page, page.getByRole('button', { name: 'Modifier la fin de ' + f.a.title, exact: true }), 2, async () => { await page.keyboard.press('Escape'); });
  expect(writes).toBe(0); expect((await currentTask(request, f.a)).endDate).toBe('2026-10-06'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.route('**/api/tasks/' + f.a.id, route => route.request().method() === 'PATCH' ? route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Planning modifié ailleurs.' }) }) : route.continue());
  await dragDays(page, page.getByRole('button', { name: 'Modifier la fin de ' + f.a.title, exact: true }), 1); await expect(page.locator('.toast')).toContainText('Planning modifié ailleurs'); await expect(page.locator('.pzg-date-preview')).toHaveCount(0); expect((await currentTask(request, f.a)).endDate).toBe('2026-10-06'); await page.unroute('**/api/tasks/' + f.a.id);
  await dragDays(page, page.getByRole('button', { name: 'Modifier le début de ' + f.a.title, exact: true }), 6); await expect.poll(async () => (await currentTask(request, f.a)).startDate).toBe('2026-10-06');
  const finish = page.getByRole('button', { name: 'Modifier la fin de ' + f.a.title, exact: true }); await finish.focus(); await page.keyboard.press('ArrowRight'); await expect.poll(async () => (await currentTask(request, f.a)).endDate).toBe('2026-10-07');
  await finish.click(); const editor = page.getByRole('dialog', { name: 'Modifier les dates du Gantt', exact: true }); await editor.getByLabel('Date de fin', { exact: true }).fill('2026-10-08'); await editor.getByRole('button', { name: 'Enregistrer les dates', exact: true }).click(); await expect(editor).not.toBeVisible();
  await dragDays(page, page.getByRole('button', { name: 'Déplacer la date de ' + f.milestone.title, exact: true }), 2); await expect.poll(async () => (await currentTask(request, f.milestone)).endDate).toBe('2026-10-10'); expect((await currentTask(request, f.milestone)).startDate).toBeNull();
  await page.getByRole('button', { name: 'Relier les barres', exact: true }).click(); await row(page, f.a).locator('.pzg-bar').click(); await row(page, f.b).locator('.pzg-bar').click(); await expect.poll(async () => (await currentTask(request, f.b)).dependsOnId).toBe(f.a.id); expect((await currentTask(request, f.a)).endDate).toBe('2026-10-08');
  const geometry = await page.locator('.pzg-fold, .pzg-fold-tools button').evaluateAll(buttons => buttons.map(button => { const b = button.getBoundingClientRect(); const s = button.querySelector('svg')!.getBoundingClientRect(); return [Math.abs(b.x + b.width / 2 - s.x - s.width / 2), Math.abs(b.y + b.height / 2 - s.y - s.height / 2)]; }));
  for (const offsets of geometry) { expect(offsets[0]).toBeLessThan(1); expect(offsets[1]).toBeLessThan(1); }
});

test('Détails Gantt : coûts de temps et tags réels, champs personnalisés, ordre personnel conservé et défilement commun', async ({ page, request }) => {
  const f = await fixture(request, 'Colonnes personnelles'); const data = await state(request);
  const field = await create<CustomFieldDefinition>(request, 'custom-field-definitions', { name: 'Priorité Gantt recette', scope: 'task', type: 'text', translations: { fr: 'Priorité Gantt recette', en: '' }, options: [] });
  const formula = await create<CustomFieldDefinition>(request, 'custom-field-definitions', { name: 'Charge double recette', scope: 'task', type: 'formula', formula: '{allocatedHours} * 2', translations: { fr: 'Charge double recette', en: '' }, options: [] });
  await patch(request, 'tasks', f.a.id, { assigneeId: data.currentUser.id, customValues: { [field.id]: 'Haute' } });
  await create(request, 'time-entries', { taskId: f.a.id, resourceId: data.currentUser.id, date: '2026-09-28', hours: 2.5, note: 'Temps antérieur inclus' });
  await openGantt(page, f.project); await page.getByRole('button', { name: 'Afficher les détails du Gantt', exact: true }).click(); await expect(row(page, f.a).locator('[data-gantt-column="spent"]')).toContainText('2,5');
  await page.getByRole('button', { name: 'Configurer les colonnes du Gantt', exact: true }).click(); const editor = page.getByRole('dialog', { name: 'Configurer les colonnes du Gantt', exact: true });
  for (const label of ['Tags', 'Responsable', field.name, formula.name]) await editor.getByRole('checkbox', { name: label, exact: label !== field.name && label !== formula.name }).check();
  for (let i = 0; i < 5; i++) await editor.getByRole('button', { name: 'Monter Passé', exact: true }).click();
  await editor.getByRole('button', { name: 'Appliquer', exact: true }).click(); const headers = page.locator('.pzg-details-head > span'); await expect(headers.first()).toHaveText('Passé');
  await expect(row(page, f.a).locator(`[data-gantt-column="custom:${field.id}"]`)).toHaveText('Haute'); await expect(row(page, f.a).locator(`[data-gantt-column="custom:${formula.id}"]`)).toHaveText('24'); await expect(row(page, f.a).locator('[data-gantt-column="tags"]')).toHaveText('Pilote');
  const region = page.getByRole('region', { name: 'Défilement des colonnes Détails du Gantt', exact: true }); await region.evaluate(element => { element.scrollLeft = 300; }); await expect.poll(async () => row(page, f.a).locator('.pzg-details').evaluate(element => getComputedStyle(element).transform)).toContain('-300');
  await page.reload(); await expect(page.getByRole('button', { name: 'Afficher les détails du Gantt', exact: true })).toHaveAttribute('aria-pressed', 'true'); await expect(headers.first()).toHaveText('Passé'); await expect(row(page, f.a).locator(`[data-gantt-column="custom:${field.id}"]`)).toHaveText('Haute');
  await screenshot(page, 'gantt-configurable-details');
  const other = await fixture(request, 'Colonnes indépendantes'); await page.goto('/#project/' + other.project.id + '/gantt'); await page.reload(); await expect(page.getByRole('button', { name: 'Afficher les détails du Gantt', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('rapport flash : présentation du PDF, données du projet, objet et compte rendu choisi identiques dans l’export', async ({ page, request }) => {
  const f = await fixture(request, 'Rapport flash référence');
  const field = await create<CustomFieldDefinition>(request, 'custom-field-definitions', { name: 'Bénéfice du rapport recette', scope: 'project', type: 'rich_text', translations: { fr: 'Bénéfice du rapport recette', en: '' }, options: [] });
  await patch(request, 'projects', f.project.id, { customValues: { [field.id]: '**Gain de visibilité** pour les équipes.' } });
  const report = (projectId: string, title: string, date: string) => create<ProjectReport>(request, 'project-reports', { projectId, title, templateId: null, templateName: 'Modèle de recette', reportDate: date, indicators: [{ id: 'quality', label: 'Qualité', rating: 4 }], fields: [{ id: 'facts', label: 'Faits marquants', type: 'text', value: 'Décision conservée à la date du compte rendu.' }] });
  const older = await report(f.project.id, 'Compte rendu à joindre', '2026-10-05'); await report(f.project.id, 'Dernier compte rendu distinct', '2026-10-06'); const foreign = await fixture(request, 'Projet étranger flash'); await report(foreign.project.id, 'Compte rendu étranger', '2026-10-07');
  await page.goto('/#project/' + f.project.id + '/summary'); await page.getByRole('button', { name: 'Rapport flash', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Rapport flash', exact: true });
  await dialog.getByRole('textbox', { name: 'Objet du rapport', exact: true }).fill('Comité de pilotage du déploiement'); await dialog.getByRole('combobox', { name: 'Compte rendu lié', exact: true }).selectOption(older.id);
  const preview = dialog.locator('.fr-preview'); await expect(preview).toContainText('Comité de pilotage du déploiement'); await expect(preview).toContainText('Gain de visibilité'); await expect(preview).toContainText('Portefeuille pilote'); await expect(preview).toContainText('5/5'); await expect(preview).toContainText('Suivi de l’activité'); await expect(preview).toContainText('Décision conservée à la date du compte rendu'); await expect(preview).not.toContainText('Dernier compte rendu distinct'); await expect(preview).not.toContainText('Compte rendu étranger');
  await screenshot(page, 'flash-report-reference-cover');
  await page.evaluate(() => { window.print = () => window.dispatchEvent(new Event('beforeprint')); }); await dialog.getByRole('button', { name: 'Imprimer / enregistrer en PDF', exact: true }).click(); await page.emulateMedia({ media: 'print' });
  const printable = page.locator('body > .fr-print-report'); await expect(printable).toBeVisible(); await expect(printable).toContainText('Comité de pilotage du déploiement'); await expect(printable).toContainText(older.title); await expect(printable).not.toContainText(foreign.project.name); await expect(dialog).not.toBeVisible();
  await page.pdf({ path: test.info().outputPath('rapport-flash-reference.pdf'), format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint'))); await page.emulateMedia({ media: 'screen' }); await dialog.getByRole('combobox', { name: 'Compte rendu lié', exact: true }).selectOption(''); await expect(preview.locator('.fr-linked-report')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 }); await screenshot(page, 'flash-report-reference-mobile'); expect(await dialog.evaluate(element => element.getBoundingClientRect().right <= window.innerWidth)).toBe(true); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('Gantt dates : projet verrouillé et observateur ne disposent pas des poignées graphiques', async ({ browser, baseURL, page, request }) => {
  const f = await fixture(request, 'Dates protégées'); const member = await create<Resource>(request, 'resources', { name: 'Lecteur des dates', role: 'visitor', projectIds: [f.project.id] }); const username = 'date-observer-' + Date.now().toString(36); const password = 'Date-test-account!2026'; await create(request, 'auth/members', { resourceId: member.id, username, password });
  const context = await browser.newContext({ baseURL }); try { expect((await context.request.post('/api/auth/login', { data: { username, password } })).ok()).toBe(true); const readonly = await context.newPage(); await readonly.goto('/#project/' + f.project.id + '/gantt'); await expect(readonly.locator('.pzg-row[data-task-id]')).not.toHaveCount(0); await expect(readonly.locator('.pzg-date-handle')).toHaveCount(0); expect((await context.request.patch('/api/tasks/' + f.a.id, { data: { endDate: '2026-10-09' } })).status()).toBe(403); } finally { await context.close(); }
  await patch(request, 'projects', f.project.id, { status: 'paused' }); await openGantt(page, f.project); await expect(page.locator('.pzg-date-handle')).toHaveCount(0);
});

test('Gantt tactile : redimensionner une barre avec le doigt et conserver la capture au bord de période', async ({ browser, baseURL, request }) => {
  const f = await fixture(request, 'Poignée tactile'); const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    await loginTestAdmin(context.request); const page = await context.newPage(); await page.goto('/#project/' + f.project.id + '/gantt'); await page.getByRole('combobox', { name: 'Échelle du Gantt', exact: true }).selectOption('month');
    const handle = page.getByRole('button', { name: 'Modifier la fin de ' + f.a.title, exact: true }); await handle.scrollIntoViewIfNeeded();
    await handle.evaluate(element => { const container = element.closest('.pzg-scroll')!; const left = container.querySelector('.pzg-header-name')!.getBoundingClientRect().right; const right = container.getBoundingClientRect().right; const handle = element.getBoundingClientRect(); container.scrollLeft += handle.x + handle.width / 2 - (left + (right - left) * .7); });
    const box = (await handle.boundingBox())!; const pixels = await page.locator('.pzg-track').first().evaluate(element => element.getBoundingClientRect().width / 31);
    const session = await context.newCDPSession(page); const x = box.x + box.width / 2; const y = box.y + box.height / 2;
    expect(await page.evaluate(({x,y}) => !!document.elementFromPoint(x,y)?.closest('.pzg-date-handle'), {x,y})).toBe(true);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 6; step++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - pixels * step / 6, y }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await expect.poll(async () => (await currentTask(request, f.a)).endDate).toBe('2026-10-05'); await expect(page.getByRole('dialog')).toHaveCount(0); await session.detach(); await screenshot(page, 'gantt-resize-touch');
    await page.setViewportSize({ width: 1920, height: 1080 }); await dragDays(page, page.getByRole('button', { name: 'Modifier le début de ' + f.a.title, exact: true }), -3);
    await expect.poll(async () => (await currentTask(request, f.a)).startDate).toBe('2026-09-30'); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.locator('.pzg-date-preview')).toHaveCount(0);
  } finally { await context.close(); }
});
