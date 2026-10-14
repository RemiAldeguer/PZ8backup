import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import type { AppData, Comment, Project, ProjectDocument, Resource, Task } from '../../shared/types';
import type { CustomFieldDefinition } from '../../shared/customization';
import { addCalendarDays } from '../../shared/time-sheets';
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
    name, zoneId: data.zones[0].id, status: 'open', budget: 7500.75,
    startDate: '2026-10-01', endDate: '2027-12-31', description: `Projet isolé de recette : ${name}.`,
  });
}
function task(request: APIRequestContext, owner: Project, title: string, extra: Record<string, unknown> = {}) {
  return create<Task>(request, 'tasks', {
    projectId: owner.id, title, startDate: '2026-10-05', endDate: '2026-10-09',
    allocatedHours: 12, progress: 25, status: 'in_progress', phase: 'Recette espace', kind: 'task', ...extra,
  });
}
function screenshotPath(name: string) {
  return test.info().project.testDir.endsWith('cloudflare-browser') ? test.info().outputPath(name) : `docs/screenshots/${name}`;
}
async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: screenshotPath(`workspace-expansion-${name}.png`), fullPage: true, animations: 'disabled' });
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
async function openTask(page: Page, owner: Project, item: Task) {
  await page.goto(`/#project/${owner.id}/list`);
  await page.locator('.content-area').getByRole('button', { name: item.title, exact: true }).click();
  return page.getByRole('dialog', { name: 'Détail de la tâche', exact: true });
}
const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';

test('extension espace : sept types de champs, édition typée et calcul sans perdre les anciens nombres et dates', async ({ page, request }) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const owner = await project(request, 'Extension champs projet');
  const item = await task(request, owner, 'Extension tâche avec sept champs');
  const labels = [
    ['text', 'Texte simple (1 ligne)', 'Extension texte simple'],
    ['rich_text', 'Texte riche', 'Extension texte riche'],
    ['multi_select', 'Liste à choix multiples', 'Extension choix multiples'],
    ['select', 'Liste à choix simple', 'Extension choix simple'],
    ['formula', 'Formule', 'Extension formule'],
    ['image', 'Image', 'Extension image'],
    ['url', 'Lien web', 'Extension lien web'],
  ] as const;
  await page.goto('/#customization/custom-fields');
  for (const [type, _option, name] of labels) {
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    const creator = page.getByRole('dialog', { name: 'Nouveau champ personnalisé', exact: true });
    const choices = creator.getByRole('combobox', { name: 'Type de champ', exact: true });
    for (const [value, label] of labels) await expect(choices.locator(`option[value="${value}"]`)).toHaveText(label);
    await expect(choices.locator('option[value="number"]')).toHaveCount(1);
    await expect(choices.locator('option[value="date"]')).toHaveCount(1);
    await creator.getByLabel('Nom', { exact: true }).fill(name);
    await creator.getByRole('combobox', { name: 'Éléments concernés', exact: true }).selectOption('task');
    await choices.selectOption(type);
    if (type === 'select' || type === 'multi_select') await creator.getByLabel('Options (une par ligne)', { exact: true }).fill('Pilote\nConfirmé\nExpert');
    if (type === 'formula') await creator.getByLabel('Expression de la formule', { exact: true }).fill('{allocatedHours} + {progress}');
    await creator.getByRole('button', { name: 'Créer le champ', exact: true }).click();
    await expect(creator).not.toBeVisible();
  }
  const number = await create<CustomFieldDefinition>(request, 'custom-field-definitions', { name: 'Extension ancien nombre', scope: 'task', type: 'number', translations: { fr: 'Extension ancien nombre', en: '' }, options: [] });
  const date = await create<CustomFieldDefinition>(request, 'custom-field-definitions', { name: 'Extension ancienne date', scope: 'task', type: 'date', translations: { fr: 'Extension ancienne date', en: '' }, options: [] });
  await patch(request, 'tasks', item.id, { customValues: { [number.id]: '125.75', [date.id]: '2026-10-16' } });
  await page.reload();
  await page.route('https://example.com/workspace-expansion.png', route => route.fulfill({ contentType: 'image/png', body: Buffer.from(tinyPng, 'base64') }));
  const imagePng = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 280; canvas.height = 100;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#087c83'; context.fillRect(0, 0, 280, 100);
    context.fillStyle = '#fff'; context.font = 'bold 24px sans-serif'; context.fillText('Planzone 8', 22, 44);
    context.font = '14px sans-serif'; context.fillText('Image de recette du champ', 22, 72);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  let dialog = await openTask(page, owner, item);
  await dialog.getByLabel('Extension texte simple', { exact: true }).fill('Un titre sur une ligne');
  await expect(dialog.getByLabel('Extension texte simple', { exact: true })).toHaveJSProperty('tagName', 'INPUT');
  await dialog.getByLabel('Extension texte riche', { exact: true }).fill('**Décision validée**\n- Premier point\n- Second point');
  await dialog.getByText('Aperçu de Extension texte riche', { exact: true }).click();
  await expect(dialog.locator('.ci-rich-preview strong')).toHaveText('Décision validée');
  const multi = dialog.getByRole('group', { name: 'Extension choix multiples', exact: true });
  await multi.getByRole('checkbox', { name: 'Pilote', exact: true }).check();
  await multi.getByRole('checkbox', { name: 'Expert', exact: true }).check();
  await dialog.getByRole('combobox', { name: 'Extension choix simple', exact: true }).selectOption('Confirmé');
  await dialog.getByLabel('Extension image', { exact: true }).fill('https://example.com/workspace-expansion.png');
  await expect(dialog.getByRole('img', { name: 'Extension image – aperçu', exact: true })).toBeVisible();
  await dialog.getByLabel('Choisir une image pour Extension image', { exact: true }).setInputFiles({ name: 'recette-image.png', mimeType: 'image/png', buffer: Buffer.from(imagePng, 'base64') });
  await expect(dialog.getByRole('img', { name: 'Extension image – aperçu', exact: true })).toHaveAttribute('src', `data:image/png;base64,${imagePng}`);
  await dialog.getByLabel('Extension lien web', { exact: true }).fill('https://example.com/espace');
  await expect(dialog.getByLabel('Extension formule', { exact: true })).toHaveAttribute('readonly', '');
  await expect(dialog.getByLabel('Extension formule', { exact: true })).toHaveValue('37');
  await dialog.getByLabel('Avancement (%)', { exact: true }).fill('50');
  await expect(dialog.getByLabel('Extension formule', { exact: true })).toHaveValue('62');
  await expect(dialog.getByLabel('Extension ancien nombre', { exact: true })).toHaveValue('125.75');
  await expect(dialog.getByLabel('Extension ancienne date', { exact: true })).toHaveValue('2026-10-16');
  await dialog.getByLabel('Extension texte riche', { exact: true }).scrollIntoViewIfNeeded();
  await screenshot(page, 'fields-desktop');
  await dialog.locator('.modal-body').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await screenshot(page, 'fields-detail-desktop');
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  dialog = await openTask(page, owner, item);
  await expect(dialog.getByLabel('Extension texte riche', { exact: true })).toHaveValue('**Décision validée**\n- Premier point\n- Second point');
  await expect(dialog.getByRole('group', { name: 'Extension choix multiples', exact: true }).getByRole('checkbox', { name: 'Pilote', exact: true })).toBeChecked();
  await expect(dialog.getByRole('group', { name: 'Extension choix multiples', exact: true }).getByRole('checkbox', { name: 'Expert', exact: true })).toBeChecked();
  await expect(dialog.getByRole('combobox', { name: 'Extension choix simple', exact: true })).toHaveValue('Confirmé');
  await expect(dialog.getByLabel('Extension formule', { exact: true })).toHaveValue('62');
  const stored = await state(request);
  const definitions = new Map(stored.customFieldDefinitions!.filter(field => field.name.startsWith('Extension ')).map(field => [field.name, field]));
  const values = stored.tasks.find(candidate => candidate.id === item.id)!.customValues!;
  expect(values[number.id]).toBe('125.75'); expect(values[date.id]).toBe('2026-10-16');
  expect(JSON.parse(values[definitions.get('Extension choix multiples')!.id])).toEqual(['Pilote', 'Expert']);
  expect(values[definitions.get('Extension choix simple')!.id]).toBe('Confirmé');
  expect(values[definitions.get('Extension image')!.id]).toBe(`data:image/png;base64,${imagePng}`);
  expect(values[definitions.get('Extension formule')!.id]).toBeUndefined();
  await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
  const convertible = await create<CustomFieldDefinition>(request, 'custom-field-definitions', {
    name: 'Extension formule littérale à convertir', scope: 'project', type: 'formula',
    formula: '1 + 2', translations: { fr: 'Extension formule littérale à convertir', en: '' }, options: [],
  });
  await page.goto('/#customization/custom-fields');
  await page.reload();
  await page.getByRole('combobox', { name: 'Éléments concernés :', exact: true }).selectOption('project');
  const accordion = page.locator('.cf-accordion').filter({ hasText: convertible.name });
  await accordion.getByRole('button', { name: new RegExp(convertible.name) }).click();
  await accordion.getByRole('combobox', { name: 'Type de champ', exact: true }).selectOption('text');
  await expect(accordion.getByLabel('Expression de la formule', { exact: true })).toHaveCount(0);
  await accordion.getByRole('button', { name: 'Modifier', exact: true }).click();
  await expect.poll(async () => (await state(request)).customFieldDefinitions!.find(field => field.id === convertible.id)?.type).toBe('text');
  expect((await state(request)).customFieldDefinitions!.find(field => field.id === convertible.id)?.formula ?? '').toBe('');
  expect(errors).toEqual([]);
});

test('extension espace : ordre et visibilité des colonnes persistés, tags ajoutés et retirés sur la tâche', async ({ page, request }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const owner = await project(request, 'Extension configuration liste');
  const other = await project(request, 'Extension configuration autre liste');
  const item = await task(request, owner, 'Extension tâche tags réordonnée', { allocatedHours: 17.5, tags: ['Conservé'] });
  await task(request, other, 'Extension autre liste intacte');
  await page.goto(`/#project/${owner.id}/list`);
  await page.getByRole('button', { name: 'Configurer les colonnes', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Configurer les colonnes', exact: true });
  await dialog.getByRole('button', { name: 'Déplacer Tags vers la gauche', exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'Responsable', exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Appliquer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const headers = page.locator('.content-area table thead th[data-column]');
  await expect.poll(() => headers.evaluateAll(cells => cells.map(cell => cell.getAttribute('data-column')))).toEqual(['task', 'tags', 'status', 'dates', 'allocated']);
  const row = page.locator('.content-area tbody tr').filter({ has: page.getByRole('button', { name: item.title, exact: true }) });
  await expect.poll(() => row.locator('td[data-column]').evaluateAll(cells => cells.map(cell => cell.getAttribute('data-column')))).toEqual(['task', 'tags', 'status', 'dates', 'allocated']);
  await expect(row.locator('[data-column="tags"]')).toContainText('Conservé');
  await expect(row.locator('[data-column="allocated"]')).toContainText('17');
  await row.getByRole('button', { name: `Modifier les tags de ${item.title}`, exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Détail de la tâche', exact: true });
  const tags = dialog.locator('.lc-task-tags');
  await tags.getByLabel('Ajouter un tag', { exact: true }).fill('Priorité haute');
  await tags.getByLabel('Ajouter un tag', { exact: true }).press('Enter');
  await tags.getByLabel('Ajouter un tag', { exact: true }).fill('priorité haute');
  await tags.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(tags.getByRole('button', { name: 'Retirer le tag Priorité haute', exact: true })).toHaveCount(1);
  await tags.getByRole('button', { name: 'Retirer le tag Conservé', exact: true }).click();
  await tags.getByLabel('Ajouter un tag', { exact: true }).fill('Validation');
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(row.locator('[data-column="tags"]')).toContainText('Priorité haute');
  await expect(row.locator('[data-column="tags"]')).toContainText('Validation');
  await expect(row.locator('[data-column="tags"]')).not.toContainText('Conservé');
  await expect.poll(() => headers.evaluateAll(cells => cells.map(cell => cell.getAttribute('data-column')))).toEqual(['task', 'tags', 'status', 'dates', 'allocated']);
  expect((await state(request)).tasks.find(candidate => candidate.id === item.id)!.tags).toEqual(['Priorité haute', 'Validation']);
  await screenshot(page, 'list-columns-desktop');
  await page.goto(`/#project/${other.id}/list`);
  await expect.poll(() => headers.evaluateAll(cells => cells.map(cell => cell.getAttribute('data-column')))).toEqual(['task', 'status', 'tags', 'assignee', 'dates', 'allocated']);
  await page.goto(`/#project/${owner.id}/list`);
  await page.getByRole('button', { name: 'Configurer les colonnes', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Configurer les colonnes', exact: true });
  await dialog.getByRole('button', { name: 'Rétablir les colonnes', exact: true }).click();
  await dialog.getByRole('button', { name: 'Appliquer', exact: true }).click();
  await expect.poll(() => headers.evaluateAll(cells => cells.map(cell => cell.getAttribute('data-column')))).toEqual(['task', 'status', 'tags', 'assignee', 'dates', 'allocated']);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Configurer les colonnes', exact: true }).click();
  await withinViewport(page, page.getByRole('dialog', { name: 'Configurer les colonnes', exact: true }));
  await noPageOverflow(page);
  await screenshot(page, 'list-columns-mobile');
  expect(errors).toEqual([]);
});

test('extension espace : documents liés et fichiers enregistrés dans leur projet, édition, téléchargement et verrouillage', async ({ page, request }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const owner = await project(request, 'Extension documents projet');
  const other = await project(request, 'Extension documents autre projet');
  await create<ProjectDocument>(request, 'project-documents', { projectId: other.id, name: 'Extension document étranger', kind: 'link', url: 'https://example.com/etranger' });
  await page.goto(`/#project/${owner.id}/documents`);
  await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ajouter un lien', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Ajouter un lien web', exact: true });
  await dialog.getByLabel('Nom du document', { exact: true }).pressSequentially('Extension lien du cadrage');
  await expect(dialog.getByLabel('Nom du document', { exact: true })).toBeFocused();
  await expect(dialog.getByLabel('Nom du document', { exact: true })).toHaveValue('Extension lien du cadrage');
  await dialog.getByLabel('Lien web', { exact: true }).fill('https://example.com/cadrage');
  await dialog.getByLabel('Description', { exact: true }).fill('Lien du cadrage partagé avec le projet.');
  await dialog.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Ajouter un document', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Ajouter un document', exact: true });
  const contents = Buffer.from('Compte rendu de la recette : le document reste lié à son projet.\n', 'utf8');
  await dialog.getByLabel(/^Fichier/).setInputFiles({ name: 'recette-espace.txt', mimeType: 'text/plain', buffer: contents });
  await dialog.getByLabel('Nom du document', { exact: true }).fill('Extension fichier de recette');
  await dialog.getByLabel('Description', { exact: true }).fill('Fichier conservé lors du rechargement.');
  await dialog.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(page.locator('.content-area')).toContainText('Extension lien du cadrage');
  await expect(page.locator('.content-area')).toContainText('Extension fichier de recette');
  await expect(page.locator('.content-area')).not.toContainText('Extension document étranger');
  let stored = await state(request);
  const file = stored.projectDocuments!.find(document => document.projectId === owner.id && document.kind === 'file')!;
  const link = stored.projectDocuments!.find(document => document.projectId === owner.id && document.kind === 'link')!;
  expect(file).toMatchObject({ fileName: 'recette-espace.txt', mimeType: 'text/plain', contentBase64: contents.toString('base64'), sizeBytes: contents.length });
  expect(file.authorId).toBe(stored.currentUser.id);
  expect(link.url).toBe('https://example.com/cadrage');
  await page.getByRole('button', { name: 'Modifier Extension lien du cadrage', exact: true }).click();
  dialog = page.getByRole('dialog', { name: /Modifier/ });
  await dialog.getByLabel('Nom du document', { exact: true }).fill('Extension lien du cadrage corrigé');
  await dialog.getByLabel('Lien web', { exact: true }).fill('https://example.com/cadrage-valide');
  await dialog.getByRole('button', { name: /Enregistrer/ }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  expect((await state(request)).projectDocuments!.find(document => document.id === link.id)).toMatchObject({ name: 'Extension lien du cadrage corrigé', url: 'https://example.com/cadrage-valide' });
  await page.getByRole('button', { name: 'Extension lien du cadrage corrigé', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Extension lien du cadrage corrigé', exact: true });
  const close = dialog.getByRole('button', { name: 'Fermer la fenêtre', exact: true });
  await close.focus();
  await page.keyboard.press('Tab');
  await expect(dialog.locator('.pcv-link')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Fermer', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('link', { name: 'Ouvrir le lien', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await close.click();
  await page.getByRole('button', { name: 'Extension fichier de recette', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Extension fichier de recette', exact: true });
  await expect(dialog).toContainText('Compte rendu de la recette : le document reste lié à son projet.');
  await dialog.getByRole('button', { name: 'Fermer la fenêtre', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Télécharger Extension fichier de recette', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('recette-espace.txt');
  await screenshot(page, 'documents-desktop');
  await patch(request, 'projects', owner.id, { status: 'paused' });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Ajouter un document', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Modifier Extension fichier de recette', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Télécharger Extension fichier de recette', exact: true })).toBeVisible();
  await patch(request, 'projects', owner.id, { status: 'open' });
  await page.reload();
  page.once('dialog', confirmation => confirmation.accept());
  await page.getByRole('button', { name: 'Supprimer Extension fichier de recette', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Extension fichier de recette', exact: true })).toHaveCount(0);
  stored = await state(request);
  expect(stored.projectDocuments!.some(document => document.id === file.id)).toBe(false);
  expect(stored.projectDocuments!.find(document => document.id === link.id)?.url).toBe('https://example.com/cadrage-valide');
  await page.setViewportSize({ width: 390, height: 844 });
  await noPageOverflow(page);
  await screenshot(page, 'documents-mobile');
  expect(errors).toEqual([]);
});

test('extension espace : mon espace affiche les tâches à gauche et un vrai calendrier personnel à droite', async ({ page, request }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const owner = await project(request, 'Extension synthèse personnelle');
  const data = await state(request);
  const ownId = data.currentUser.id;
  const outsider = await create<Resource>(request, 'resources', { name: 'Extension autre personne synthèse' });
  const dates = { startDate: data.today, endDate: addCalendarDays(data.today, 3) };
  const open = await task(request, owner, 'Extension tâche personnelle ouverte', { assigneeId: ownId, ...dates });
  await task(request, owner, 'Extension tâche personnelle en retard', { assigneeId: ownId, startDate: addCalendarDays(data.today, -4), endDate: addCalendarDays(data.today, -1) });
  await task(request, owner, 'Extension tâche personnelle terminée', { assigneeId: ownId, status: 'done', progress: 100, ...dates });
  const predecessor = await task(request, owner, 'Extension prédécesseur non terminé');
  const blocked = await task(request, owner, 'Extension tâche personnelle bloquée', { assigneeId: ownId, dependsOnId: predecessor.id, status: 'todo', progress: 0, ...dates });
  await task(request, owner, 'Extension tâche de l’autre personne', { assigneeId: outsider.id, ...dates });
  await task(request, owner, 'Extension jalon personnel', { assigneeId: ownId, kind: 'milestone', allocatedHours: 0, startDate: data.today, endDate: data.today });
  await create(request, 'calendar-events', { title: 'Extension atelier personnel', description: 'Rendez-vous de la synthèse.', projectId: owner.id, resourceIds: [ownId], startDate: data.today, endDate: data.today, allDay: false, startTime: '08:00', endTime: '09:00' });
  await create(request, 'calendar-events', { title: 'Extension événement étranger', projectId: owner.id, resourceIds: [outsider.id], startDate: data.today, endDate: data.today, allDay: false, startTime: '10:00', endTime: '11:00' });
  await create(request, 'unavailabilities', { title: 'Extension absence partielle personnelle', resourceId: ownId, reason: 'other', startDate: data.today, endDate: data.today, allDay: false, startTime: '08:30', endTime: '09:30' });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/#personal');
  const upcoming = page.getByRole('region', { name: 'Tâches à venir et ouvertes', exact: true });
  const overdue = page.getByRole('region', { name: 'Tâches en retard', exact: true });
  const calendar = page.getByRole('region', { name: 'Mon calendrier hebdomadaire', exact: true });
  await expect(upcoming.getByRole('button', { name: open.title, exact: true })).toBeVisible();
  await expect(upcoming.getByRole('button', { name: blocked.title, exact: true })).toBeVisible();
  await expect(overdue).toContainText('Extension tâche personnelle en retard');
  await expect(upcoming).not.toContainText('Extension tâche de l’autre personne');
  await expect(calendar).toContainText('Extension atelier personnel');
  await expect(calendar).toContainText('Extension absence partielle personnelle');
  await expect(calendar).toContainText('Extension jalon personnel');
  await expect(calendar).not.toContainText('Extension événement étranger');
  await expect(calendar).not.toContainText('Extension tâche personnelle terminée');
  const left = await upcoming.boundingBox(); const right = await calendar.boundingBox();
  expect(right!.x).toBeGreaterThan(left!.x + left!.width);
  const timed = calendar.locator('.pd-timed-entry');
  await expect(timed).toHaveCount(2);
  const lanes = await timed.evaluateAll(items => items.map(item => (item as HTMLElement).style.left));
  expect(new Set(lanes).size).toBe(2);
  await expect(calendar.locator('.pd-day-all-day')).toContainText(open.title);
  await expect(calendar.locator('.pd-timed-items')).not.toContainText(open.title);
  await screenshot(page, 'personal-desktop');
  await page.getByRole('switch', { name: 'Afficher les tâches bloquées', exact: true }).uncheck();
  await expect(upcoming.getByRole('button', { name: blocked.title, exact: true })).toHaveCount(0);
  await expect(calendar).not.toContainText(blocked.title);
  await page.getByRole('switch', { name: 'Afficher les tâches bloquées', exact: true }).check();
  await calendar.getByRole('button', { name: 'Semaine suivante', exact: true }).click();
  await expect(calendar).not.toContainText('Extension atelier personnel');
  await calendar.getByRole('button', { name: 'Aujourd’hui', exact: true }).click();
  await expect(calendar).toContainText('Extension atelier personnel');
  const row = upcoming.getByRole('row').filter({ hasText: open.title });
  await row.getByRole('checkbox', { name: `Terminer ${open.title}`, exact: true }).click();
  await expect(upcoming.getByRole('button', { name: open.title, exact: true })).toHaveCount(0);
  expect((await state(request)).tasks.find(candidate => candidate.id === open.id)).toMatchObject({ status: 'done', progress: 100 });
  await page.getByRole('combobox', { name: 'La synthèse de', exact: true }).selectOption(outsider.id);
  await expect(upcoming).toContainText('Extension tâche de l’autre personne');
  await expect(calendar).toContainText('Extension événement étranger');
  await expect(calendar).not.toContainText('Extension atelier personnel');
  await page.getByRole('combobox', { name: 'La synthèse de', exact: true }).selectOption(ownId);
  await page.setViewportSize({ width: 390, height: 844 });
  await noPageOverflow(page);
  await withinViewport(page, calendar);
  const mobileCards = await upcoming.boundingBox(); const mobileCalendar = await calendar.boundingBox();
  expect(mobileCalendar!.y).toBeGreaterThan(mobileCards!.y);
  await screenshot(page, 'personal-mobile');
  expect(errors).toEqual([]);
});

test('extension espace : discussions projet et tâche, mentions explicites et fils personnels pertinents', async ({ page, request }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const owner = await project(request, 'Extension discussions projet');
  const other = await project(request, 'Extension discussions autre projet');
  const item = await task(request, owner, 'Extension tâche commentée');
  const mentionOnly = await task(request, owner, 'Extension tâche mention externe');
  const legacyTask = await task(request, owner, 'Extension tâche historique personnelle');
  const legacyResourceTask = await task(request, owner, 'Extension tâche historique identité ressource');
  const unrelated = await task(request, other, 'Extension tâche discussion étrangère');
  const initial = await state(request);
  const ownResource = initial.resources.find(resource => resource.id === initial.currentUser.id)!;
  const otherResource = initial.resources.find(resource => resource.id !== initial.currentUser.id)!;
  await page.goto(`/#project/${owner.id}/discussions`);
  await expect(page.getByRole('heading', { name: 'Discussions du projet', exact: true })).toBeVisible();
  const panel = page.locator('.pcv-thread-panel');
  await panel.getByLabel('Votre commentaire', { exact: true }).fill('Extension commentaire général du projet.');
  await panel.getByRole('button', { name: 'Mentionner une ressource', exact: true }).click();
  await panel.getByLabel('Rechercher une ressource à mentionner', { exact: true }).fill(ownResource.name);
  await panel.getByLabel('Rechercher une ressource à mentionner', { exact: true }).press('Enter');
  await expect(panel.getByLabel('Votre commentaire', { exact: true })).toHaveValue(`Extension commentaire général du projet. @${ownResource.name} `);
  await expect(panel.locator('.pcv-comment')).toHaveCount(0);
  await expect(panel.getByLabel('Rechercher une ressource à mentionner', { exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Envoyer', exact: true }).click();
  await expect(panel.locator('.pcv-comment-feed')).toContainText('Extension commentaire général du projet.');
  await expect(panel.locator('.pcv-comment-feed')).toContainText(`@${ownResource.name}`);
  let stored = await state(request);
  const general = stored.comments.find(comment => comment.body.startsWith('Extension commentaire général du projet.'))!;
  expect(general).toMatchObject({ projectId: owner.id, taskId: null, authorId: stored.currentUser.id, mentionResourceIds: [ownResource.id] });
  let dialog = await openTask(page, owner, item);
  await dialog.getByLabel('Votre commentaire', { exact: true }).fill('Extension commentaire directement dans la tâche.');
  await dialog.getByRole('button', { name: 'Mentionner une ressource', exact: true }).click();
  await dialog.getByLabel('Rechercher une ressource à mentionner', { exact: true }).fill(otherResource.name);
  await dialog.getByRole('button', { name: otherResource.name, exact: true }).click();
  await dialog.getByRole('button', { name: 'Envoyer', exact: true }).click();
  const article = dialog.locator('.pcv-comment').filter({ hasText: 'Extension commentaire directement dans la tâche.' });
  await expect(article).toBeVisible();
  await article.getByRole('button', { name: /^Modifier le commentaire de/ }).click();
  const editing = dialog.getByRole('form', { name: 'Modifier le commentaire', exact: true });
  await editing.getByLabel('Votre commentaire', { exact: true }).fill(`Extension commentaire de tâche corrigé. @${otherResource.name} `);
  await editing.getByRole('button', { name: 'Enregistrer le commentaire', exact: true }).click();
  await expect(dialog.locator('.pcv-comment-feed')).toContainText('Extension commentaire de tâche corrigé.');
  await dialog.getByLabel('Votre commentaire', { exact: true }).fill('Extension commentaire temporaire à supprimer pendant son édition.');
  await dialog.getByRole('button', { name: 'Envoyer', exact: true }).click();
  const scratch = dialog.locator('.pcv-comment').filter({ hasText: 'Extension commentaire temporaire à supprimer pendant son édition.' });
  await scratch.getByRole('button', { name: /^Modifier le commentaire de/ }).click();
  page.once('dialog', confirmation => confirmation.accept());
  await scratch.getByRole('button', { name: /^Supprimer le commentaire de/ }).click();
  await expect(scratch).toHaveCount(0);
  await expect(dialog.getByRole('form', { name: 'Ajouter un commentaire', exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Votre commentaire', { exact: true })).toHaveValue('');
  await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
  await page.goto(`/#project/${owner.id}/discussions`);
  await page.getByRole('combobox', { name: 'Discuter de', exact: true }).selectOption(`task:${item.id}`);
  await expect(panel).toContainText('Extension commentaire de tâche corrigé.');
  await expect(panel).not.toContainText('Extension commentaire général du projet.');
  await page.reload();
  await page.getByRole('combobox', { name: 'Discuter de', exact: true }).selectOption(`task:${item.id}`);
  await expect(panel).toContainText('Extension commentaire de tâche corrigé.');
  stored = await state(request);
  const own = stored.comments.find(comment => comment.body.startsWith('Extension commentaire de tâche corrigé.'))!;
  expect(own).toMatchObject({ taskId: item.id, projectId: owner.id, authorId: ownResource.id, mentionResourceIds: [otherResource.id] });
  expect(own.updatedAt).toBeTruthy();
  await patch(request, 'projects', owner.id, { status: 'paused' });
  await page.reload();
  await page.getByRole('combobox', { name: 'Discuter de', exact: true }).selectOption(`task:${item.id}`);
  await expect(panel).toContainText('Extension commentaire de tâche corrigé.');
  await expect(panel.getByLabel('Votre commentaire', { exact: true })).toHaveCount(0);
  await patch(request, 'projects', owner.id, { status: 'open' });

  // Read-only response fixtures represent other authors and legacy snapshots. All
  // actual creations, edits and locks above use the API; metadata cannot be forged.
  const snapshot = await state(request);
  const fixtures: Comment[] = [
    { id: 'extension-other-mention', projectId: owner.id, taskId: mentionOnly.id, authorId: otherResource.id, authorName: otherResource.name, body: `Extension mention explicite de @${ownResource.name}.`, mentionResourceIds: [ownResource.id], createdAt: '2026-10-06T11:00:00.000Z' },
    { id: 'extension-legacy-own', taskId: legacyTask.id, authorName: snapshot.currentUser.name, body: 'Extension commentaire historique sans identifiant d’auteur.', createdAt: '2026-10-06T10:00:00.000Z' },
    { id: 'extension-legacy-resource-own', taskId: legacyResourceTask.id, authorName: ownResource.name, body: 'Extension ancien commentaire lié au nom unique de la ressource actuelle.', createdAt: '2026-10-06T09:00:00.000Z' },
    { id: 'extension-unrelated-author', projectId: other.id, taskId: unrelated.id, authorId: otherResource.id, authorName: snapshot.currentUser.name, body: `Extension texte @${ownResource.name} sans mention enregistrée.`, mentionResourceIds: [], createdAt: '2026-10-06T12:00:00.000Z' },
  ];
  await page.route('**/api/state', route => route.fulfill({ json: { ...snapshot, comments: [...snapshot.comments, ...fixtures] } }));
  await page.goto('/#discussions');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Mes discussions', exact: true })).toBeVisible();
  const threads = page.locator('.pcv-thread-list');
  await expect(threads.getByRole('button', { name: item.title, exact: true })).toBeVisible();
  await expect(threads.getByRole('button', { name: mentionOnly.title, exact: true })).toBeVisible();
  await expect(threads.getByRole('button', { name: legacyTask.title, exact: true })).toBeVisible();
  await expect(threads.getByRole('button', { name: legacyResourceTask.title, exact: true })).toBeVisible();
  await expect(threads.getByRole('button', { name: unrelated.title, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /^Où je suis mentionné/ }).click();
  await expect(threads.getByRole('button', { name: mentionOnly.title, exact: true })).toBeVisible();
  await expect(threads.getByRole('button', { name: item.title, exact: true })).toHaveCount(0);
  await expect(threads.getByRole('button', { name: legacyTask.title, exact: true })).toHaveCount(0);
  await expect(threads.getByRole('button', { name: legacyResourceTask.title, exact: true })).toHaveCount(0);
  await threads.getByRole('button', { name: mentionOnly.title, exact: true }).click();
  await expect(panel).toContainText('Extension mention explicite de');
  await screenshot(page, 'discussions-desktop');
  await page.getByRole('button', { name: /^Où j’ai commenté/ }).click();
  await expect(threads.getByRole('button', { name: item.title, exact: true })).toBeVisible();
  await expect(threads.getByRole('button', { name: legacyTask.title, exact: true })).toBeVisible();
  await expect(threads.getByRole('button', { name: legacyResourceTask.title, exact: true })).toBeVisible();
  await expect(threads.getByRole('button', { name: mentionOnly.title, exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await noPageOverflow(page);
  await withinViewport(page, panel);
  await screenshot(page, 'discussions-mobile');
  expect(errors).toEqual([]);
});

test('extension espace : personnalisation garde ses cinq vues et les paramètres restent accessibles au bon endroit', async ({ page, request }) => {
  const owner = await project(request, 'Extension navigation complète');
  await page.goto('/#customization/project-templates');
  const sidebar = page.getByRole('complementary', { name: 'Navigation principale', exact: true });
  const customization = sidebar.locator('#pz-sidebar-customization');
  await expect(customization.getByRole('button')).toHaveCount(5);
  for (const label of ['Modèles de projet', 'Champs personnalisés', 'Modèle de compte rendu', 'Statuts de projet', 'Axes stratégiques']) {
    await expect(customization.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
  await expect(customization).not.toContainText('Paramètres du projet');
  await expect(customization).not.toContainText('Informations sur l’espace');
  await expect(sidebar.getByRole('button', { name: 'Mon espace', exact: true })).toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'Mes discussions', exact: true })).toHaveCount(0);
  await expect(sidebar.getByRole('button', { name: 'Suivi temporel', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Votre espace et votre profil', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Mon espace de travail', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Votre espace de travail', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Retour à mon espace', exact: true }).click();
  await page.goto(`/#project/${owner.id}/summary`);
  await page.locator('.project-header').getByRole('button', { name: 'Paramètres du projet', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Paramètres du projet', exact: true });
  await expect(dialog.getByLabel('Nom du projet', { exact: true })).toHaveValue(owner.name);
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  await page.getByRole('navigation', { name: 'Accès du projet', exact: true }).getByRole('link', { name: 'Documents', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#project/${owner.id}/documents$`));
  await page.getByRole('navigation', { name: 'Accès du projet', exact: true }).getByRole('link', { name: 'Discussions', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#project/${owner.id}/discussions$`));
});
