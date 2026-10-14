import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, ApiService } from '../server/service.ts';
import { MemoryStore } from '../server/memory-store.ts';
import { Store } from '../server/store.ts';
import { TABLES, type Records, type StoreLike } from '../server/contracts.ts';
import { seed } from '../server/seed.ts';
import { capacityPlan } from '../shared/capaplan.ts';
import { RESOURCE_ROLE_LABELS, type DocumentFolder, type Project, type ProjectTaskList, type Task } from '../shared/types.ts';

for (const backend of ['sqlite', 'memory'] as const) test(`${backend}: confirmed cascade is atomic and preserves resources and projects outside the zone`, () => {
  const store = backend === 'sqlite' ? new Store(':memory:') : new MemoryStore(); seed(store);
  const api = new ApiService(store);
  const snapshot = () => Object.fromEntries(TABLES.map(table => [table, store.all(table)]));
  const refuse = (status: number, operation: () => unknown) => { const before = snapshot(); assert.throws(operation, error => error instanceof ApiError && error.status === status); assert.deepEqual(snapshot(), before); };
  try {
    const zoneId = 'zone-transformation';
    const projects = store.all('projects').filter(project => project.zoneId === zoneId);
    const project = projects[0], resource = store.all('resources')[0];
    const rootList = api.mutate('task-lists', 'POST', { projectId: project.id, name: 'Liste parent', parentId: null }).value as ProjectTaskList;
    const childList = api.mutate('task-lists', 'POST', { projectId: project.id, name: 'Sous-liste', parentId: rootList.id }).value as ProjectTaskList;
    const first = api.mutate('tasks', 'POST', { projectId: project.id, title: 'Première tâche', listId: childList.id, status: 'done', progress: 100 }).value as Task;
    api.mutate('tasks', 'POST', { projectId: project.id, title: 'Tâche suivante', dependsOnId: first.id, dependencyConstraint: { mode: 'exact', offset: 0, unit: 'days', direction: 'after', automatic: true } });
    api.mutate('time-entries', 'POST', { taskId: first.id, resourceId: resource.id, date: '2026-10-12', hours: 1, validated: true });
    const folder = api.mutate('document-folders', 'POST', { projectId: project.id, name: 'Dossier', parentId: null }).value as DocumentFolder;
    const childFolder = api.mutate('document-folders', 'POST', { projectId: project.id, name: 'Sous-dossier', parentId: folder.id }).value as DocumentFolder;
    api.mutate('project-documents', 'POST', { projectId: project.id, name: 'Document lié', kind: 'link', url: 'https://example.test/document', folderId: childFolder.id });
    api.mutate('comments', 'POST', { projectId: project.id, taskId: null, body: 'Discussion du projet' });
    api.mutate('comments', 'POST', { taskId: first.id, body: 'Discussion de tâche' });
    api.mutate('revenues', 'POST', { projectId: project.id, label: 'Recette', amount: 100, plannedDate: '2026-10-12' });
    const at = '2026-10-12T12:00:00.000Z';
    const foreignProject = store.all('projects').find(item => item.zoneId !== zoneId)!;
    const foreignFolder = api.mutate('document-folders', 'POST', { projectId: foreignProject.id, name: 'Dossier conservé', parentId: null }).value as DocumentFolder;
    const foreignDocument = api.mutate('project-documents', 'POST', { projectId: foreignProject.id, name: 'Document conservé', kind: 'link', url: 'https://example.test/keep', folderId: foreignFolder.id }).value!;
    const demand = { id: 'demand-delete', projectId: project.id, skillId: 'skill', month: '2026-10', days: 1, status: 'go' as const, createdAt: at, updatedAt: at };
    const foreignDemand = { ...demand, id: 'demand-keep', projectId: foreignProject.id };
    const plan = { ...capacityPlan(api.readState()), demands: [demand, foreignDemand], allocations: [{ id: 'allocation-delete', demandId: demand.id, resourceId: resource.id, days: 1 }, { id: 'allocation-keep', demandId: foreignDemand.id, resourceId: resource.id, days: 1 }], baselines: [{ id: 'baseline-delete', projectId: project.id, at, demands: [demand] }, { id: 'baseline-keep', projectId: foreignProject.id, at, demands: [foreignDemand] }] };
    store.put('capacityPlans', plan);
    store.put('resources', { ...resource, zoneIds: [zoneId, foreignProject.zoneId], projectIds: [project.id, foreignProject.id] });
    api.mutate('projects', 'PATCH', { status: 'closed' }, project.id);
    const confirmation = { deleteProjects: true, expectedProjectIds: projects.map(item => item.id) };
    refuse(409, () => api.mutate('zones', 'DELETE', undefined, zoneId));
    refuse(400, () => api.mutate('zones', 'DELETE', { deleteProjects: false, expectedProjectIds: [] }, zoneId));
    refuse(409, () => api.mutate('zones', 'DELETE', { ...confirmation, expectedProjectIds: [project.id] }, zoneId));
    refuse(409, () => api.mutate('zones', 'DELETE', { ...confirmation, expectedProjectIds: [...confirmation.expectedProjectIds, foreignProject.id] }, zoneId));
    const member = store.all('resources').find(item => item.id !== resource.id)!;
    store.put('resources', { ...member, role: 'user' });
    const memberApi = new ApiService(store, { id: member.id, name: member.name, role: RESOURCE_ROLE_LABELS.user });
    refuse(403, () => memberApi.mutate('zones', 'DELETE', confirmation, zoneId));
    const before = snapshot();
    const failing: StoreLike = {
      all: store.all.bind(store), get: store.get.bind(store), put: store.put.bind(store), transaction: store.transaction.bind(store),
      remove: (table, id) => { if (table === 'zones') throw new Error('Simulated final-write failure'); store.remove(table, id); },
    };
    assert.throws(() => new ApiService(failing).mutate('zones', 'DELETE', confirmation, zoneId), /Simulated final-write failure/);
    assert.deepEqual(snapshot(), before, 'Every dependent write must roll back');
    assert.equal(api.mutate('zones', 'DELETE', confirmation, zoneId).status, 204);
    assert.equal(store.get('zones', zoneId), undefined);
    for (const item of projects) assert.equal(store.get('projects', item.id), undefined);
    assert.equal(store.get('tasks', first.id), undefined);
    assert.ok(store.all('timeEntries').every(item => item.taskId !== first.id));
    assert.equal(store.get('documentFolders', childFolder.id), undefined);
    assert.deepEqual(store.all('projectDocuments'), [foreignDocument]);
    assert.deepEqual(store.all('documentFolders'), [foreignFolder]);
    assert.equal(store.all('taskLists').length, 0);
    assert.deepEqual(store.all('resources'), (before.resources as Records['resources'][]).map(item => item.id === resource.id ? { ...item, zoneIds: [foreignProject.zoneId], projectIds: [foreignProject.id] } : item));
    assert.deepEqual(store.all('capacityPlans'), [{ ...plan, demands: [foreignDemand], allocations: [plan.allocations[1]], baselines: [plan.baselines[1]] }]);
    const foreignIds = new Set((before.projects as Project[]).filter(item => item.zoneId !== zoneId).map(item => item.id));
    const foreignTaskIds = new Set((before.tasks as Task[]).filter(item => foreignIds.has(item.projectId)).map(item => item.id));
    assert.deepEqual(store.all('timeEntries'), (before.timeEntries as Records['timeEntries'][]).filter(item => foreignTaskIds.has(item.taskId)));
    assert.deepEqual(store.all('comments'), (before.comments as Records['comments'][]).filter(item => foreignTaskIds.has(item.taskId ?? '') || foreignIds.has(item.projectId ?? '')));
    for (const table of ['projects', 'tasks', 'expenses', 'revenues', 'projectReports', 'calendarEvents'] as const) {
      assert.deepEqual(store.all(table), (before[table] as { id: string; projectId?: string }[]).filter(item => table === 'projects' ? foreignIds.has(item.id) : foreignIds.has(item.projectId ?? '') || table === 'calendarEvents' && !item.projectId));
    }
    for (const table of ['profiles', 'unavailabilities', 'organizationUnits', 'projectTemplates', 'customFieldDefinitions', 'reportTemplates', 'projectStatusDefinitions', 'strategicAxes', 'permissionPolicies', 'planzonePreferences'] as const) assert.deepEqual(store.all(table), before[table]);
    if (store instanceof Store) assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
    else assert.doesNotThrow(() => new MemoryStore(store.snapshot()));
  } finally { if (store instanceof Store) store.close(); }
});
