import { mkdirSync } from 'node:fs';
import { test, expect, type APIRequestContext } from '@playwright/test';
import type { AppData, Project, Resource } from '../../shared/types';
import type { ProjectTemplate } from '../../shared/customization';
import { loginTestAdmin } from '../auth-fixture';

test.beforeEach(async ({ page, request }) => { await loginTestAdmin(page.request); await loginTestAdmin(request); });
async function state(request: APIRequestContext): Promise<AppData> { const response = await request.get('/api/state'); expect(response.ok()).toBeTruthy(); return response.json(); }
async function create<T>(request: APIRequestContext, entity: string, data: unknown): Promise<T> { const response = await request.post('/api/' + entity, { data }); expect(response.ok(), await response.text()).toBeTruthy(); return response.json(); }
const screenshot = (name: string) => { mkdirSync('docs/screenshots', { recursive: true }); return 'docs/screenshots/' + name + '.png'; };

test('création depuis zéro : choix, tags, portefeuilles, texte formaté et vues conservés après rechargement', async ({ page, request }) => {
  const initial = await state(request); const zone = initial.zones[0];
  await page.setViewportSize({ width: 1720, height: 1000 }); await page.goto('/#zones/' + zone.id + '/projects');
  await page.getByRole('button', { name: 'Nouveau projet', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouveau projet', exact: true });
  await expect(dialog.getByRole('button', { name: 'Depuis zéro', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'À partir d’un modèle', exact: true })).toBeVisible();
  await page.screenshot({ path: screenshot('project-creation-choice'), animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Depuis zéro', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Créer un projet de zéro', exact: true })).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Zone', exact: true })).toHaveValue(zone.id);
  await dialog.getByRole('textbox', { name: 'Nom du projet', exact: true }).fill('Création visuelle complète');
  await dialog.getByLabel('Date de début', { exact: true }).fill('2026-11-02'); await dialog.getByLabel('Date de fin', { exact: true }).fill('2026-12-31');
  await dialog.getByRole('button', { name: 'Ajouter des tags', exact: true }).click(); await dialog.getByRole('textbox', { name: 'Nouveau tag du projet', exact: true }).fill('Client'); await dialog.getByRole('textbox', { name: 'Nouveau tag du projet', exact: true }).press('Enter');
  await dialog.getByRole('button', { name: 'Ajouter des portefeuilles', exact: true }).click(); await dialog.getByRole('textbox', { name: 'Nouveau portefeuille du projet', exact: true }).fill('Transformation'); await dialog.getByRole('textbox', { name: 'Nouveau portefeuille du projet', exact: true }).press('Enter');
  await dialog.getByRole('textbox', { name: 'Description', exact: true }).fill('Objectif'); await dialog.getByRole('textbox', { name: 'Description', exact: true }).selectText(); await dialog.getByRole('button', { name: 'Gras : Description', exact: true }).click();
  await dialog.getByRole('switch', { name: 'Activer la vue Budget', exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Ajouter des tags', exact: true }).click(); await dialog.getByRole('button', { name: 'Ajouter des portefeuilles', exact: true }).click();
  await page.screenshot({ path: screenshot('project-creation-desktop'), animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Créer le projet', exact: true }).click(); await expect(dialog).not.toBeVisible();
  const project = (await state(request)).projects.find(item => item.name === 'Création visuelle complète')!;
  expect(project).toMatchObject({ zoneId: zone.id, tags: ['Client'], portfolioNames: ['Transformation'], description: '**Objectif**', descriptionFormat: 'markdown' }); expect(project.enabledViews).not.toContain('budget');
  await page.goto('/#project/' + project.id + '/summary'); await expect(page.getByRole('region', { name: 'Description du projet', exact: true }).locator('strong')).toHaveText('Objectif');
  await expect(page.getByRole('navigation', { name: 'Accès du projet', exact: true }).getByRole('link', { name: 'Budget', exact: true })).toHaveCount(0);
  await page.goto('/#project/' + project.id + '/budget'); await expect(page.getByText('Cette vue est désactivée pour ce projet.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Configurer les vues du projet', exact: true }).click(); const edit = page.getByRole('dialog', { name: 'Paramètres du projet', exact: true });
  await expect(edit.getByRole('button', { name: 'Retirer Transformation', exact: true })).toBeVisible(); await edit.getByRole('switch', { name: 'Activer la vue Budget', exact: true }).check(); await edit.getByRole('button', { name: 'Enregistrer le projet', exact: true }).click(); await expect(edit).not.toBeVisible();
  await page.reload(); await expect(page.getByRole('navigation', { name: 'Accès du projet', exact: true }).getByRole('link', { name: 'Budget', exact: true })).toBeVisible();
  const saved = (await state(request)).projects.find(item => item.id === project.id)!; expect(saved.tags).toEqual(['Client']); expect(saved.portfolioNames).toEqual(['Transformation']); expect(saved.enabledViews).toContain('budget');
});

test('formulaire projet mobile : retour au choix, activation minimale et annulation sans création', async ({ page, request }) => {
  const initial = await state(request); await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/#projects');
  await page.getByRole('button', { name: 'Nouveau projet', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Nouveau projet', exact: true });
  await dialog.getByRole('button', { name: 'Depuis zéro', exact: true }).click(); await dialog.getByRole('button', { name: 'Changer le mode de création', exact: true }).click(); await dialog.getByRole('button', { name: 'Depuis zéro', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Nom du projet', exact: true }).fill('Projet non enregistré');
  await dialog.getByRole('switch', { name: 'Tout activer', exact: true }).uncheck(); await expect(dialog.getByRole('switch', { name: 'Activer la vue Synthèse', exact: true })).toBeChecked();
  await dialog.getByRole('switch', { name: 'Activer la vue Synthèse', exact: true }).uncheck(); await dialog.getByRole('button', { name: 'Créer le projet', exact: true }).click(); await expect(dialog.getByRole('alert')).toHaveText('Activez au moins une vue du projet.');
  await dialog.getByRole('switch', { name: 'Tout activer', exact: true }).check();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await dialog.locator('.modal-body').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: screenshot('project-creation-mobile'), animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click(); await expect(dialog).not.toBeVisible(); expect((await state(request)).projects).toEqual(initial.projects);
});

test('annuaire : ajout de membre, ressource virtuelle et ressource matérielle avec capacité persistante', async ({ page, request }) => {
  await page.goto('/#resources'); await page.getByRole('button', { name: 'Nouvelle ressource', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Nouvelle ressource', exact: true }).getByRole('button', { name: 'Ressource matérielle', exact: true })).toBeVisible();
  expect((await page.getByRole('dialog', { name: 'Nouvelle ressource', exact: true }).boundingBox())!.height).toBeLessThan(600);
  await page.screenshot({ path: screenshot('resource-creation-choices'), animations: 'disabled' }); await page.getByRole('dialog', { name: 'Nouvelle ressource', exact: true }).getByRole('button', { name: 'Ajouter un membre', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Ajouter un membre', exact: true }); await dialog.getByLabel('Nom de la ressource', { exact: true }).fill('Membre création Planzone'); await dialog.getByLabel('Adresse e-mail', { exact: true }).fill('membre@example.org'); await dialog.getByRole('combobox', { name: 'Rôle', exact: true }).selectOption('visitor'); await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click(); await expect(dialog).not.toBeVisible();
  for (const option of [{ type: 'virtual', button: 'Ressource virtuelle', title: 'Créer une ressource virtuelle', name: 'Équipe virtuelle création' }, { type: 'material', button: 'Ressource matérielle', title: 'Créer une ressource matérielle', name: 'Machine création' }]) {
    await page.getByRole('button', { name: 'Nouvelle ressource', exact: true }).click(); await page.getByRole('dialog', { name: 'Nouvelle ressource', exact: true }).getByRole('button', { name: option.button, exact: true }).click(); dialog = page.getByRole('dialog', { name: option.title, exact: true });
    await dialog.getByLabel('Nom de la ressource', { exact: true }).fill(option.name); await dialog.getByLabel('Capacité du lundi (h/jour)', { exact: true }).fill('2'); await expect(dialog.getByRole('textbox', { name: 'Adresse e-mail', exact: true })).toHaveCount(0); await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click(); await expect(dialog).not.toBeVisible();
  }
  await page.reload(); const saved = await state(request);
  expect(saved.resources.find(item => item.name === 'Membre création Planzone')).toMatchObject({ type: 'human', email: 'membre@example.org', role: 'visitor' });
  expect(saved.resources.find(item => item.name === 'Équipe virtuelle création')).toMatchObject({ type: 'virtual', mondayHours: 2, email: '' }); expect(saved.resources.find(item => item.name === 'Machine création')).toMatchObject({ type: 'material', mondayHours: 2, email: '' });
  await page.getByRole('combobox', { name: 'Nature de ressource', exact: true }).selectOption('material'); await expect(page.getByRole('button', { name: 'Ouvrir la fiche de Machine création', exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Ouvrir la fiche de Équipe virtuelle création', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('button', { name: 'Nouvelle ressource', exact: true }).click(); const mobile = page.getByRole('dialog', { name: 'Nouvelle ressource', exact: true }); await expect(mobile.getByRole('button', { name: 'Ressource matérielle', exact: true })).toBeVisible(); expect(await mobile.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true); await page.screenshot({ path: screenshot('resource-creation-mobile'), animations: 'disabled' }); await mobile.getByRole('button', { name: 'Fermer la fiche ressource', exact: true }).click();
});

test('équipe projet : ajouter depuis la Planzone et créer une ressource déjà associée au projet', async ({ page, request }) => {
  const initial = await state(request); const project = await create<Project>(request, 'projects', { name: 'Projet équipe création', zoneId: initial.zones[0].id, startDate: '2026-10-06', endDate: '2026-12-31' });
  const existing = await create<Resource>(request, 'resources', { name: 'Membre existant à associer' });
  await page.goto('/#project/' + project.id + '/team'); await page.getByRole('button', { name: 'Ajouter une ressource', exact: true }).click(); let dialog = page.getByRole('dialog', { name: 'Ajouter une ressource au projet', exact: true });
  await dialog.getByRole('combobox', { name: 'Ressource de la Planzone', exact: true }).selectOption(existing.id); await dialog.getByRole('button', { name: 'Ajouter au projet', exact: true }).click(); await expect(dialog).not.toBeVisible(); await expect(page.getByRole('button', { name: 'Ouvrir la fiche de Membre existant à associer', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ajouter une ressource', exact: true }).click(); await page.getByRole('dialog', { name: 'Ajouter une ressource au projet', exact: true }).getByRole('button', { name: 'Créer une nouvelle ressource', exact: true }).click(); await page.getByRole('dialog', { name: 'Nouvelle ressource', exact: true }).getByRole('button', { name: 'Ressource virtuelle', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Créer une ressource virtuelle', exact: true }); await dialog.getByLabel('Nom de la ressource', { exact: true }).fill('Équipe virtuelle du projet'); await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click(); await expect(dialog).not.toBeVisible();
  await page.reload(); await expect(page.getByRole('button', { name: 'Ouvrir la fiche de Équipe virtuelle du projet', exact: true })).toBeVisible(); const saved = await state(request); expect(saved.resources.find(item => item.id === existing.id)!.projectIds).toContain(project.id); expect(saved.resources.find(item => item.name === 'Équipe virtuelle du projet')!.projectIds).toEqual([project.id]); expect(saved.tasks.filter(item => item.projectId === project.id)).toEqual([]);
});

test('choix depuis un modèle : sélection, description formatée, tarif et dates des tâches repris', async ({ page, request }) => {
  const template = await create<ProjectTemplate>(request, 'project-templates', { name: 'Modèle assistant de création', description: '**Mission du modèle**', descriptionFormat: 'markdown', budget: 3456.78, color: '#427BC8',
    tasks: [{ key: 'pilote', title: 'Tâche du modèle de création', description: '', phase: 'Cadrage', kind: 'task', allocatedHours: 8, tags: ['Pilote'], startOffsetDays: 2, endOffsetDays: 4, dependsOnKey: null }] });
  await page.goto('/#projects'); await page.getByRole('button', { name: 'Nouveau projet', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Nouveau projet', exact: true }); await dialog.getByRole('button', { name: 'À partir d’un modèle', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Modèle de projet', exact: true }).selectOption(template.id); await expect(dialog.getByRole('textbox', { name: 'Nom du projet', exact: true })).toHaveValue(template.name); await expect(dialog.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue(template.description);
  await dialog.getByRole('textbox', { name: 'Nom du projet', exact: true }).fill('Projet depuis assistant modèle'); await dialog.getByLabel('Date de début', { exact: true }).fill('2026-11-02'); await dialog.getByLabel('Date de fin', { exact: true }).fill('2026-11-30'); await dialog.getByRole('button', { name: 'Créer le projet', exact: true }).click(); await expect(dialog).not.toBeVisible();
  const saved = await state(request); const project = saved.projects.find(item => item.name === 'Projet depuis assistant modèle')!; expect(project).toMatchObject({ budget: template.budget, color: template.color, description: template.description, descriptionFormat: 'markdown' });
  const tasks = saved.tasks.filter(task => task.projectId === project.id); expect(tasks).toHaveLength(1); expect(tasks[0]).toMatchObject({ title: 'Tâche du modèle de création', startDate: '2026-11-04', endDate: '2026-11-06', tags: ['Pilote'], allocatedHours: 8 });
});
