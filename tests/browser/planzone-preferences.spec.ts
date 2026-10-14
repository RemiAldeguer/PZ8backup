import { test, expect } from '@playwright/test';
import { loginTestAdmin } from '../auth-fixture';

test('les préférences enregistrées modifient les unités et les feuilles de temps après rechargement', async ({ page }) => {
  const request = page.request;
  await loginTestAdmin(request);
  await page.goto('/#settings');
  await expect(page.getByRole('heading', { name: 'Paramètres de la Planzone', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Saisir l’allocation de temps en jours', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Afficher le pourcentage d’avancement des tâches dans les feuilles de temps', exact: true }).check();
  await page.getByRole('spinbutton', { name: 'Avertir lorsque les ressources dépassent un volume de travail journalier critique', exact: true }).fill('9');
  await page.getByRole('button', { name: 'Enregistrer les préférences', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Préférences à jour' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Saisir l’allocation de temps en jours', exact: true })).toBeChecked();
  const data = await (await request.get('/api/state')).json();
  expect(data.planzonePreferences[0]).toMatchObject({ allocationInDays: true, showTimeSheetProgress: true, criticalDailyWorkHours: 9 });
  const taskResponse = await request.post('/api/tasks', { data: { projectId: 'project-nova', title: 'Allocation en jours', assigneeId: data.currentUser.id, startDate: '2026-10-06', endDate: '2026-10-09', allocatedHours: 16 } });
  expect(taskResponse.ok()).toBe(true); const task = await taskResponse.json();
  await page.goto('/#project/project-nova/list'); await page.reload();
  await page.getByRole('button', { name: 'Allocation en jours', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('spinbutton', { name: 'Travail alloué (jours)', exact: true })).toHaveValue('2');
  await dialog.getByRole('spinbutton', { name: 'Travail alloué (jours)', exact: true }).fill('3');
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const stored = await (await request.get('/api/state')).json();
  expect(stored.tasks.find((item: { id: string }) => item.id === task.id).allocatedHours).toBe(24);
  await page.goto('/#time');
  await expect(page.getByRole('columnheader', { name: 'Alloué (j)', exact: true })).toBeVisible();
  await expect(page.getByLabel('Avancement de Allocation en jours : 0 %', { exact: true })).toBeVisible();
});

test('ma synthèse filtre les tâches et reste lisible en clair, sombre et sur mobile', async ({ page }) => {
  await loginTestAdmin(page.request);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  for (const theme of ['light', 'dark']) {
    await page.goto('/#personal');
    await page.getByRole('combobox', { name: 'Thème de l’application', exact: true }).selectOption(theme);
    await expect(page.getByRole('heading', { name: 'Ma synthèse', exact: true })).toBeVisible();
    await expect(page.locator('.pd-summary-metric')).toHaveCount(4);
    await page.getByRole('button', { name: /Tâches terminées/ }).click();
    await expect(page.getByRole('region', { name: 'Tâches terminées', exact: true })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Rechercher dans mes tâches', exact: true }).fill('aucune correspondance');
    await expect(page.getByText('Aucune tâche terminée dans ce filtre.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Réinitialiser les filtres', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Tâches à venir et ouvertes', exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('personal-' + theme + '.png'), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Ma synthèse', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('personal-mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
});
