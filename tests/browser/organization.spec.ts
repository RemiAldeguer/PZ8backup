import { mkdirSync } from 'node:fs';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import type { AppData, OrganizationUnit, Resource } from '../../shared/types';
import type { CustomFieldDefinition } from '../../shared/customization';
import { DEFAULT_PERMISSION_POLICY } from '../../shared/permissions';
import { loginTestAdmin } from '../auth-fixture';

async function state(request: APIRequestContext): Promise<AppData> { const r = await request.get('/api/state'); expect(r.ok()).toBe(true); return r.json(); }
async function create<T>(request: APIRequestContext, entity: string, data: unknown): Promise<T> { const r = await request.post('/api/' + entity, { data }); expect(r.ok(), await r.text()).toBe(true); return r.json(); }
async function patch(request: APIRequestContext, entity: string, id: string, data: unknown) { const r = await request.patch('/api/' + entity + '/' + id, { data }); expect(r.ok(), await r.text()).toBe(true); }
async function screenshot(page: Page, name: string) { mkdirSync('docs/screenshots',{recursive:true}); await page.screenshot({path: test.info().project.testDir.endsWith('cloudflare-browser') ? test.info().outputPath(name+'.png') : 'docs/screenshots/'+name+'.png',fullPage:true,animations:'disabled'}); }
async function fixture(request: APIRequestContext, name: string) {
  const human = await create<Resource>(request,'resources',{name:name+' humaine',jobTitle:'Pilote organisation',type:'human',role:'user'});
  const virtual = await create<Resource>(request,'resources',{name:name+' virtuelle',type:'virtual'});
  const material = await create<Resource>(request,'resources',{name:name+' matérielle',type:'material'});
  const inactive = await create<Resource>(request,'resources',{name:name+' inactive',active:false});
  const root = await create<OrganizationUnit>(request,'organization-units',{name:name+' Direction'});
  const child = await create<OrganizationUnit>(request,'organization-units',{name:name+' Département',parentId:root.id});
  const leaf = await create<OrganizationUnit>(request,'organization-units',{name:name+' Équipe',parentId:child.id,resourceIds:[human.id,virtual.id,material.id,inactive.id]});
  return {human,virtual,material,inactive,root,child,leaf};
}
const unitRow = (page:Page,unit:OrganizationUnit)=>page.locator(`.org-unit-row[data-unit-id="${unit.id}"]`);
const resourceRow = (page:Page,resource:Resource)=>page.locator(`.org-resource-row[data-resource-id="${resource.id}"]`).first();
test.beforeEach(async({page,request})=>{await loginTestAdmin(page.request);await loginTestAdmin(request);});

test('organigramme : navigation, hiérarchie, création imbriquée avec ressources, repli et persistance',async({page,request})=>{
  const f=await fixture(request,'Organisation recette'); const before=(await state(request)).resources;
  await page.setViewportSize({width:1915,height:958}); await page.goto('/#personal'); await page.getByRole('button',{name:'Gestion',exact:true}).click(); await page.getByRole('button',{name:'Ouvrir l’organigramme',exact:true}).click(); await expect(page).toHaveURL(/#resources\/organization$/);
  await expect(unitRow(page,f.leaf)).toHaveAttribute('data-depth','2'); await expect(resourceRow(page,f.inactive)).toHaveClass(/org-inactive/); await expect(resourceRow(page,f.virtual).locator('.org-resource-icon')).toHaveCount(1);
  await page.getByRole('button',{name:'Replier l’unité '+f.child.name,exact:true}).click(); await expect(unitRow(page,f.leaf)).toHaveCount(0); await page.getByRole('button',{name:'Déplier l’unité '+f.child.name,exact:true}).click(); await expect(unitRow(page,f.leaf)).toBeVisible();
  await page.getByRole('button',{name:'Ajouter une sous-unité à '+f.leaf.name,exact:true}).click(); const dialog=page.getByRole('dialog',{name:'Créer une unité organisationnelle',exact:true}); await expect(dialog.getByRole('button',{name:'Enregistrer',exact:true})).toBeDisabled(); await expect(dialog.getByLabel('Unité parente',{exact:true})).toHaveValue(f.leaf.id);
  await dialog.getByRole('textbox',{name:'Nom de l’unité',exact:true}).fill('Équipe créée depuis l’organigramme'); await screenshot(page,'organization-unit-create'); await dialog.getByRole('button',{name:'Choisir les ressources de l’unité',exact:true}).click(); await dialog.getByRole('checkbox',{name:'Inclure '+f.human.name,exact:true}).check(); await dialog.getByRole('button',{name:'Enregistrer',exact:true}).click(); await expect(dialog).not.toBeVisible();
  const created=(await state(request)).organizationUnits!.find(unit=>unit.name==='Équipe créée depuis l’organigramme')!; expect(created.parentId).toBe(f.leaf.id); expect(created.resourceIds).toEqual([f.human.id]); expect((await state(request)).resources).toEqual(before); await expect(unitRow(page,created)).toHaveAttribute('data-depth','3');
  await page.reload(); await expect(unitRow(page,created)).toBeVisible(); await page.getByRole('button',{name:'Modifier l’unité '+f.root.name,exact:true}).click(); const editor=page.getByRole('dialog',{name:'Modifier une unité organisationnelle',exact:true}); const options=await editor.getByLabel('Unité parente',{exact:true}).locator('option').evaluateAll(options=>options.map(option=>(option as HTMLOptionElement).value)); for(const id of [f.root.id,f.child.id,f.leaf.id,created.id])expect(options).not.toContain(id); await editor.getByRole('button',{name:'Annuler',exact:true}).click();
  await screenshot(page,'organization-desktop');
});

test('organigramme : rôle, responsable et champs ressources éditables, filtres et configuration des colonnes',async({page,request})=>{
  const f=await fixture(request,'Métadonnées organisation');
  const field=await create<CustomFieldDefinition>(request,'custom-field-definitions',{name:'Trigramme organisation',scope:'resource',type:'text',translations:{fr:'Trigramme organisation',en:''},options:[]});
  const date=await create<CustomFieldDefinition>(request,'custom-field-definitions',{name:'Date d’arrivée organisation',scope:'resource',type:'date',translations:{fr:'Date d’arrivée organisation',en:''},options:[]});
  await patch(request,'resources',f.human.id,{customValues:{[field.id]:'PIL',[date.id]:'2026-10-13'}}); await page.goto('/#resources/organization'); const row=resourceRow(page,f.human);
  await row.getByRole('combobox',{name:'Responsable de '+f.human.name,exact:true}).selectOption(f.virtual.id); await expect.poll(async()=>(await state(request)).resources.find(r=>r.id===f.human.id)?.managerId).toBe(f.virtual.id);
  await row.getByRole('combobox',{name:'Rôle global de '+f.human.name,exact:true}).selectOption('project_creator'); await expect.poll(async()=>(await state(request)).resources.find(r=>r.id===f.human.id)?.role).toBe('project_creator');
  await row.getByRole('combobox',{name:'Classification de '+f.human.name,exact:true}).selectOption('external'); await expect.poll(async()=>(await state(request)).resources.find(r=>r.id===f.human.id)?.classification).toBe('external');
  const cell=row.locator(`[data-org-column="custom:${field.id}"]`); await expect(cell).toContainText('PIL'); await cell.getByRole('button',{name:'Consulter les champs de '+f.human.name,exact:true}).click(); const editor=page.getByRole('dialog',{name:'Champs de '+f.human.name,exact:true}); await editor.getByRole('textbox',{name:field.name,exact:true}).fill('PZ8'); await editor.getByRole('button',{name:'Enregistrer',exact:true}).click(); await expect(editor).not.toBeVisible(); await expect(cell).toContainText('PZ8'); expect((await state(request)).resources.find(r=>r.id===f.human.id)?.customValues?.[date.id]).toBe('2026-10-13');
  await page.getByRole('textbox',{name:'Rechercher dans l’organigramme',exact:true}).fill(f.human.name); await expect(unitRow(page,f.root)).toBeVisible(); await expect(resourceRow(page,f.material)).toHaveCount(0); await page.getByRole('textbox',{name:'Rechercher dans l’organigramme',exact:true}).fill(''); await page.getByRole('combobox',{name:'Filtrer l’organigramme',exact:true}).selectOption('inactive'); await expect(resourceRow(page,f.inactive)).toBeVisible(); await expect(resourceRow(page,f.human)).toHaveCount(0); await page.getByRole('combobox',{name:'Filtrer l’organigramme',exact:true}).selectOption('all');
  await page.getByRole('button',{name:'Configurer les colonnes de l’organigramme',exact:true}).click(); const columns=page.getByRole('dialog',{name:'Colonnes de l’organigramme',exact:true}); await columns.getByRole('checkbox',{name:field.name,exact:true}).uncheck(); await columns.getByRole('button',{name:'Terminer',exact:true}).click(); await expect(page.locator(`.org-table thead [data-org-column="custom:${field.id}"]`)).toHaveCount(0); await page.reload(); await expect(page.locator(`.org-table thead [data-org-column="custom:${field.id}"]`)).toHaveCount(0); await expect(resourceRow(page,f.human).getByRole('combobox',{name:'Responsable de '+f.human.name,exact:true})).toHaveValue(f.virtual.id);
  await resourceRow(page,f.human).getByRole('button',{name:'Ouvrir la fiche de '+f.human.name,exact:true}).click(); await expect(page.getByRole('dialog',{name:'Fiche ressource',exact:true}).getByRole('combobox',{name:'Responsable de la ressource',exact:true})).toHaveValue(f.virtual.id);
});

test('organigramme : erreur de sauvegarde conservée, suppression des seules unités vides et écran mobile',async({page,request})=>{
  const f=await fixture(request,'Organisation mobile'); await page.setViewportSize({width:390,height:844}); await page.goto('/#resources/organization'); await expect(page.getByRole('heading',{name:'Organigramme',exact:true})).toBeVisible(); expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await expect(page.getByRole('button',{name:'Supprimer l’unité '+f.root.name,exact:true})).toBeDisabled(); await expect(page.getByRole('button',{name:'Supprimer l’unité '+f.leaf.name,exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Unité organisationnelle',exact:true}).click(); const dialog=page.getByRole('dialog',{name:'Créer une unité organisationnelle',exact:true}); await dialog.getByRole('textbox',{name:'Nom de l’unité',exact:true}).fill('Unité mobile à créer');
  await page.route('**/api/organization-units',route=>route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Réessayez après actualisation.'})})); await dialog.getByRole('button',{name:'Enregistrer',exact:true}).click(); await expect(dialog.getByRole('alert')).toContainText('Réessayez'); await expect(dialog.getByRole('textbox',{name:'Nom de l’unité',exact:true})).toHaveValue('Unité mobile à créer'); await page.unroute('**/api/organization-units'); await screenshot(page,'organization-create-mobile');
  await dialog.getByRole('button',{name:'Enregistrer',exact:true}).click(); await expect(dialog).not.toBeVisible(); await page.getByRole('button',{name:'Supprimer l’unité Unité mobile à créer',exact:true}).click(); await expect(page.getByRole('button',{name:'Modifier l’unité Unité mobile à créer',exact:true})).toHaveCount(0); expect((await state(request)).organizationUnits!.some(unit=>unit.name==='Unité mobile à créer')).toBe(false); await screenshot(page,'organization-mobile');
});

test('organigramme : lecteur autorisé en lecture seule, écritures et accès sans droit refusés',async({browser,baseURL,request})=>{
  const f=await fixture(request,'Lecture organisation'); const username='org-reader-'+Date.now().toString(36);const password='Org-test-member!2026'; await create(request,'auth/members',{resourceId:f.human.id,username,password});
  const context=await browser.newContext({baseURL}); try {expect((await context.request.post('/api/auth/login',{data:{username,password}})).ok()).toBe(true);const page=await context.newPage();await page.goto('/#resources/organization');await expect(page.getByRole('heading',{name:'Accès réservé',exact:true})).toBeVisible();expect((await state(context.request)).organizationUnits).toEqual([]);
    const policies=(await state(request)).permissionPolicies??[];const input={...DEFAULT_PERMISSION_POLICY,resourcesRead:['user']}; if(policies[0])await patch(request,'permission-policies',policies[0].id,input);else await create(request,'permission-policies',input);
    await page.reload();await expect(unitRow(page,f.root)).toBeVisible();await expect(page.getByRole('button',{name:'Unité organisationnelle',exact:true})).toHaveCount(0);await expect(resourceRow(page,f.human).getByRole('combobox',{name:'Responsable de '+f.human.name,exact:true})).toBeDisabled();expect((await context.request.post('/api/organization-units',{data:{name:'Interdit'}})).status()).toBe(403);expect((await context.request.patch('/api/organization-units/'+f.leaf.id,{data:{name:'Interdit'}})).status()).toBe(403);expect((await context.request.delete('/api/organization-units/'+f.leaf.id)).status()).toBe(403);
  }finally{await context.close();}
});
