import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import type { AppData, Project, ProjectTaskList, Resource, Task } from '../../shared/types';
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
async function project(request: APIRequestContext, name: string) {
  const data = await state(request);
  return create<Project>(request, 'projects', {
    name, zoneId: data.zones[0].id, status: 'open', budget: 5000.75,
    startDate: '2026-10-01', endDate: '2027-12-31', description: `Projet isolé de recette : ${name}.`,
  });
}
function task(request: APIRequestContext, owner: Project, title: string, extra: Record<string, unknown> = {}) {
  return create<Task>(request, 'tasks', {
    projectId: owner.id, title, startDate: '2026-10-05', endDate: '2026-10-09',
    allocatedHours: 8, progress: 0, status: 'todo', phase: 'Listes historique', kind: 'task', ...extra,
  });
}
function list(request: APIRequestContext, owner: Project, name: string, parentId: string | null = null) {
  return create<ProjectTaskList>(request, 'task-lists', { projectId: owner.id, name, parentId });
}
const taskRow = (page: Page, item: Task) => page.locator(`.nlv-task-row[data-task-id="${item.id}"]`);
const listRow = (page: Page, item: ProjectTaskList) => page.locator(`.nlv-list-row[data-list-id="${item.id}"]`);
function errorsOf(page: Page) { const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); return errors; }
async function screenshot(page: Page, name: string) {
  const filename = `nested-lists-${name}.png`;
  const path = test.info().project.testDir.endsWith('cloudflare-browser') ? test.info().outputPath(filename) : `docs/screenshots/${filename}`;
  if (name.endsWith('desktop')) await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ path, fullPage: true, animations: 'disabled' });
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
async function createListInUI(page: Page, name: string, parentName?: string) {
  if (parentName) {
    await page.getByRole('button', { name: `Ajouter dans la liste ${parentName}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Sous-liste', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Créer', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Liste', exact: true }).click();
  }
  const dialog = page.getByRole('dialog', { name: 'Créer une liste', exact: true });
  await dialog.getByLabel('Nom de la liste', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Créer la liste', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
async function taskListSelect(dialog: Locator) {
  // The list selector is separate from the legacy phase input retained for older tasks.
  return dialog.getByRole('combobox', { name: 'Liste', exact: true });
}

test('listes imbriquées : phases historiques lisibles sans écriture puis conversion avec sous-liste sans perdre les tâches', async ({ page, request }) => {
  const errors = errorsOf(page);
  const owner = await project(request, 'Listes phases historiques');
  const first = await task(request, owner, 'Listes historique premier élément', { phase: 'Préparation historique', allocatedHours: 16 });
  const second = await task(request, owner, 'Listes historique second élément', { phase: 'Préparation historique', allocatedHours: 24 });
  const other = await task(request, owner, 'Listes historique autre phase', { phase: 'Livraison historique' });
  const before = await state(request);
  await page.goto(`/#project/${owner.id}/list`);
  await expect(page.locator('.nlv-table')).toHaveCount(1);
  await expect(taskRow(page, first)).toBeVisible();
  await expect(taskRow(page, second)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Replier la liste Préparation historique', exact: true })).toBeVisible();
  await page.reload();
  const afterRead = await state(request);
  expect(afterRead.taskLists).toEqual(before.taskLists);
  expect(afterRead.tasks.filter(item => item.projectId === owner.id)).toEqual(before.tasks.filter(item => item.projectId === owner.id));
  await createListInUI(page, 'Listes sous-phase convertie', 'Préparation historique');
  const stored = await state(request);
  const parent = stored.taskLists!.find(item => item.projectId === owner.id && item.name === 'Préparation historique')!;
  const child = stored.taskLists!.find(item => item.projectId === owner.id && item.name === 'Listes sous-phase convertie')!;
  expect(child.parentId).toBe(parent.id);
  for (const original of [first, second]) {
    expect(stored.tasks.find(item => item.id === original.id)).toEqual({ ...original, listId: parent.id });
  }
  expect(stored.tasks.find(item => item.id === other.id)).toEqual(other);
  await expect(listRow(page, child)).toHaveAttribute('data-depth', '1');
  await expect(listRow(page, parent).locator('[data-column="allocated"]')).toContainText('40');
  await page.reload();
  await expect(taskRow(page, first)).toBeVisible();
  await expect(listRow(page, child)).toBeVisible();
  await screenshot(page, 'legacy-conversion-desktop');
  expect(errors).toEqual([]);
});

test('listes imbriquées : création à trois niveaux, tâches et jalons contextualisés, déplacement, renommage et suppression sûre', async ({ page, request }) => {
  test.setTimeout(80_000);
  const errors = errorsOf(page);
  const owner = await project(request, 'Listes hiérarchie modifiable');
  const foreignProject = await project(request, 'Listes projet étranger');
  const foreignList = await list(request, foreignProject, 'Listes étrangères');
  await page.goto(`/#project/${owner.id}/list`);
  await createListInUI(page, 'Listes Formation');
  await createListInUI(page, 'Listes Préparation', 'Listes Formation');
  await createListInUI(page, 'Listes Installation', 'Listes Préparation');
  await createListInUI(page, 'Listes Livraison');
  await createListInUI(page, 'Listes vide à supprimer');
  let stored = await state(request);
  const findList = (name: string) => stored.taskLists!.find(item => item.projectId === owner.id && item.name === name)!;
  const root = findList('Listes Formation');
  const child = findList('Listes Préparation');
  const leaf = findList('Listes Installation');
  const delivery = findList('Listes Livraison');
  const empty = findList('Listes vide à supprimer');
  expect(child.parentId).toBe(root.id); expect(leaf.parentId).toBe(child.id);
  await expect(listRow(page, leaf)).toHaveAttribute('data-depth', '2');
  const lastRowTrigger = page.getByRole('button', { name: `Ajouter dans la liste ${empty.name}`, exact: true });
  await lastRowTrigger.click();
  await withinViewport(page, page.getByRole('menu', { name: `Ajouter dans la liste ${empty.name}`, exact: true }));
  await screenshot(page, 'last-row-menu-desktop');
  await page.getByRole('menuitem', { name: 'Sous-liste', exact: true }).click();
  const emptyEditor = page.getByRole('dialog', { name: 'Créer une liste', exact: true });
  await expect(emptyEditor.getByRole('combobox', { name: 'Liste parente', exact: true })).toHaveValue(empty.id);
  await emptyEditor.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(lastRowTrigger).toBeFocused();
  await page.getByRole('button', { name: `Ajouter dans la liste ${leaf.name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Tâche', exact: true }).click();
  let editor = page.getByRole('dialog', { name: 'Nouvelle tâche', exact: true });
  const selector = await taskListSelect(editor);
  await expect(selector).toHaveValue(`list:${leaf.id}`);
  await editor.getByLabel('Titre', { exact: true }).fill('Listes tâche dans installation');
  await editor.getByLabel('Travail alloué (heures)', { exact: true }).fill('17.5');
  await editor.getByLabel('Début', { exact: true }).fill('2026-10-12');
  await editor.getByLabel('Fin', { exact: true }).fill('2026-10-16');
  await editor.getByRole('button', { name: 'Créer la tâche', exact: true }).click();
  await expect(editor).not.toBeVisible();
  stored = await state(request);
  const created = stored.tasks.find(item => item.projectId === owner.id && item.title === 'Listes tâche dans installation')!;
  expect(created.listId).toBe(leaf.id);
  await expect(taskRow(page, created)).toHaveAttribute('data-depth', '3');
  await expect(page.getByRole('button', { name: `Supprimer la liste ${root.name}`, exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: `Supprimer la liste ${leaf.name}`, exact: true })).toBeDisabled();
  await page.getByRole('button', { name: `Modifier la liste ${child.name}`, exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Modifier la liste', exact: true });
  const parentSelect = dialog.getByRole('combobox', { name: 'Liste parente', exact: true });
  const parentOptions = await parentSelect.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
  expect(parentOptions).not.toContain(child.id); expect(parentOptions).not.toContain(leaf.id); expect(parentOptions).not.toContain(foreignList.id);
  await dialog.getByLabel('Nom de la liste', { exact: true }).fill('Listes Préparation révisée');
  await parentSelect.selectOption(delivery.id);
  await dialog.getByRole('button', { name: 'Enregistrer la liste', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await taskRow(page, created).getByRole('button', { name: created.title, exact: true }).click();
  editor = page.getByRole('dialog', { name: 'Détail de la tâche', exact: true });
  await (await taskListSelect(editor)).selectOption(`list:${root.id}`);
  await editor.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(editor).not.toBeVisible();
  page.once('dialog', confirmation => confirmation.accept());
  await page.getByRole('button', { name: `Supprimer la liste ${empty.name}`, exact: true }).click();
  await expect(listRow(page, empty)).toHaveCount(0);
  await page.reload();
  stored = await state(request);
  expect(stored.taskLists!.find(item => item.id === child.id)).toMatchObject({ name: 'Listes Préparation révisée', parentId: delivery.id });
  expect(stored.tasks.find(item => item.id === created.id)).toMatchObject({ listId: root.id, allocatedHours: 17.5 });
  expect(stored.taskLists!.some(item => item.id === empty.id)).toBe(false);
  await expect(taskRow(page, created)).toHaveAttribute('data-depth', '1');
  await expect(page.locator('.nlv-table')).not.toContainText(foreignList.name);
  await page.getByRole('button', { name: `Ajouter dans la liste ${root.name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Jalon', exact: true }).click();
  editor = page.getByRole('dialog', { name: 'Nouvelle tâche', exact: true });
  await expect(editor.getByRole('combobox', { name: 'Type', exact: true })).toHaveValue('milestone');
  await expect(await taskListSelect(editor)).toHaveValue(`list:${root.id}`);
  await editor.getByLabel('Titre', { exact: true }).fill('Listes jalon de formation');
  await editor.getByLabel('Fin', { exact: true }).fill('2026-10-20');
  await editor.getByRole('button', { name: 'Créer la tâche', exact: true }).click();
  await expect(editor).not.toBeVisible();
  expect((await state(request)).tasks.find(item => item.title === 'Listes jalon de formation')).toMatchObject({ listId: root.id, kind: 'milestone', allocatedHours: 0 });
  await screenshot(page, 'hierarchy-desktop');
  await taskRow(page, created).getByRole('button', { name: created.title, exact: true }).click();
  editor = page.getByRole('dialog', { name: 'Détail de la tâche', exact: true });
  await (await taskListSelect(editor)).selectOption('root');
  await editor.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(taskRow(page, created)).toHaveAttribute('data-depth', '0');
  expect((await state(request)).tasks.find(item => item.id === created.id)).toMatchObject({ listId: null, phase: 'Sans phase', allocatedHours: 17.5 });
  expect(errors).toEqual([]);
});

test('listes imbriquées : agrégats sans doublon, filtres avec ancêtres, repli et colonnes configurées concordantes', async ({ page, request }) => {
  test.setTimeout(65_000);
  const errors = errorsOf(page);
  const owner = await project(request, 'Listes agrégats et filtres');
  const root = await list(request, owner, 'Listes ensemble agrégé');
  const child = await list(request, owner, 'Listes branche agrégée', root.id);
  const leaf = await list(request, owner, 'Listes feuille agrégée', child.id);
  const empty = await list(request, owner, 'Listes vide conservée', root.id);
  const resource = await create<Resource>(request, 'resources', { name: 'Listes personne filtrée' });
  const direct = await task(request, owner, 'Listes tâche racine directe', { listId: root.id, allocatedHours: 10, startDate: '2026-10-05', endDate: '2026-10-06' });
  const nested = await task(request, owner, 'Listes tâche feuille ciblée', { listId: leaf.id, allocatedHours: 20, assigneeId: resource.id, tags: ['Support'], startDate: '2026-10-12', endDate: '2026-10-16' });
  const completed = await task(request, owner, 'Listes tâche branche terminée', { listId: child.id, allocatedHours: 30, status: 'done', progress: 100, startDate: '2026-10-07', endDate: '2026-10-09' });
  await task(request, owner, 'Listes jalon sans charge', { listId: leaf.id, kind: 'milestone', allocatedHours: 0, startDate: '2026-10-20', endDate: '2026-10-20' });
  await page.goto(`/#project/${owner.id}/list`);
  await expect(listRow(page, root).locator('[data-column="allocated"]')).toContainText('60');
  await expect(listRow(page, child).locator('[data-column="allocated"]')).toContainText('50');
  await expect(listRow(page, leaf).locator('[data-column="allocated"]')).toContainText('20');
  await expect(listRow(page, root).locator('.nlv-list-count')).toHaveText('4');
  await expect(listRow(page, child).locator('.nlv-list-count')).toHaveText('3');
  await expect(listRow(page, leaf).locator('.nlv-list-count')).toHaveText('2');
  await expect(listRow(page, root).locator('[data-column="dates"]')).toContainText('05/10');
  await expect(listRow(page, root).locator('[data-column="dates"]')).toContainText('20/10');
  await expect(listRow(page, empty)).toBeVisible();
  await page.getByRole('button', { name: 'Tout replier', exact: true }).click();
  await expect(listRow(page, root)).toBeVisible(); await expect(taskRow(page, nested)).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Rechercher une tâche ou une liste', exact: true }).fill('feuille ciblée');
  await expect(taskRow(page, nested)).toBeVisible();
  for (const ancestor of [root, child, leaf]) await expect(listRow(page, ancestor)).toBeVisible();
  await expect(taskRow(page, direct)).toHaveCount(0); await expect(taskRow(page, completed)).toHaveCount(0);
  await expect(listRow(page, root).locator('[data-column="allocated"]')).toContainText('60');
  await expect(page.locator('.nlv-result-count')).toHaveText('1 élément');
  await page.getByRole('textbox', { name: 'Rechercher une tâche ou une liste', exact: true }).fill('');
  await page.getByRole('button', { name: 'Tout replier', exact: true }).click();
  await page.getByRole('button', { name: 'Tout déplier', exact: true }).click();
  await page.getByRole('combobox', { name: 'Filtrer par responsable', exact: true }).selectOption(resource.id);
  await page.getByRole('combobox', { name: 'Filtrer par statut', exact: true }).selectOption('todo');
  await expect(taskRow(page, nested)).toBeVisible();
  await expect(taskRow(page, direct)).toHaveCount(0);
  await expect(listRow(page, root)).toBeVisible();
  await page.getByRole('combobox', { name: 'Filtrer par responsable', exact: true }).selectOption('all');
  await page.getByRole('combobox', { name: 'Filtrer par statut', exact: true }).selectOption('all');
  await page.getByRole('combobox', { name: 'Filtrer le type d’élément', exact: true }).selectOption('milestone');
  await expect(page.locator('.nlv-task-row')).toHaveCount(1);
  await expect(taskRow(page, nested)).toHaveCount(0);
  await expect(listRow(page, root)).toBeVisible();
  await page.getByRole('combobox', { name: 'Filtrer le type d’élément', exact: true }).selectOption('all');
  await page.getByRole('combobox', { name: 'Trier les tâches', exact: true }).selectOption('title');
  await expect.poll(() => page.locator('.nlv-task-row').evaluateAll(rows => rows.map(row => row.getAttribute('data-task-id')))).toEqual([
    direct.id, completed.id,
    (await state(request)).tasks.find(item => item.projectId === owner.id && item.kind === 'milestone')!.id,
    nested.id,
  ]);
  await page.getByRole('button', { name: 'Configurer les colonnes', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Configurer les colonnes', exact: true });
  await dialog.getByRole('button', { name: 'Déplacer Tags vers la gauche', exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'Responsable', exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Appliquer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const headers = page.locator('.nlv-table thead th[data-column]');
  const expectedColumns = ['task', 'tags', 'status', 'dates', 'allocated'];
  await expect.poll(() => headers.evaluateAll(cells => cells.map(cell => cell.getAttribute('data-column')))).toEqual(expectedColumns);
  for (const row of [listRow(page, root), listRow(page, child), taskRow(page, nested)]) {
    await expect.poll(() => row.locator('td[data-column]').evaluateAll(cells => cells.map(cell => cell.getAttribute('data-column')))).toEqual(expectedColumns);
  }
  await expect(taskRow(page, nested).locator('[data-column="tags"]')).toContainText('Support');
  await page.reload();
  await expect.poll(() => headers.evaluateAll(cells => cells.map(cell => cell.getAttribute('data-column')))).toEqual(expectedColumns);
  await expect(taskRow(page, nested)).toBeVisible();
  await screenshot(page, 'filters-columns-desktop');
  expect(errors).toEqual([]);
});

test('listes imbriquées : cases des tâches persistées, dépendances et projets verrouillés protégés', async ({ page, request }) => {
  const errors = errorsOf(page);
  const owner = await project(request, 'Listes dépendances et verrouillage');
  const root = await list(request, owner, 'Listes contrôlées');
  const child = await list(request, owner, 'Listes contrôlées enfant', root.id);
  const predecessor = await task(request, owner, 'Listes préalable à terminer', { listId: root.id });
  const dependent = await task(request, owner, 'Listes tâche dépendante', { listId: child.id, dependsOnId: predecessor.id });
  await page.goto(`/#project/${owner.id}/list`);
  await taskRow(page, dependent).getByRole('checkbox', { name: `Terminer ${dependent.title}`, exact: true }).click();
  await expect(taskRow(page, dependent).getByRole('checkbox', { name: `Terminer ${dependent.title}`, exact: true })).toHaveAttribute('aria-checked', 'false');
  expect((await state(request)).tasks.find(item => item.id === dependent.id)?.status).toBe('todo');
  await taskRow(page, predecessor).getByRole('checkbox', { name: `Terminer ${predecessor.title}`, exact: true }).click();
  await expect(taskRow(page, predecessor).getByRole('checkbox', { name: `Rouvrir ${predecessor.title}`, exact: true })).toHaveAttribute('aria-checked', 'true');
  await taskRow(page, dependent).getByRole('checkbox', { name: `Terminer ${dependent.title}`, exact: true }).click();
  await expect(taskRow(page, dependent).getByRole('checkbox', { name: `Rouvrir ${dependent.title}`, exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.reload();
  expect((await state(request)).tasks.find(item => item.id === dependent.id)).toMatchObject({ listId: child.id, status: 'done', progress: 100 });
  await patch(request, 'projects', owner.id, { status: 'paused' });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Créer', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: `Ajouter dans la liste ${root.name}`, exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: `Modifier la liste ${child.name}`, exact: true })).toBeDisabled();
  await expect(taskRow(page, dependent).getByRole('checkbox', { name: `Rouvrir ${dependent.title}`, exact: true })).toBeDisabled();
  await page.getByRole('button', { name: `Replier la liste ${root.name}`, exact: true }).click();
  await expect(taskRow(page, dependent)).toHaveCount(0);
  await page.getByRole('button', { name: `Déplier la liste ${root.name}`, exact: true }).click();
  await taskRow(page, dependent).getByRole('button', { name: dependent.title, exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Détail de la tâche', exact: true });
  await expect(await taskListSelect(editor)).toBeDisabled();
  await expect(editor.getByRole('button', { name: 'Enregistrer', exact: true })).toBeDisabled();
  await editor.getByRole('button', { name: 'Fermer', exact: true }).click();
  expect(errors).toEqual([]);
});

test('listes imbriquées : modèle importé du projet et cloné avec listes, affectations et dépendances remappées', async ({ page, request }) => {
  test.setTimeout(60_000);
  const errors = errorsOf(page);
  const source = await project(request, 'Listes source du modèle');
  const root = await list(request, source, 'Listes modèle racine');
  const child = await list(request, source, 'Listes modèle enfant', root.id);
  const leaf = await list(request, source, 'Listes modèle feuille', child.id);
  const empty = await list(request, source, 'Listes modèle vide', root.id);
  const first = await task(request, source, 'Listes modèle premier élément', { listId: root.id, startDate: '2026-10-01', endDate: '2026-10-03', status: 'done', progress: 100, assigneeId: 'resource-claire', tags: ['Conservé'] });
  const next = await task(request, source, 'Listes modèle élément dépendant', { listId: leaf.id, startDate: '2026-10-05', endDate: '2026-10-06', dependsOnId: first.id });
  const outside = await task(request, source, 'Listes modèle ancien élément sans phase', { listId: null, phase: '', allocatedHours: 3 });
  await create(request, 'time-entries', { taskId: first.id, resourceId: 'resource-claire', hours: 2, date: '2026-10-01' });
  await page.goto('/#customization/project-templates');
  await page.getByRole('button', { name: 'Modèle', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Nouveau modèle de projet', exact: true });
  await editor.getByRole('combobox', { name: 'Partir d’un projet existant', exact: true }).selectOption(source.id);
  await editor.getByLabel('Nom du modèle', { exact: true }).fill('Listes modèle arborescence');
  await editor.getByRole('button', { name: 'Créer le modèle', exact: true }).click();
  await expect(editor).not.toBeVisible();
  const before = await state(request);
  const template = before.projectTemplates!.find(item => item.name === 'Listes modèle arborescence')!;
  expect(template.taskLists).toHaveLength(4);
  expect(template.taskLists!.find(item => item.key === leaf.id)?.parentKey).toBe(child.id);
  expect(template.tasks.find(item => item.key === next.id)?.listKey).toBe(leaf.id);
  await page.getByRole('button', { name: 'Créer un projet à partir de Listes modèle arborescence', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouveau projet', exact: true });
  await dialog.getByLabel('Nom du projet', { exact: true }).fill('Listes clone du modèle');
  await dialog.getByLabel('Date de début', { exact: true }).fill('2026-11-02');
  await dialog.getByLabel('Date de fin', { exact: true }).fill('2026-11-30');
  await dialog.getByRole('button', { name: 'Créer le projet', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const saved = await state(request);
  const clone = saved.projects.find(item => item.name === 'Listes clone du modèle')!;
  const clonedLists = saved.taskLists!.filter(item => item.projectId === clone.id);
  const byName = (name: string) => clonedLists.find(item => item.name === name)!;
  expect(clonedLists).toHaveLength(4);
  expect(byName(child.name).parentId).toBe(byName(root.name).id);
  expect(byName(leaf.name).parentId).toBe(byName(child.name).id);
  expect(byName(empty.name).parentId).toBe(byName(root.name).id);
  for (const item of clonedLists) expect([root.id, child.id, leaf.id, empty.id]).not.toContain(item.id);
  const clonedTasks = saved.tasks.filter(item => item.projectId === clone.id);
  const firstClone = clonedTasks.find(item => item.title === first.title)!;
  const nextClone = clonedTasks.find(item => item.title === next.title)!;
  const outsideClone = clonedTasks.find(item => item.title === outside.title)!;
  expect(firstClone).toMatchObject({ listId: byName(root.name).id, startDate: '2026-11-02', endDate: '2026-11-04', status: 'todo', progress: 0, assigneeId: null, tags: ['Conservé'] });
  expect(nextClone).toMatchObject({ listId: byName(leaf.name).id, dependsOnId: firstClone.id, startDate: '2026-11-06', endDate: '2026-11-07' });
  expect(outsideClone).toMatchObject({ listId: null, phase: '', allocatedHours: 3 });
  expect(saved.taskLists!.filter(item => item.projectId === source.id)).toEqual(before.taskLists!.filter(item => item.projectId === source.id));
  expect(saved.timeEntries).toEqual(before.timeEntries);
  await page.goto(`/#project/${clone.id}/list`);
  await page.reload();
  await expect(listRow(page, byName(empty.name))).toBeVisible();
  await expect(taskRow(page, nextClone)).toHaveAttribute('data-depth', '3');
  await expect(taskRow(page, outsideClone)).toHaveAttribute('data-depth', '0');
  await screenshot(page, 'template-desktop');
  expect(errors).toEqual([]);
});

test('listes imbriquées : navigation mobile contenue, défilement du tableau et focus de la modale de création', async ({ page, request }) => {
  const errors = errorsOf(page);
  const owner = await project(request, 'Listes mobile et clavier');
  const root = await list(request, owner, 'Listes mobile racine');
  const child = await list(request, owner, 'Listes mobile enfant', root.id);
  const leaf = await list(request, owner, 'Listes mobile feuille au nom assez long', child.id);
  const item = await task(request, owner, 'Listes mobile élément complet avec libellé assez long', { listId: leaf.id, allocatedHours: 37.5, tags: ['Mobile'] });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/#project/${owner.id}/list`);
  await expect(taskRow(page, item)).toBeVisible();
  await noPageOverflow(page);
  const scroller = page.locator('.lc-table-scroll');
  expect(await scroller.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await screenshot(page, 'mobile-tree');
  await scroller.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await expect(taskRow(page, item).locator('[data-column="allocated"]')).toBeVisible();
  await screenshot(page, 'mobile-columns');
  await scroller.evaluate(element => { element.scrollLeft = 0; });
  await page.getByRole('button', { name: `Ajouter dans la liste ${leaf.name}`, exact: true }).click();
  await withinViewport(page, page.getByRole('menu', { name: `Ajouter dans la liste ${leaf.name}`, exact: true }));
  await noPageOverflow(page);
  await expect(page.getByRole('menuitem', { name: 'Tâche', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: 'Sous-liste', exact: true })).toBeFocused();
  await page.getByRole('menuitem', { name: 'Sous-liste', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Créer une liste', exact: true });
  await withinViewport(page, dialog);
  const nameInput = dialog.getByLabel('Nom de la liste', { exact: true });
  await nameInput.fill('Listes mobile saisie continue');
  await expect(nameInput).toBeFocused();
  await nameInput.press('End');
  await nameInput.press('!');
  await expect(nameInput).toHaveValue('Listes mobile saisie continue!');
  for (let index = 0; index < 9; index++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await screenshot(page, 'mobile-dialog');
  page.once('dialog', confirmation => confirmation.accept());
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await noPageOverflow(page);
  expect((await state(request)).taskLists!.filter(item => item.projectId === owner.id)).toHaveLength(3);
  expect(errors).toEqual([]);
});
