import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, ApiService } from '../server/service.ts';
import { Store } from '../server/store.ts';
import { MemoryStore } from '../server/memory-store.ts';
import { seed } from '../server/seed.ts';
import { capacityConsumed, capacityMonthMetrics, commonCapacityWindow, type CapacityPlan } from '../shared/capaplan.ts';
import { RESOURCE_ROLE_LABELS, type Resource } from '../shared/types.ts';

function fixture(store = new MemoryStore()) {
  seed(store);
  const api = new ApiService(store);
  return { store, api, state: () => api.readState('2026-10-06'), command: (value: unknown) => api.mutate('capacity-plan', 'POST', value).value as CapacityPlan };
}
function readyPlan(f: ReturnType<typeof fixture>, managerId = 'resource-claire') {
  let plan = f.command({action: 'domain', value: {name: 'Domaine de test', resourceIds: ['resource-claire'], managerIds: [managerId]}});
  const domain = plan.domains[0];
  plan = f.command({action: 'skill-request', domainId: domain.id, name: 'Compétence de test'});
  const skill = plan.skills[0];
  f.command({action: 'skill-status', id: skill.id, status: 'approved'});
  f.command({action: 'skill-status', id: skill.id, status: 'created'});
  f.command({action: 'membership', skillId: skill.id, resourceId: 'resource-claire', share: 100});
  return {domain, skill};
}

test('CapaPlan persists in SQLite, validates the skill workflow and rolls back a refused allocation', () => {
  const store = new Store(':memory:');
  try {
    seed(store);
    const api = new ApiService(store), command = (value: unknown) => api.mutate('capacity-plan', 'POST', value).value as CapacityPlan;
    const domain = command({action:'domain',value:{name:'Persistant',resourceIds:['resource-claire']}}).domains[0];
    const skill = command({action:'skill-request',domainId:domain.id,name:'Expertise'}).skills[0];
    assert.throws(() => command({action:'skill-status',id:skill.id,status:'created'}), error => error instanceof ApiError && error.status === 409);
    command({action:'skill-status',id:skill.id,status:'approved'});
    command({action:'skill-status',id:skill.id,status:'created'});
    command({action:'membership',skillId:skill.id,resourceId:'resource-claire',share:100});
    const demand = command({action:'demand',value:{projectId:'project-nova',skillId:skill.id,month:'2026-10',days:3,status:'go'}}).demands[0];
    command({action:'allocation',demandId:demand.id,resourceId:'resource-claire',days:2});
    const before = structuredClone(store.all('capacityPlans'));
    assert.throws(() => command({action:'allocation',demandId:demand.id,resourceId:'resource-claire',days:4}), error => error instanceof ApiError && error.status === 400);
    assert.deepEqual(store.all('capacityPlans'), before);
    assert.equal(new ApiService(store).readState().capacityPlans![0].allocations[0].days, 2);
  } finally { store.close(); }
});
test('CapaPlan responses and mutations do not expose another project or audit payload to a non-PMO', () => {
  const f = fixture();
  const user = f.api.mutate('resources','POST',{name:'Manager',role:'user',projectIds:['project-nova']}).value as Resource;
  const {domain, skill} = readyPlan(f, user.id);
  f.command({action:'demand',value:{projectId:'project-mobile',skillId:skill.id,month:'2026-11',days:7,status:'go'}});
  const creator = f.api.mutate('resources','POST',{name:'Créateur limité',role:'project_creator',projectIds:[]}).value as Resource;
  const limited = new ApiService(f.store,{id:creator.id,name:creator.name,role:RESOURCE_ROLE_LABELS.project_creator});
  assert.deepEqual(limited.readState().capacityPlans![0].demands, []);
  assert.deepEqual(limited.readState().capacityPlans![0].audit, []);
  const manager = new ApiService(f.store,{id:user.id,name:user.name,role:RESOURCE_ROLE_LABELS.user});
  const response = manager.mutate('capacity-plan','POST',{action:'skill-request',domainId:domain.id,name:'Nouvelle compétence'}).value as CapacityPlan;
  assert.deepEqual(response.audit, []);
  assert.ok(!JSON.stringify(response).includes('project-mobile'));
  assert.throws(() => limited.mutate('capacity-plan','POST',{action:'skill-request',domainId:domain.id,name:'Refusée'}), error => error instanceof ApiError && error.status === 403);
});
test('duplicate resource needs are combined when searching a common capacity window', () => {
  const f = fixture(), data = f.state(); data.tasks = []; data.timeEntries = [];
  const available = capacityMonthMetrics(data,data.resources[0],'2026-10').real;
  const result = commonCapacityWindow(data,[{resourceId:data.resources[0].id,days:available * .6},{resourceId:data.resources[0].id,days:available * .6}],['2026-10']);
  assert.equal(result[0].blockers.length, 1);
  assert.equal(result[0].blockers[0].required, available * 1.2);
});
test('external contract capacity deducts absences and missing resource consumption is unknown', () => {
  const f = fixture(), data = f.state(), resource = data.resources.find(item => item.id === 'resource-lucas')!;
  data.capacityPlans = [{id:'capacity-plan',domains:[],skills:[],memberships:[],contracts:[{id:'contract',resourceId:resource.id,startMonth:'2026-10',endMonth:'2026-10',monthlyDays:20}],overheads:[],demands:[],allocations:[],baselines:[],audit:[],settings:{warningThreshold:80,underloadThreshold:50,allowOverload:true,includeProposed:false,suggestionMonths:3,carryDay:1,pmoIds:[]}}];
  data.unavailabilities = [{id:'absence',title:'Absence',resourceId:resource.id,reason:'leave',allDay:true,startDate:'2026-10-06',endDate:'2026-10-06',startTime:null,endTime:null}];
  const metrics = capacityMonthMetrics(data,resource,'2026-10');
  assert.equal(metrics.absences, 1); assert.equal(metrics.capacity, 19);
  assert.equal(capacityConsumed(data,data.projects[0],'hidden-resource','2026-10'), null);
});
test('future demands do not erase current legacy task load', () => {
  const f = fixture(), data = f.state(), resource = data.resources[0];
  const legacy = capacityMonthMetrics(data,resource,'2026-10').allocated;
  const {skill} = readyPlan(f);
  f.command({action:'demand',value:{projectId:'project-nova',skillId:skill.id,month:'2027-01',days:10,status:'go'}});
  assert.equal(capacityMonthMetrics(f.state(),resource,'2026-10').allocated, legacy);
});
