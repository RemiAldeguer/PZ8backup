import { test, expect } from '@playwright/test';
import type { AppData, Project, Resource, Task } from '../../shared/types';
import { loginTestAdmin } from '../auth-fixture';

test('fiche tâche : description formatée, dates, allocation, discussion et lecture seule de l’observateur', async ({ page, request, browser, baseURL }) => {
  await loginTestAdmin(page.request); await loginTestAdmin(request);
  const state = await (await request.get('/api/state')).json() as AppData;
  const create = async <T,>(entity: string, data: object): Promise<T> => {
    const response = await request.post('/api/' + entity, { data }); expect(response.ok(), await response.text()).toBeTruthy(); return await response.json() as T;
  };
  const project = await create<Project>('projects', { name: 'Projet fiche détail', zoneId: state.zones[0].id });
  const task = await create<Task>('tasks', { projectId: project.id, title: 'Tâche fiche détail', assigneeId: state.currentUser.id, allocatedHours: 8, startDate: '2026-10-12', endDate: '2026-10-15' });
  await create('time-entries', { taskId: task.id, resourceId: state.currentUser.id, date: '2026-10-12', hours: 2 });
  await create('comments', { taskId: task.id, body: 'Discussion existante de la tâche' });
  await create('project-documents', { projectId: project.id, name: 'Document du projet', kind: 'link', url: 'https://example.test/detail' });
  await page.goto('/#project/' + project.id + '/list');
  await page.getByRole('button', { name: task.title, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Détail de la tâche', exact: true });
  await expect(dialog.getByRole('navigation', { name: 'Emplacement de la tâche', exact: true })).toContainText(project.name);
  await expect(dialog.locator('.td-discussion-column')).toContainText('Discussion existante de la tâche');
  await expect(dialog.getByRole('region', { name: 'Ressource affectée', exact: true })).toContainText('2 h');
  await expect(dialog.getByRole('region', { name: 'Documents du projet', exact: true })).toContainText('Document du projet');
  await dialog.getByLabel('Description', { exact: true }).fill('Description enrichie');
  await dialog.getByRole('button', { name: 'Gras : Description', exact: true }).click();
  await dialog.getByLabel('Fin', { exact: true }).fill('2026-10-17');
  await dialog.getByLabel('Travail alloué (heures)', { exact: true }).fill('12');
  await dialog.getByLabel('Ajouter un tag', { exact: true }).fill('important');
  await dialog.getByLabel('Ajouter un tag', { exact: true }).press('Enter');
  await dialog.getByRole('textbox', { name: 'Votre commentaire', exact: true }).fill('Nouveau commentaire de la fiche');
  await dialog.getByRole('button', { name: 'Envoyer', exact: true }).click();
  await expect(dialog.locator('.td-discussion-column')).toContainText('Nouveau commentaire de la fiche');
  await page.screenshot({ path: test.info().outputPath('task-detail-desktop.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click(); await expect(dialog).not.toBeVisible();
  const after = await (await request.get('/api/state')).json() as AppData;
  const saved = after.tasks.find(item => item.id === task.id)!;
  expect(saved.endDate).toBe('2026-10-17'); expect(saved.allocatedHours).toBe(12); expect(saved.tags).toContain('important'); expect(saved.description).toContain('**');
  await page.getByRole('button', { name: task.title, exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.getByLabel('Titre', { exact: true })).toHaveValue(task.title);
  expect(await dialog.evaluate(element => element.getBoundingClientRect().right <= innerWidth)).toBeTruthy();
  await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();

  const observer = await create<Resource>('resources', { name: 'Observateur fiche détail', role: 'visitor', projectIds: [project.id] });
  expect((await request.patch('/api/projects/' + project.id, { data: { projectRoles: { [observer.id]: 'observer' } } })).ok()).toBeTruthy();
  const username = 'detail-observer-' + Date.now(), password = 'Detail-observer-test!2026';
  await create('auth/members', { resourceId: observer.id, username, password });
  const context = await browser.newContext({ baseURL });
  try {
    expect((await context.request.post('/api/auth/login', { data: { username, password } })).ok()).toBeTruthy();
    const readPage = await context.newPage(); await readPage.goto('/#project/' + project.id + '/list');
    await readPage.getByRole('button', { name: task.title, exact: true }).click();
    const readonly = readPage.getByRole('dialog', { name: 'Détail de la tâche', exact: true });
    await expect(readonly.getByLabel('Titre', { exact: true })).toBeDisabled();
    await expect(readonly.getByLabel('Description', { exact: true })).not.toBeEditable();
    await expect(readonly.getByLabel('Début', { exact: true })).toBeDisabled(); await expect(readonly.getByLabel('Fin', { exact: true })).toBeDisabled();
    await expect(readonly.getByRole('button', { name: 'Enregistrer', exact: true })).toBeDisabled();
  } finally { await context.close(); }
});
