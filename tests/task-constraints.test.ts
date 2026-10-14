import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.ts';
import { MemoryStore } from '../server/memory-store.ts';
import { ApiError, ApiService } from '../server/service.ts';
import { seed } from '../server/seed.ts';
import { DEFAULT_PERMISSION_POLICY } from '../shared/permissions.ts';
import { DEFAULT_PLANZONE_PREFERENCES } from '../shared/planzone-preferences.ts';
import { DEFAULT_TASK_CONSTRAINT } from '../shared/task-constraints.ts';
import { templateFromProject } from '../shared/customization.ts';
import { RESOURCE_ROLE_LABELS, type Project, type Resource, type Task, type TaskConstraint } from '../shared/types.ts';
import { TABLES, type WorkspaceSnapshot, type StoreLike } from '../server/contracts.ts';

const admin = { id: 'resource-claire', name: 'Administrateur', role: RESOURCE_ROLE_LABELS.administrator };
function rejected(status: number, action: () => unknown) { assert.throws(action, error => error instanceof ApiError && error.status === status); }
for (const backend of ['sqlite', 'memory'] as const) {
  function fixture(run: (store: StoreLike, api: ApiService, project: Project) => void) {
    const dir = mkdtempSync(join(tmpdir(), 'pz-constraints-'));
    const store: StoreLike = backend === 'sqlite' ? new Store(join(dir, 'test.sqlite')) : new MemoryStore();
    seed(store); store.put('resources', { ...store.get('resources', admin.id)!, weeklyCapacityHours: [8, 8, 8, 8, 8, 0, 0] }); const api = new ApiService(store, admin);
    const project = api.mutate('projects', 'POST', { name: 'Planning des contraintes', zoneId: store.all('zones')[0].id, startDate: '2026-10-01', endDate: '2027-12-31' }).value as Project;
    try { run(store, api, project); } finally { if (store instanceof Store) store.close(); rmSync(dir, { recursive: true, force: true }); }
  }
  test(backend + ': configurable constraints cascade in both directions, preserve durations/history and survive templates', () => fixture((store, api, project) => {
    const create = (title: string, startDate: string | null, endDate: string | null, kind = 'task') => api.mutate('tasks', 'POST', { projectId: project.id, title, startDate, endDate, kind, assigneeId: admin.id }).value as Task;
    const a = create('Préparation', '2026-10-05', '2026-10-06'), b = create('Exécution', '2026-10-12', '2026-10-14'), c = create('Livraison', null, '2026-10-20', 'milestone');
    const patch = (task: Task, body: unknown) => api.mutate('tasks', 'PATCH', body, task.id).value as Task;
    const link = (task: Task, predecessor: Task, changes: Partial<TaskConstraint> = {}) => patch(task, { dependsOnId: predecessor.id, dependencyConstraint: { ...DEFAULT_TASK_CONSTRAINT, ...changes } });
    const dates = (task: Task) => { const current = store.get('tasks', task.id)!; return [current.startDate, current.endDate]; };
    const sibling = create('Travail parallèle', '2026-10-07', '2026-10-07'); link(sibling, a);
    const entry = api.mutate('time-entries', 'POST', { taskId: a.id, resourceId: admin.id, date: '2026-10-05', hours: 2 }).value;
    link(b, a, { offset: 2 }); assert.deepEqual(dates(b), ['2026-10-09', '2026-10-11']);
    link(c, b); assert.deepEqual(dates(c), [null, '2026-10-12']);
    patch(a, { endDate: '2026-10-08' }); assert.deepEqual(dates(b), ['2026-10-11', '2026-10-13']); assert.deepEqual(dates(c), [null, '2026-10-14']);
    patch(b, { startDate: '2026-10-13', endDate: '2026-10-15' }); assert.deepEqual(dates(a), ['2026-10-07', '2026-10-10']); assert.deepEqual(dates(c), [null, '2026-10-16']);
    assert.deepEqual(dates(sibling), ['2026-10-11', '2026-10-11']);
    link(b, a, { offset: 1, unit: 'weeks', direction: 'before' }); assert.deepEqual(dates(b), ['2026-10-04', '2026-10-06']);
    link(b, a, { mode: 'not_before' }); assert.deepEqual(dates(b), ['2026-10-11', '2026-10-13']);
    patch(a, { startDate: '2026-10-05', endDate: '2026-10-08' }); assert.deepEqual(dates(b), ['2026-10-11', '2026-10-13']);
    link(b, a, { mode: 'not_after' }); assert.deepEqual(dates(b), ['2026-10-09', '2026-10-11']);
    link(b, a, { automatic: false }); patch(a, { endDate: '2026-10-10' }); assert.deepEqual(dates(b), ['2026-10-09', '2026-10-11']);
    const undated = create('Sans dates', null, null); link(undated, b); assert.deepEqual(dates(undated), [null, null]);
    patch(undated, { startDate: '2026-10-16', endDate: '2026-10-17' }); assert.deepEqual(dates(b), ['2026-10-13', '2026-10-15']);
    assert.deepEqual(store.get('timeEntries', (entry as { id: string }).id), entry);
    assert.deepEqual(new MemoryStore(Object.fromEntries(TABLES.map(table => [table, store.all(table)])) as WorkspaceSnapshot).get('tasks', b.id)?.dependencyConstraint, store.get('tasks', b.id)?.dependencyConstraint);
    const template = api.mutate('project-templates', 'POST', templateFromProject(project, store.all('tasks'))).value as { id: string };
    const cloned = api.mutate('projects', 'POST', { name: 'Planning cloné', zoneId: project.zoneId, startDate: project.startDate, endDate: project.endDate, templateId: template.id }).value as Project;
    const clonedTasks = store.all('tasks').filter(task => task.projectId === cloned.id), clonedB = clonedTasks.find(task => task.title === b.title)!;
    assert.deepEqual(clonedB.dependencyConstraint, store.get('tasks', b.id)?.dependencyConstraint);
    assert.equal(clonedB.dependsOnId, clonedTasks.find(task => task.title === a.title)?.id);
    rejected(409, () => link(a, undated));
    rejected(400, () => link(b, a, { offset: -1 }));
    patch(b, { dependsOnId: null }); assert.equal(store.get('tasks', b.id)?.dependencyConstraint, null);
    rejected(409, () => patch(b, { dependencyConstraint: DEFAULT_TASK_CONSTRAINT }));
  }));
  test(backend + ': permission, allocation and date-boundary failures roll back the entire cascade; working duration is preserved', () => fixture((store, api, project) => {
    const member = api.mutate('resources', 'POST', { name: 'Planificateur', role: 'user', projectIds: [project.id], weeklyCapacityHours: [8, 8, 8, 8, 8, 0, 0] }).value as Resource;
    store.put('projects', { ...project, projectRoles: { [member.id]: 'collaborator' } });
    store.put('permissionPolicies', { ...DEFAULT_PERMISSION_POLICY, id: 'policy', collaborator: { ...DEFAULT_PERMISSION_POLICY.collaborator, taskEdit: true } });
    const a = api.mutate('tasks', 'POST', { projectId: project.id, title: 'Départ', assigneeId: member.id, startDate: '2026-10-05', endDate: '2026-10-06' }).value as Task;
    const b = api.mutate('tasks', 'POST', { projectId: project.id, title: 'Jalon protégé', kind: 'milestone', endDate: '2026-10-07', dependsOnId: a.id, dependencyConstraint: DEFAULT_TASK_CONSTRAINT }).value as Task;
    const userApi = new ApiService(store, { id: member.id, name: member.name, role: RESOURCE_ROLE_LABELS.user });
    let before = store.all('tasks');
    rejected(403, () => userApi.mutate('tasks', 'PATCH', { endDate: '2026-10-08' }, a.id)); assert.deepEqual(store.all('tasks'), before);
    rejected(403, () => userApi.mutate('tasks', 'PATCH', { dependencyConstraint: { ...DEFAULT_TASK_CONSTRAINT, offset: 1 } }, b.id));
    rejected(409, () => api.mutate('tasks', 'PATCH', { endDate: '9999-12-31' }, a.id)); assert.deepEqual(store.all('tasks'), before);
    api.mutate('tasks', 'DELETE', undefined, b.id);
    const c = api.mutate('tasks', 'POST', { projectId: project.id, title: 'Deux jours ouvrés', assigneeId: admin.id, startDate: '2026-10-07', endDate: '2026-10-08', dependsOnId: a.id, dependencyConstraint: DEFAULT_TASK_CONSTRAINT }).value as Task;
    store.put('planzonePreferences', { ...DEFAULT_PLANZONE_PREFERENCES, extendAcrossNonWorkingDays: true, linkAllocationToDuration: true });
    before = store.all('tasks'); rejected(403, () => userApi.mutate('tasks', 'PATCH', { endDate: '2026-10-08' }, a.id)); assert.deepEqual(store.all('tasks'), before);
    api.mutate('tasks', 'PATCH', { endDate: '2026-10-08' }, a.id);
    const moved = store.get('tasks', c.id)!; assert.equal(moved.startDate, '2026-10-09'); assert.equal(moved.endDate, '2026-10-12'); assert.equal(moved.allocatedHours, 16);
    const legacy = api.mutate('tasks', 'POST', { projectId: project.id, title: 'Dépendance ancienne', dependsOnId: c.id }).value as Task;
    rejected(409, () => api.mutate('tasks', 'PATCH', { status: 'in_progress' }, legacy.id));
    const beforeLegacy = store.get('tasks', legacy.id); api.mutate('tasks', 'PATCH', { endDate: '2026-10-13' }, c.id); assert.deepEqual(store.get('tasks', legacy.id), beforeLegacy);
  }));
}
