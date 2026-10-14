import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync(process.env.PZ8_BROWSER_FIXTURE_FILE!, 'utf8')) as {
  scopeCandidateResourceId: string;
};

async function signIn(page: Page, account: string) {
  await page.goto('/access');
  await page.getByRole('link', { name: 'Se connecter', exact: true }).click();
  await page.getByRole('button', { name: account, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recette Java', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Zones et projets', exact: true }).click();
}

test('un responsable ajoute une ressource sans compte, puis l’administrateur révoque ses droits et retire l’appartenance de zone', async ({ browser, page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signIn(page, 'manager@example.test');
  await page.getByRole('button', { name: 'Ressources', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lecture des ressources non autorisée', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Liste des ressources', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Zones et projets', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Voir les membres de la zone Zone recette', exact: true })).toBeVisible();
  await expect(page.getByText('Projet confidentiel', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Voir les membres du projet Projet partagé', exact: true }).click();
  const team = page.getByRole('region', { name: 'Membres du projet Projet partagé', exact: true });
  await team.getByRole('button', { name: 'Ajouter un membre au projet', exact: true }).click();
  const add = page.getByRole('dialog', { name: 'Ajouter un membre au projet', exact: true });
  await add.getByRole('combobox', { name: 'Ressource', exact: true }).selectOption(fixture.scopeCandidateResourceId);
  await expect(add.getByRole('combobox', { name: 'Rôle dans le projet' })).toHaveValue('');
  await add.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(team.getByRole('row').filter({ hasText: 'Expertise partagée' })).toContainText('Sans rôle');
  await page.reload();
  await page.getByRole('button', { name: 'Zones et projets', exact: true }).click();
  await page.getByRole('button', { name: 'Voir les membres de la zone Zone recette', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Membres de la zone Zone recette', exact: true }).getByText('Expertise partagée', { exact: true })).toBeVisible();

  const administratorContext = await browser.newContext();
  try {
    const administrator = await administratorContext.newPage();
    administrator.on('pageerror', error => errors.push(error.message));
    await signIn(administrator, 'admin@example.test');
    await expect(administrator.getByText('Projet confidentiel', { exact: true })).toBeVisible();
    await administrator.getByRole('button', { name: 'Voir les membres du projet Projet partagé', exact: true }).click();
    const adminTeam = administrator.getByRole('region', { name: 'Membres du projet Projet partagé', exact: true });
    await adminTeam.getByRole('button', { name: 'Modifier Responsable projet', exact: true }).click();
    const edit = administrator.getByRole('dialog', { name: 'Modifier le membre : Responsable projet', exact: true });
    await edit.getByRole('checkbox', { name: 'Actif dans le projet', exact: true }).uncheck();
    await edit.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(adminTeam.getByRole('row').filter({ hasText: 'Responsable projet' })).toContainText('Inactif');
    await page.reload();
    await page.getByRole('button', { name: 'Zones et projets', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Voir les membres de la zone Zone recette', exact: true })).toBeVisible();
    await expect(page.getByText('Aucun projet accessible pour cette recherche.', { exact: true })).toBeVisible();

    await administrator.getByRole('button', { name: 'Voir les membres de la zone Zone recette', exact: true }).click();
    await administrator.getByRole('button', { name: 'Retirer Expertise partagée de la zone', exact: true }).click();
    const remove = administrator.getByRole('dialog', { name: 'Retirer Expertise partagée', exact: true });
    await expect(remove).toContainText('simultanément de toutes les équipes projet de cette zone');
    await remove.getByRole('button', { name: 'Confirmer le retrait', exact: true }).click();
    await expect(remove).toBeHidden();
    await administrator.getByRole('button', { name: 'Actualiser les projets', exact: true }).click();
    await administrator.getByRole('button', { name: 'Voir les membres du projet Projet partagé', exact: true }).click();
    await expect(adminTeam.getByText('Responsable projet', { exact: true })).toBeVisible();
    await expect(adminTeam.getByText('Expertise partagée', { exact: true })).toHaveCount(0);
  } finally {
    await administratorContext.close();
  }
  expect(errors).toEqual([]);
});
