import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import type { AppData, Project, Resource, Task, TimeEntry } from '../../shared/types';
import { loginTestAdmin } from '../auth-fixture';

test.beforeEach(async ({ page, request }) => {
  await loginTestAdmin(page.request);
  await loginTestAdmin(request);
});

async function fixture(request: APIRequestContext, suffix: string) {
  const data = await (await request.get('/api/state')).json() as AppData;
  const personal = data.resources.find(resource => resource.id === data.currentUser.id)!;
  const colleague = data.resources.find(resource => resource.active && resource.type === 'human' && resource.id !== personal.id)!;
  const projectResponse = await request.post('/api/projects', { data: {
    name: `Projet suivi hebdomadaire ${suffix}`, zoneId: data.zones[0].id,
    startDate: '2026-10-01', endDate: '2028-01-31', status: 'open',
  } });
  expect(projectResponse.ok()).toBeTruthy();
  const project = await projectResponse.json() as Project;
  async function createTask(resource: Resource, title: string, allocatedHours: number) {
    const response = await request.post('/api/tasks', { data: {
      projectId: project.id, title: `${title} ${suffix}`, phase: `Phase hebdomadaire ${suffix}`,
      assigneeId: resource.id, allocatedHours, startDate: '2026-10-05', endDate: '2028-01-31',
    } });
    expect(response.ok()).toBeTruthy();
    return await response.json() as Task;
  }
  const task = await createTask(personal, 'Tâche personnelle', 16);
  const colleagueTask = await createTask(colleague, 'Tâche de l’équipe', 10);
  return { project, task, colleagueTask, personal, colleague };
}

async function record(request: APIRequestContext, task: Task, resource: Resource, date: string, hours: number, note: string) {
  const response = await request.post('/api/time-entries', { data: { taskId: task.id, resourceId: resource.id, date, hours, note } });
  expect(response.ok()).toBeTruthy();
  return await response.json() as TimeEntry;
}

function matrix(page: Page) { return page.getByRole('table', { name: 'Suivi temporel hebdomadaire', exact: true }); }
function screenshotPath(name: string) {
  return test.info().project.testDir.endsWith('cloudflare-browser') ? test.info().outputPath(name) : `docs/screenshots/${name}`;
}
function projectRow(page: Page, project: Project, resource: Resource) {
  return matrix(page).locator(`tr[data-row-kind="project"][data-project-id="${project.id}"][data-resource-id="${resource.id}"]`);
}
function taskRow(page: Page, task: Task, resource: Resource) {
  return matrix(page).locator(`tr[data-row-kind="task"][data-task-id="${task.id}"][data-resource-id="${resource.id}"]`);
}
async function expectNumber(cell: Locator, value: number) {
  await expect.poll(async () => Number((await cell.innerText()).replace(/\s/g, '').replace(',', '.').replace(/[^\d.\-]/g, ''))).toBe(value);
}
async function selectWeek(page: Page, date = '2026-10-06') {
  await page.getByLabel('Date de la semaine', { exact: true }).fill(date);
}

test('grille personnelle puis équipe : heures de chaque jour et totaux du projet sans double comptage', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const { project, task, colleagueTask, personal, colleague } = await fixture(request, 'totaux');
  await record(request, task, personal, '2026-10-05', 2.25, 'Lundi hebdo');
  await record(request, task, personal, '2026-10-06', 1.75, 'Mardi hebdo');
  await record(request, task, personal, '2026-10-11', 5, 'Dimanche hebdo');
  await record(request, task, personal, '2026-09-28', 3, 'Historique avant cette semaine');
  await record(request, colleagueTask, colleague, '2026-10-07', 4, 'Équipe mercredi hebdo');

  await page.goto('/#time');
  await expect(page.getByRole('button', { name: 'Personnel', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('combobox', { name: 'Projet', exact: true })).toHaveValue('');
  await expect(matrix(page).locator('tr[data-row-kind="resource"]')).toHaveCount(1);
  await expect(projectRow(page, project, personal)).toBeVisible();
  await selectWeek(page);
  await expect(page.getByLabel('Date de la semaine', { exact: true })).toHaveValue('2026-10-05');
  await page.screenshot({ path: screenshotPath('time-personnel.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('combobox', { name: 'Projet', exact: true }).selectOption(project.id);

  const personalProject = projectRow(page, project, personal);
  await expectNumber(personalProject.locator('[data-date="2026-10-05"]'), 2.25);
  await expectNumber(personalProject.locator('[data-date="2026-10-06"]'), 1.75);
  await expectNumber(personalProject.locator('[data-date="2026-10-07"]'), 0);
  await expectNumber(personalProject.locator('[data-date="2026-10-11"]'), 5);
  await expectNumber(personalProject.locator('[data-summary="allocated"]'), 16);
  await expectNumber(personalProject.locator('[data-summary="spent"]'), 12);
  await expectNumber(personalProject.locator('[data-summary="week"]'), 9);
  await expectNumber(personalProject.locator('[data-summary="remaining"]'), 4);
  await expectNumber(taskRow(page, task, personal).locator('[data-summary="week"]'), 9);

  await page.getByRole('button', { name: 'Équipe', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Équipe', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const colleagueProject = projectRow(page, project, colleague);
  await expectNumber(colleagueProject.locator('[data-date="2026-10-07"]'), 4);
  await expectNumber(colleagueProject.locator('[data-summary="allocated"]'), 10);
  await expectNumber(colleagueProject.locator('[data-summary="spent"]'), 4);
  await expectNumber(colleagueProject.locator('[data-summary="week"]'), 4);
  await expectNumber(colleagueProject.locator('[data-summary="remaining"]'), 6);
  await expectNumber(personalProject.locator('[data-summary="allocated"]'), 16);
  await page.screenshot({ path: screenshotPath('time-equipe.png'), fullPage: true, animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('arborescence, mode Détails et navigation d’une semaine qui traverse le changement d’année', async ({ page, request }) => {
  const { project, task, personal } = await fixture(request, 'navigation');
  await record(request, task, personal, '2028-01-02', 2, 'Dimanche du nouvel an');
  await page.goto(`/#time/${project.id}`);
  await expect(page.getByRole('combobox', { name: 'Projet', exact: true })).toHaveValue(project.id);
  await expect(taskRow(page, task, personal)).toBeVisible();

  await projectRow(page, project, personal).getByRole('button', { name: `Replier ${project.name}`, exact: true }).click();
  await expect(taskRow(page, task, personal)).toHaveCount(0);
  await projectRow(page, project, personal).getByRole('button', { name: `Déplier ${project.name}`, exact: true }).click();
  await expect(taskRow(page, task, personal)).toBeVisible();
  await page.getByRole('checkbox', { name: 'Détails', exact: true }).uncheck();
  await expect(taskRow(page, task, personal)).toHaveCount(0);
  await expect(projectRow(page, project, personal)).toBeVisible();
  await page.getByRole('checkbox', { name: 'Détails', exact: true }).check();
  await expect(taskRow(page, task, personal)).toBeVisible();

  await selectWeek(page, '2028-01-02');
  await expect(page.getByLabel('Date de la semaine', { exact: true })).toHaveValue('2027-12-27');
  await expectNumber(taskRow(page, task, personal).locator('[data-date="2028-01-02"]'), 2);
  await expectNumber(projectRow(page, project, personal).locator('[data-summary="week"]'), 2);
  await page.getByRole('button', { name: 'Semaine suivante', exact: true }).click();
  await expect(page.getByLabel('Date de la semaine', { exact: true })).toHaveValue('2028-01-03');
  await expectNumber(projectRow(page, project, personal).locator('[data-summary="week"]'), 0);
  await expectNumber(projectRow(page, project, personal).locator('[data-summary="spent"]'), 2);
  await page.getByRole('button', { name: 'Semaine précédente', exact: true }).click();
  await expectNumber(projectRow(page, project, personal).locator('[data-summary="week"]'), 2);
});

test('saisie depuis une cellule, validation séparée, verrouillage puis correction et conservation après rechargement', async ({ page, request }) => {
  const { project, task, personal } = await fixture(request, 'saisie');
  await page.goto(`/#time/${project.id}`);
  await selectWeek(page);
  await taskRow(page, task, personal).locator('[data-date="2026-10-07"]').getByRole('button').click();
  let dialog = page.getByRole('dialog', { name: 'Saisir du temps', exact: true });
  await expect(dialog.getByRole('combobox', { name: 'Tâche', exact: true })).toHaveValue(task.id);
  await expect(dialog.getByRole('combobox', { name: 'Ressource', exact: true })).toHaveValue(personal.id);
  await expect(dialog.getByLabel('Date', { exact: true })).toHaveValue('2026-10-07');
  await dialog.getByLabel('Temps passé (heures)', { exact: true }).fill('1.25');
  await dialog.getByRole('textbox', { name: 'Note', exact: true }).fill('Saisie directe depuis la grille');
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expectNumber(taskRow(page, task, personal).locator('[data-date="2026-10-07"]'), 1.25);

  const history = page.getByRole('table', { name: 'Saisies de la semaine', exact: true });
  let entryRow = history.getByRole('row').filter({ hasText: 'Saisie directe depuis la grille' });
  await entryRow.getByRole('button', { name: /^Valider :/ }).click();
  await expect(entryRow.getByRole('button', { name: /^Retirer la validation :/ })).toBeVisible();
  await expect(entryRow.getByRole('button', { name: /^Modifier la saisie/ })).toBeDisabled();
  await expect(entryRow.getByRole('button', { name: /^Supprimer la saisie/ })).toBeDisabled();
  let state = await (await request.get('/api/state')).json() as AppData;
  expect(state.timeEntries.find(entry => entry.note === 'Saisie directe depuis la grille')).toMatchObject({
    taskId: task.id, resourceId: personal.id, date: '2026-10-07', hours: 1.25, validated: true,
  });

  await entryRow.getByRole('button', { name: /^Retirer la validation :/ }).click();
  await entryRow.getByRole('button', { name: /^Modifier la saisie/ }).click();
  dialog = page.getByRole('dialog', { name: /Modifier/ });
  await dialog.getByLabel('Temps passé (heures)', { exact: true }).fill('2.75');
  await dialog.getByRole('textbox', { name: 'Note', exact: true }).fill('Saisie de la grille corrigée');
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expectNumber(taskRow(page, task, personal).locator('[data-date="2026-10-07"]'), 2.75);
  await page.reload();
  await selectWeek(page);
  await expectNumber(taskRow(page, task, personal).locator('[data-date="2026-10-07"]'), 2.75);
  entryRow = history.getByRole('row').filter({ hasText: 'Saisie de la grille corrigée' });
  await expect(entryRow).toBeVisible();
  state = await (await request.get('/api/state')).json() as AppData;
  expect(state.timeEntries.find(entry => entry.note === 'Saisie de la grille corrigée')).toMatchObject({
    hours: 2.75, validated: false, date: '2026-10-07',
  });

  page.once('dialog', confirmation => void confirmation.accept());
  await entryRow.getByRole('button', { name: /^Supprimer la saisie/ }).click();
  await expect(entryRow).toHaveCount(0);
  await expectNumber(taskRow(page, task, personal).locator('[data-date="2026-10-07"]'), 0);
  state = await (await request.get('/api/state')).json() as AppData;
  expect(state.timeEntries.some(entry => entry.note === 'Saisie de la grille corrigée')).toBe(false);

  await record(request, task, personal, '2026-10-07', 2.75, 'Saisie conservée après clôture');
  expect((await request.patch(`/api/projects/${project.id}`, { data: { status: 'closed' } })).ok()).toBeTruthy();
  await page.reload();
  await selectWeek(page);
  entryRow = history.getByRole('row').filter({ hasText: 'Saisie conservée après clôture' });
  await expect(entryRow.getByRole('button', { name: /^Modifier la saisie/ })).toBeDisabled();
  await expect(entryRow.getByRole('button', { name: /^Supprimer la saisie/ })).toBeDisabled();
  await expect(taskRow(page, task, personal).locator('[data-date="2026-10-07"]').getByRole('button')).toBeDisabled();
});

test('lien d’un projet et grille mobile : colonnes défilantes sans débordement de la page', async ({ page, request }) => {
  const { project, task, personal } = await fixture(request, 'mobile');
  await record(request, task, personal, '2026-10-05', 4, 'Temps affiché sur mobile');
  await page.goto(`/#time/${project.id}`);
  await selectWeek(page);
  await expect(page.getByRole('combobox', { name: 'Projet', exact: true })).toHaveValue(project.id);
  await expect(matrix(page).locator('tr[data-row-kind="project"]')).toHaveCount(1);
  await expectNumber(taskRow(page, task, personal).locator('[data-summary="allocated"]'), 16);
  await page.screenshot({ path: screenshotPath('time-desktop.png'), fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Personnel', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  const scrolling = await matrix(page).evaluate(element => {
    let container = element.parentElement;
    while (container && container !== document.body) {
      const overflow = getComputedStyle(container).overflowX;
      if ((overflow === 'auto' || overflow === 'scroll') && container.scrollWidth > container.clientWidth + 100) {
        container.scrollLeft = 150;
        return { scrollLeft: container.scrollLeft, width: container.clientWidth, contentWidth: container.scrollWidth };
      }
      container = container.parentElement;
    }
    return null;
  });
  expect(scrolling).not.toBeNull();
  expect(scrolling!.scrollLeft).toBeGreaterThan(0);
  expect(scrolling!.contentWidth).toBeGreaterThan(scrolling!.width);
  await page.screenshot({ path: screenshotPath('time-mobile.png'), fullPage: true, animations: 'disabled' });
});

test('filtres de l’équipe : historique inactif, sélection réinitialisée et totaux des temps validés ou à valider', async ({ page, request }) => {
  const { project, task, colleagueTask, personal, colleague } = await fixture(request, 'filtres');
  const validated = await record(request, task, personal, '2026-10-05', 2, 'Temps validé pour le filtre');
  await record(request, task, personal, '2026-10-06', 3, 'Temps à valider pour le filtre');
  expect((await request.patch(`/api/time-entries/${validated.id}`, { data: { validated: true } })).ok()).toBeTruthy();
  await record(request, colleagueTask, colleague, '2026-10-07', 4, 'Historique d’une tâche terminée');
  expect((await request.patch(`/api/tasks/${colleagueTask.id}`, { data: { status: 'done' } })).ok()).toBeTruthy();
  const resourceResponse = await request.post('/api/resources', { data: { name: 'Ancienne ressource du suivi hebdomadaire', type: 'human' } });
  expect(resourceResponse.ok()).toBeTruthy();
  const former = await resourceResponse.json() as Resource;
  const taskResponse = await request.post('/api/tasks', { data: {
    projectId: project.id, title: 'Tâche de la ressource désactivée', phase: 'Phase historique', assigneeId: former.id, allocatedHours: 6,
  } });
  expect(taskResponse.ok()).toBeTruthy();
  const formerTask = await taskResponse.json() as Task;
  await record(request, formerTask, former, '2026-10-08', 1, 'Historique d’une ressource désactivée');
  expect((await request.patch(`/api/resources/${former.id}`, { data: { active: false } })).ok()).toBeTruthy();

  await page.goto(`/#time/${project.id}`);
  await selectWeek(page);
  await page.getByRole('button', { name: 'Équipe', exact: true }).click();
  await expect(matrix(page).locator(`tr[data-row-kind="resource"][data-resource-id="${former.id}"]`)).toHaveCount(0);
  await page.locator('details').filter({ hasText: 'Inclure les ressources inactives' }).locator('summary').click();
  await page.getByRole('checkbox', { name: 'Inclure les ressources inactives', exact: true }).check();
  await page.getByRole('combobox', { name: 'Ressource du suivi temporel', exact: true }).selectOption(former.id);
  await expectNumber(projectRow(page, project, former).locator('[data-summary="spent"]'), 1);
  await expect(taskRow(page, formerTask, former).locator('[data-date="2026-10-08"]').getByRole('button')).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Inclure les ressources inactives', exact: true }).uncheck();
  await expect(page.getByRole('combobox', { name: 'Ressource du suivi temporel', exact: true })).toHaveValue('');
  await expect(matrix(page).locator(`tr[data-row-kind="resource"][data-resource-id="${former.id}"]`)).toHaveCount(0);
  await expectNumber(projectRow(page, project, personal).locator('[data-summary="week"]'), 5);

  await expect(taskRow(page, colleagueTask, colleague)).toBeVisible();
  await page.getByRole('checkbox', { name: 'Inclure les tâches terminées', exact: true }).uncheck();
  await expect(taskRow(page, colleagueTask, colleague)).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Inclure les tâches terminées', exact: true }).check();
  await expect(taskRow(page, colleagueTask, colleague)).toBeVisible();
  await page.getByRole('combobox', { name: 'Filtrer la validation des temps', exact: true }).selectOption('validated');
  await expectNumber(projectRow(page, project, personal).locator('[data-summary="week"]'), 2);
  await expect(page.getByRole('table', { name: 'Saisies de la semaine', exact: true })).toContainText('Temps validé pour le filtre');
  await expect(page.getByRole('table', { name: 'Saisies de la semaine', exact: true })).not.toContainText('Temps à valider pour le filtre');
  await page.getByRole('combobox', { name: 'Filtrer la validation des temps', exact: true }).selectOption('pending');
  await expectNumber(projectRow(page, project, personal).locator('[data-summary="week"]'), 3);
  await page.getByRole('combobox', { name: 'Filtrer la validation des temps', exact: true }).selectOption('all');
  await expectNumber(projectRow(page, project, personal).locator('[data-summary="week"]'), 5);
});
