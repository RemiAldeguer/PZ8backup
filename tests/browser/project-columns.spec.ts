import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import type { AppData, Project, Resource, Task } from '../../shared/types';
import type { CustomFieldDefinition } from '../../shared/customization';
import { loginTestAdmin } from '../auth-fixture';

async function create<T>(request: APIRequestContext, entity: string, data: object): Promise<T> {
  const response = await request.post('/api/' + entity, { data });
  expect(response.ok(), await response.text()).toBeTruthy();
  return await response.json() as T;
}
async function width(cell: Locator, value: number) {
  await expect.poll(async () => Math.round(await cell.evaluate(element => element.getBoundingClientRect().width))).toBe(value);
}
async function drag(page: Page, handle: Locator, delta: number) {
  await handle.scrollIntoViewIfNeeded();
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + delta, box.y + box.height / 2, { steps: 4 });
}

test('colonnes projets : champs personnalisés, ordre et largeur persistants, budget protégé et préférences personnelles', async ({ page, request }) => {
  await loginTestAdmin(page.request); await loginTestAdmin(request);
  const data = await (await request.get('/api/state')).json() as AppData;
  const field = await create<CustomFieldDefinition>(request, 'custom-field-definitions', { name: 'Référence colonnes ' + Date.now(), scope: 'project', type: 'text' });
  const project = await create<Project>(request, 'projects', { name: 'Projet colonnes ' + Date.now(), zoneId: data.zones[0].id, budget: 18000, customValues: { [field.id]: 'REF-COLONNES' } });
  await page.goto('/#projects');
  const table = page.getByRole('table', { name: 'Projets de la zone', exact: true });
  const headers = table.locator('thead th[data-column]');
  const name = headers.filter({ has: page.getByRole('separator', { name: 'Redimensionner Nom du projet', exact: true }) });
  const resize = name.getByRole('separator');
  await width(name, 260);
  await drag(page, resize, 95); await page.mouse.up();
  await width(name, 355);
  await resize.press('ArrowRight'); await width(name, 365);
  await drag(page, resize, -45); await page.keyboard.press('Escape'); await page.mouse.up();
  await width(name, 365);
  await page.getByRole('button', { name: 'Configurer les colonnes des projets', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Configurer les colonnes des projets', exact: true });
  await expect(dialog.getByRole('checkbox', { name: 'Nom du projet Obligatoire', exact: true })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: 'Zone', exact: true }).uncheck();
  await dialog.getByRole('checkbox', { name: field.name, exact: true }).check();
  await dialog.getByRole('button', { name: 'Monter Date de début', exact: true }).click();
  await dialog.getByRole('button', { name: 'Appliquer', exact: true }).click();
  await expect(headers.nth(1)).toHaveAttribute('data-column', 'start');
  await expect(table.locator('[data-column="zone"]')).toHaveCount(0);
  await expect(table.locator(`tr[data-project-id="${project.id}"] [data-column="custom:${field.id}"]`)).toHaveText('REF-COLONNES');
  await page.reload(); await width(name, 365);
  await expect(headers.nth(1)).toHaveAttribute('data-column', 'start');
  await page.goto('/#zones/' + project.zoneId + '/projects'); await width(name, 365);
  await expect(table.locator(`tr[data-project-id="${project.id}"] [data-column="custom:${field.id}"]`)).toHaveText('REF-COLONNES');
  await page.screenshot({ path: test.info().outputPath('project-columns.png'), fullPage: true });

  // The same browser retains the administrator's local storage when a different account signs in.
  const visitor = await create<Resource>(request, 'resources', { name: 'Lecteur colonnes', role: 'visitor', projectIds: [project.id] });
  expect((await request.patch('/api/projects/' + project.id, { data: { projectRoles: { [visitor.id]: 'observer' } } })).ok()).toBeTruthy();
  const username = 'columns-visitor-' + Date.now(), password = 'Columns-visitor-test!2026';
  await create(request, 'auth/members', { resourceId: visitor.id, username, password });
  expect((await page.request.post('/api/auth/login', { data: { username, password } })).ok()).toBeTruthy();
  await page.reload(); await width(name, 260);
  await expect(headers.nth(1)).toHaveAttribute('data-column', 'zone');
  await expect(table.locator('[data-column^="budget-"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Configurer les colonnes des projets', exact: true }).click();
  await expect(dialog.getByRole('checkbox', { name: /^Budget ·/ })).toHaveCount(0);
});

test('liste du projet : redimensionnement après réorganisation des colonnes, persistance et retour à la largeur initiale', async ({ page, request }) => {
  await loginTestAdmin(page.request); await loginTestAdmin(request);
  const data = await (await request.get('/api/state')).json() as AppData;
  const project = await create<Project>(request, 'projects', { name: 'Projet largeur liste', zoneId: data.zones[0].id });
  const task = await create<Task>(request, 'tasks', { projectId: project.id, title: 'Tâche dont la liste conserve les colonnes', allocatedHours: 8, startDate: '2026-10-12', endDate: '2026-10-15' });
  await page.goto('/#project/' + project.id + '/list');
  const table = page.getByRole('region', { name: 'Liste des tâches et sous-listes', exact: true }).locator('table');
  await page.getByRole('button', { name: 'Configurer les colonnes', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Configurer les colonnes', exact: true });
  await dialog.getByRole('checkbox', { name: 'Tags', exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Déplacer Statut vers la gauche', exact: true }).click();
  await dialog.getByRole('button', { name: 'Appliquer', exact: true }).click();
  await expect(table.locator('thead th[data-column]').first()).toHaveAttribute('data-column', 'status');
  const taskHeader = table.locator('thead th[data-column="task"]');
  const resize = taskHeader.getByRole('separator', { name: 'Redimensionner Tâche', exact: true });
  await width(taskHeader, 530); await drag(page, resize, -110); await page.mouse.up(); await width(taskHeader, 420);
  const statusHeader = table.locator('thead th[data-column="status"]');
  await statusHeader.getByRole('separator').press('Home'); await width(statusHeader, 60);
  const select = table.getByRole('combobox', { name: `Statut de ${task.title}`, exact: true });
  expect(await select.evaluate(element => element.getBoundingClientRect().width <= element.closest('td')!.getBoundingClientRect().width)).toBeTruthy();
  await page.reload(); await width(taskHeader, 420); await width(statusHeader, 60);
  await expect(table.locator('[data-column="tags"]')).toHaveCount(0);
  await resize.dblclick(); await width(taskHeader, 530);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});
