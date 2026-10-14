import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiError, ApiService } from '../server/service.ts';
import { Store } from '../server/store.ts';
import { MemoryStore } from '../server/memory-store.ts';
import { TABLES, type WorkspaceSnapshot } from '../server/contracts.ts';
import { seed } from '../server/seed.ts';
import { DEFAULT_PERMISSION_POLICY } from '../shared/permissions.ts';
import type { OrganizationUnit, Resource } from '../shared/types.ts';
import { flattenOrganization, organizationTree, organizationDescendantIds, resourceManagementDescendantIds } from '../shared/organization.ts';

for (const backend of ['sqlite','memory'] as const) {
  function fixture() { const store = backend === 'sqlite' ? new Store(':memory:') : new MemoryStore(); seed(store); const api = new ApiService(store); return { store, api, close: () => { if (store instanceof Store) store.close(); }, snapshot: () => Object.fromEntries(TABLES.map(table => [table, store.all(table)])) }; }
  test(`${backend}: organisation stores nested units and shared resources without rewriting resources or history`, () => {
    const f = fixture(); try {
      const before = f.store.all('resources'); const entries = f.store.all('timeEntries');
      const root = f.api.mutate('organization-units','POST',{name:'Direction'}).value as OrganizationUnit;
      const child = f.api.mutate('organization-units','POST',{name:'Département',parentId:root.id,resourceIds:['resource-thomas']}).value as OrganizationUnit;
      const leaf = f.api.mutate('organization-units','POST',{name:'Équipe',parentId:child.id,resourceIds:['resource-thomas','resource-ines']}).value as OrganizationUnit;
      const empty = f.api.mutate('organization-units','POST',{name:'Unité vide'}).value as OrganizationUnit;
      const nodes = flattenOrganization(organizationTree(f.api.readState().organizationUnits!, f.api.readState().resources));
      assert.deepEqual(nodes.map(node => node.depth),[0,1,2,0]); assert.equal(nodes[2].path,'Direction / Département / Équipe'); assert.equal(nodes[0].resources.length,0); assert.equal(nodes[2].resources.length,2);
      assert.deepEqual([...organizationDescendantIds(f.store.all('organizationUnits'),root.id)],[root.id,child.id,leaf.id]);
      f.api.mutate('organization-units','PATCH',{name:'Équipe renommée',parentId:root.id},leaf.id);
      assert.equal(f.store.get('organizationUnits',leaf.id)?.parentId,root.id); assert.deepEqual(f.store.all('resources'),before); assert.deepEqual(f.store.all('timeEntries'),entries);
      assert.equal(f.api.mutate('organization-units','DELETE',undefined,empty.id).status,204);
      if (f.store instanceof MemoryStore) assert.deepEqual(new MemoryStore(f.store.snapshot()).all('organizationUnits'),f.store.all('organizationUnits'));
    } finally { f.close(); }
  });
  test(`${backend}: organisation rejects duplicate/missing memberships, cycles, deep descendant moves and deleting populated units atomically`, () => {
    const f = fixture(); try {
      const make = (name:string,parentId:string|null=null,resourceIds:string[]=[]) => f.api.mutate('organization-units','POST',{name,parentId,resourceIds}).value as OrganizationUnit;
      const root=make('Racine'), child=make('Enfant',root.id,['resource-thomas']);
      const deny=(status:number,action:()=>unknown) => {const before=f.snapshot(); assert.throws(action,error=>error instanceof ApiError && error.status===status); assert.deepEqual(f.snapshot(),before);};
      deny(400,()=>make('Doublon',null,['resource-thomas','resource-thomas'])); deny(404,()=>make('Membre absent',null,['missing'])); deny(404,()=>make('Parent absent','missing'));
      deny(400,()=>f.api.mutate('organization-units','PATCH',{parentId:child.id},root.id)); deny(400,()=>f.api.mutate('organization-units','PATCH',{parentId:root.id},root.id));
      deny(409,()=>f.api.mutate('organization-units','DELETE',undefined,root.id)); deny(409,()=>f.api.mutate('organization-units','DELETE',undefined,child.id));
      let last=root; for(let depth=2;depth<=20;depth++) last=make('Niveau '+depth,last.id);
      deny(400,()=>make('Niveau 21',last.id));
      const branch=make('Branche'),sub=make('Sous-branche',branch.id); deny(400,()=>f.api.mutate('organization-units','PATCH',{parentId:last.id},branch.id)); assert.equal(f.store.get('organizationUnits',sub.id)?.parentId,branch.id);
      f.api.mutate('organization-units','PATCH',{resourceIds:[]},child.id); assert.equal(f.api.mutate('organization-units','DELETE',undefined,child.id).status,204);
    } finally { f.close(); }
  });
  test(`${backend}: responsible references persist, preserve roles/capacity and cannot form cycles or grant permissions`, () => {
    const f=fixture(); try {
      const a=f.api.mutate('resources','POST',{name:'Responsable A'}).value as Resource; const b=f.api.mutate('resources','POST',{name:'Membre B',managerId:a.id}).value as Resource;
      const c=f.api.mutate('resources','POST',{name:'Virtuelle C',type:'virtual',managerId:b.id}).value as Resource;
      assert.deepEqual([...resourceManagementDescendantIds(f.store.all('resources'),a.id)],[a.id,b.id,c.id]);
      const previous=f.store.get('resources',b.id)!;
      f.api.mutate('resources','PATCH',{managerId:null},b.id); assert.deepEqual(f.store.get('resources',b.id),{...previous,managerId:null}); f.api.mutate('resources','PATCH',{managerId:a.id},b.id);
      for(const [id,managerId] of [[a.id,c.id],[b.id,b.id],[b.id,'missing']]) { const before=f.snapshot(); assert.throws(()=>f.api.mutate('resources','PATCH',{managerId},id),error=>error instanceof ApiError && [400,404].includes(error.status)); assert.deepEqual(f.snapshot(),before); }
      const material=f.api.mutate('resources','POST',{name:'Matériel',type:'material'}).value as Resource; assert.throws(()=>f.api.mutate('resources','PATCH',{managerId:material.id},b.id),/matérielle/);
      assert.throws(()=>f.api.mutate('resources','PATCH',{type:'material'},a.id),/matérielle/); f.api.mutate('resources','PATCH',{active:false},a.id); assert.equal(f.api.readState().resources.find(r=>r.id===b.id)?.managerId,a.id);
      const memberApi=new ApiService(f.store,{id:b.id,name:b.name,role:'Usager'}); assert.throws(()=>memberApi.mutate('resources','PATCH',{managerId:c.id},b.id),error=>error instanceof ApiError && error.status===403);
    } finally { f.close(); }
  });
  test(`${backend}: readers are gated by directory permissions and organisational writes are administrator-only`, () => {
    const f=fixture(); try {
      const member=f.api.mutate('resources','POST',{name:'Lecteur organisation',role:'user'}).value as Resource;
      const unit=f.api.mutate('organization-units','POST',{name:'Administration',resourceIds:[member.id]}).value as OrganizationUnit;
      const memberApi=new ApiService(f.store,{id:member.id,name:member.name,role:'Usager'}); assert.deepEqual(memberApi.readState().organizationUnits,[]);
      f.api.mutate('permission-policies','POST',{...DEFAULT_PERMISSION_POLICY,resourcesRead:['user']}); assert.equal(memberApi.readState().organizationUnits?.[0]?.id,unit.id);
      for(const [method,input,id] of [['POST',{name:'Interdit'},undefined],['PATCH',{name:'Interdit'},unit.id],['DELETE',undefined,unit.id]] as const) {
        const before=f.snapshot(); assert.throws(()=>memberApi.mutate('organization-units',method,input,id),error=>error instanceof ApiError && error.status===403); assert.deepEqual(f.snapshot(),before);
      }
    } finally { f.close(); }
  });
}

test('legacy snapshots acquire an empty organisation without overwriting legacy payloads; invalid organisation restores fail',()=>{
  const store=new MemoryStore();seed(store); const current=store.snapshot(); const legacy=structuredClone(current) as Partial<WorkspaceSnapshot>; delete legacy.organizationUnits;
  const upgraded=new MemoryStore(legacy as WorkspaceSnapshot); assert.deepEqual(upgraded.all('organizationUnits'),[]); assert.deepEqual(upgraded.all('resources'),current.resources);
  const unit:OrganizationUnit={id:'u',name:'U',parentId:null,resourceIds:['resource-thomas']}; const invalid=structuredClone(current); invalid.organizationUnits=[{...unit,parentId:'u'}]; assert.throws(()=>new MemoryStore(invalid),/sous-unités/);
  invalid.organizationUnits=[{...unit,resourceIds:['missing']}]; assert.throws(()=>new MemoryStore(invalid),/introuvable/);
  invalid.organizationUnits=[{id:'u',name:'U',parentId:null} as OrganizationUnit]; assert.throws(()=>new MemoryStore(invalid),/Invalid workspace table/);
  invalid.organizationUnits=[]; invalid.resources[0].managerId='missing'; assert.throws(()=>new MemoryStore(invalid),/responsable.*introuvable/);
});
test('SQLite organisation survives reopening and additive setup leaves resource payloads intact',()=>{
  const folder=mkdtempSync(join(tmpdir(),'planzone8-organisation-')); const path=join(folder,'workspace.sqlite'); let store=new Store(path);seed(store);
  try {const before=store.all('resources'); store.db.exec('DROP TABLE organizationUnits'); store.close(); store=new Store(path); assert.deepEqual(store.all('organizationUnits'),[]); assert.deepEqual(store.all('resources'),before); const api=new ApiService(store); const unit=api.mutate('organization-units','POST',{name:'Persistante',resourceIds:['resource-thomas']}).value as OrganizationUnit;store.close();store=new Store(path);assert.deepEqual(store.get('organizationUnits',unit.id),unit);assert.deepEqual(store.all('resources'),before);} finally {store.close();rmSync(folder,{recursive:true,force:true});}
});
