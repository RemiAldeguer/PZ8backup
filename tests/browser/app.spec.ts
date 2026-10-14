import { test, expect, type APIRequestContext } from '@playwright/test';
import type { AppData, Project } from '../../shared/types';
import { readFile } from 'node:fs/promises';
import { loginTestAdmin } from '../auth-fixture';

test.beforeEach(async ({ page, request }) => {
  await loginTestAdmin(page.request);
  await loginTestAdmin(request);
});

async function createProject(request: APIRequestContext, name: string): Promise<Project> {
  const data = await (await request.get('/api/state')).json() as AppData;
  const response = await request.post('/api/projects', { data: { name, zoneId: data.zones[0].id, startDate: '2026-10-05', endDate: '2026-11-30', status: 'open', weather: 4, budget: 10000, color: '#6366f1' } });
  expect(response.ok()).toBeTruthy();
  const next = await (await request.get('/api/state')).json() as AppData;
  return next.projects.find(p => p.name === name)!;
}

test('création, changement de statut, commentaire et persistance après rechargement', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Vue d’ensemble', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Nouvelle tâche', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Nouvelle tâche', exact: true });
  await dialog.getByLabel('Titre', { exact: true }).fill('Recette navigateur Planzone');
  await dialog.getByRole('combobox', { name: 'Assigné à', exact: true }).selectOption('resource-claire');
  await dialog.getByLabel('Début', { exact: true }).fill('2026-10-06');
  await dialog.getByLabel('Fin', { exact: true }).fill('2026-10-09');
  await dialog.getByLabel('Travail alloué (heures)').fill('8');
  await dialog.getByRole('button', { name: 'Créer la tâche', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('navigation', { name: 'Vues du projet' }).getByRole('button', { name: /^Liste/ }).click();
  await page.getByRole('button', { name: 'Recette navigateur Planzone', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Détail de la tâche', exact: true });
  await dialog.getByLabel('Votre commentaire').fill('Le parcours fonctionne et conserve les données.');
  await dialog.getByRole('button', { name: 'Envoyer', exact: true }).click();
  await expect(dialog.getByText('Le parcours fonctionne et conserve les données.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
  await page.getByRole('navigation', { name: 'Vues du projet' }).getByRole('button', { name: 'Tableau', exact: true }).click();
  await page.getByLabel('Statut de Recette navigateur Planzone', { exact: true }).selectOption('done');
  await expect(page.getByLabel('Statut de Recette navigateur Planzone', { exact: true })).toHaveValue('done');
  await page.reload();
  await expect(page.getByLabel('Statut de Recette navigateur Planzone', { exact: true })).toHaveValue('done');
  const data = await (await page.request.get('/api/state')).json() as AppData;
  const task = data.tasks.find(t => t.title === 'Recette navigateur Planzone')!;
  expect(task.status).toBe('done'); expect(task.progress).toBe(100);
  expect(data.comments.some(c => c.taskId === task.id && c.body.startsWith('Le parcours'))).toBeTruthy();
  expect(errors).toEqual([]);
});

test('projet créé depuis le formulaire, puis consulté avec ses propres données', async ({ page }) => {
  await page.goto('/#projects');
  await page.getByRole('button', { name: 'Nouveau projet', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouveau projet', exact: true });
  await dialog.getByRole('button', { name: 'Depuis zéro', exact: true }).click();
  await dialog.getByLabel('Nom du projet').fill('Projet créé dans le navigateur');
  await dialog.getByLabel('Date de début').fill('2026-10-06');
  await dialog.getByLabel('Date de fin').fill('2026-11-06');
  await dialog.getByRole('button', { name: 'Créer le projet', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.locator('.content-area').getByRole('button', { name: 'Projet créé dans le navigateur', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Projet créé dans le navigateur', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Suivi de l’activité', exact: true }).locator('[data-metric="allocated"]')).toHaveText('0 h');
  await page.getByRole('navigation', { name: 'Accès du projet', exact: true }).getByRole('link', { name: 'Rapports', exact: true }).click();
  await expect(page.locator('#context-project')).toHaveValue(/.+/);
  await expect(page.locator('.project-header').getByRole('heading', { name: 'Projet créé dans le navigateur', exact: true })).toBeVisible();
});

test('annuaire et profils de coûts créés par des formulaires accessibles', async ({ page }) => {
  await page.goto('/#resources');
  await page.getByRole('button', { name: /Profils de coût/ }).click();
  await page.getByRole('button', { name: /Nouveau profil/ }).click();
  let dialog = page.getByRole('dialog', { name: 'Nouveau profil de coût' });
  await dialog.getByLabel('Nom du profil').fill('Profil de recette');
  await dialog.getByLabel('Tarif par Eqjt (€)').fill('432.75');
  await dialog.getByLabel('Heures par Eqjt').fill('7');
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: /Annuaire/ }).click();
  await page.getByRole('button', { name: /Nouvelle ressource/ }).click();
  await page.getByRole('dialog', { name: 'Nouvelle ressource' }).getByRole('button', { name: 'Ajouter un membre', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Ajouter un membre', exact: true });
  await dialog.getByLabel('Nom de la ressource').fill('Camille Recette');
  await dialog.getByLabel('Capacité du lundi (h/jour)').fill('4');
  const createdProfile = ((await (await page.request.get('/api/state')).json()) as AppData).profiles.find(p => p.name === 'Profil de recette')!;
  await dialog.getByLabel('Profil tarifaire').selectOption(createdProfile.id);
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(page.getByText('Camille Recette', { exact: true })).toBeVisible();
  const data = await (await page.request.get('/api/state')).json() as AppData;
  const resource = data.resources.find(r => r.name === 'Camille Recette')!;
  expect(resource.mondayHours).toBe(4);
  expect(data.profiles.find(p => p.id === resource.profileId)?.dailyRate).toBe(432.75);
});

test('temps saisis, validation séparée et historique de tarif', async ({ page, request }) => {
  const project = await createProject(request, 'Projet temps recette');
  await request.post('/api/tasks', { data: { projectId: project.id, title: 'Tâche temps recette', assigneeId: 'resource-claire', allocatedHours: 16 } });
  await page.goto(`/#time/${project.id}`);
  await page.getByRole('button', { name: 'Saisir du temps', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Saisir du temps', exact: true });
  await dialog.getByRole('combobox', { name: 'Tâche', exact: true }).selectOption({ label: 'Tâche temps recette' });
  await dialog.getByLabel('Temps passé (heures)').fill('1.25');
  await dialog.getByLabel('Note', { exact: true }).fill('Saisie de recette');
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: /^Valider : Claire Martin, 1.25/ }).click();
  await expect(page.getByRole('button', { name: /^Retirer la validation : Claire Martin, 1.25/ })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'Saisie de recette' });
  await expect(row.getByRole('button', { name: /^Modifier la saisie/ })).toBeDisabled();
  await expect(row.getByRole('button', { name: /^Supprimer la saisie/ })).toBeDisabled();
  await page.reload();
  await expect(page.getByText('Saisie de recette', { exact: true })).toBeVisible();
  const data = await (await request.get('/api/state')).json() as AppData;
  const entry = data.timeEntries.find(e => e.note === 'Saisie de recette')!;
  expect(entry.validated).toBe(true); expect(entry.rateSnapshot).toBe(650); expect(entry.eqjtSnapshot).toBe(8);
});

test('dépense réglée, centimes conservés et changement de colonne par glisser-déposer', async ({ page, request }) => {
  const project = await createProject(request, 'Projet budget et tableau recette');
  const response = await request.post('/api/tasks', { data: { projectId: project.id, title: 'Carte à déplacer', allocatedHours: 8, assigneeId: 'resource-claire' } });
  expect(response.ok()).toBeTruthy();
  await page.goto(`/#project/${project.id}/budget`);
  await page.getByRole('button', { name: 'Nouvelle dépense', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouvelle dépense', exact: true });
  await dialog.getByLabel('Libellé', { exact: true }).fill('Licence de recette');
  await dialog.getByLabel('Montant (€)', { exact: true }).fill('123.45');
  await dialog.getByLabel('Date prévue', { exact: true }).fill('2026-10-06');
  await dialog.getByLabel('Date de règlement (facultative)', { exact: true }).fill('2026-10-07');
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'Licence de recette' });
  await expect(row).toContainText('123,45');
  await expect(row).toContainText('07/10/2026');
  await expect(page.locator('.metric-card').filter({ hasText: 'Coût réel' })).toContainText('123,45');
  await expect(page.locator('.metric-card').filter({ hasText: 'Coût planifié' })).toContainText('773,45');
  await page.getByRole('navigation', { name: 'Vues du projet' }).getByRole('button', { name: 'Tableau', exact: true }).click();
  const card = page.locator('.proj-task-card').filter({ hasText: 'Carte à déplacer' });
  await card.dragTo(page.locator('.proj-board-column[data-status="in_progress"]'));
  await expect(page.getByLabel('Statut de Carte à déplacer', { exact: true })).toHaveValue('in_progress');
  await page.reload();
  await expect(page.getByLabel('Statut de Carte à déplacer', { exact: true })).toHaveValue('in_progress');
  const data = await (await request.get('/api/state')).json() as AppData;
  expect(data.expenses.find(e => e.label === 'Licence de recette')?.amount).toBe(123.45);
  expect(data.tasks.find(t => t.title === 'Carte à déplacer')?.status).toBe('in_progress');
});

test('export CSV réel et rapport imprimable sans navigation de l’application', async ({ page }) => {
  await page.goto('/#reports/project-nova');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exporter les tâches', exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  const csv = await readFile(path!, 'utf8');
  expect(csv).toContain('Définir les objectifs et le périmètre');
  expect(csv).toContain('ID');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('body > .print-report')).toBeVisible();
  await expect(page.locator('.app-shell')).not.toBeVisible();
  await expect(page.locator('.print-report')).toContainText('PLANZONE 8');
});

test('recherche globale, calendrier consolidé et navigation mobile', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Recherche globale').fill('Prototyper');
  await page.getByRole('region', { name: 'Résultats de recherche' }).getByRole('button', { name: /Prototyper les écrans clés/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Application mobile clients');
  await page.keyboard.press('Escape');
  await page.goto('/#calendar');
  await expect(page.getByRole('heading', { name: 'Calendrier global', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Ouvrir le menu', exact: true }).click();
  await page.getByRole('button', { name: 'Tous les projets, toutes les zones', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tous les projets', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});
