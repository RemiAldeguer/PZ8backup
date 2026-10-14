import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { AppData, DocumentFolder, Project, ProjectDocument } from '../../shared/types';
import { loginTestAdmin } from '../auth-fixture';

test.beforeEach(async ({ page, request }) => { await loginTestAdmin(page.request); await loginTestAdmin(request); });
async function state(request: APIRequestContext): Promise<AppData> { const response = await request.get('/api/state'); expect(response.ok()).toBeTruthy(); return response.json(); }
async function create<T>(request: APIRequestContext, entity: string, body: unknown): Promise<T> { const response = await request.post('/api/' + entity, { data: body }); expect(response.ok(), await response.text()).toBeTruthy(); return response.json(); }
async function fixture(request: APIRequestContext, prefix: string) {
  const data = await state(request);
  const project = (name: string) => create<Project>(request, 'projects', { name, zoneId: data.zones[0].id, status: 'open', startDate: '2026-01-01', endDate: '2027-12-31' });
  const a = await project(prefix + ' Alpha'); const b = await project(prefix + ' Bêta'); const closed = await project(prefix + ' Archives');
  const parent = await create<DocumentFolder>(request, 'document-folders', { projectId: a.id, name: prefix + ' Contrats' });
  const child = await create<DocumentFolder>(request, 'document-folders', { projectId: a.id, parentId: parent.id, name: prefix + ' Annexes' });
  const foreign = await create<DocumentFolder>(request, 'document-folders', { projectId: b.id, name: prefix + ' Livrables' });
  const file = await create<ProjectDocument>(request, 'project-documents', { projectId: a.id, folderId: child.id, name: prefix + ' Note', kind: 'file', fileName: 'note.txt', mimeType: 'text/plain', contentBase64: Buffer.from('Texte partagé : documents globaux.').toString('base64') });
  const link = await create<ProjectDocument>(request, 'project-documents', { projectId: b.id, name: prefix + ' Référence', kind: 'link', url: 'https://example.com/reference' });
  const archived = await create<ProjectDocument>(request, 'project-documents', { projectId: closed.id, name: prefix + ' Archive', kind: 'link', url: 'https://example.com/archive' });
  expect((await request.patch('/api/projects/' + closed.id, { data: { status: 'closed' } })).ok()).toBeTruthy();
  return { a, b, closed, parent, child, foreign, file, link, archived };
}
function sidebar(page: Page) { return page.getByRole('complementary', { name: 'Navigation principale', exact: true }); }
function catalog(page: Page) { return page.getByRole('region', { name: 'Documents de tous les projets', exact: true }); }
function row(page: Page, item: ProjectDocument) { return catalog(page).locator('[data-document-id="' + item.id + '"]'); }
async function screenshot(page: Page, name: string) { const filename = 'global-documents-' + name + '.png'; await page.screenshot({ path: test.info().project.testDir.endsWith('cloudflare-browser') ? test.info().outputPath(filename) : 'docs/screenshots/' + filename, fullPage: true, animations: 'disabled' }); }

test('documents globaux : sidebar, recherche tous dossiers, filtres, aperçu et téléchargement, retour direct au dossier du projet', async ({ page, request }) => {
  const f = await fixture(request, 'Catalogue global'); const before = await state(request); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#project/' + f.a.id + '/summary'); await sidebar(page).getByRole('button', { name: 'Documents', exact: true }).click();
  await expect(page).toHaveURL(/#documents$/); await expect(sidebar(page).getByRole('button', { name: 'Documents', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByLabel('Rechercher dans tous les documents', { exact: true }).fill('Catalogue global');
  await expect(catalog(page).locator('[data-document-id]')).toHaveCount(3); await expect(row(page, f.file)).toContainText(f.a.name + ' / Documents / ' + f.parent.name + ' / ' + f.child.name);
  await page.getByLabel('Filtrer les documents par projet', { exact: true }).selectOption(f.a.id); await expect(catalog(page).locator('[data-document-id]')).toHaveCount(1);
  await page.getByLabel('Filtrer les documents par type', { exact: true }).selectOption('link'); await expect(catalog(page).getByText('Aucun document trouvé', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Réinitialiser les filtres', exact: true }).click(); await page.getByLabel('Rechercher dans tous les documents', { exact: true }).fill(f.child.name);
  await expect(catalog(page).locator('[data-document-id]')).toHaveCount(1); await row(page, f.file).getByRole('button', { name: f.file.name, exact: true }).click();
  const preview = page.getByRole('dialog', { name: f.file.name, exact: true }); await expect(preview).toContainText('Texte partagé : documents globaux.'); await expect(preview).toContainText(f.child.name);
  const downloaded = page.waitForEvent('download'); await preview.getByRole('button', { name: 'Télécharger', exact: true }).click(); const download = await downloaded; expect(download.suggestedFilename()).toBe('note.txt'); expect(await readFile((await download.path())!, 'utf8')).toBe('Texte partagé : documents globaux.');
  await preview.getByRole('button', { name: 'Fermer', exact: true }).click();
  await page.getByLabel('Rechercher dans tous les documents', { exact: true }).fill('Catalogue global'); await screenshot(page, 'desktop');
  await row(page, f.file).getByRole('link', { name: 'Ouvrir le dossier de ' + f.file.name, exact: true }).click(); await expect(page).toHaveURL(new RegExp('#project/' + f.a.id + '/documents/' + f.child.id + '$'));
  await expect(page.getByRole('navigation', { name: 'Chemin du dossier', exact: true })).toContainText(f.child.name); await expect(page.getByRole('region', { name: 'Documents du projet', exact: true }).getByRole('button', { name: f.file.name, exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByRole('navigation', { name: 'Chemin du dossier', exact: true })).toContainText(f.child.name);
  await sidebar(page).getByRole('button', { name: 'Documents', exact: true }).click(); await page.reload(); await expect(catalog(page)).toBeVisible();
  const after = await state(request); expect(after.projectDocuments).toEqual(before.projectDocuments); expect(after.documentFolders).toEqual(before.documentFolders); expect(errors).toEqual([]);
});

test('documents globaux : ajout et modification dans le projet choisi, dossiers du bon projet et archives en lecture seule', async ({ page, request }) => {
  const f = await fixture(request, 'Ajout global'); await page.goto('/#documents');
  await page.getByRole('button', { name: 'Ajouter un lien', exact: true }).click(); let dialog = page.getByRole('dialog', { name: 'Choisir le projet du document', exact: true });
  await expect(dialog.getByRole('button', { name: 'Continuer', exact: true })).toBeDisabled(); expect(await dialog.getByRole('combobox', { name: 'Projet du document', exact: true }).locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).not.toContain(f.closed.id);
  await dialog.getByRole('combobox', { name: 'Projet du document', exact: true }).selectOption(f.b.id); await dialog.getByRole('button', { name: 'Continuer', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Ajouter un lien web', exact: true }); const folders = await dialog.getByRole('combobox', { name: 'Dossier du document', exact: true }).locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)); expect(folders).toContain(f.foreign.id); expect(folders).not.toContain(f.child.id);
  await dialog.getByLabel('Nom du document', { exact: true }).fill('Lien créé depuis le catalogue'); await dialog.getByLabel('Lien web', { exact: true }).fill('https://example.com/creation'); await dialog.getByRole('combobox', { name: 'Dossier du document', exact: true }).selectOption(f.foreign.id); await dialog.getByRole('button', { name: 'Ajouter', exact: true }).click(); await expect(dialog).not.toBeVisible();
  let data = await state(request); const created = data.projectDocuments!.find(item => item.name === 'Lien créé depuis le catalogue')!; expect(created.projectId).toBe(f.b.id); expect(created.folderId).toBe(f.foreign.id);
  await row(page, created).getByRole('button', { name: 'Modifier ' + created.name, exact: true }).click(); dialog = page.getByRole('dialog', { name: 'Modifier le document', exact: true }); await dialog.getByLabel('Nom du document', { exact: true }).fill('Lien global renommé'); await dialog.getByLabel('Lien web', { exact: true }).fill('https://example.com/renomme'); await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click(); await expect(dialog).not.toBeVisible();
  await page.getByLabel('Filtrer les documents par projet', { exact: true }).selectOption(f.a.id); await page.getByRole('button', { name: 'Ajouter un document', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'Choisir le projet du document', exact: true }); await expect(dialog.getByRole('combobox', { name: 'Projet du document', exact: true })).toHaveValue(f.a.id); await dialog.getByRole('button', { name: 'Continuer', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Ajouter un document', exact: true }); await dialog.getByLabel(/^Fichier/).setInputFiles({ name: 'global.txt', mimeType: 'text/plain', buffer: Buffer.from('Ajout global au bon projet.') }); await dialog.getByRole('combobox', { name: 'Dossier du document', exact: true }).selectOption(f.child.id); await dialog.getByRole('button', { name: 'Ajouter', exact: true }).click(); await expect(dialog).not.toBeVisible();
  data = await state(request); const uploaded = data.projectDocuments!.find(item => item.fileName === 'global.txt')!; expect(uploaded.projectId).toBe(f.a.id); expect(uploaded.folderId).toBe(f.child.id); expect(Buffer.from(uploaded.contentBase64!, 'base64').toString()).toBe('Ajout global au bon projet.');
  expect(data.projectDocuments!.find(item => item.id === created.id)).toMatchObject({ projectId: f.b.id, folderId: f.foreign.id, name: 'Lien global renommé', url: 'https://example.com/renomme' });
  await page.getByLabel('Filtrer les documents par projet', { exact: true }).selectOption(f.closed.id); await expect(row(page, f.archived)).toContainText('Projet en lecture seule'); await expect(row(page, f.archived).getByRole('button', { name: 'Modifier ' + f.archived.name, exact: true })).toHaveCount(0); await expect(row(page, f.archived).getByRole('link', { name: 'Ouvrir ' + f.archived.name, exact: true })).toHaveAttribute('rel', 'noopener noreferrer');
  await page.reload(); await expect(row(page, uploaded)).toBeVisible(); await expect(row(page, created)).toContainText('Lien global renommé');
});

test('documents globaux : sidebar repliée, menu mobile, filtres et aperçu sans débordement', async ({ page, request }) => {
  const f = await fixture(request, 'Mobile global'); await page.goto('/#personal'); await sidebar(page).getByRole('button', { name: 'Réduire la barre latérale', exact: true }).click(); await sidebar(page).getByRole('button', { name: 'Documents', exact: true }).click(); await expect(catalog(page)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('button', { name: 'Ouvrir le menu', exact: true }).click(); await sidebar(page).getByRole('button', { name: 'Documents', exact: true }).click(); await expect(page.getByRole('button', { name: 'Fermer le menu', exact: true })).toHaveCount(0);
  await page.getByLabel('Rechercher dans tous les documents', { exact: true }).fill('Mobile global'); await page.getByLabel('Filtrer les documents par type', { exact: true }).selectOption('link'); await expect(catalog(page).locator('[data-document-id]')).toHaveCount(2); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); await screenshot(page, 'mobile');
  await row(page, f.link).getByRole('button', { name: f.link.name, exact: true }).click(); const preview = page.getByRole('dialog', { name: f.link.name, exact: true }); await expect(preview).toContainText(f.b.name); await expect(preview.getByRole('link', { name: 'Ouvrir le lien', exact: true })).toHaveAttribute('href', 'https://example.com/reference'); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); await preview.getByRole('button', { name: 'Fermer', exact: true }).click();
});
