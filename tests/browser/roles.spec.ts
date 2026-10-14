import { mkdirSync } from 'node:fs';
import { test, expect, type APIRequestContext, type Browser } from '@playwright/test';
import type { AppData, Project, Resource, ResourceRole, Task } from '../../shared/types';
import { DEFAULT_PERMISSION_POLICY } from '../../shared/permissions';
import { loginTestAdmin } from '../auth-fixture';

const PASSWORD = 'Roles-browser-test!2026';
test.beforeEach(async ({ page, request }) => { await loginTestAdmin(page.request); await loginTestAdmin(request); });
async function state(request: APIRequestContext): Promise<AppData> { const result = await request.get('/api/state'); expect(result.ok()).toBeTruthy(); return result.json(); }
async function create<T>(request: APIRequestContext, entity: string, data: unknown): Promise<T> { const result = await request.post('/api/' + entity, { data }); expect(result.ok(), await result.text()).toBeTruthy(); return result.json(); }
const screenshot = (name: string) => { mkdirSync('docs/screenshots', { recursive: true }); return 'docs/screenshots/' + name + '.png'; };
async function fixture(request: APIRequestContext, role: ResourceRole, projectRole = 'collaborator') {
  const suffix = Date.now().toString(36); const initial = await state(request);
  const project = await create<Project>(request, 'projects', { name: 'Projet rôles ' + suffix, zoneId: initial.zones[0].id, startDate: '2026-10-01', endDate: '2026-12-31', budget: 43210 });
  const member = await create<Resource>(request, 'resources', { name: 'Membre rôles ' + suffix, role, profileId: 'profile-pilot', projectIds: [project.id], zoneIds: [initial.zones[0].id] });
  const result = await request.patch('/api/projects/' + project.id, { data: { projectRoles: { [member.id]: role === 'visitor' ? 'observer' : projectRole } } }); expect(result.ok()).toBeTruthy();
  const task = await create<Task>(request, 'tasks', { projectId: project.id, title: 'Tâche personnelle rôles ' + suffix, assigneeId: member.id, allocatedHours: 8 });
  return { project, member, task, username: 'roles-' + suffix, initial };
}
async function memberContext(browser: Browser, baseURL: string | undefined, request: APIRequestContext, f: Awaited<ReturnType<typeof fixture>>) {
  const account = await request.post('/api/auth/members', { data: { resourceId: f.member.id, username: f.username, password: PASSWORD } }); expect(account.status(), await account.text()).toBe(201);
  const context = await browser.newContext({ baseURL, locale: 'fr-FR', timezoneId: 'Europe/Paris' }); const response = await context.request.post('/api/auth/login', { data: { username: f.username, password: PASSWORD } }); expect(response.status(), await response.text()).toBe(200);
  return context;
}

test('administration : quatre rôles globaux, trois rôles projet et droits conditionnels persistants', async ({ page, request }) => {
  const f = await fixture(request, 'user'); await page.goto('/#resources'); const global = page.getByRole('combobox', { name: 'Rôle global de ' + f.member.name, exact: true }); await expect(global.locator('option')).toHaveCount(4); await global.selectOption('project_creator');
  await page.reload(); await expect(page.getByRole('combobox', { name: 'Rôle global de ' + f.member.name, exact: true })).toHaveValue('project_creator');
  await page.screenshot({ path: screenshot('roles-global-desktop'), animations: 'disabled' });
  await page.goto('/#project/' + f.project.id + '/team'); const projectRole = page.getByRole('combobox', { name: 'Rôle projet de ' + f.member.name, exact: true }); await expect(projectRole.locator('option')).toHaveCount(3); await projectRole.selectOption('manager'); await page.reload(); await expect(page.getByRole('combobox', { name: 'Rôle projet de ' + f.member.name, exact: true })).toHaveValue('manager');
  await page.screenshot({ path: screenshot('roles-project-desktop'), animations: 'disabled' });
  expect((await state(request)).resources.find(item => item.id === f.member.id)?.role).toBe('project_creator');
  await page.goto('/#resources/permissions'); await page.getByRole('checkbox', { name: 'Créer une tâche', exact: true }).check(); await page.getByRole('button', { name: 'Enregistrer les droits', exact: true }).click(); await page.reload(); await expect(page.getByRole('checkbox', { name: 'Créer une tâche', exact: true })).toBeChecked(); await page.getByRole('checkbox', { name: 'Créer un jalon', exact: true }).check(); await page.getByRole('button', { name: 'Enregistrer les droits', exact: true }).click(); await page.reload(); await expect(page.getByRole('checkbox', { name: 'Créer un jalon', exact: true })).toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: screenshot('roles-policy-mobile'), fullPage: true, animations: 'disabled' }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('observateur connecté : projet affecté, budget masqué, discussion autorisée et écritures refusées', async ({ browser, baseURL, request }) => {
  const f = await fixture(request, 'visitor'); const context = await memberContext(browser, baseURL, request, f);
  try {
    const page = await context.newPage(); await page.goto('/#project/' + f.project.id + '/list'); await expect(page.getByRole('checkbox', { name: 'Terminer ' + f.task.title, exact: true })).toBeDisabled();
    await expect(page.getByRole('navigation', { name: 'Vues du projet', exact: true }).getByRole('button', { name: 'Budget', exact: true })).toHaveCount(0); await expect(page.getByRole('navigation', { name: 'Vues du projet', exact: true }).getByRole('button', { name: 'Suivi temporel', exact: true })).toHaveCount(0);
    const data = await state(context.request); expect(data.currentUser.id).toBe(f.member.id); expect(data.currentUser.role).toBe('Visiteur'); expect(data.projects.map(item => item.id)).toEqual([f.project.id]); expect(data.projects[0].budget).toBe(0); expect(data.profiles).toEqual([]); expect(data.expenses).toEqual([]);
    expect((await context.request.patch('/api/resources/' + f.member.id, { data: { role: 'administrator' } })).status()).toBe(403); expect((await context.request.patch('/api/tasks/' + f.task.id, { data: { status: 'done' } })).status()).toBe(403);
    expect((await context.request.post('/api/comments', { data: { projectId: f.project.id, body: 'Discussion observateur autorisée' } })).status()).toBe(201);
    await page.goto('/#project/' + f.project.id + '/documents'); await expect(page.getByRole('button', { name: 'Nouveau dossier', exact: true })).toBeDisabled();
    await page.goto('/#project/' + f.project.id + '/budget'); await expect(page.getByRole('heading', { name: 'Accès réservé', exact: true })).toBeVisible();
    expect((await context.request.post('/api/auth/members', { data: { resourceId: f.member.id, username: 'interdit', password: PASSWORD } })).status()).toBe(403);
  } finally { await context.close(); }
});

test('collaborateur connecté : tâche propre, temps personnels sans tarifs et révocation des droits immédiate', async ({ browser, baseURL, request }) => {
  const f = await fixture(request, 'user'); const policy = (await state(request)).permissionPolicies?.[0];
  const policyPayload = { ...DEFAULT_PERMISSION_POLICY, collaborator: { ...DEFAULT_PERMISSION_POLICY.collaborator, taskCreate: true } };
  if (policy) expect((await request.patch('/api/permission-policies/' + policy.id, { data: policyPayload })).ok()).toBeTruthy(); else await create(request, 'permission-policies', policyPayload);
  const context = await memberContext(browser, baseURL, request, f);
  try {
    const page = await context.newPage(); await page.goto('/#project/' + f.project.id + '/list'); await page.getByRole('checkbox', { name: 'Terminer ' + f.task.title, exact: true }).click(); await expect(page.getByRole('checkbox', { name: 'Rouvrir ' + f.task.title, exact: true })).toBeChecked();
    const entry = await context.request.post('/api/time-entries', { data: { taskId: f.task.id, resourceId: f.member.id, date: '2026-10-06', hours: 1 } }); expect(entry.status(), await entry.text()).toBe(201); expect((await entry.json()).rateSnapshot).toBeNull();
    const privileged = (await state(request)).timeEntries.find(item => item.taskId === f.task.id)!; expect(privileged.rateSnapshot).toBe(650);
    expect((await context.request.post('/api/tasks', { data: { projectId: f.project.id, title: 'Création collaborateur autorisée', allocatedHours: 0 } })).status()).toBe(201);
    expect((await context.request.patch('/api/projects/' + f.project.id, { data: { projectRoles: { [f.member.id]: 'manager' } } })).status()).toBe(403);
    expect((await request.patch('/api/resources/' + f.member.id, { data: { role: 'visitor' } })).ok()).toBeTruthy();
    expect((await context.request.get('/api/auth/session')).status()).toBe(200); expect((await (await context.request.get('/api/auth/session')).json()).user.role).toBe('visitor');
    expect((await context.request.post('/api/tasks', { data: { projectId: f.project.id, title: 'Après rétrogradation' } })).status()).toBe(403); await page.reload(); await expect(page.getByRole('checkbox', { name: 'Rouvrir ' + f.task.title, exact: true })).toBeDisabled();
  } finally { await context.close(); }
});

test('chef de projet connecté : budget, intégration et limites du rôle global', async ({ browser, baseURL, request }) => {
  const f = await fixture(request, 'user', 'manager'); const context = await memberContext(browser, baseURL, request, f);
  try {
    const page = await context.newPage(); await page.goto('/#project/' + f.project.id + '/budget'); await expect(page.getByRole('button', { name: 'Modifier le budget alloué', exact: true })).toBeEnabled();
    expect((await context.request.patch('/api/projects/' + f.project.id, { data: { budget: 12345 } })).status()).toBe(200);
    const entry = await context.request.post('/api/time-entries', { data: { taskId: f.task.id, resourceId: f.member.id, date: '2026-10-06', hours: 2 } }); expect(entry.status()).toBe(201); expect((await entry.json()).rateSnapshot).toBe(650);
    await page.goto('/#project/' + f.project.id + '/time'); await expect(page.getByRole('textbox', { name: 'Date d’intégration projet', exact: true })).toBeEnabled();
    expect((await context.request.post('/api/time-integrations', { data: { scope: 'project', projectId: f.project.id, date: '2026-10-06' } })).status()).toBe(200);
    expect((await state(context.request)).timeEntries.find(item => item.taskId === f.task.id)?.integrationValidated).toBe(true);
    expect((await context.request.post('/api/resources', { data: { name: 'Création globale interdite' } })).status()).toBe(403);
    expect((await context.request.patch('/api/projects/project-mobile', { data: { description: 'Projet non affecté' } })).status()).toBe(403);
    expect((await context.request.post('/api/projects', { data: { name: 'Usager ne crée pas de projet', zoneId: f.initial.zones[0].id, startDate: '2026-10-06', endDate: '2026-11-30' } })).status()).toBe(403);
  } finally { await context.close(); }
});

test('fiche membre : création de connexion, créateur limité à ses zones et capacité personnelle éditable', async ({ page, browser, baseURL, request }) => {
  const f = await fixture(request, 'project_creator'); await page.goto('/#resources'); await page.getByRole('button', { name: 'Ouvrir la fiche de ' + f.member.name, exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Fiche ressource', exact: true });
  await dialog.getByRole('button', { name: 'Créer l’accès de connexion', exact: true }).click(); await dialog.getByLabel('Identifiant du membre', { exact: true }).fill(f.username); await dialog.getByLabel('Mot de passe initial', { exact: true }).fill(PASSWORD); await dialog.getByRole('button', { name: 'Créer le compte du membre', exact: true }).click(); await expect(dialog.getByText(f.username, { exact: true })).toBeVisible(); await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  const context = await browser.newContext({ baseURL, locale: 'fr-FR', timezoneId: 'Europe/Paris' });
  try {
    expect((await context.request.post('/api/auth/login', { data: { username: f.username, password: PASSWORD } })).status()).toBe(200); const own = await context.newPage(); await own.goto('/#projects'); await own.getByRole('button', { name: 'Nouveau projet', exact: true }).click(); const form = own.getByRole('dialog', { name: 'Nouveau projet', exact: true }); await form.getByRole('button', { name: 'Depuis zéro', exact: true }).click(); await expect(form.getByRole('combobox', { name: 'Zone', exact: true }).locator('option')).toHaveCount(1);
    await form.getByRole('textbox', { name: 'Nom du projet', exact: true }).fill('Projet du créateur connecté ' + f.username); await form.getByRole('button', { name: 'Créer le projet', exact: true }).click(); await expect(form).not.toBeVisible(); const created = (await state(context.request)).projects.find(project => project.name === 'Projet du créateur connecté ' + f.username)!; expect(created.projectRoles?.[f.member.id]).toBe('manager');
    await own.goto('/#personal'); await own.getByRole('button', { name: 'Ma capacité', exact: true }).click(); const capacity = own.getByRole('dialog', { name: 'Ma capacité', exact: true }); await capacity.getByLabel('Lundi (heures)', { exact: true }).fill('4'); await capacity.getByRole('button', { name: 'Enregistrer ma capacité', exact: true }).click(); await expect(capacity).not.toBeVisible(); expect((await state(context.request)).resources.find(item => item.id === f.member.id)?.weeklyCapacityHours?.[0]).toBe(4);
    expect((await context.request.post('/api/zones', { data: { name: 'Zone du créateur interdite' } })).status()).toBe(403);
  } finally { await context.close(); }
});
