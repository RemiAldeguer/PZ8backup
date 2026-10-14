import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import type { AppData, Project, Resource, Task, TaskStatus, TimeEntry } from '../../shared/types';
import { loginTestAdmin } from '../auth-fixture';

test.beforeEach(async ({ page, request }) => {
  await loginTestAdmin(page.request);
  await loginTestAdmin(request);
});

async function fixture(request: APIRequestContext, suffix: string) {
  const data = await (await request.get('/api/state')).json() as AppData;
  const personal = data.resources.find(resource => resource.id === data.currentUser.id)!;
  const response = await request.post('/api/projects', { data: {
    name: `Projet coche de tâche ${suffix}`, zoneId: data.zones[0].id,
    startDate: '2026-10-01', endDate: '2028-01-31', status: 'open',
  } });
  expect(response.ok()).toBeTruthy();
  const project = await response.json() as Project;
  async function createTask(title: string, dependsOnId: string | null = null) {
    const taskResponse = await request.post('/api/tasks', { data: {
      projectId: project.id, title: `${title} ${suffix}`, phase: 'Phase des coches',
      assigneeId: personal.id, allocatedHours: 8, dependsOnId,
      startDate: '2026-10-05', endDate: '2028-01-31',
    } });
    expect(taskResponse.ok()).toBeTruthy();
    return await taskResponse.json() as Task;
  }
  return { project, personal, createTask, today: data.today };
}

function taskRow(page: Page, task: Task, resource: Resource) {
  return page.getByRole('table', { name: 'Suivi temporel hebdomadaire', exact: true })
    .locator(`tr[data-row-kind="task"][data-task-id="${task.id}"][data-resource-id="${resource.id}"]`);
}

function screenshotPath(name: string) {
  return test.info().project.testDir.endsWith('cloudflare-browser') ? test.info().outputPath(name) : `docs/screenshots/${name}`;
}

async function expectTask(request: APIRequestContext, task: Task, status: TaskStatus, progress: number) {
  await expect.poll(async () => {
    const state = await (await request.get('/api/state')).json() as AppData;
    const stored = state.tasks.find(item => item.id === task.id)!;
    return { status: stored.status, progress: stored.progress };
  }).toEqual({ status, progress });
}

test('coche de tâche : terminer dans la semaine, persister, ouvrir le titre puis rouvrir au clavier depuis la liste', async ({ page, request }) => {
  const { project, personal, createTask, today } = await fixture(request, 'persistance');
  const task = await createTask('Tâche à terminer');
  const entryResponse = await request.post('/api/time-entries', { data: {
    taskId: task.id, resourceId: personal.id, date: today, hours: 1,
    note: 'La coche de tâche ne valide pas cette saisie',
  } });
  expect(entryResponse.ok()).toBeTruthy();
  const entry = await entryResponse.json() as TimeEntry;

  await page.goto(`/#time/${project.id}`);
  const row = taskRow(page, task, personal);
  await expect(row.getByRole('checkbox', { name: `Terminer ${task.title}`, exact: true })).not.toBeChecked();
  await row.getByRole('checkbox', { name: `Terminer ${task.title}`, exact: true }).click();
  await expect(row.getByRole('checkbox', { name: `Rouvrir ${task.title}`, exact: true })).toBeChecked();
  await expectTask(request, task, 'done', 100);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const state = await (await request.get('/api/state')).json() as AppData;
  expect(state.timeEntries.find(item => item.id === entry.id)?.validated).toBe(false);

  await page.reload();
  await expect(row.getByRole('checkbox', { name: `Rouvrir ${task.title}`, exact: true })).toBeChecked();
  await page.screenshot({ path: screenshotPath('task-check-time.png'), fullPage: true, animations: 'disabled' });
  await row.getByRole('button', { name: task.title, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Détail de la tâche', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Statut', exact: true })).toHaveValue('done');
  await expect(dialog.getByLabel('Avancement (%)', { exact: true })).toHaveValue('100');
  await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();

  await page.goto(`/#project/${project.id}/list`);
  const listMark = page.getByRole('checkbox', { name: `Rouvrir ${task.title}`, exact: true });
  await expect(listMark).toBeChecked();
  await expect(page.getByLabel(`Statut de ${task.title}`, { exact: true })).toHaveValue('done');
  await page.screenshot({ path: screenshotPath('task-check-list.png'), fullPage: true, animations: 'disabled' });
  await listMark.press('Space');
  await expect(page.getByRole('checkbox', { name: `Terminer ${task.title}`, exact: true })).not.toBeChecked();
  await expect(page.getByLabel(`Statut de ${task.title}`, { exact: true })).toHaveValue('todo');
  await expectTask(request, task, 'todo', 0);
  await page.goto(`/#time/${project.id}`);
  await expect(row.getByRole('checkbox', { name: `Terminer ${task.title}`, exact: true })).not.toBeChecked();

  await page.goto(`/#project/${project.id}/summary`);
  await page.locator('.proj-priority-list').getByRole('button').filter({ hasText: task.title }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Statut', exact: true })).toHaveValue('todo');
  await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
  await page.getByRole('checkbox', { name: `Terminer ${task.title}`, exact: true }).click();
  await expectTask(request, task, 'done', 100);
  await expect(page.getByRole('checkbox', { name: `Terminer ${task.title}`, exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: `Rouvrir ${task.title}`, exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('coche et dépendances : refus sans faux état terminé puis déblocage et protection du prédécesseur', async ({ page, request }) => {
  const { project, personal, createTask } = await fixture(request, 'dépendances');
  const predecessor = await createTask('Prédécesseur');
  const successor = await createTask('Successeur', predecessor.id);
  await page.goto(`/#time/${project.id}`);
  const previousRow = taskRow(page, predecessor, personal);
  const nextRow = taskRow(page, successor, personal);

  await nextRow.getByRole('checkbox', { name: `Terminer ${successor.title}`, exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Terminez la tâche précédente');
  await expect(nextRow.getByRole('checkbox', { name: `Terminer ${successor.title}`, exact: true })).not.toBeChecked();
  await expectTask(request, successor, 'todo', 0);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await previousRow.getByRole('checkbox', { name: `Terminer ${predecessor.title}`, exact: true }).click();
  await expect(previousRow.getByRole('checkbox', { name: `Rouvrir ${predecessor.title}`, exact: true })).toBeChecked();
  await nextRow.getByRole('checkbox', { name: `Terminer ${successor.title}`, exact: true }).click();
  await expect(nextRow.getByRole('checkbox', { name: `Rouvrir ${successor.title}`, exact: true })).toBeChecked();
  await expectTask(request, successor, 'done', 100);

  await previousRow.getByRole('checkbox', { name: `Rouvrir ${predecessor.title}`, exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Une tâche dépendante a déjà démarré');
  await expect(previousRow.getByRole('checkbox', { name: `Rouvrir ${predecessor.title}`, exact: true })).toBeChecked();
  await expectTask(request, predecessor, 'done', 100);
  await page.reload();
  await expect(previousRow.getByRole('checkbox', { name: `Rouvrir ${predecessor.title}`, exact: true })).toBeChecked();
  await expect(nextRow.getByRole('checkbox', { name: `Rouvrir ${successor.title}`, exact: true })).toBeChecked();
});

test('projets interrompus ou clos : coche désactivée dans la semaine et la liste, consultation conservée', async ({ page, request }) => {
  const { project, personal, createTask } = await fixture(request, 'lecture seule');
  const task = await createTask('Tâche en lecture seule');
  let taskWrites = 0;
  page.on('request', response => {
    if (response.method() === 'PATCH' && new URL(response.url()).pathname === `/api/tasks/${task.id}`) taskWrites++;
  });

  for (const status of ['paused', 'closed'] as const) {
    expect((await request.patch(`/api/projects/${project.id}`, { data: { status } })).ok()).toBeTruthy();
    await page.goto(`/#time/${project.id}`);
    const row = taskRow(page, task, personal);
    await expect(row.getByRole('checkbox', { name: `Terminer ${task.title}`, exact: true })).toBeDisabled();
    await expect(row.getByRole('checkbox', { name: `Terminer ${task.title}`, exact: true })).not.toBeChecked();
    await row.getByRole('button', { name: task.title, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Détail de la tâche', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'Statut', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
    await page.goto(`/#project/${project.id}/list`);
    await expect(page.getByRole('checkbox', { name: `Terminer ${task.title}`, exact: true })).toBeDisabled();
    await expect(page.getByLabel(`Statut de ${task.title}`, { exact: true })).toHaveValue('todo');
    await expectTask(request, task, 'todo', 0);
  }
  expect(taskWrites).toBe(0);

  expect((await request.patch(`/api/projects/${project.id}`, { data: { status: 'open' } })).ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByRole('checkbox', { name: `Terminer ${task.title}`, exact: true })).toBeEnabled();
  await page.getByRole('checkbox', { name: `Terminer ${task.title}`, exact: true }).click();
  await expect(page.getByRole('checkbox', { name: `Rouvrir ${task.title}`, exact: true })).toBeChecked();
  await expectTask(request, task, 'done', 100);
  expect(taskWrites).toBe(1);
});
