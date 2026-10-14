import { test, expect, type Page, type Route } from '@playwright/test';
import { TEST_ADMIN, loginTestAdmin } from '../auth-fixture';
import type { AppData } from '../../shared/types';

async function fillLogin(page: Page, password = TEST_ADMIN.password) {
  await page.getByLabel('Identifiant', { exact: true }).fill(TEST_ADMIN.username);
  await page.getByLabel('Mot de passe', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
}

async function openAccount(page: Page) {
  await page.getByRole('button', { name: 'Votre espace et votre profil', exact: true }).click();
}

test('connexion obligatoire, mauvais mot de passe refusé et lien du projet conservé', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#project/project-nova/team');
  await expect(page.getByRole('button', { name: 'Se connecter', exact: true })).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveCount(0);
  const anonymousState = await page.request.get('/api/state');
  expect(anonymousState.status()).toBe(401);
  expect(await anonymousState.text()).not.toContain('Claire Martin');

  await fillLogin(page, 'Mot-de-passe-incorrect!');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveCount(0);
  expect((await page.request.get('/api/state')).status()).toBe(401);
  await fillLogin(page);
  await expect(page.getByRole('heading', { name: 'Équipe du projet', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#project\/project-nova\/team$/);
  const cookie = (await page.context().cookies()).find(item => item.name.includes('planzone8') && item.httpOnly);
  expect(cookie).toBeDefined();
  expect(cookie!.sameSite).toBe('Lax');
  expect(await page.evaluate(() => document.cookie)).not.toContain(cookie!.value);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Équipe du projet', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('déconnexion réelle et cookie de session précédent inutilisable', async ({ page, request }) => {
  await loginTestAdmin(page.request);
  await page.goto('/#project/project-nova/team');
  await expect(page.getByRole('heading', { name: 'Équipe du projet', exact: true })).toBeVisible();
  const previousCookie = (await page.context().cookies()).find(item => item.name.includes('planzone8') && item.httpOnly)!;
  await openAccount(page);
  await page.getByRole('menuitem', { name: 'Se déconnecter', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Se connecter', exact: true })).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveCount(0);
  expect((await page.request.get('/api/state')).status()).toBe(401);
  const replay = await request.get('/api/state', { headers: { Cookie: `${previousCookie.name}=${previousCookie.value}` } });
  expect(replay.status()).toBe(401);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Se connecter', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#project\/project-nova\/team$/);
});

test('session révoquée : le formulaire ouvert disparaît et ses modifications ne sont pas enregistrées', async ({ page, request }) => {
  await loginTestAdmin(page.request);
  const initialState = await (await page.request.get('/api/state')).json() as AppData;
  const resource = initialState.resources.find(item => item.id === 'resource-claire')!;
  await page.goto('/#resources');
  await page.getByRole('button', { name: `Ouvrir la fiche de ${resource.name}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Fiche ressource', exact: true });
  await dialog.getByLabel('Nom de la ressource', { exact: true }).fill('Modification après révocation');
  const cookie = (await page.context().cookies()).find(item => item.name.includes('planzone8') && item.httpOnly)!;
  const revoked = await request.post('/api/auth/logout', { data: {}, headers: { Cookie: `${cookie.name}=${cookie.value}` } });
  expect(revoked.status()).toBe(204);
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Se connecter', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.app-shell')).toHaveCount(0);
  await fillLogin(page);
  await expect(page.getByRole('button', { name: `Ouvrir la fiche de ${resource.name}`, exact: true })).toBeVisible();
  const restored = await (await page.request.get('/api/state')).json() as AppData;
  expect(restored.resources.find(item => item.id === resource.id)?.name).toBe(resource.name);
});

test('une réponse 401 retardée de l’ancienne session ne déconnecte pas la nouvelle connexion', async ({ page }) => {
  const taskTitle = 'Requête de l’ancienne session suspendue';
  await loginTestAdmin(page.request);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Vue d’ensemble', exact: true })).toBeVisible();

  let captureRequest!: (route: Route) => void;
  const capturedRequest = new Promise<Route>(resolve => { captureRequest = resolve; });
  await page.route('**/api/tasks', route => {
    if (route.request().method() === 'POST') captureRequest(route);
    else void route.continue();
  });
  const delayedResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/tasks' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Nouvelle tâche', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouvelle tâche', exact: true });
  await dialog.getByLabel('Titre', { exact: true }).fill(taskTitle);
  await dialog.getByRole('button', { name: 'Créer la tâche', exact: true }).click();
  const oldRequest = await capturedRequest;
  await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await openAccount(page);
  await page.getByRole('menuitem', { name: 'Se déconnecter', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Se connecter', exact: true })).toBeVisible();
  await fillLogin(page);
  await expect(page.getByRole('heading', { name: 'Vue d’ensemble', exact: true })).toBeVisible();

  // Release the old WorkspaceApp fetch only after the new session is displayed.
  await oldRequest.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Connexion requise.' }) });
  expect((await delayedResponse).status()).toBe(401);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByRole('heading', { name: 'Vue d’ensemble', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Se connecter', exact: true })).toHaveCount(0);
  expect(await (await page.request.get('/api/auth/session')).json()).toMatchObject({ authenticated: true });
  const state = await (await page.request.get('/api/state')).json() as AppData;
  expect(state.tasks.some(item => item.title === taskTitle)).toBe(false);
});

test('changement du mot de passe depuis le compte et révocation des autres sessions', async ({ page, request }) => {
  const newPassword = 'Planzone8-Test-Rotation!2026';
  await loginTestAdmin(page.request);
  await loginTestAdmin(request);
  let rotated = false;
  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Vue d’ensemble', exact: true })).toBeVisible();
    await openAccount(page);
    await page.getByRole('menuitem', { name: 'Changer le mot de passe', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Changer le mot de passe', exact: true });
    await dialog.getByLabel('Mot de passe actuel', { exact: true }).fill('Actuel-incorrect!2026');
    await dialog.getByLabel('Nouveau mot de passe', { exact: true }).fill(newPassword);
    await dialog.getByLabel('Confirmer le nouveau mot de passe', { exact: true }).fill(newPassword);
    await dialog.getByRole('button', { name: 'Modifier le mot de passe', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect((await page.request.get('/api/state')).status()).toBe(200);
    await dialog.getByLabel('Mot de passe actuel', { exact: true }).fill(TEST_ADMIN.password);
    const passwordSaved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/password' && response.status() === 200);
    await dialog.getByRole('button', { name: 'Modifier le mot de passe', exact: true }).click();
    await passwordSaved;
    rotated = true;
    await expect(dialog).not.toBeVisible();
    expect((await request.get('/api/state')).status()).toBe(401);
    expect((await page.request.get('/api/state')).status()).toBe(200);
    await openAccount(page);
    await page.getByRole('menuitem', { name: 'Se déconnecter', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Se connecter', exact: true })).toBeVisible();
    await fillLogin(page);
    await expect(page.getByRole('alert')).toBeVisible();
    await fillLogin(page, newPassword);
    await expect(page.getByRole('heading', { name: 'Vue d’ensemble', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Vue d’ensemble', exact: true })).toBeVisible();
  } finally {
    if (rotated) {
      await loginTestAdmin(request, newPassword);
      const restored = await request.post('/api/auth/password', { data: { currentPassword: newPassword, newPassword: TEST_ADMIN.password } });
      expect(restored.status()).toBe(200);
    }
  }
});

test('écran de connexion utilisable sur ordinateur et sur mobile sans débordement', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Identifiant', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Mot de passe', { exact: true })).toHaveAttribute('type', 'password');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const screenshotPath = (name: string) => test.info().project.testDir.endsWith('cloudflare-browser')
    ? test.info().outputPath(name) : `docs/screenshots/${name}`;
  await page.screenshot({ path: screenshotPath('auth-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Se connecter', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: screenshotPath('auth-mobile.png'), fullPage: true });
  await fillLogin(page);
  await expect(page.getByRole('heading', { name: 'Vue d’ensemble', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
