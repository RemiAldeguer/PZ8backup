import { test, expect } from '@playwright/test';
import { loginTestAdmin } from '../auth-fixture';
import type { AppData, ProjectDocument, Resource } from '../../shared/types';

test('les rôles de vue se conservent, autorisent la lecture et refusent les vues et écritures exclues', async ({ page, browser }) => {
  await loginTestAdmin(page.request);
  const resourceResponse = await page.request.post('/api/resources', { data: { name: 'Usager visibilité', role: 'user', projectIds: ['project-nova'] } });
  expect(resourceResponse.status()).toBe(201); const resource = await resourceResponse.json() as Resource;
  const account = { username: 'usager-visibilite', password: 'Test-Visibilite!2026', resourceId: resource.id };
  expect((await page.request.post('/api/auth/members', { data: account })).status()).toBe(201);
  const fileResponse = await page.request.post('/api/project-documents', { data: { projectId: 'project-nova', name: 'Document accessible', kind: 'file', fileName: 'document.txt', mimeType: 'text/plain', contentBase64: Buffer.from('Contenu de recette').toString('base64') } });
  expect(fileResponse.status()).toBe(201); const file = await fileResponse.json() as ProjectDocument;
  await page.goto('/#settings');
  const choose = async (label: string, checked: boolean) => {
    const row = page.locator('.pz-view-row').filter({ has: page.getByRole('button', { name: label, exact: true }) });
    await row.getByRole('button').click();
    await row.getByRole('checkbox', { name: 'Usager', exact: true }).setChecked(checked);
    await row.getByRole('button').press('Escape');
  };
  await choose('Calendrier', false);
  await choose('Mon espace > Suivi temporel', false);
  await choose('Gestion > Profils de coûts', true);
  await choose('Personnalisation > Modèles de projet', true);
  await choose('Création / édition de document', false);
  await page.getByRole('button', { name: 'Enregistrer les préférences', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Préférences à jour' })).toBeVisible();
  await page.reload();
  const config = await (await page.request.get('/api/state')).json() as AppData;
  expect(config.planzonePreferences?.[0].viewRoles?.calendar).not.toContain('user');
  expect(config.planzonePreferences?.[0].viewRoles?.profiles).toContain('user');
  await page.getByRole('combobox', { name: 'Thème de l’application', exact: true }).selectOption('dark');
  await page.getByRole('button', { name: 'Gestion > Profils de coûts', exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('view-roles-dark.png'), fullPage: true });
  await page.getByRole('button', { name: 'Gestion > Profils de coûts', exact: true }).press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const context = await browser.newContext({ locale: 'fr-FR' });
  try {
    const member = await context.newPage(), errors: string[] = [];
    member.on('pageerror', error => errors.push(error.message));
    expect((await member.request.post('/api/auth/login', { data: { username: account.username, password: account.password } })).status()).toBe(200);
    await member.goto('/#personal');
    await expect(member.getByRole('heading', { name: 'Ma synthèse', exact: true })).toBeVisible();
    await expect(member.getByRole('navigation', { name: 'Espace de travail', exact: true }).getByRole('button', { name: 'Calendrier', exact: true })).toHaveCount(0);
    await expect(member.getByRole('navigation', { name: 'Vues de mon espace', exact: true }).getByRole('link', { name: 'Suivi temporel', exact: true })).toHaveCount(0);
    for (const route of ['calendar', 'time', 'resources/directory']) {
      await member.goto('/#' + route);
      await expect(member.getByRole('region', { name: 'Accès réservé', exact: true })).toBeVisible();
    }
    await member.goto('/#resources/profiles');
    await expect(member.getByRole('columnheader', { name: 'Tarif par Eqjt', exact: true })).toBeVisible();
    await expect(member.getByRole('button', { name: 'Nouveau profil', exact: true })).toBeDisabled();
    await member.goto('/#customization/project-templates');
    await expect(member.getByRole('button', { name: 'Modèle', exact: true })).toBeDisabled();
    await member.goto('/#documents');
    await expect(member.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();
    await expect(member.getByRole('button', { name: 'Ajouter un document', exact: true })).toBeDisabled();
    expect((await member.request.get('/api/project-documents/' + file.id + '/content')).status()).toBe(200);
    expect((await member.request.patch('/api/project-documents/' + file.id, { data: { name: 'Écriture exclue' } })).status()).toBe(403);
    const { id, version, ...options } = config.planzonePreferences![0];
    expect((await member.request.post('/api/planzone-preferences', { data: { ...options, expectedVersion: version } })).status()).toBe(403);
    const scoped = await (await member.request.get('/api/state')).json() as AppData;
    expect(scoped.projects.some(project => project.id === 'project-mobile')).toBe(false);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
