import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import type { AppData, DocumentFolder, Project, ProjectDocument, Resource, Task, TimeEntry } from '../../shared/types';
import type { CustomFieldDefinition } from '../../shared/customization';
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
    startDate: '2026-01-01', endDate: '2027-12-31', description: `Projet isolé de recette : ${name}.`,
  });
}
function task(request: APIRequestContext, owner: Project, title: string, extra: Record<string, unknown> = {}) {
  return create<Task>(request, 'tasks', {
    projectId: owner.id, title, startDate: '2026-01-05', endDate: '2026-01-09',
    allocatedHours: 16, progress: 0, status: 'todo', phase: 'Recette des évolutions', kind: 'task', ...extra,
  });
}
function captureErrors(page: Page) { const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); return errors; }
async function screenshot(page: Page, name: string) {
  const filename = `folders-capacity-time-${name}.png`;
  const path = test.info().project.testDir.endsWith('cloudflare-browser') ? test.info().outputPath(filename) : `docs/screenshots/${filename}`;
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
async function createFolder(page: Page, name: string) {
  await page.getByRole('button', { name: 'Nouveau dossier', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Créer un dossier', exact: true });
  await dialog.getByLabel('Nom du dossier', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Créer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

test('dossiers : hiérarchie du projet, déplacement de documents, racine préservée et suppression des seuls dossiers vides', async ({ page, request }) => {
  test.setTimeout(70_000);
  const errors = captureErrors(page);
  const owner = await project(request, 'Dossiers projet de recette');
  const other = await project(request, 'Dossiers projet étranger');
  const legacy = await create<ProjectDocument>(request, 'project-documents', { projectId: owner.id, name: 'Dossiers document historique racine', kind: 'link', url: 'https://example.com/historique' });
  const foreign = await create<DocumentFolder>(request, 'document-folders', { projectId: other.id, name: 'Dossiers étrangers' });
  await create<ProjectDocument>(request, 'project-documents', { projectId: other.id, folderId: foreign.id, name: 'Dossiers document étranger', kind: 'link', url: 'https://example.com/etranger' });
  await page.goto(`/#project/${owner.id}/documents`);
  const documents = page.getByRole('region', { name: 'Documents du projet', exact: true });
  await expect(documents.getByRole('button', { name: legacy.name, exact: true })).toBeVisible();
  await createFolder(page, 'Dossiers Contrats');
  await documents.getByRole('button', { name: 'Ouvrir le dossier Dossiers Contrats', exact: true }).click();
  await createFolder(page, 'Dossiers Annexes');
  await documents.getByRole('button', { name: 'Ouvrir le dossier Dossiers Annexes', exact: true }).click();
  await page.getByRole('button', { name: 'Ajouter un lien', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Ajouter un lien web', exact: true });
  await dialog.getByLabel('Nom du document', { exact: true }).fill('Dossiers lien dans annexes');
  await dialog.getByLabel('Lien web', { exact: true }).fill('https://example.com/annexe');
  await dialog.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  let stored = await state(request);
  const parent = stored.documentFolders!.find(folder => folder.projectId === owner.id && folder.name === 'Dossiers Contrats')!;
  const child = stored.documentFolders!.find(folder => folder.projectId === owner.id && folder.name === 'Dossiers Annexes')!;
  const linked = stored.projectDocuments!.find(document => document.projectId === owner.id && document.name === 'Dossiers lien dans annexes')!;
  expect(child.parentId).toBe(parent.id);
  expect(linked.folderId).toBe(child.id);
  expect(stored.projectDocuments!.find(document => document.id === legacy.id)?.folderId ?? null).toBeNull();
  await expect(documents.getByRole('button', { name: `Supprimer le dossier ${child.name}`, exact: true })).toBeDisabled();
  await page.getByRole('navigation', { name: 'Chemin du dossier', exact: true }).getByRole('button', { name: 'Documents', exact: true }).click();
  await expect(documents.getByRole('button', { name: `Supprimer le dossier ${parent.name}`, exact: true })).toBeDisabled();
  await expect(documents.getByRole('button', { name: legacy.name, exact: true })).toBeVisible();
  await documents.getByRole('button', { name: `Modifier le dossier ${parent.name}`, exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Modifier le dossier', exact: true });
  const parentOptions = await dialog.getByRole('combobox', { name: 'Dossier parent', exact: true }).locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
  expect(parentOptions).not.toContain(parent.id);
  expect(parentOptions).not.toContain(child.id);
  expect(parentOptions).not.toContain(foreign.id);
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  await page.getByLabel('Rechercher un document', { exact: true }).fill('lien dans annexes');
  await expect(documents.getByRole('button', { name: linked.name, exact: true })).toBeVisible();
  await documents.getByRole('button', { name: `Modifier ${linked.name}`, exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Modifier le document', exact: true });
  const destination = dialog.getByRole('combobox', { name: 'Dossier du document', exact: true });
  await expect(destination.locator(`option[value="${foreign.id}"]`)).toHaveCount(0);
  await destination.selectOption(parent.id);
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByLabel('Rechercher un document', { exact: true }).fill('');
  await documents.getByRole('button', { name: `Ouvrir le dossier ${parent.name}`, exact: true }).click();
  await expect(documents.getByRole('button', { name: linked.name, exact: true })).toBeVisible();
  await expect(documents).not.toContainText('Dossiers document étranger');
  await screenshot(page, 'documents-desktop');
  page.once('dialog', confirmation => confirmation.accept());
  await documents.getByRole('button', { name: `Supprimer le dossier ${child.name}`, exact: true }).click();
  await expect(documents.getByRole('button', { name: `Ouvrir le dossier ${child.name}`, exact: true })).toHaveCount(0);
  await page.reload();
  await documents.getByRole('button', { name: `Ouvrir le dossier ${parent.name}`, exact: true }).click();
  await expect(documents.getByRole('button', { name: linked.name, exact: true })).toBeVisible();
  stored = await state(request);
  expect(stored.documentFolders!.some(folder => folder.id === child.id)).toBe(false);
  expect(stored.projectDocuments!.find(document => document.id === linked.id)?.folderId).toBe(parent.id);
  expect(stored.projectDocuments!.find(document => document.id === legacy.id)).toEqual(legacy);
  await page.setViewportSize({ width: 390, height: 844 });
  await noPageOverflow(page);
  await page.getByRole('button', { name: 'Nouveau dossier', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Créer un dossier', exact: true });
  await withinViewport(page, dialog);
  await screenshot(page, 'documents-mobile');
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  await patch(request, 'projects', owner.id, { status: 'paused' });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Nouveau dossier', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Ajouter un document', exact: true })).toBeDisabled();
  await documents.getByRole('button', { name: `Ouvrir le dossier ${parent.name}`, exact: true }).click();
  await expect(documents.getByRole('button', { name: linked.name, exact: true })).toBeVisible();
  await expect(documents.getByRole('button', { name: `Modifier ${linked.name}`, exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

const planningRow = (page: Page, resource: Resource) => page.locator('.rpv-resource-row').filter({ has: page.getByRole('button', { name: `Ouvrir la fiche de ${resource.name}`, exact: true }) });
async function resourceLabelsContained(row: Locator) {
  expect(await row.locator('.rpv-resource-column').evaluate(cell => {
    const limit = cell.getBoundingClientRect();
    return [...cell.querySelectorAll<HTMLElement>('.rpv-resource-link, .rpv-job-title')].every(label => {
      const bounds = label.getBoundingClientRect();
      const overflow = getComputedStyle(label).overflowX;
      return bounds.x >= limit.x && bounds.right <= limit.right + 1
        && (label.scrollWidth <= label.clientWidth + 1 || overflow === 'hidden' || overflow === 'clip');
    });
  })).toBe(true);
}
async function setPlanningYear(page: Page, year: number) {
  await page.getByLabel('Année de planification', { exact: true }).fill(String(year));
  await page.getByLabel('Année de planification', { exact: true }).press('Enter');
}

test('capacité : douze mois calculés depuis la semaine de la ressource, fériés et union des absences, mise à jour de la fiche', async ({ page, request }) => {
  test.setTimeout(65_000);
  const errors = captureErrors(page);
  const resource = await create<Resource>(request, 'resources', {
    name: 'Capacité hebdomadaire avec absences', jobTitle: 'Temps partiel', type: 'human',
    weeklyCapacityHours: [8, 4, 0, 8, 8, 0, 0], hoursPerDay: 8, holidayCalendarId: 'fr', capacityUnit: 'days',
  });
  const outside = await create<Resource>(request, 'resources', { name: 'Capacité absences autre personne', weeklyCapacityHours: [8, 8, 8, 8, 8, 0, 0] });
  await create(request, 'unavailabilities', { title: 'Capacité lundi indisponible', resourceId: resource.id, reason: 'leave', allDay: true, startDate: '2026-01-05', endDate: '2026-01-05' });
  await create(request, 'unavailabilities', { title: 'Capacité mardi première plage', resourceId: resource.id, reason: 'other', allDay: false, startDate: '2026-01-06', endDate: '2026-01-06', startTime: '09:00', endTime: '11:00' });
  await create(request, 'unavailabilities', { title: 'Capacité mardi plage chevauchante', resourceId: resource.id, reason: 'other', allDay: false, startDate: '2026-01-06', endDate: '2026-01-06', startTime: '10:00', endTime: '12:00' });
  await create(request, 'unavailabilities', { title: 'Capacité absence étrangère', resourceId: outside.id, reason: 'leave', allDay: true, startDate: '2026-01-01', endDate: '2026-01-31' });
  await page.goto('/#resources/capacity');
  await expect(page.getByRole('heading', { name: 'Capacité', exact: true })).toBeVisible();
  await setPlanningYear(page, 2026);
  await page.getByRole('combobox', { name: 'Choisir une ressource', exact: true }).selectOption(resource.id);
  await expect(page.locator('.rpv-table thead th')).toHaveCount(13);
  const row = planningRow(page, resource);
  await expect(row.locator('td').nth(0)).toHaveText('13,63'); // January: 120 h after New Year's Day, minus 8 h and 3 h of unioned absences.
  await page.getByRole('combobox', { name: 'Unité de planification', exact: true }).selectOption('hours');
  await expect(row.locator('td').nth(0)).toHaveText('109');
  await expect(row.locator('td').nth(1)).toHaveText('112');
  await expect(row.locator('td').nth(2)).toHaveText('124');
  await page.getByRole('combobox', { name: 'Vue de planification', exact: true }).selectOption('weekly');
  await expect(page.locator('.rpv-table thead th')).toHaveCount(54);
  await expect(row.locator('td').nth(0)).toHaveText('8'); // The first bucket counts only 1–4 January.
  await expect(row.locator('td').nth(1)).toHaveText('17');
  await expect(page.locator('.rpv-table thead th').nth(1)).toHaveAttribute('title', '01/01/2026 – 04/01/2026');
  await page.getByRole('combobox', { name: 'Vue de planification', exact: true }).selectOption('monthly');
  await row.getByRole('button', { name: `Ouvrir la fiche de ${resource.name}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Fiche ressource', exact: true });
  await dialog.getByLabel('Capacité du lundi (jours/jour)', { exact: true }).fill('0.5');
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(row.locator('td').nth(0)).toHaveText('97');
  await expect(row.locator('td').nth(1)).toHaveText('96');
  expect((await state(request)).resources.find(item => item.id === resource.id)?.weeklyCapacityHours).toEqual([4, 4, 0, 8, 8, 0, 0]);
  await page.reload();
  await setPlanningYear(page, 2026);
  await page.getByRole('combobox', { name: 'Choisir une ressource', exact: true }).selectOption(resource.id);
  await page.getByRole('combobox', { name: 'Unité de planification', exact: true }).selectOption('hours');
  await expect(row.locator('td').nth(0)).toHaveText('97');
  await page.getByRole('button', { name: 'Année suivante', exact: true }).click();
  await expect(page.getByLabel('Année de planification', { exact: true })).toHaveValue('2027');
  await expect(row.locator('td').nth(0)).toHaveText('96');
  await page.getByRole('button', { name: 'Année précédente', exact: true }).click();
  await expect(row.locator('td').nth(0)).toHaveText('97');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await screenshot(page, 'capacity-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await noPageOverflow(page);
  const scroller = page.locator('.rpv-table-scroll');
  expect(await scroller.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await scroller.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await expect(page.locator('.rpv-table thead th').last()).toBeVisible();
  await resourceLabelsContained(row);
  await screenshot(page, 'capacity-mobile');
  expect(errors).toEqual([]);
});

test('charge et occupation : sommes des projets, branches, couleurs de surcharge et charge visible avec capacité nulle', async ({ page, request }) => {
  test.setTimeout(65_000);
  const errors = captureErrors(page);
  const owner = await project(request, 'Occupation projet principal');
  const other = await project(request, 'Occupation projet secondaire');
  const third = await project(request, 'Occupation projet étranger');
  const overloaded = await create<Resource>(request, 'resources', { name: 'Occupation surcharge rouge', weeklyCapacityHours: [8, 8, 8, 8, 8, 0, 0], hoursPerDay: 8, holidayCalendarId: 'none' });
  const warning = await create<Resource>(request, 'resources', { name: 'Occupation surcharge orange', weeklyCapacityHours: [8, 8, 8, 8, 8, 0, 0], hoursPerDay: 8, holidayCalendarId: 'none' });
  const zero = await create<Resource>(request, 'resources', { name: 'Occupation sans capacité', weeklyCapacityHours: [0, 0, 0, 0, 0, 0, 0], hoursPerDay: 8, holidayCalendarId: 'none' });
  const material = await create<Resource>(request, 'resources', { name: 'Occupation matériel filtré', type: 'material' });
  await task(request, owner, 'Occupation allocation principale', { assigneeId: overloaded.id, allocatedHours: 250 });
  await task(request, other, 'Occupation allocation secondaire', { assigneeId: overloaded.id, allocatedHours: 20 });
  await task(request, owner, 'Occupation allocation orange', { assigneeId: warning.id, allocatedHours: 200 });
  await task(request, owner, 'Occupation allocation sans capacité', { assigneeId: zero.id, allocatedHours: 8 });
  await task(request, third, 'Occupation allocation autre ressource', { assigneeId: material.id, allocatedHours: 999 });
  await task(request, owner, 'Occupation tâche non datée', { assigneeId: overloaded.id, allocatedHours: 888, startDate: null, endDate: null });
  await page.goto('/#resources/load');
  await setPlanningYear(page, 2026);
  await page.getByRole('combobox', { name: 'Choisir une ressource', exact: true }).selectOption(overloaded.id);
  let row = planningRow(page, overloaded);
  await expect(row.locator('td').nth(0)).toHaveText('33,75 / 22');
  await expect(row.locator('td').nth(0)).toHaveClass(/rpv-overload-text/);
  await expect(page.locator('.rpv-notes')).toContainText('1 tâche allouée sans dates complètes');
  await page.getByRole('combobox', { name: 'Unité de planification', exact: true }).selectOption('hours');
  await expect(row.locator('td').nth(0)).toHaveText('270 / 176');
  await row.getByRole('button', { name: `Déplier les projets de ${overloaded.name}`, exact: true }).click();
  const branches = page.locator('.rpv-project-row');
  await expect(branches).toHaveCount(2);
  await expect(branches.filter({ hasText: owner.name }).locator('td').nth(0)).toHaveText('250');
  await expect(branches.filter({ hasText: other.name }).locator('td').nth(0)).toHaveText('20');
  await expect(branches.filter({ hasText: third.name })).toHaveCount(0);
  await page.getByRole('button', { name: 'Replier toutes les ressources', exact: true }).click();
  await expect(branches).toHaveCount(0);
  await page.getByRole('button', { name: 'Déplier toutes les ressources', exact: true }).click();
  await expect(branches).toHaveCount(2);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await screenshot(page, 'load-desktop');
  await page.goto('/#resources/occupancy');
  await setPlanningYear(page, 2026);
  row = planningRow(page, overloaded);
  await expect(row.locator('td').nth(0)).toHaveText('153,4 %');
  await expect(row.locator('td').nth(0)).toHaveClass(/rpv-heat-overload/);
  await expect(planningRow(page, warning).locator('td').nth(0)).toHaveText('113,6 %');
  await expect(planningRow(page, warning).locator('td').nth(0)).toHaveClass(/rpv-heat-warning/);
  await expect(planningRow(page, warning).locator('td').nth(1)).toHaveText('0 %');
  await expect(planningRow(page, warning).locator('td').nth(1)).toHaveClass(/rpv-heat-normal/);
  await expect(planningRow(page, zero).locator('td').nth(0)).toHaveText('—');
  await expect(planningRow(page, zero).locator('td').nth(0)).toHaveClass(/rpv-heat-unavailable/);
  await expect(planningRow(page, zero).locator('td').nth(0)).toHaveAttribute('title', /Charge 1 j, capacité 0 j.*taux non calculable/);
  await planningRow(page, zero).getByRole('button', { name: `Déplier les projets de ${zero.name}`, exact: true }).click();
  await expect(branches.filter({ hasText: owner.name }).locator('td').nth(0)).toHaveText('1');
  await page.getByRole('combobox', { name: 'Filtrer le type de ressources', exact: true }).selectOption('material');
  await expect(planningRow(page, material)).toBeVisible();
  await expect(planningRow(page, overloaded)).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Filtrer le type de ressources', exact: true }).selectOption('all');
  await page.getByRole('combobox', { name: 'Choisir une ressource', exact: true }).selectOption(overloaded.id);
  await row.getByRole('button', { name: `Ouvrir la fiche de ${overloaded.name}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Fiche ressource', exact: true });
  await dialog.getByLabel('Unité de capacité', { exact: true }).selectOption('hours');
  await dialog.getByLabel('Capacité du lundi (h/jour)', { exact: true }).fill('4');
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(row.locator('td').nth(0)).toHaveText('168,8 %'); // 270 h stays planned; January capacity becomes 160 h.
  await expect(row.locator('td').nth(0)).toHaveAttribute('title', /Charge 33,75 j, capacité 20 j/);
  await page.getByRole('combobox', { name: 'Choisir une ressource', exact: true }).selectOption('');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await planningRow(page, warning).scrollIntoViewIfNeeded();
  await screenshot(page, 'occupancy-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await noPageOverflow(page);
  await resourceLabelsContained(planningRow(page, overloaded));
  await resourceLabelsContained(planningRow(page, warning));
  await screenshot(page, 'occupancy-mobile');
  expect(errors).toEqual([]);
});

test('navigation : mon espace réunit synthèse, discussions et temps, Gestion ouvre les trois vues de planification', async ({ page }) => {
  const errors = captureErrors(page);
  await page.goto('/#personal');
  const sidebar = page.getByRole('complementary', { name: 'Navigation principale', exact: true });
  await expect(sidebar.getByRole('button', { name: 'Mon espace', exact: true })).toHaveCount(1);
  await expect(sidebar.getByRole('button', { name: 'Suivi temporel', exact: true })).toHaveCount(0);
  await expect(sidebar.getByRole('button', { name: 'Mes discussions', exact: true })).toHaveCount(0);
  const tabs = page.getByRole('navigation', { name: 'Vues de mon espace', exact: true });
  await expect(tabs.getByRole('link', { name: 'Ma synthèse', exact: true })).toHaveAttribute('aria-current', 'page');
  await tabs.getByRole('link', { name: 'Mes discussions', exact: true }).click();
  await expect(page).toHaveURL(/#discussions$/);
  await expect(sidebar.getByRole('button', { name: 'Mon espace', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(tabs.getByRole('link', { name: 'Mes discussions', exact: true })).toHaveAttribute('aria-current', 'page');
  await tabs.getByRole('link', { name: 'Suivi temporel', exact: true }).click();
  await expect(page).toHaveURL(/#time$/);
  await expect(tabs.getByRole('link', { name: 'Suivi temporel', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(sidebar.getByRole('button', { name: 'Mon espace', exact: true })).toHaveAttribute('aria-current', 'page');
  await sidebar.getByRole('button', { name: 'Gestion', exact: true }).click();
  await expect(sidebar.getByRole('button', { name: 'Vue d’ensemble', exact: true })).toHaveCount(0);
  for (const [label, route, action] of [['Capacité', 'capacity', 'Ouvrir la capacité'], ['Charge prévisionnelle', 'load', 'Ouvrir la charge prévisionnelle'], ['Taux d’occupation', 'occupancy', 'Ouvrir le taux d’occupation']] as const) {
    await sidebar.getByRole('button', { name: action, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#resources/${route}$`));
    await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: action, exact: true })).toHaveClass(/active/);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#discussions');
  await noPageOverflow(page);
  await expect(tabs.getByRole('link', { name: 'Mes discussions', exact: true })).toHaveAttribute('aria-current', 'page');
  await screenshot(page, 'personal-navigation-mobile');
  expect(errors).toEqual([]);
});

test('saisies de temps : champs personnalisés typés, formule dynamique, sauvegarde et consultation de la saisie validée', async ({ page, request }) => {
  test.setTimeout(90_000);
  const errors = captureErrors(page);
  const owner = await project(request, 'Saisies personnalisées projet');
  const data = await state(request);
  const own = data.resources.find(resource => resource.id === data.currentUser.id)!;
  const item = await task(request, owner, 'Saisies personnalisées tâche', { assigneeId: own.id, startDate: '2026-10-05', endDate: '2026-10-09' });
  await page.goto('/#customization/custom-fields');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Nouveau champ personnalisé', exact: true });
  await dialog.getByLabel('Nom', { exact: true }).fill('Saisie référence');
  await dialog.getByRole('combobox', { name: 'Éléments concernés', exact: true }).selectOption('time-entry');
  await dialog.getByRole('combobox', { name: 'Type de champ', exact: true }).selectOption('text');
  await dialog.getByRole('button', { name: 'Créer le champ', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const specs = [
    ['rich_text', 'Saisie détails', {}], ['multi_select', 'Saisie activités', { options: ['Analyse', 'Tests', 'Documentation'] }],
    ['select', 'Saisie nature', { options: ['Facturable', 'Interne'] }], ['formula', 'Saisie coût calculé', { formula: '{hours} * 100' }],
    ['image', 'Saisie image', {}], ['url', 'Saisie lien', {}], ['number', 'Saisie nombre', {}], ['date', 'Saisie livraison', {}],
  ] as const;
  for (const [type, name, extra] of specs) await create<CustomFieldDefinition>(request, 'custom-field-definitions', { name, scope: 'time-entry', type, translations: { fr: name, en: '' }, options: [], ...extra });
  const unrelated = await create<CustomFieldDefinition>(request, 'custom-field-definitions', { name: 'Saisie champ tâche étranger', scope: 'task', type: 'text', translations: { fr: 'Saisie champ tâche étranger', en: '' }, options: [] });
  const legacy = await create<TimeEntry>(request, 'time-entries', { taskId: item.id, resourceId: own.id, date: '2026-10-05', hours: 1.75, note: 'Saisie historique avant les champs' });
  await page.goto(`/#project/${owner.id}/time`);
  await page.reload(); // The extra definitions were seeded through the API after opening the catalog.
  await page.getByLabel('Date de la semaine', { exact: true }).fill('2026-10-06');
  await page.getByRole('button', { name: 'Saisir du temps', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Saisir du temps', exact: true });
  await dialog.getByRole('combobox', { name: 'Tâche', exact: true }).selectOption(item.id);
  await dialog.getByRole('combobox', { name: 'Ressource', exact: true }).selectOption(own.id);
  await dialog.getByLabel('Date', { exact: true }).fill('2026-10-06');
  await dialog.getByLabel('Temps passé (heures)', { exact: true }).fill('2.5');
  await dialog.getByLabel('Note', { exact: true }).fill('Saisie complète avec champs');
  await dialog.getByLabel('Saisie référence', { exact: true }).fill('TICKET-42');
  await dialog.getByLabel('Saisie détails', { exact: true }).fill('**Compte rendu de travail**\n- Tests réalisés');
  await dialog.getByRole('group', { name: 'Saisie activités', exact: true }).getByRole('checkbox', { name: 'Tests', exact: true }).check();
  await dialog.getByRole('group', { name: 'Saisie activités', exact: true }).getByRole('checkbox', { name: 'Documentation', exact: true }).check();
  await dialog.getByRole('combobox', { name: 'Saisie nature', exact: true }).selectOption('Facturable');
  await dialog.getByLabel('Saisie lien', { exact: true }).fill('https://example.com/ticket/42');
  await dialog.getByLabel('Saisie nombre', { exact: true }).fill('3.75');
  await dialog.getByLabel('Saisie livraison', { exact: true }).fill('2026-10-07');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
  await page.evaluate(() => {
    const read = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (file: Blob) { window.setTimeout(() => read.call(this, file), 800); };
  });
  await dialog.getByLabel('Choisir une image pour Saisie image', { exact: true }).setInputFiles({ name: 'preuve-saisie.png', mimeType: 'image/png', buffer: png });
  await expect(dialog.getByRole('button', { name: 'Lecture de l’image…', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Fermer le formulaire', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('img', { name: 'Saisie image – aperçu', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Enregistrer', exact: true })).toBeEnabled();
  await expect(dialog.getByLabel('Saisie coût calculé', { exact: true })).toHaveValue('250');
  await expect(dialog.getByLabel('Saisie coût calculé', { exact: true })).toHaveAttribute('readonly', '');
  await expect(dialog.getByLabel(unrelated.name, { exact: true })).toHaveCount(0);
  await screenshot(page, 'time-fields-desktop');
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  let stored = await state(request);
  const definitions = new Map(stored.customFieldDefinitions!.filter(field => field.scope === 'time-entry').map(field => [field.name, field]));
  const entry = stored.timeEntries.find(candidate => candidate.note === 'Saisie complète avec champs')!;
  expect(entry.customValues![definitions.get('Saisie référence')!.id]).toBe('TICKET-42');
  expect(JSON.parse(entry.customValues![definitions.get('Saisie activités')!.id])).toEqual(['Tests', 'Documentation']);
  expect(entry.customValues![definitions.get('Saisie image')!.id]).toBe(`data:image/png;base64,${png.toString('base64')}`);
  expect(entry.customValues![definitions.get('Saisie coût calculé')!.id]).toBeUndefined();
  const snapshot = { rateSnapshot: entry.rateSnapshot, eqjtSnapshot: entry.eqjtSnapshot, taskId: entry.taskId, resourceId: entry.resourceId };
  await page.reload();
  await page.getByLabel('Date de la semaine', { exact: true }).fill('2026-10-06');
  const history = page.getByRole('table', { name: 'Saisies de la semaine', exact: true });
  let row = history.getByRole('row').filter({ hasText: entry.note });
  await row.getByRole('button', { name: /^Modifier la saisie/ }).click();
  dialog = page.getByRole('dialog', { name: 'Modifier la saisie de temps', exact: true });
  await expect(dialog.getByLabel('Saisie référence', { exact: true })).toHaveValue('TICKET-42');
  await expect(dialog.getByRole('group', { name: 'Saisie activités', exact: true }).getByRole('checkbox', { name: 'Tests', exact: true })).toBeChecked();
  await dialog.getByLabel('Temps passé (heures)', { exact: true }).fill('3.25');
  await dialog.getByLabel('Saisie référence', { exact: true }).fill('TICKET-42 corrigé');
  await expect(dialog.getByLabel('Saisie coût calculé', { exact: true })).toHaveValue('325');
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  row = history.getByRole('row').filter({ hasText: entry.note });
  await row.getByRole('button', { name: /^Valider :/ }).click();
  await expect(row.getByRole('button', { name: /^Modifier la saisie/ })).toBeDisabled();
  await row.getByRole('button', { name: /^Consulter la saisie/ }).click();
  dialog = page.getByRole('dialog', { name: 'Consulter la saisie de temps', exact: true });
  await expect(dialog).toContainText('TICKET-42 corrigé');
  await expect(dialog).toContainText('325');
  await expect(dialog.getByRole('button', { name: 'Enregistrer', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await withinViewport(page, dialog);
  await noPageOverflow(page);
  await screenshot(page, 'time-fields-mobile');
  await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
  stored = await state(request);
  expect(stored.timeEntries.find(candidate => candidate.id === entry.id)).toMatchObject({ ...snapshot, hours: 3.25, validated: true });
  expect(stored.timeEntries.find(candidate => candidate.id === legacy.id)).toEqual(legacy);
  expect(errors).toEqual([]);
});
