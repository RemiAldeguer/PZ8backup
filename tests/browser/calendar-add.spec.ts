import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import type { AppData, CalendarEvent, Project, Resource, Task, Unavailability } from '../../shared/types';
import { formatDate } from '../../shared/domain';
import { loginTestAdmin } from '../auth-fixture';

test.beforeEach(async ({ page, request }) => {
  await loginTestAdmin(page.request);
  await loginTestAdmin(request);
});

async function state(request: APIRequestContext) {
  const response = await request.get('/api/state');
  expect(response.ok()).toBeTruthy();
  return await response.json() as AppData;
}

async function fixture(request: APIRequestContext, suffix: string) {
  const data = await state(request);
  const projectResponse = await request.post('/api/projects', { data: {
    name: `Projet calendrier ${suffix}`, zoneId: data.zones[0].id,
    startDate: '2026-10-01', endDate: '2026-11-30', status: 'open',
  } });
  expect(projectResponse.ok()).toBeTruthy();
  const project = await projectResponse.json() as Project;
  const resourceResponse = await request.post('/api/resources', { data: {
    name: `Ressource calendrier ${suffix}`, jobTitle: 'Recette calendrier', type: 'human',
    weeklyCapacityHours: [8, 8, 8, 8, 8, 0, 0], capacityUnit: 'hours',
    dailyHours: 8, mondayHours: 8, holidayCalendarId: 'none',
  } });
  expect(resourceResponse.ok()).toBeTruthy();
  const resource = await resourceResponse.json() as Resource;
  const otherResource = data.resources.find(item => item.active && item.id !== resource.id)!;
  return { project, resource, otherResource };
}

async function add(page: Page, kind: 'Tâche' | 'Jalon' | 'Événement' | 'Indisponibilité') {
  await page.getByRole('button', { name: 'Ajouter au calendrier', exact: true }).click();
  await page.getByRole('menuitem', { name: kind, exact: true }).click();
}

function screenshotPath(name: string) {
  return test.info().project.testDir.endsWith('cloudflare-browser') ? test.info().outputPath(name) : `docs/screenshots/${name}`;
}

async function expectOctoberCapacity(page: Page, resource: Resource, hours: number) {
  await page.goto('/#resources/capacity');
  await page.getByRole('spinbutton', { name: 'Année de planification', exact: true }).fill('2026');
  await page.getByRole('spinbutton', { name: 'Année de planification', exact: true }).press('Enter');
  await page.getByRole('combobox', { name: 'Unité de planification', exact: true }).selectOption('hours');
  await page.getByRole('combobox', { name: 'Choisir une ressource', exact: true }).selectOption(resource.id);
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: `Ouvrir la fiche de ${resource.name}`, exact: true }) });
  await expect.poll(async () => Number((await row.getByRole('cell').nth(9).innerText()).replace(/[^\d,.\-]/g, '').replace(',', '.'))).toBe(hours);
}

test('menu Ajouter : tâche et jalon créés dans le bon projet, visibles et conservés après rechargement', async ({ page, request }) => {
  const { project, resource } = await fixture(request, 'tâche et jalon');
  await page.goto('/#calendar');
  await page.getByRole('button', { name: 'Ajouter au calendrier', exact: true }).click();
  for (const kind of ['Tâche', 'Jalon', 'Événement', 'Indisponibilité']) {
    await expect(page.getByRole('menuitem', { name: kind, exact: true })).toBeVisible();
  }
  await page.screenshot({ path: screenshotPath('calendar-add-menu.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('menuitem', { name: 'Tâche', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Nouvelle tâche', exact: true });
  await dialog.getByLabel('Titre', { exact: true }).fill('Tâche ajoutée au calendrier');
  await dialog.getByRole('combobox', { name: 'Projet', exact: true }).selectOption(project.id);
  await dialog.getByRole('combobox', { name: 'Assigné à', exact: true }).selectOption(resource.id);
  await dialog.getByLabel('Phase', { exact: true }).fill('Phase calendrier');
  await dialog.getByLabel('Début', { exact: true }).fill('2026-10-05');
  await dialog.getByLabel('Fin', { exact: true }).fill('2026-10-07');
  await dialog.getByLabel('Travail alloué (heures)', { exact: true }).fill('12.5');
  await dialog.getByRole('button', { name: 'Créer la tâche', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('combobox', { name: 'Filtrer le calendrier par projet', exact: true }).selectOption(project.id);
  await expect(page.getByRole('button', { name: 'Ouvrir Tâche ajoutée au calendrier', exact: true }).first()).toBeVisible();

  await add(page, 'Jalon');
  dialog = page.getByRole('dialog', { name: 'Nouveau jalon', exact: true });
  await dialog.getByLabel('Titre', { exact: true }).fill('Jalon ajouté au calendrier');
  await dialog.getByRole('combobox', { name: 'Projet', exact: true }).selectOption(project.id);
  await dialog.getByLabel('Date du jalon', { exact: true }).fill('2026-10-09');
  await dialog.getByRole('button', { name: 'Créer le jalon', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('combobox', { name: 'Filtrer le calendrier par projet', exact: true }).selectOption(project.id);
  await expect(page.getByRole('button', { name: 'Ouvrir Jalon ajouté au calendrier', exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole('combobox', { name: 'Filtrer le calendrier par projet', exact: true }).selectOption(project.id);
  await expect(page.getByRole('button', { name: 'Ouvrir Tâche ajoutée au calendrier', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ouvrir Jalon ajouté au calendrier', exact: true })).toBeVisible();
  const stored = await state(request);
  expect(stored.tasks.find(task => task.title === 'Tâche ajoutée au calendrier')).toMatchObject({
    projectId: project.id, assigneeId: resource.id, kind: 'task', allocatedHours: 12.5,
    phase: 'Phase calendrier', startDate: '2026-10-05', endDate: '2026-10-07',
  });
  const milestone = stored.tasks.find(task => task.title === 'Jalon ajouté au calendrier')!;
  expect(milestone).toMatchObject({ projectId: project.id, kind: 'milestone', allocatedHours: 0, endDate: '2026-10-09' });
  await page.getByRole('button', { name: 'Ouvrir Jalon ajouté au calendrier', exact: true }).click();
  const taskDetails = page.getByRole('dialog', { name: 'Détail de la tâche', exact: true });
  await expect(taskDetails).toBeVisible();
  await taskDetails.getByRole('button', { name: 'Fermer', exact: true }).click();

  // A busy day must retain access to every item through the existing overflow dialog.
  for (let index = 1; index <= 3; index++) {
    const response = await request.post('/api/tasks', { data: {
      projectId: project.id, title: `Tâche du jour chargé ${index}`,
      startDate: '2026-10-09', endDate: '2026-10-09',
    } });
    expect(response.ok()).toBeTruthy();
  }
  await page.reload();
  await page.getByRole('combobox', { name: 'Filtrer le calendrier par projet', exact: true }).selectOption(project.id);
  await page.getByRole('button', { name: '+ 1 autres', exact: true }).click();
  const overflow = page.getByRole('dialog');
  await expect(overflow).toBeVisible();
  await overflow.getByRole('button', { name: 'Ouvrir Tâche du jour chargé 3', exact: true }).click();
  await expect(taskDetails).toBeVisible();
  await expect(taskDetails.getByLabel('Titre', { exact: true })).toHaveValue('Tâche du jour chargé 3');
});

test('événement : horaires, participants et filtres, puis journée entière, édition et suppression persistantes', async ({ page, request }) => {
  const { project, resource, otherResource } = await fixture(request, 'événement');
  await page.goto('/#calendar');
  await add(page, 'Événement');
  let dialog = page.getByRole('dialog', { name: 'Nouvel événement', exact: true });
  await dialog.getByLabel('Nom de l’événement', { exact: true }).fill('Atelier calendrier horodaté');
  await dialog.getByRole('combobox', { name: 'Projet', exact: true }).selectOption(project.id);
  await dialog.getByRole('checkbox', { name: resource.name, exact: true }).check();
  await dialog.getByRole('checkbox', { name: 'Toute la journée', exact: true }).uncheck();
  await dialog.getByLabel('Début', { exact: true }).fill('2026-10-08');
  await dialog.getByLabel('Fin', { exact: true }).fill('2026-10-08');
  await dialog.getByLabel('De', { exact: true }).fill('09:30');
  await dialog.getByLabel('À', { exact: true }).fill('11:15');
  await page.screenshot({ path: screenshotPath('calendar-event-form.png'), fullPage: false, animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Créer l’événement', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('combobox', { name: 'Filtrer le calendrier par projet', exact: true }).selectOption(project.id);
  const item = () => page.getByRole('button', { name: 'Ouvrir l’événement Atelier calendrier horodaté', exact: true });
  await expect(item()).toBeVisible();
  let stored = await state(request);
  const event = stored.calendarEvents.find(item => item.title === 'Atelier calendrier horodaté') as CalendarEvent;
  expect(event).toMatchObject({ projectId: project.id, resourceIds: [resource.id], allDay: false,
    startDate: '2026-10-08', endDate: '2026-10-08', startTime: '09:30', endTime: '11:15' });
  expect(stored.tasks.some(task => task.title === event.title)).toBe(false);

  await page.getByRole('combobox', { name: 'Filtrer le calendrier par type', exact: true }).selectOption('task');
  await expect(item()).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Filtrer le calendrier par type', exact: true }).selectOption('event');
  await page.getByRole('combobox', { name: 'Filtrer le calendrier par ressource', exact: true }).selectOption(otherResource.id);
  await expect(item()).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Filtrer le calendrier par ressource', exact: true }).selectOption(resource.id);
  await expect(item()).toBeVisible();
  await item().click();
  dialog = page.getByRole('dialog', { name: 'Modifier l’événement', exact: true });
  await expect(dialog.getByLabel('De', { exact: true })).toHaveValue('09:30');
  // A range that ends on the following day can legitimately end at an earlier clock time.
  await dialog.getByLabel('Fin', { exact: true }).fill('2026-10-09');
  await dialog.getByLabel('De', { exact: true }).fill('18:00');
  await dialog.getByLabel('À', { exact: true }).fill('08:30');
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('combobox', { name: 'Filtrer le calendrier par projet', exact: true }).selectOption(project.id);
  await expect(item()).toHaveCount(2);
  await expect.poll(() => item().first().getAttribute('title')).toContain(formatDate('2026-10-08'));
  await expect.poll(() => item().first().getAttribute('title')).toContain(formatDate('2026-10-09'));
  stored = await state(request);
  expect(stored.calendarEvents.find(item => item.id === event.id)).toMatchObject({
    allDay: false, startDate: '2026-10-08', endDate: '2026-10-09', startTime: '18:00', endTime: '08:30',
  });
  await item().first().click();
  dialog = page.getByRole('dialog', { name: 'Modifier l’événement', exact: true });
  await dialog.getByLabel('Nom de l’événement', { exact: true }).fill('Atelier calendrier journée entière');
  await dialog.getByRole('checkbox', { name: 'Toute la journée', exact: true }).check();
  await dialog.getByLabel('Fin', { exact: true }).fill('2026-10-09');
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await page.getByRole('combobox', { name: 'Filtrer le calendrier par projet', exact: true }).selectOption(project.id);
  const allDay = page.getByRole('button', { name: 'Ouvrir l’événement Atelier calendrier journée entière', exact: true });
  await expect(allDay).toHaveCount(2);
  stored = await state(request);
  expect(stored.calendarEvents.find(item => item.id === event.id)).toMatchObject({ title: 'Atelier calendrier journée entière', allDay: true, startTime: null, endTime: null, endDate: '2026-10-09' });
  await allDay.first().click();
  dialog = page.getByRole('dialog', { name: 'Modifier l’événement', exact: true });
  page.once('dialog', confirmation => void confirmation.accept());
  await dialog.getByRole('button', { name: 'Supprimer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(allDay).toHaveCount(0);
  await page.reload();
  expect((await state(request)).calendarEvents.some(item => item.id === event.id)).toBe(false);
});

test('indisponibilités : période totale et heures partielles, refus d’horaires inversés, correction et suppression', async ({ page, request }) => {
  const { resource, otherResource } = await fixture(request, 'indisponibilités');
  await page.goto('/#calendar');
  await add(page, 'Indisponibilité');
  let dialog = page.getByRole('dialog', { name: 'Créer une indisponibilité', exact: true });
  await dialog.getByLabel('Nom de l’indisponibilité', { exact: true }).fill('Congé calendrier total');
  await dialog.getByRole('combobox', { name: 'Pour', exact: true }).selectOption(resource.id);
  await dialog.getByRole('combobox', { name: 'Type', exact: true }).selectOption('leave');
  await dialog.getByRole('radio', { name: 'Toute la journée', exact: true }).check();
  await dialog.getByLabel('Début', { exact: true }).fill('2026-10-05');
  await dialog.getByLabel('Fin', { exact: true }).fill('2026-10-06');
  await page.screenshot({ path: screenshotPath('calendar-unavailability-full.png'), fullPage: false, animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Créer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('combobox', { name: 'Filtrer le calendrier par type', exact: true }).selectOption('unavailability');
  await page.getByRole('combobox', { name: 'Filtrer le calendrier par ressource', exact: true }).selectOption(resource.id);
  const totalItem = page.getByRole('button', { name: 'Ouvrir l’indisponibilité Congé calendrier total', exact: true });
  await expect(totalItem).toHaveCount(2);
  let stored = await state(request);
  const total = stored.unavailabilities.find(item => item.title === 'Congé calendrier total') as Unavailability;
  expect(total).toMatchObject({ resourceId: resource.id, reason: 'leave', allDay: true,
    startDate: '2026-10-05', endDate: '2026-10-06', startTime: null, endTime: null });

  await add(page, 'Indisponibilité');
  dialog = page.getByRole('dialog', { name: 'Créer une indisponibilité', exact: true });
  await dialog.getByLabel('Nom de l’indisponibilité', { exact: true }).fill('Absence calendrier partielle');
  await dialog.getByRole('combobox', { name: 'Pour', exact: true }).selectOption(resource.id);
  await dialog.getByRole('combobox', { name: 'Type', exact: true }).selectOption('sick');
  await dialog.getByRole('radio', { name: 'Journée partielle', exact: true }).check();
  await dialog.getByLabel('Le', { exact: true }).fill('2026-10-07');
  await dialog.getByLabel('De', { exact: true }).fill('09:00');
  await dialog.getByLabel('À', { exact: true }).fill('11:00');
  await page.screenshot({ path: screenshotPath('calendar-unavailability-partial.png'), fullPage: false, animations: 'disabled' });
  await dialog.getByLabel('De', { exact: true }).fill('12:00');
  await dialog.getByLabel('À', { exact: true }).fill('10:00');
  await dialog.getByRole('button', { name: 'Créer', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toBeVisible();
  expect((await state(request)).unavailabilities.some(item => item.title === 'Absence calendrier partielle')).toBe(false);
  await dialog.getByLabel('De', { exact: true }).fill('09:00');
  await dialog.getByLabel('À', { exact: true }).fill('11:00');
  await dialog.getByRole('button', { name: 'Créer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('combobox', { name: 'Filtrer le calendrier par type', exact: true }).selectOption('unavailability');
  await page.getByRole('combobox', { name: 'Filtrer le calendrier par ressource', exact: true }).selectOption(resource.id);
  const partialItem = page.getByRole('button', { name: 'Ouvrir l’indisponibilité Absence calendrier partielle', exact: true });
  await expect(partialItem).toBeVisible();
  await page.screenshot({ path: screenshotPath('calendar-unavailabilities.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('combobox', { name: 'Filtrer le calendrier par ressource', exact: true }).selectOption(otherResource.id);
  await expect(totalItem).toHaveCount(0);
  await expect(partialItem).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Filtrer le calendrier par ressource', exact: true }).selectOption(resource.id);
  stored = await state(request);
  const partial = stored.unavailabilities.find(item => item.title === 'Absence calendrier partielle') as Unavailability;
  expect(partial).toMatchObject({ resourceId: resource.id, reason: 'sick', allDay: false,
    startDate: '2026-10-07', endDate: '2026-10-07', startTime: '09:00', endTime: '11:00' });
  // October contains 22 weekdays: 176 h, minus two full days and this two-hour absence.
  await expectOctoberCapacity(page, resource, 158);
  await page.goto('/#calendar');
  await page.getByRole('combobox', { name: 'Filtrer le calendrier par type', exact: true }).selectOption('unavailability');
  await page.getByRole('combobox', { name: 'Filtrer le calendrier par ressource', exact: true }).selectOption(resource.id);
  await partialItem.click();
  dialog = page.getByRole('dialog', { name: 'Modifier l’indisponibilité', exact: true });
  await dialog.getByRole('radio', { name: 'Toute la journée', exact: true }).check();
  await dialog.getByLabel('Début', { exact: true }).fill('2026-10-07');
  await dialog.getByLabel('Fin', { exact: true }).fill('2026-10-08');
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await page.getByRole('combobox', { name: 'Filtrer le calendrier par type', exact: true }).selectOption('unavailability');
  await page.getByRole('combobox', { name: 'Filtrer le calendrier par ressource', exact: true }).selectOption(resource.id);
  await expect(partialItem).toHaveCount(2);
  expect((await state(request)).unavailabilities.find(item => item.id === partial.id)).toMatchObject({ allDay: true, startTime: null, endTime: null, endDate: '2026-10-08' });
  await partialItem.first().click();
  dialog = page.getByRole('dialog', { name: 'Modifier l’indisponibilité', exact: true });
  page.once('dialog', confirmation => void confirmation.accept());
  await dialog.getByRole('button', { name: 'Supprimer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(partialItem).toHaveCount(0);
  expect((await state(request)).unavailabilities.some(item => item.id === partial.id)).toBe(false);
  expect((await state(request)).unavailabilities.some(item => item.id === total.id)).toBe(true);
  await expectOctoberCapacity(page, resource, 160);
});

test('calendrier d’un projet clos : créations de projet verrouillées, indisponibilité globale encore disponible', async ({ page, request }) => {
  const { project, resource } = await fixture(request, 'lecture seule');
  const taskResponse = await request.post('/api/tasks', { data: {
    projectId: project.id, title: 'Tâche calendrier conservée', assigneeId: resource.id,
    startDate: '2026-10-05', endDate: '2026-10-05', allocatedHours: 4,
  } });
  expect(taskResponse.ok()).toBeTruthy();
  const task = await taskResponse.json() as Task;
  expect((await request.patch(`/api/projects/${project.id}`, { data: { status: 'closed' } })).ok()).toBeTruthy();
  await page.goto(`/#project/${project.id}/calendar`);
  await expect(page.getByRole('button', { name: `Ouvrir ${task.title}`, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ajouter au calendrier', exact: true }).click();
  for (const kind of ['Tâche', 'Jalon', 'Événement']) {
    await expect(page.getByRole('menuitem', { name: kind, exact: true })).toBeDisabled();
  }
  await expect(page.getByRole('menuitem', { name: 'Indisponibilité', exact: true })).toBeEnabled();
  await page.getByRole('menuitem', { name: 'Indisponibilité', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Créer une indisponibilité', exact: true });
  await dialog.getByLabel('Nom de l’indisponibilité', { exact: true }).fill('Absence hors verrouillage du projet');
  await dialog.getByRole('combobox', { name: 'Pour', exact: true }).selectOption(resource.id);
  await dialog.getByLabel('Début', { exact: true }).fill('2026-10-12');
  await dialog.getByLabel('Fin', { exact: true }).fill('2026-10-12');
  await dialog.getByRole('button', { name: 'Créer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect((await state(request)).unavailabilities.find(item => item.title === 'Absence hors verrouillage du projet')).toMatchObject({ resourceId: resource.id, allDay: true });
});

test('formulaire mobile : absence partielle créée sans débordement, puis calendrier du projet prérempli', async ({ page, request }) => {
  const { project, resource } = await fixture(request, 'mobile');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#calendar');
  await add(page, 'Indisponibilité');
  const dialog = page.getByRole('dialog', { name: 'Créer une indisponibilité', exact: true });
  await dialog.getByLabel('Nom de l’indisponibilité', { exact: true }).fill('Absence partielle mobile');
  await dialog.getByRole('combobox', { name: 'Pour', exact: true }).selectOption(resource.id);
  await dialog.getByRole('radio', { name: 'Journée partielle', exact: true }).check();
  await dialog.getByLabel('Le', { exact: true }).fill('2026-10-09');
  await dialog.getByLabel('De', { exact: true }).fill('14:00');
  await dialog.getByLabel('À', { exact: true }).fill('16:30');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: screenshotPath('calendar-unavailability-mobile.png'), fullPage: false, animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Créer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect((await state(request)).unavailabilities.find(item => item.title === 'Absence partielle mobile')).toMatchObject({ allDay: false, startTime: '14:00', endTime: '16:30' });

  await page.goto(`/#project/${project.id}/calendar`);
  await add(page, 'Tâche');
  const taskDialog = page.getByRole('dialog', { name: 'Nouvelle tâche', exact: true });
  await taskDialog.getByLabel('Titre', { exact: true }).fill('Tâche calendrier mobile');
  await taskDialog.getByLabel('Début', { exact: true }).fill('2026-10-09');
  await taskDialog.getByLabel('Fin', { exact: true }).fill('2026-10-09');
  await taskDialog.getByRole('button', { name: 'Créer la tâche', exact: true }).click();
  await expect(taskDialog).not.toBeVisible();
  expect((await state(request)).tasks.find(item => item.title === 'Tâche calendrier mobile')).toMatchObject({ projectId: project.id, kind: 'task', startDate: '2026-10-09', endDate: '2026-10-09' });
});
