import { test, expect, type Page } from '@playwright/test';
import { loginTestAdmin } from '../auth-fixture';
import type { AppData, Project, Task } from '../../shared/types';

test('Paramétrer une contrainte et déplacer/redimensionner les barres replanifie la chaîne et synchronise Liste', async ({ page }) => {
  await loginTestAdmin(page.request);
  const state = async (): Promise<AppData> => (await page.request.get('/api/state')).json();
  const create = async <T,>(entity: string, body: unknown): Promise<T> => { const response = await page.request.post('/api/' + entity, { data: body }); expect(response.ok(), await response.text()).toBe(true); return response.json(); };
  const data = await state();
  const project = await create<Project>('projects', { name: 'Contraintes graphiques', zoneId: data.zones[0].id, startDate: '2026-10-01', endDate: '2026-10-31' });
  const a = await create<Task>('tasks', { projectId: project.id, title: 'Préparation du planning', startDate: '2026-10-05', endDate: '2026-10-06' });
  const b = await create<Task>('tasks', { projectId: project.id, title: 'Exécution liée', startDate: '2026-10-12', endDate: '2026-10-14' });
  await page.setViewportSize({ width: 1920, height: 1080 }); await page.goto('/#project/' + project.id + '/gantt');
  await page.getByRole('combobox', { name: 'Échelle du Gantt', exact: true }).selectOption('month');
  await page.getByRole('button', { name: 'Contraintes de ' + b.title, exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Contrainte entre les tâches', exact: true });
  await dialog.getByRole('combobox', { name: 'Élément précédent', exact: true }).selectOption(a.id);
  await dialog.getByRole('spinbutton', { name: 'Décalage', exact: true }).fill('2');
  await expect(dialog.getByRole('status')).toContainText('1 élément');
  await page.screenshot({ path: test.info().outputPath('constraint-desktop.png') });
  await dialog.getByRole('button', { name: 'Enregistrer la contrainte', exact: true }).click(); await expect(dialog).not.toBeVisible();
  const task = async (id: string) => (await state()).tasks.find(task => task.id === id)!;
  expect((await task(b.id)).startDate).toBe('2026-10-09'); expect((await task(b.id)).endDate).toBe('2026-10-11');
  await dragDays(page, page.getByRole('button', { name: 'Modifier la fin de ' + a.title, exact: true }), 2);
  await expect.poll(async () => (await task(b.id)).startDate).toBe('2026-10-11'); expect((await task(b.id)).endDate).toBe('2026-10-13');
  await dragDays(page, page.locator(`.pzg-row[data-task-id="${b.id}"] .pzg-bar`), 2);
  await expect.poll(async () => (await task(a.id)).endDate).toBe('2026-10-10'); expect((await task(a.id)).startDate).toBe('2026-10-07');
  await page.reload(); await page.getByRole('button', { name: 'Contraintes de ' + b.title, exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Contrainte entre les tâches', exact: true });
  await expect(dialog.getByRole('spinbutton', { name: 'Décalage', exact: true })).toHaveValue('2');
  await page.getByRole('combobox', { name: 'Thème de l’application', exact: true }).selectOption('dark');
  await page.screenshot({ path: test.info().outputPath('constraint-dark.png') });
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: test.info().outputPath('constraint-mobile.png') });
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  await page.goto('/#project/' + project.id + '/list');
  const bRow = page.locator(`.nlv-task-row[data-task-id="${b.id}"]`); await expect(bRow).not.toHaveClass(/nlv-blocked/);
  await expect(bRow.locator('.nlv-date-box').first()).toHaveText('13/10/2026');
  await page.request.delete('/api/tasks/' + b.id); await page.request.delete('/api/tasks/' + a.id); await page.request.delete('/api/projects/' + project.id);
});

async function dragDays(page: Page, handle: ReturnType<Page['locator']>, days: number) {
  await handle.scrollIntoViewIfNeeded(); const box = await handle.boundingBox(); expect(box).not.toBeNull();
  const pixels = await page.locator('.pzg-track').first().evaluate(element => element.getBoundingClientRect().width / 31);
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2); await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + pixels * days, box!.y + box!.height / 2, { steps: 8 }); await page.mouse.up();
}
