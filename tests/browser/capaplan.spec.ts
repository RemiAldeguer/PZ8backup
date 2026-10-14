import { test, expect } from '@playwright/test';
import { loginTestAdmin } from '../auth-fixture';

test('CapaPlan is accessible, persists a domain and shows project commitments', async ({page}) => {
  await loginTestAdmin(page.request);
  const initial = await (await page.request.get('/api/state')).json();
  await page.goto('/#resources/capaplan');
  await expect(page.getByRole('heading',{name:'CapaPlan',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Domaine',exact:true}).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nom du domaine',{exact:true}).fill('Domaine capacitaire publié');
  await dialog.getByRole('button',{name:'Enregistrer',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  const state = await (await page.request.get('/api/state')).json();
  const domainId = state.capacityPlans[0].domains.find((domain:{name:string})=>domain.name==='Domaine capacitaire publié').id;
  async function command(body:unknown) {
    const response = await page.request.post('/api/capacity-plan',{data:body});
    expect(response.ok(),await response.text()).toBeTruthy(); return response.json();
  }
  await command({action:'domain',value:{id:domainId,name:'Domaine capacitaire publié',resourceIds:[initial.currentUser.id]}});
  const requested = await command({action:'skill-request',domainId,name:'Expertise publiée'});
  const skillId = requested.skills.find((skill:{name:string})=>skill.name==='Expertise publiée').id;
  await command({action:'skill-status',id:skillId,status:'approved'});
  await command({action:'skill-status',id:skillId,status:'created'});
  await command({action:'membership',skillId,resourceId:initial.currentUser.id,share:100});
  const requestedPlan = await command({action:'demand',value:{projectId:'project-nova',skillId,month:'2026-10',days:3,status:'go'}});
  const demandId = requestedPlan.demands.at(-1).id;
  await command({action:'allocation',demandId,resourceId:initial.currentUser.id,days:2});
  await page.reload();
  await page.getByRole('navigation',{name:'Vues CapaPlan'}).getByRole('button',{name:'Équipes / domaines',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Domaine capacitaire publié',exact:true})).toBeVisible();
  await page.goto('/#project/project-nova/summary');
  await expect(page.getByRole('region',{name:'Affectations CapaPlan du projet',exact:true})).toContainText('Expertise publiée');
});
