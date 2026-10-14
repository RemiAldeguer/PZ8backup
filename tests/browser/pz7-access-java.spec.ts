import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

type Fixture = {
  apiUrl: string;
  issuer: string;
  adminSubject: string;
  inviteeSubject: string;
  planzoneId: string;
  adminRoleId: string;
  visitorRoleId: string;
  controlUrl: string;
};
const fixture = JSON.parse(readFileSync(process.env.PZ8_BROWSER_FIXTURE_FILE!, 'utf8')) as Fixture;

test('l’entrée réelle relie connexion, ressources, invitation et révocation des permissions au backend Java', async ({ browser, page }) => {
  // The disposable provider serves its own account selection page. All redirects,
  // product API responses and database results use the actual HTTP implementations.
  await page.goto('/access/');
  await expect(page.getByRole('heading', { name: 'Connexion à Planzone' })).toBeVisible();
  await page.getByRole('link', { name: 'Se connecter', exact: true }).click();
  await page.getByRole('button', { name: 'admin@example.test', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recette Java', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Créer une ressource', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Créer une ressource' });
  const longName = 'R'.repeat(256);
  await create.getByLabel('Nom de la ressource', { exact: true }).fill(longName);
  await create.getByRole('button', { name: 'Créer une ressource', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: longName })).toContainText('Sans compte');
  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: longName })).toBeVisible();
  await page.getByRole('button', { name: 'Modifier ' + longName, exact: true }).click();
  const rename = page.getByRole('dialog', { name: 'Modifier la ressource' });
  await rename.getByLabel('Nouveau nom').fill('Studio partagé');
  await rename.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Studio partagé' })).toBeVisible();

  await page.getByRole('button', { name: 'Invitations', exact: true }).click();
  await page.getByRole('button', { name: 'Inviter un membre', exact: true }).click();
  const invite = page.getByRole('dialog', { name: 'Inviter un membre' });
  await invite.getByLabel('Adresse e-mail').fill('invitee@example.test');
  await invite.getByLabel('Prénom', { exact: true }).fill('Camille');
  await invite.getByLabel('Nom', { exact: true }).fill('Invitée');
  await invite.getByRole('combobox', { name: 'Rôle', exact: true }).selectOption(fixture.adminRoleId);
  await invite.getByRole('button', { name: 'Envoyer l’invitation' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'invitee@example.test' })).toContainText('En attente');

  const delivery = await page.request.get(fixture.controlUrl + '/invitation');
  expect(delivery.ok()).toBeTruthy();
  const { token } = await delivery.json() as { token: string };
  const invitedContext = await browser.newContext();
  try {
    const invited = await invitedContext.newPage();
    await invited.goto('/invitations/accept?token=' + encodeURIComponent(token));
    await expect(invited.getByRole('heading', { name: 'Vous êtes invité' })).toBeVisible();
    await invited.goto('/account/validation?token=' + encodeURIComponent(token));
    await invited.getByRole('link', { name: 'Se connecter', exact: true }).click();
    await invited.getByRole('button', { name: 'invitee@example.test', exact: true }).click();
    await expect(invited.getByRole('button', { name: 'Accepter l’invitation' })).toBeVisible();
    await invited.getByRole('button', { name: 'Accepter l’invitation' }).click();
    await expect(invited).toHaveURL('http://127.0.0.1:3000/access');
    await expect(invited.getByRole('row').filter({ hasText: 'Studio partagé' })).toBeVisible();

    await page.getByRole('button', { name: 'Ressources', exact: true }).click();
    await page.getByRole('button', { name: 'Permissions de Camille Invitée', exact: true }).click();
    const permissions = page.getByRole('dialog', { name: 'Permissions de la ressource' });
    await permissions.getByRole('combobox', { name: 'Rôle', exact: true }).selectOption(fixture.visitorRoleId);
    await permissions.getByLabel('Verrouiller Rôle', { exact: true }).check();
    await permissions.getByRole('button', { name: 'Enregistrer les permissions' }).click();
    await expect(permissions).toBeHidden();
    await invited.reload();
    await expect(invited.getByRole('button', { name: 'Zones et projets', exact: true })).toBeVisible();
    await expect(invited.getByRole('button', { name: 'Ressources', exact: true })).toHaveCount(0);
    await expect(invited.getByRole('row').filter({ hasText: 'Studio partagé' })).toHaveCount(0);
    await invited.getByRole('button', { name: 'Se déconnecter' }).click();
    await expect(invited.getByRole('heading', { name: 'Connexion à Planzone' })).toBeVisible();
    const session = await invited.request.get('/api/v1/session');
    expect(session.status()).toBe(401);
  } finally {
    await invitedContext.close();
  }
});
