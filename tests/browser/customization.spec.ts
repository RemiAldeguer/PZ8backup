import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import type { AppData, Project, Resource, Task } from '../../shared/types';
import type { CustomFieldDefinition, ProjectStatusDefinition, ProjectTemplate, StrategicAxis } from '../../shared/customization';
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

async function newProject(request: APIRequestContext, name: string): Promise<Project> {
  const data = await state(request);
  return create<Project>(request, 'projects', {
    name, zoneId: data.zones[0].id, status: 'open', budget: 1200,
    startDate: '2026-10-05', endDate: '2026-11-30',
    description: 'Structure de recette personnalisable, indépendante des données de démonstration.',
  });
}

function newTask(request: APIRequestContext, project: Project, title: string, extra: Record<string, unknown> = {}) {
  return create<Task>(request, 'tasks', {
    projectId: project.id, title, startDate: '2026-10-05', endDate: '2026-10-09',
    allocatedHours: 8, phase: 'Préparation', kind: 'task', ...extra,
  });
}

function screenshotPath(name: string) {
  return test.info().project.testDir.endsWith('cloudflare-browser') ? test.info().outputPath(name) : `docs/screenshots/${name}`;
}

async function noPageOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function withinViewport(page: Page, locator: Locator) {
  const bounds = await locator.boundingBox();
  const viewport = page.viewportSize()!;
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
}

test('personnalisation : modèle issu d’un projet, tâches et jalons réutilisés avec dates et dépendances remappées', async ({ page, request }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const source = await newProject(request, 'Recette projet source du modèle');
  const first = await newTask(request, source, 'Recette structure cadrage', { status: 'done', progress: 100, assigneeId: 'resource-claire', tags: ['Recette'] });
  const milestone = await newTask(request, source, 'Recette structure validation', {
    kind: 'milestone', allocatedHours: 0, startDate: '2026-10-12', endDate: '2026-10-12', dependsOnId: first.id,
  });
  await create(request, 'time-entries', { taskId: first.id, resourceId: 'resource-claire', hours: 2, date: '2026-10-05' });
  await create(request, 'comments', { taskId: first.id, body: 'Historique du projet source à conserver sur ce seul projet.' });
  await create(request, 'expenses', { projectId: source.id, label: 'Recette historique dépense', amount: 75.50, plannedDate: '2026-10-05', paidDate: '2026-10-06', category: 'other' });
  await create(request, 'revenues', { projectId: source.id, label: 'Recette historique recette', amount: 150.25, plannedDate: '2026-10-05', category: 'services' });
  await page.goto('/#customization/project-templates');
  await page.getByRole('button', { name: 'Modèle', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Nouveau modèle de projet', exact: true });
  await editor.getByRole('combobox', { name: 'Partir d’un projet existant', exact: true }).selectOption(source.id);
  await editor.getByLabel('Nom du modèle', { exact: true }).fill('Recette modèle de déploiement');
  await editor.getByRole('button', { name: 'Ajouter une tâche', exact: true }).click();
  await editor.getByLabel('Titre de l’élément', { exact: true }).fill('Recette tâche ajoutée au modèle');
  await editor.getByLabel('Début : décalage en jours', { exact: true }).fill('5');
  await editor.getByLabel('Fin : décalage en jours', { exact: true }).fill('6');
  await editor.getByLabel('Travail alloué (heures)', { exact: true }).fill('4');
  await editor.getByRole('combobox', { name: 'Démarre après', exact: true }).selectOption({ label: first.title });
  await editor.getByRole('button', { name: 'Ajouter un jalon', exact: true }).click();
  await editor.getByLabel('Titre de l’élément', { exact: true }).fill('Recette jalon ajouté au modèle');
  await editor.getByLabel('Début : décalage en jours', { exact: true }).fill('8');
  await editor.getByLabel('Fin : décalage en jours', { exact: true }).fill('8');
  await expect(editor.getByLabel('Travail alloué (heures)', { exact: true })).toBeDisabled();
  await editor.getByRole('combobox', { name: 'Démarre après', exact: true }).selectOption({ label: 'Recette tâche ajoutée au modèle' });
  await editor.getByRole('button', { name: 'Créer le modèle', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await page.reload();
  const card = page.getByRole('article', { name: 'Modèle Recette modèle de déploiement', exact: true });
  await expect(card).toBeVisible();
  await expect(card).toContainText('2 tâche(s)');
  await expect(card).toContainText('2 jalon(s)');
  await withinViewport(page, card);
  await page.screenshot({ path: screenshotPath('customization-project-templates-desktop.png'), fullPage: true, animations: 'disabled' });
  const template = (await state(request)).projectTemplates!.find(item => item.name === 'Recette modèle de déploiement')!;
  expect(template.tasks.find(item => item.title === first.title)).toMatchObject({ startOffsetDays: 0, endOffsetDays: 4 });
  expect(template.tasks.find(item => item.title === milestone.title)).toMatchObject({ startOffsetDays: 7, endOffsetDays: 7, dependsOnKey: first.id });
  const before = await state(request);
  await card.getByRole('button', { name: 'Créer un projet à partir de Recette modèle de déploiement', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouveau projet', exact: true });
  await expect(dialog.getByRole('combobox', { name: 'Modèle de projet', exact: true })).toHaveValue(template.id);
  await dialog.getByLabel('Nom du projet', { exact: true }).fill('Recette projet créé depuis le modèle');
  await dialog.getByLabel('Date de début', { exact: true }).fill('2026-11-02');
  await dialog.getByLabel('Date de fin', { exact: true }).fill('2026-11-30');
  await dialog.getByRole('button', { name: 'Créer le projet', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const saved = await state(request);
  const cloned = saved.projects.find(item => item.name === 'Recette projet créé depuis le modèle')!;
  expect(cloned).toMatchObject({ budget: source.budget, description: source.description, status: 'open' });
  const clonedTasks = saved.tasks.filter(item => item.projectId === cloned.id);
  expect(clonedTasks).toHaveLength(4);
  const taskByTitle = (title: string) => clonedTasks.find(item => item.title === title)!;
  expect(taskByTitle(first.title)).toMatchObject({ startDate: '2026-11-02', endDate: '2026-11-06', tags: ['Recette'] });
  expect(taskByTitle(milestone.title)).toMatchObject({ startDate: '2026-11-09', endDate: '2026-11-09', dependsOnId: taskByTitle(first.title).id, kind: 'milestone', allocatedHours: 0 });
  expect(taskByTitle('Recette tâche ajoutée au modèle')).toMatchObject({ startDate: '2026-11-07', endDate: '2026-11-08', dependsOnId: taskByTitle(first.title).id, allocatedHours: 4 });
  expect(taskByTitle('Recette jalon ajouté au modèle')).toMatchObject({ startDate: '2026-11-10', endDate: '2026-11-10', dependsOnId: taskByTitle('Recette tâche ajoutée au modèle').id, kind: 'milestone', allocatedHours: 0 });
  for (const task of clonedTasks) {
    expect(task).toMatchObject({ status: 'todo', progress: 0, assigneeId: null });
    expect([first.id, milestone.id]).not.toContain(task.id);
    if (task.dependsOnId) expect(clonedTasks.some(item => item.id === task.dependsOnId)).toBe(true);
  }
  for (const collection of ['timeEntries', 'comments', 'expenses', 'revenues'] as const) expect(saved[collection]).toEqual(before[collection]);
  expect(saved.tasks.find(item => item.id === first.id)).toEqual(before.tasks.find(item => item.id === first.id));
  await page.goto(`/#project/${cloned.id}/list`);
  await page.reload();
  await expect(page.locator('.content-area').getByRole('button', { name: 'Recette tâche ajoutée au modèle', exact: true })).toBeVisible();
  await expect(page.locator('.content-area').getByRole('button', { name: 'Recette jalon ajouté au modèle', exact: true })).toBeVisible();
  await page.goto('/#customization/project-templates');
  await page.getByRole('button', { name: 'Modifier le modèle Recette modèle de déploiement', exact: true }).click();
  let edit = page.getByRole('dialog', { name: 'Modifier le modèle de projet', exact: true });
  await edit.getByLabel('Nom du modèle', { exact: true }).fill('Recette modèle de déploiement révisé');
  await edit.getByRole('button', { name: 'Enregistrer le modèle', exact: true }).click();
  await expect(edit).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Modifier le modèle Recette modèle de déploiement révisé', exact: true }).click();
  edit = page.getByRole('dialog', { name: 'Modifier le modèle de projet', exact: true });
  page.once('dialog', confirmation => confirmation.accept());
  await edit.getByRole('button', { name: 'Supprimer le modèle', exact: true }).click();
  await expect(edit).not.toBeVisible();
  const afterDelete = await state(request);
  expect(afterDelete.projectTemplates!.some(item => item.id === template.id)).toBe(false);
  expect(afterDelete.projects.find(item => item.id === cloned.id)).toEqual(cloned);
  expect(afterDelete.tasks.filter(item => item.projectId === cloned.id)).toEqual(clonedTasks);
  expect(errors).toEqual([]);
});

test('personnalisation : champs traduits et typés dans les fiches projet, tâche et ressource, valeurs protégées', async ({ page, request }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const project = await newProject(request, 'Recette fiches personnalisées');
  const task = await newTask(request, project, 'Recette livrable avec champs');
  const resource = await create<Resource>(request, 'resources', { name: 'Recette ressource avec champs', type: 'human' });
  await page.goto('/#customization/custom-fields');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  const creation = page.getByRole('dialog', { name: 'Nouveau champ personnalisé', exact: true });
  await creation.getByLabel('Nom', { exact: true }).fill('Recette montant du contrat');
  await creation.getByRole('combobox', { name: 'Éléments concernés', exact: true }).selectOption('project');
  await creation.getByRole('combobox', { name: 'Type de champ', exact: true }).selectOption('number');
  await creation.getByLabel(/Français \(FR\)/).fill('Valeur contrat recette');
  await creation.getByLabel(/Anglais \(EN\)/).fill('Contract value');
  await creation.getByRole('button', { name: 'Créer le champ', exact: true }).click();
  await expect(creation).not.toBeVisible();
  await page.getByRole('combobox', { name: 'Éléments concernés :', exact: true }).selectOption('project');
  const accordion = page.locator('.cf-accordion').filter({ hasText: 'Recette montant du contrat' });
  await accordion.getByRole('button', { name: /Recette montant du contrat/ }).click();
  await expect(accordion.getByRole('combobox', { name: 'Type de champ', exact: true })).toBeEnabled();
  await accordion.getByLabel(/Anglais \(EN\)/).fill('Contract amount');
  await accordion.getByRole('button', { name: 'Modifier', exact: true }).click();
  await page.reload();
  const contract = (await state(request)).customFieldDefinitions!.find(item => item.name === 'Recette montant du contrat')!;
  expect(contract).toMatchObject({ type: 'number', scope: 'project', translations: { fr: 'Valeur contrat recette', en: 'Contract amount' } });
  const date = await create<CustomFieldDefinition>(request, 'custom-field-definitions', { name: 'Date remise recette', scope: 'task', type: 'date', translations: { fr: 'Date remise recette', en: 'Delivery date' }, options: [] });
  const link = await create<CustomFieldDefinition>(request, 'custom-field-definitions', { name: 'Lien livraison recette', scope: 'task', type: 'url', translations: { fr: 'Lien livraison recette', en: 'Delivery link' }, options: [] });
  const level = await create<CustomFieldDefinition>(request, 'custom-field-definitions', { name: 'Niveau ressource recette', scope: 'resource', type: 'select', translations: { fr: 'Niveau ressource recette', en: 'Resource level' }, options: ['Pilote', 'Confirmé'] });
  await page.goto(`/#project/${project.id}/summary`);
  await page.locator('.project-header').getByRole('button', { name: 'Paramètres du projet', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Paramètres du projet', exact: true });
  await expect(dialog.getByLabel('Valeur contrat recette', { exact: true })).toHaveAttribute('type', 'number');
  await expect(dialog.getByLabel('Date remise recette', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('combobox', { name: 'Niveau ressource recette', exact: true })).toHaveCount(0);
  await dialog.getByLabel('Valeur contrat recette', { exact: true }).fill('245.50');
  await dialog.getByRole('button', { name: 'Enregistrer le projet', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await page.locator('.project-header').getByRole('button', { name: 'Paramètres du projet', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Paramètres du projet', exact: true });
  await expect(dialog.getByLabel('Valeur contrat recette', { exact: true })).toHaveValue('245.50');
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  await page.goto(`/#project/${project.id}/list`);
  await page.locator('.content-area').getByRole('button', { name: task.title, exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Détail de la tâche', exact: true });
  await expect(dialog.getByLabel('Date remise recette', { exact: true })).toHaveAttribute('type', 'date');
  await expect(dialog.getByLabel('Lien livraison recette', { exact: true })).toHaveAttribute('type', 'url');
  await expect(dialog.getByLabel('Valeur contrat recette', { exact: true })).toHaveCount(0);
  await dialog.getByLabel('Date remise recette', { exact: true }).fill('2026-10-16');
  await dialog.getByLabel('Lien livraison recette', { exact: true }).fill('https://example.com/livraison');
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await page.locator('.content-area').getByRole('button', { name: task.title, exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Détail de la tâche', exact: true });
  await expect(dialog.getByLabel('Date remise recette', { exact: true })).toHaveValue('2026-10-16');
  await expect(dialog.getByLabel('Lien livraison recette', { exact: true })).toHaveValue('https://example.com/livraison');
  await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
  await page.goto('/#resources/directory');
  await page.getByRole('button', { name: `Ouvrir la fiche de ${resource.name}`, exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Fiche ressource', exact: true });
  await dialog.getByRole('combobox', { name: 'Niveau ressource recette', exact: true }).selectOption('Pilote');
  await expect(dialog.getByLabel('Valeur contrat recette', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: `Ouvrir la fiche de ${resource.name}`, exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Fiche ressource', exact: true });
  await expect(dialog.getByRole('combobox', { name: 'Niveau ressource recette', exact: true })).toHaveValue('Pilote');
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  const saved = await state(request);
  expect(saved.projects.find(item => item.id === project.id)?.customValues).toEqual({ [contract.id]: '245.50' });
  expect(saved.tasks.find(item => item.id === task.id)?.customValues).toEqual({ [date.id]: '2026-10-16', [link.id]: 'https://example.com/livraison' });
  expect(saved.resources.find(item => item.id === resource.id)?.customValues).toEqual({ [level.id]: 'Pilote' });
  await page.goto('/#customization/custom-fields');
  await page.getByRole('combobox', { name: 'Éléments concernés :', exact: true }).selectOption('project');
  await accordion.getByRole('button', { name: /Recette montant du contrat/ }).click();
  page.once('dialog', confirmation => confirmation.accept());
  await accordion.getByRole('button', { name: 'Supprimer', exact: true }).click();
  await expect(accordion.getByRole('alert')).toContainText(/utilisé|valeur|fiche/i);
  await expect(accordion.getByLabel('Nom', { exact: true })).toHaveValue(contract.name);
  await page.screenshot({ path: screenshotPath('customization-custom-fields-desktop.png'), fullPage: true, animations: 'disabled' });
  expect((await state(request)).projects.find(item => item.id === project.id)?.customValues).toEqual({ [contract.id]: '245.50' });
  await page.goto(`/#project/${project.id}/summary`);
  await page.locator('.project-header').getByRole('button', { name: 'Paramètres du projet', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Paramètres du projet', exact: true });
  await dialog.getByLabel('Valeur contrat recette', { exact: true }).fill('');
  await dialog.getByRole('button', { name: 'Enregistrer le projet', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect((await state(request)).projects.find(item => item.id === project.id)?.customValues).toEqual({});
  await page.goto('/#customization/custom-fields');
  await page.getByRole('combobox', { name: 'Éléments concernés :', exact: true }).selectOption('project');
  await accordion.getByRole('button', { name: /Recette montant du contrat/ }).click();
  page.once('dialog', confirmation => confirmation.accept());
  await accordion.getByRole('button', { name: 'Supprimer', exact: true }).click();
  await expect(accordion).toHaveCount(0);
  expect((await state(request)).customFieldDefinitions!.some(item => item.id === contract.id)).toBe(false);
  expect(errors).toEqual([]);
});

test('personnalisation : modèle de compte rendu enregistré, champs réordonnés et impression du contenu rédigé', async ({ page, request }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const project = await newProject(request, 'Recette projet du compte rendu');
  const copiedField = await create<CustomFieldDefinition>(request, 'custom-field-definitions', {
    name: 'Lien annexe du rapport recette', scope: 'report', type: 'url',
    translations: { fr: 'Lien annexe du rapport recette', en: 'Report attachment URL' }, options: [],
  });
  await page.goto('/#customization/report-templates');
  const builder = page.getByRole('region', { name: 'Gestion des modèles de compte rendu', exact: true });
  await builder.getByRole('button', { name: 'Nouveau modèle de compte rendu', exact: true }).click();
  await builder.getByLabel('Nom du modèle', { exact: true }).fill('Recette comité de pilotage');
  await builder.getByRole('textbox', { name: /^Titre du compte rendu/ }).fill('Point de recette du {date}');
  await builder.getByRole('button', { name: 'Ajouter un indicateur', exact: true }).click();
  await builder.getByLabel('Libellé de l’indicateur 2', { exact: true }).fill('KPI recette');
  await builder.getByRole('button', { name: 'Ajouter un champ', exact: true }).click();
  await builder.getByLabel('Libellé du champ 2', { exact: true }).fill('Montant résultat recette');
  await builder.getByRole('combobox', { name: 'Type du champ 2', exact: true }).selectOption('number');
  await builder.getByRole('button', { name: 'Ajouter un champ', exact: true }).click();
  await builder.getByLabel('Libellé du champ 3', { exact: true }).fill('Date livraison rapport');
  await builder.getByRole('combobox', { name: 'Type du champ 3', exact: true }).selectOption('date');
  await builder.getByRole('button', { name: 'Monter le champ Date livraison rapport', exact: true }).click();
  await builder.getByRole('button', { name: 'Monter le champ Date livraison rapport', exact: true }).click();
  await expect(builder.getByLabel('Libellé du champ 1', { exact: true })).toHaveValue('Date livraison rapport');
  await builder.getByRole('combobox', { name: 'Champ personnalisé à ajouter au modèle', exact: true }).selectOption(copiedField.id);
  await builder.getByRole('button', { name: 'Ajouter au modèle', exact: true }).click();
  await builder.getByRole('button', { name: 'Enregistrer le modèle', exact: true }).click();
  await expect(builder.getByRole('status')).toHaveText('Modèle enregistré');
  let report = (await state(request)).reportTemplates!.find(item => item.name === 'Recette comité de pilotage')!;
  expect(report.fields.map(item => [item.label, item.type])).toEqual([
    ['Date livraison rapport', 'date'], ['Faits marquants', 'text'], ['Montant résultat recette', 'number'], ['Lien annexe du rapport recette', 'url'],
  ]);
  expect(report.indicators.map(item => item.label)).toEqual(['Qualité', 'KPI recette']);
  await page.reload();
  await builder.getByRole('combobox', { name: 'Modèle de compte rendu enregistré', exact: true }).selectOption(report.id);
  await expect(builder.getByLabel('Libellé du champ 1', { exact: true })).toHaveValue('Date livraison rapport');
  await expect(builder.getByLabel('Libellé de l’indicateur 2', { exact: true })).toHaveValue('KPI recette');
  await builder.getByRole('textbox', { name: /^Titre du compte rendu/ }).fill('Revue de recette du {date}');
  await builder.getByRole('button', { name: 'Enregistrer le modèle', exact: true }).click();
  await expect(builder.getByRole('status')).toHaveText('Modèle enregistré');
  report = (await state(request)).reportTemplates!.find(item => item.id === report.id)!;
  expect(report.titlePattern).toBe('Revue de recette du {date}');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: screenshotPath('customization-report-template-desktop.png'), fullPage: true, animations: 'disabled' });

  await page.goto(`/#reports/${project.id}`);
  await page.evaluate(() => { window.print = () => { document.documentElement.dataset.printRequested = 'true'; }; });
  const composer = page.getByRole('region', { name: 'Rédiger un compte rendu', exact: true });
  await composer.getByRole('combobox', { name: 'Modèle du compte rendu', exact: true }).selectOption(report.id);
  await composer.getByLabel('Date du compte rendu', { exact: true }).fill('2026-10-12');
  await composer.getByRole('combobox', { name: 'Évaluation : Qualité', exact: true }).selectOption('5');
  await composer.getByRole('combobox', { name: 'Évaluation : KPI recette', exact: true }).selectOption('2');
  await composer.getByLabel('Date livraison rapport', { exact: true }).fill('2026-10-16');
  await composer.getByLabel('Faits marquants', { exact: true }).fill('La structure du modèle et les champs typés sont conservés.');
  await composer.getByLabel('Montant résultat recette', { exact: true }).fill('123.45');
  await composer.getByLabel('Lien annexe du rapport recette', { exact: true }).fill('https://example.com/rapport');
  const preview = composer.locator('.rt-report-preview');
  await expect(preview).toContainText('Revue de recette du 12/10/2026');
  await expect(preview).toContainText('16/10/2026');
  await expect(preview).toContainText('123.45');
  await expect(preview).toContainText('La structure du modèle et les champs typés sont conservés.');
  await expect(preview.locator('.rt-rated-indicators').getByText('5 / 5', { exact: true })).toBeVisible();
  await expect(preview.locator('.rt-rated-indicators').getByText('2 / 5', { exact: true })).toBeVisible();
  await composer.getByRole('button', { name: 'Imprimer le compte rendu / PDF', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-print-requested', 'true');
  await page.emulateMedia({ media: 'print' });
  const printable = page.locator('body > .print-report .rt-print-content');
  await expect(printable).toBeVisible();
  await expect(page.locator('.app-shell')).not.toBeVisible();
  await expect(printable).toContainText(project.name);
  await expect(printable).toContainText('Revue de recette du 12/10/2026');
  await expect(printable).toContainText('https://example.com/rapport');
  await expect(printable.locator('.rt-report-field h3')).toHaveText(report.fields.map(item => item.label));
  await page.emulateMedia({ media: 'screen' });
  expect((await state(request)).reportTemplates!.find(item => item.id === report.id)).toEqual(report);
  expect(errors).toEqual([]);
});

test('personnalisation : statuts appliqués, verrouillage effectif et score stratégique pondéré persistant', async ({ page, request }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  const project = await newProject(request, 'Recette gouvernance personnalisée');
  const task = await newTask(request, project, 'Recette tâche à protéger');
  await page.goto('/#customization/project-statuses');
  await page.getByRole('button', { name: 'Nouveau statut', exact: true }).click();
  const statusDialog = page.getByRole('dialog', { name: 'Nouveau statut', exact: true });
  await statusDialog.getByLabel('Nom du statut', { exact: true }).fill('Recette en arbitrage');
  await statusDialog.getByLabel('Description', { exact: true }).fill('Suspend les modifications pendant l’arbitrage.');
  await statusDialog.getByRole('combobox', { name: 'Comportement du projet', exact: true }).selectOption('paused');
  await statusDialog.getByRole('button', { name: 'Créer le statut', exact: true }).click();
  await expect(statusDialog).not.toBeVisible();
  const statusDefinition = (await state(request)).projectStatusDefinitions!.find(item => item.name === 'Recette en arbitrage')!;
  expect(statusDefinition.baseStatus).toBe('paused');

  for (const [code, weight] of [['RECETTE INNOVATION', 4], ['RECETTE RSE', 3]] as const) {
    await page.goto('/#customization/strategic-axes');
    await page.getByRole('button', { name: 'Axe stratégique', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Nouvel axe stratégique', exact: true });
    await dialog.getByLabel('Code', { exact: true }).fill(code);
    await dialog.getByLabel('Nom de l’axe stratégique', { exact: true }).fill(`Axe ${code}`);
    await dialog.getByLabel('Poids', { exact: true }).fill(String(weight));
    await dialog.getByLabel('Libellé pour 2', { exact: true }).fill('Soutient fortement la stratégie');
    await dialog.getByRole('button', { name: 'Créer l’axe stratégique', exact: true }).click();
    await expect(dialog).not.toBeVisible();
  }
  const axes = (await state(request)).strategicAxes!.filter(item => item.code.startsWith('RECETTE '));
  const innovation = axes.find(item => item.code === 'RECETTE INNOVATION')!;
  const rse = axes.find(item => item.code === 'RECETTE RSE')!;
  await page.goto(`/#project/${project.id}/summary`);
  await page.locator('.project-header').getByRole('button', { name: 'Paramètres du projet', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Paramètres du projet', exact: true });
  await dialog.getByRole('combobox', { name: 'État', exact: true }).selectOption(statusDefinition.id);
  await dialog.getByRole('combobox', { name: 'Évaluation RECETTE INNOVATION', exact: true }).selectOption('2');
  await dialog.getByRole('combobox', { name: 'Évaluation RECETTE RSE', exact: true }).selectOption('-1');
  await expect(dialog.locator('.ci-strategic-note strong')).toHaveText('5');
  await dialog.getByRole('button', { name: 'Enregistrer le projet', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.project-header .project-status')).toHaveText('Recette en arbitrage');
  await page.reload();
  await page.locator('.project-header').getByRole('button', { name: 'Paramètres du projet', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Paramètres du projet', exact: true });
  await expect(dialog.getByRole('combobox', { name: 'État', exact: true })).toHaveValue(statusDefinition.id);
  await expect(dialog.locator('.ci-strategic-note strong')).toHaveText('5');
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  await page.goto(`/#project/${project.id}/list`);
  await page.locator('.content-area').getByRole('button', { name: task.title, exact: true }).click();
  const taskDialog = page.getByRole('dialog', { name: 'Détail de la tâche', exact: true });
  await expect(taskDialog.getByLabel('Titre', { exact: true })).toBeDisabled();
  await expect(taskDialog.getByRole('button', { name: 'Enregistrer', exact: true })).toBeDisabled();
  await taskDialog.getByRole('button', { name: 'Fermer', exact: true }).click();
  expect((await request.patch(`/api/tasks/${task.id}`, { data: { title: 'Modification interdite' } })).status()).toBe(409);

  await page.goto('/#customization/project-statuses');
  page.once('dialog', confirmation => confirmation.accept());
  await page.getByRole('button', { name: 'Supprimer le statut Recette en arbitrage', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/utilisé|projet/i);
  await expect(page.getByRole('button', { name: 'Modifier le statut Recette en arbitrage', exact: true })).toBeVisible();
  await page.goto('/#customization/strategic-axes');
  page.once('dialog', confirmation => confirmation.accept());
  await page.getByRole('button', { name: 'Supprimer l’axe RECETTE INNOVATION', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/évalué|utilisé|projet/i);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('.sa-table-scroll').evaluate(element => { element.scrollLeft = 0; });
  await page.screenshot({ path: screenshotPath('customization-strategic-axes-desktop.png'), fullPage: true, animations: 'disabled' });
  let saved = await state(request);
  expect(saved.projects.find(item => item.id === project.id)).toMatchObject({
    status: 'paused', customStatusId: statusDefinition.id,
    strategicRatings: { [innovation.id]: 2, [rse.id]: -1 },
  });
  expect(saved.tasks.find(item => item.id === task.id)?.title).toBe(task.title);
  expect(saved.strategicAxes!.some(item => item.id === innovation.id)).toBe(true);

  await page.goto(`/#project/${project.id}/summary`);
  await page.locator('.project-header').getByRole('button', { name: 'Paramètres du projet', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Paramètres du projet', exact: true });
  await dialog.getByRole('combobox', { name: 'État', exact: true }).selectOption('open');
  await dialog.getByRole('button', { name: 'Enregistrer le projet', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  saved = await state(request);
  expect(saved.projects.find(item => item.id === project.id)).toMatchObject({ status: 'open', customStatusId: null });
  expect((await request.patch(`/api/tasks/${task.id}`, { data: { title: 'Recette tâche reprise' } })).ok()).toBe(true);
  expect(errors).toEqual([]);
});

test('personnalisation : les cinq vues accessibles dans la sidebar et les formulaires utilisables sur mobile', async ({ page, request }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await create<ProjectTemplate>(request, 'project-templates', {
    name: 'Recette modèle mobile', description: 'Préparer et réutiliser une structure de projet sur un écran étroit.',
    budget: 250, color: '#ff6b24', tasks: [],
  });
  await create<CustomFieldDefinition>(request, 'custom-field-definitions', { name: 'Recette champ mobile', scope: 'task', type: 'text', translations: { fr: 'Recette champ mobile', en: 'Mobile field' }, options: [] });
  await create<ProjectStatusDefinition>(request, 'project-status-definitions', { name: 'Recette statut mobile', description: 'Un statut ouvert configurable.', color: '#55b8b6', baseStatus: 'open' });
  await create<StrategicAxis>(request, 'strategic-axes', { code: 'RECETTE MOBILE', name: 'Lecture de la stratégie sur mobile', color: '#462182', weight: 5, scale: ['Très faible', 'Faible', 'Neutre', 'Fort', 'Très fort'] });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const routes = [
    ['project-templates', 'Modèles de projet', '.pc-view'],
    ['custom-fields', 'Champs personnalisés', '.cf-view'],
    ['report-templates', 'Modèle de compte rendu', '.rt-view'],
    ['project-statuses', 'Statuts de projet', '.pg-view'],
    ['strategic-axes', 'Axes stratégiques', '.sa-view'],
  ] as const;
  for (const [route, label, selector] of routes) {
    await page.getByRole('button', { name: 'Ouvrir le menu', exact: true }).click();
    const sidebar = page.getByRole('complementary', { name: 'Navigation principale', exact: true });
    const group = sidebar.getByRole('button', { name: 'Personnalisation', exact: true });
    if (await group.getAttribute('aria-expanded') !== 'true') await group.click();
    await expect(sidebar.getByRole('button', { name: label, exact: true })).toHaveCount(1);
    await sidebar.getByRole('button', { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#customization/${route}$`));
    await expect(page.locator(selector)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Fermer le menu', exact: true })).not.toBeVisible();
    await noPageOverflow(page);
    await withinViewport(page, page.locator(selector));
  }
  const axes = page.getByRole('region', { name: 'Liste des axes stratégiques', exact: true });
  await withinViewport(page, axes);
  expect(await axes.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await page.screenshot({ path: screenshotPath('customization-strategic-axes-mobile.png'), fullPage: true, animations: 'disabled' });

  await page.goto('/#customization/project-templates');
  const card = page.getByRole('article', { name: 'Modèle Recette modèle mobile', exact: true });
  await withinViewport(page, card);
  await page.screenshot({ path: screenshotPath('customization-project-templates-mobile.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Modèle', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Nouveau modèle de projet', exact: true });
  await withinViewport(page, editor);
  await editor.getByLabel('Nom du modèle', { exact: true }).fill('Recette modèle rédigé sur mobile');
  await editor.getByRole('button', { name: 'Ajouter une tâche', exact: true }).click();
  await editor.getByLabel('Titre de l’élément', { exact: true }).fill('Recette élément mobile');
  await editor.getByLabel('Début : décalage en jours', { exact: true }).fill('0');
  await editor.getByLabel('Fin : décalage en jours', { exact: true }).fill('2');
  await page.screenshot({ path: screenshotPath('customization-template-form-mobile.png'), fullPage: true, animations: 'disabled' });
  await editor.getByRole('button', { name: 'Créer le modèle', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(page.getByRole('article', { name: 'Modèle Recette modèle rédigé sur mobile', exact: true })).toBeVisible();
  await page.reload();
  expect((await state(request)).projectTemplates!.find(item => item.name === 'Recette modèle rédigé sur mobile')?.tasks[0]).toMatchObject({ title: 'Recette élément mobile', startOffsetDays: 0, endOffsetDays: 2 });
  await page.goto('/#customization/custom-fields');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  const fieldDialog = page.getByRole('dialog', { name: 'Nouveau champ personnalisé', exact: true });
  await withinViewport(page, fieldDialog);
  await fieldDialog.getByLabel('Nom', { exact: true }).fill('Recette choix mobile');
  await fieldDialog.getByRole('combobox', { name: 'Type de champ', exact: true }).selectOption('select');
  await fieldDialog.getByLabel('Options (une par ligne)', { exact: true }).fill('Faible\nFort');
  await page.screenshot({ path: screenshotPath('customization-field-form-mobile.png'), fullPage: true, animations: 'disabled' });
  await fieldDialog.getByRole('button', { name: 'Créer le champ', exact: true }).click();
  await expect(fieldDialog).not.toBeVisible();
  await page.reload();
  await expect(page.locator('.cf-accordion').filter({ hasText: 'Recette choix mobile' })).toBeVisible();
  await noPageOverflow(page);
  await page.goto('/#customization/report-templates');
  await page.screenshot({ path: screenshotPath('customization-report-template-mobile.png'), fullPage: true, animations: 'disabled' });
  await noPageOverflow(page);
  expect(errors).toEqual([]);
});
