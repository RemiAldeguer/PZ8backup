import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { loginTestAdmin } from '../auth-fixture';
import type { AppData, Project, ProjectTaskList, Task } from '../../shared/types';
import { buildProjectTaskListTree, orderedTaskListItems } from '../../shared/task-lists';

test.beforeEach(async ({ page, request }) => { await loginTestAdmin(page.request); await loginTestAdmin(request); });
async function state(request: APIRequestContext): Promise<AppData> { const response = await request.get('/api/state'); expect(response.ok()).toBeTruthy(); return response.json(); }
async function create<T>(request: APIRequestContext, entity: string, body: unknown): Promise<T> { const response = await request.post(`/api/${entity}`, { data: body }); expect(response.ok(), await response.text()).toBeTruthy(); return response.json(); }
async function fixture(request: APIRequestContext, name: string) {
  const data = await state(request);
  const project = await create<Project>(request, 'projects', { name, zoneId: data.zones[0].id, startDate: '2026-10-01', endDate: '2027-12-31' });
  const a = await create<ProjectTaskList>(request, 'task-lists', { projectId: project.id, name: `${name} A` });
  const b = await create<ProjectTaskList>(request, 'task-lists', { projectId: project.id, name: `${name} B` });
  const child = await create<ProjectTaskList>(request, 'task-lists', { projectId: project.id, name: `${name} enfant`, parentId: a.id });
  const task = await create<Task>(request, 'tasks', { projectId: project.id, title: `${name} tâche`, phase: 'Sans phase', allocatedHours: 8 });
  const milestone = await create<Task>(request, 'tasks', { projectId: project.id, title: `${name} jalon`, phase: 'Sans phase', kind: 'milestone' });
  const nested = await create<Task>(request, 'tasks', { projectId: project.id, title: `${name} tâche imbriquée`, listId: child.id, allocatedHours: 20 });
  return { project, a, b, child, task, milestone, nested };
}
const listRow = (page: Page, list: ProjectTaskList) => page.locator(`.nlv-list-row[data-list-id="${list.id}"]`);
const taskRow = (page: Page, task: Task) => page.locator(`.nlv-task-row[data-task-id="${task.id}"]`);
const handle = (page: Page, type: 'tâche' | 'liste', name: string) => page.getByRole('button', { name: `Déplacer la ${type} ${name}`, exact: true });
async function mouseGesture(page: Page, source: Locator, target: Locator, placement: 'before' | 'inside' | 'after' = 'inside') {
  const start = await source.boundingBox(); const rect = await target.boundingBox(); expect(start).not.toBeNull(); expect(rect).not.toBeNull();
  await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2); await page.mouse.down();
  await page.mouse.move(rect!.x + Math.min(180, rect!.width / 2), rect!.y + (placement === 'before' ? 4 : placement === 'after' ? rect!.height - 4 : rect!.height / 2), { steps: 15 });
}
async function drag(page: Page, source: Locator, target: Locator, placement: 'before' | 'inside' | 'after' = 'inside') {
  await mouseGesture(page, source, target, placement);
  const response = page.waitForResponse(response => response.url().endsWith('/api/project-item-moves') && response.request().method() === 'POST');
  await page.mouse.up(); expect((await response).status()).toBe(200);
  await expect(page.locator('.nlv-table-scroll')).not.toHaveAttribute('inert', '');
}
function rootNames(data: AppData, id: string) { const tree = buildProjectTaskListTree(data, id); return orderedTaskListItems(tree.rootTasks, tree.roots).map(item => item.type === 'task' ? item.task.title : item.node.name); }
async function screenshot(page: Page, name: string) { const filename = `project-item-moves-${name}.png`; await page.screenshot({ path: test.info().project.testDir.endsWith('cloudflare-browser') ? test.info().outputPath(filename) : `docs/screenshots/${filename}`, fullPage: true, animations: 'disabled' }); }

test('glisser-déposer : tâches et jalons dans une liste repliée, avant et après une liste, ordre conservé au rechargement', async ({ page, request }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const f = await fixture(request, 'Déplacement tâches');
  await page.goto(`/#project/${f.project.id}/list`);
  await page.getByRole('button', { name: `Replier la liste ${f.a.name}`, exact: true }).click();
  await drag(page, handle(page, 'tâche', f.task.title), listRow(page, f.a));
  expect((await state(request)).tasks.find(task => task.id === f.task.id)!.listId).toBe(f.a.id);
  await expect(taskRow(page, f.task)).toHaveAttribute('data-depth', '1');
  await drag(page, handle(page, 'tâche', f.task.title), listRow(page, f.a), 'before');
  await drag(page, handle(page, 'tâche', f.milestone.title), listRow(page, f.a), 'after');
  expect(rootNames(await state(request), f.project.id)).toEqual([f.task.title, f.a.name, f.milestone.title, f.b.name]);
  await expect(taskRow(page, f.milestone)).toHaveAttribute('data-depth', '0');
  const actualRootOrder = await page.locator('.nlv-table tbody tr[data-depth="0"]').evaluateAll(rows => rows.map(row => row.getAttribute('data-task-id') ?? row.getAttribute('data-list-id')));
  expect(actualRootOrder).toEqual([f.task.id, f.a.id, f.milestone.id, f.b.id]);
  await page.reload(); await expect(taskRow(page, f.milestone)).toBeVisible();
  await drag(page, handle(page, 'tâche', f.milestone.title), page.locator('.nlv-root-drop'));
  expect(rootNames(await state(request), f.project.id)).toEqual([f.task.title, f.a.name, f.b.name, f.milestone.title]);
  await page.setViewportSize({ width: 1920, height: 1080 }); await screenshot(page, 'mixed-order-desktop');
  expect(errors).toEqual([]);
});

test('glisser-déposer : liste entière avec descendants, avant/après au même niveau, cycle et projet verrouillé refusés', async ({ page, request }) => {
  const f = await fixture(request, 'Déplacement listes'); await page.goto(`/#project/${f.project.id}/list`);
  await drag(page, handle(page, 'liste', f.a.name), listRow(page, f.b));
  let data = await state(request); expect(data.taskLists!.find(list => list.id === f.a.id)!.parentId).toBe(f.b.id); expect(data.taskLists!.find(list => list.id === f.child.id)!.parentId).toBe(f.a.id); expect(data.tasks.find(task => task.id === f.nested.id)!.listId).toBe(f.child.id);
  await expect(taskRow(page, f.nested)).toHaveAttribute('data-depth', '3');
  let writes = 0; page.on('request', req => { if (req.url().endsWith('/api/project-item-moves') && req.method() === 'POST') writes++; });
  await mouseGesture(page, handle(page, 'liste', f.a.name), listRow(page, f.child));
  await expect(page.locator('.nlv-drop-inside')).toHaveCount(0); await page.mouse.up();
  expect(writes).toBe(0); expect((await state(request)).taskLists!.find(list => list.id === f.a.id)!.parentId).toBe(f.b.id);
  await drag(page, handle(page, 'liste', f.a.name), listRow(page, f.b), 'after');
  await drag(page, handle(page, 'liste', f.b.name), listRow(page, f.a), 'after');
  data = await state(request); expect(rootNames(data, f.project.id)).toEqual([f.task.title, f.milestone.title, f.a.name, f.b.name]);
  const updated = await request.patch(`/api/projects/${f.project.id}`, { data: { status: 'paused' } }); expect(updated.ok()).toBeTruthy(); await page.reload();
  await expect(handle(page, 'liste', f.a.name)).toBeDisabled(); await expect(handle(page, 'tâche', f.task.title)).toBeDisabled();
  expect((await request.post('/api/project-item-moves', { data: { projectId: f.project.id, source: { type: 'task', id: f.task.id }, target: { type: 'list', id: f.a.id }, placement: 'inside' } })).status()).toBe(409);
});

test('glisser-déposer : repère visuel pendant le geste, dépôt validé et poignée consultable au clavier', async ({ page, request }) => {
  const f = await fixture(request, 'Repères de déplacement'); await page.setViewportSize({ width: 1920, height: 1080 }); await page.goto(`/#project/${f.project.id}/list`);
  const source = await handle(page, 'tâche', f.task.title).boundingBox(); const target = await listRow(page, f.a).boundingBox(); expect(source).not.toBeNull(); expect(target).not.toBeNull();
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
  await page.mouse.down();
  await page.mouse.move(target!.x + 180, target!.y + target!.height / 2, { steps: 15 });
  await expect(listRow(page, f.a)).toHaveClass(/nlv-drop-inside/); await expect(page.locator('.nlv-drag-announcement')).toContainText(`Dans la liste ${f.a.name}`);
  expect(await listRow(page, f.a).locator('td').first().evaluate(cell => getComputedStyle(cell).backgroundColor)).toBe('rgb(255, 240, 226)');
  await screenshot(page, 'drop-indicator-desktop');
  const response = page.waitForResponse(response => response.url().endsWith('/api/project-item-moves') && response.request().method() === 'POST');
  await page.mouse.up(); expect((await response).status()).toBe(200);
  await expect(page.locator('.nlv-table-scroll')).not.toHaveAttribute('inert', '');
  await handle(page, 'tâche', f.task.title).focus(); await page.keyboard.press('Enter'); await expect(page.getByRole('dialog', { name: 'Déplacer l’élément', exact: true })).toBeVisible(); await page.keyboard.press('Escape');
});

test('glisser-déposer : phases historiques converties sans perte, ordre avec une recherche et colonnes réordonnées', async ({ page, request }) => {
  const f = await fixture(request, 'Déplacement phases');
  const legacy = await create<Task>(request, 'tasks', { projectId: f.project.id, title: 'Atelier historique', phase: 'Phase historique', allocatedHours: 11 });
  await create(request, 'comments', { taskId: legacy.id, body: 'Commentaire conservé' });
  const before = await state(request); await page.goto(`/#project/${f.project.id}/list`);
  await drag(page, handle(page, 'liste', 'Phase historique'), listRow(page, f.a));
  let data = await state(request); const converted = data.taskLists!.find(list => list.projectId === f.project.id && list.name === 'Phase historique')!;
  expect(converted.parentId).toBe(f.a.id); expect(data.tasks.find(task => task.id === legacy.id)!.listId).toBe(converted.id); expect(data.comments).toEqual(before.comments);
  await page.getByRole('button', { name: 'Configurer les colonnes', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Configurer les colonnes', exact: true });
  await dialog.getByRole('button', { name: 'Déplacer Tâche vers la droite', exact: true }).click(); await dialog.getByRole('button', { name: 'Appliquer', exact: true }).click();
  await page.getByRole('textbox', { name: 'Rechercher une tâche ou une liste', exact: true }).fill('Atelier historique');
  await drag(page, handle(page, 'tâche', legacy.title), listRow(page, f.a), 'before');
  data = await state(request); expect(data.tasks.find(task => task.id === legacy.id)!.listId).toBeNull();
  await page.getByRole('button', { name: 'Réinitialiser', exact: true }).click();
  await page.getByRole('combobox', { name: 'Trier les tâches', exact: true }).selectOption('title');
  await expect(handle(page, 'tâche', legacy.title)).toHaveAttribute('data-drag-enabled', 'true');
  await handle(page, 'tâche', legacy.title).click(); const move = page.getByRole('dialog', { name: 'Déplacer l’élément', exact: true });
  await move.getByRole('combobox', { name: 'Destination', exact: true }).selectOption(`list:${f.a.id}`); await move.getByRole('combobox', { name: 'Emplacement', exact: true }).selectOption('after'); await move.getByRole('button', { name: 'Déplacer', exact: true }).click();
  await expect(move).not.toBeVisible(); await expect(page.getByRole('combobox', { name: 'Trier les tâches', exact: true })).toHaveValue('none');
});

test('glisser-déposer : geste souris sur les noms de tâche et de liste, même avec un tri actif', async ({ page, request }) => {
  const f = await fixture(request, 'Déplacement par nom'); await page.goto(`/#project/${f.project.id}/list`);
  const source = taskRow(page, f.task).locator('.nlv-task-name');
  const start = await source.boundingBox(); const end = await listRow(page, f.a).boundingBox(); expect(start).not.toBeNull(); expect(end).not.toBeNull();
  await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2); await page.mouse.down();
  await page.mouse.move(end!.x + 180, end!.y + end!.height / 2, { steps: 15 });
  await expect(listRow(page, f.a)).toHaveClass(/nlv-drop-inside/);
  const response = page.waitForResponse(response => response.url().endsWith('/api/project-item-moves') && response.request().method() === 'POST');
  await page.mouse.up(); expect((await response).status()).toBe(200);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await state(request)).tasks.find(task => task.id === f.task.id)!.listId).toBe(f.a.id);
  await page.getByRole('combobox', { name: 'Trier les tâches', exact: true }).selectOption('title');
  await drag(page, listRow(page, f.a).locator('.nlv-list-name > strong'), listRow(page, f.b));
  await expect(page.getByRole('combobox', { name: 'Trier les tâches', exact: true })).toHaveValue('none');
  expect((await state(request)).taskLists!.find(list => list.id === f.a.id)!.parentId).toBe(f.b.id);
  await drag(page, taskRow(page, f.task).locator('.nlv-task-name'), listRow(page, f.b), 'before');
  await drag(page, listRow(page, f.a).locator('.nlv-list-name > strong'), listRow(page, f.b), 'after');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload(); await expect(taskRow(page, f.task)).toHaveAttribute('data-depth', '0');
  expect(rootNames(await state(request), f.project.id)).toEqual([f.milestone.title, f.task.title, f.b.name, f.a.name]);
  await taskRow(page, f.task).locator('.nlv-task-name').click(); await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape');
});

test('glisser-déposer : annulation, dépôt hors du tableau et geste souris rapide sans ouverture de fiche', async ({ page, request }) => {
  const f = await fixture(request, 'Déplacement annulé'); await page.goto(`/#project/${f.project.id}/list`);
  let writes = 0; page.on('request', req => { if (req.url().endsWith('/api/project-item-moves') && req.method() === 'POST') writes++; });
  await mouseGesture(page, taskRow(page, f.task).locator('.nlv-task-name'), listRow(page, f.a));
  await expect(listRow(page, f.a)).toHaveClass(/nlv-drop-inside/);
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.locator('.nlv-dragging')).toHaveCount(0); await expect(page.getByRole('dialog')).toHaveCount(0); expect(writes).toBe(0);
  const grip = await handle(page, 'tâche', f.task.title).boundingBox(); expect(grip).not.toBeNull();
  await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2); await page.mouse.down(); await page.mouse.move(800, 20); await page.mouse.up();
  await expect(page.locator('.nlv-dragging')).toHaveCount(0); await expect(page.getByRole('dialog')).toHaveCount(0); expect(writes).toBe(0);
  expect((await state(request)).tasks.find(task => task.id === f.task.id)).toEqual(f.task);
  const target = await listRow(page, f.a).boundingBox(); expect(target).not.toBeNull();
  await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2); await page.mouse.down();
  await page.mouse.move(target!.x + 180, target!.y + target!.height / 2);
  await expect(listRow(page, f.a)).toHaveClass(/nlv-drop-inside/);
  const response = page.waitForResponse(response => response.url().endsWith('/api/project-item-moves') && response.request().method() === 'POST');
  await page.mouse.up(); expect((await response).status()).toBe(200); await expect(page.locator('.nlv-table-scroll')).not.toHaveAttribute('inert', '');
  expect(writes).toBe(1); await expect(page.getByRole('dialog')).toHaveCount(0);
  await taskRow(page, f.task).locator('.nlv-task-name').click(); await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape');
});

test('glisser-déposer : gestes tactiles, déplacement au clavier, tableau mobile contenu et sidebar sans entrée Projets', async ({ page, request }) => {
  const f = await fixture(request, 'Déplacement mobile'); await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`/#project/${f.project.id}/list`);
  await handle(page, 'tâche', f.task.title).click(); const move = page.getByRole('dialog', { name: 'Déplacer l’élément', exact: true });
  await move.getByRole('combobox', { name: 'Destination', exact: true }).selectOption(`list:${f.a.id}`); await move.getByRole('button', { name: 'Déplacer', exact: true }).click(); await expect(move).not.toBeVisible();
  expect((await state(request)).tasks.find(task => task.id === f.task.id)!.listId).toBe(f.a.id);
  await listRow(page, f.b).scrollIntoViewIfNeeded();
  const touchSource = await handle(page, 'tâche', f.milestone.title).boundingBox(); const touchTarget = await listRow(page, f.b).boundingBox(); expect(touchSource).not.toBeNull(); expect(touchTarget).not.toBeNull();
  const cdp = await page.context().newCDPSession(page);
  const start = { x: touchSource!.x + touchSource!.width / 2, y: touchSource!.y + touchSource!.height / 2 };
  const end = { x: Math.min(touchTarget!.x + 130, 300), y: touchTarget!.y + touchTarget!.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  for (let step = 1; step <= 5; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + (end.x - start.x) * step / 5, y: start.y + (end.y - start.y) * step / 5 }] });
  const touchResponse = page.waitForResponse(response => response.url().endsWith('/api/project-item-moves') && response.request().method() === 'POST');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); expect((await touchResponse).status()).toBe(200); await cdp.detach();
  expect((await state(request)).tasks.find(task => task.id === f.milestone.id)!.listId).toBe(f.b.id);
  await expect(page.locator('.nlv-table-scroll')).not.toHaveAttribute('inert', '');
  await page.getByRole('button', { name: 'Ouvrir le menu', exact: true }).click(); const sidebar = page.getByRole('complementary', { name: 'Navigation principale', exact: true });
  await expect(sidebar.getByRole('button', { name: 'Mes projets', exact: true })).toHaveCount(0); await expect(sidebar.getByRole('button', { name: 'Tous les projets, toutes les zones', exact: true })).toBeVisible();
  await sidebar.getByRole('button', { name: 'Tous les projets, toutes les zones', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Tous les projets', exact: true })).toBeVisible();
  await page.goto(`/#project/${f.project.id}/list`); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); await screenshot(page, 'mobile');
});


test('listes imbriquées : action Imbriquer vers une sous-liste, descendants conservés, cycles exclus et verrou respecté', async ({ page, request }) => {
  const f = await fixture(request, 'Imbrication explicite');
  const target = await create<ProjectTaskList>(request, 'task-lists', { projectId: f.project.id, name: 'Destination profonde', parentId: f.b.id });
  await create(request, 'comments', { taskId: f.nested.id, body: 'Commentaire à conserver' });
  const before = await state(request); await page.goto(`/#project/${f.project.id}/list`);
  const button = page.getByRole('button', { name: `Imbriquer la liste ${f.a.name}`, exact: true }); await button.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Imbriquer la liste', exact: true }); await expect(dialog).toBeVisible();
  const select = dialog.getByRole('combobox', { name: 'Liste de destination', exact: true });
  const options = await select.locator('option').evaluateAll(nodes => nodes.map(node => (node as HTMLOptionElement).value));
  expect(options).not.toContain(`list:${f.a.id}`); expect(options).not.toContain(`list:${f.child.id}`); expect(options).not.toContain('root'); expect(options.some(value => value.startsWith('task:'))).toBe(false);
  await expect(dialog.getByRole('button', { name: 'Imbriquer', exact: true })).toBeDisabled();
  await expect(select.locator(`option[value="list:${target.id}"]`)).toHaveText(`Liste : ${f.b.name} / ${target.name}`);
  await select.selectOption(`list:${target.id}`); await dialog.getByRole('button', { name: 'Imbriquer', exact: true }).click(); await expect(dialog).not.toBeVisible();
  const data = await state(request); expect(data.taskLists!.find(list => list.id === f.a.id)!.parentId).toBe(target.id);
  expect(data.taskLists!.find(list => list.id === f.child.id)!.parentId).toBe(f.a.id); expect(data.tasks.find(task => task.id === f.nested.id)!.listId).toBe(f.child.id); expect(data.comments).toEqual(before.comments); expect(data.timeEntries).toEqual(before.timeEntries);
  await expect(taskRow(page, f.nested)).toHaveAttribute('data-depth', '4'); await page.reload(); await expect(taskRow(page, f.nested)).toHaveAttribute('data-depth', '4');
  await page.getByRole('button', { name: `Imbriquer la liste ${f.b.name}`, exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Imbriquer', exact: true })).toBeDisabled(); await expect(dialog).toContainText('Créez une autre liste');
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  expect((await request.patch(`/api/projects/${f.project.id}`, { data: { status: 'paused' } })).ok()).toBeTruthy(); await page.reload(); await expect(button).toBeDisabled();
});

test('listes imbriquées : Imbriquer une liste existante dans une phase historique depuis un écran mobile', async ({ page, request }) => {
  const f = await fixture(request, 'Parent historique');
  const legacy = await create<Task>(request, 'tasks', { projectId: f.project.id, title: 'Tâche de la phase destinataire', phase: 'Phase destinataire', allocatedHours: 11 });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`/#project/${f.project.id}/list`);
  await page.getByRole('button', { name: `Imbriquer la liste ${f.a.name}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Imbriquer la liste', exact: true });
  await dialog.getByRole('combobox', { name: 'Liste de destination', exact: true }).selectOption('phase:Phase destinataire');
  await dialog.getByRole('button', { name: 'Imbriquer', exact: true }).click(); await expect(dialog).not.toBeVisible();
  const data = await state(request); const parent = data.taskLists!.find(list => list.projectId === f.project.id && list.name === 'Phase destinataire')!;
  expect(data.taskLists!.find(list => list.id === f.a.id)!.parentId).toBe(parent.id); expect(data.tasks.find(task => task.id === legacy.id)!.listId).toBe(parent.id); expect(data.tasks.find(task => task.id === f.nested.id)!.listId).toBe(f.child.id);
  await page.reload(); await expect(listRow(page, f.a)).toHaveAttribute('data-depth', '1'); await expect(taskRow(page, f.nested)).toHaveAttribute('data-depth', '3');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
