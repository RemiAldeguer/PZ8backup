import assert from 'node:assert/strict';
import test from 'node:test';
import { Store } from '../server/store.ts';
import { MemoryStore } from '../server/memory-store.ts';
import { ApiError, ApiService } from '../server/service.ts';
import { seed } from '../server/seed.ts';
import { TABLES } from '../server/contracts.ts';
import { DEFAULT_PERMISSION_POLICY } from '../shared/permissions.ts';
import { RESOURCE_ROLE_LABELS, type Project, type Resource, type ResourceRole, type TimeEntry } from '../shared/types.ts';

for (const backend of ['sqlite', 'memory'] as const) {
  const fixture = () => {
    const store = backend === 'sqlite' ? new Store(':memory:') : new MemoryStore(); seed(store); const admin = new ApiService(store);
    const member = (name: string, role: ResourceRole, projectIds = ['project-nova']) => admin.mutate('resources', 'POST', { name, role, projectIds, zoneIds: ['zone-transformation'] }).value as Resource;
    const creator = member('Créateur permissions', 'project_creator', []); const manager = member('Chef permissions', 'user'); const collaborator = member('Collaborateur permissions', 'user'); const visitor = member('Visiteur permissions', 'visitor');
    admin.mutate('projects', 'PATCH', { projectRoles: { [manager.id]: 'manager', [collaborator.id]: 'collaborator', [visitor.id]: 'observer' } }, 'project-nova');
    const own = admin.mutate('tasks', 'POST', { projectId: 'project-nova', title: 'Tâche propre permissions', assigneeId: collaborator.id, allocatedHours: 8 }).value!;
    const api = (resource: Resource) => new ApiService(store, { id: resource.id, name: resource.name, role: RESOURCE_ROLE_LABELS[resource.role!] });
    const snapshot = () => Object.fromEntries(TABLES.map(table => [table, store.all(table)]));
    const denied = (action: () => unknown, status = 403) => { const before = snapshot(); assert.throws(action, error => error instanceof ApiError && error.status === status); assert.deepEqual(snapshot(), before); };
    return { store, admin, creator, manager, collaborator, visitor, own, api, denied, snapshot, close: () => { if (store instanceof Store) store.close(); } };
  };

  test(`${backend}: global roles restrict creation, administration and self-escalation`, () => {
    const f = fixture(); try {
      const created = f.api(f.creator).mutate('projects', 'POST', { name: 'Projet du créateur', zoneId: 'zone-transformation', startDate: '2026-10-01', endDate: '2026-11-30' }).value as Project;
      assert.equal(created.createdByResourceId, f.creator.id); assert.equal(created.projectRoles?.[f.creator.id], 'manager');
      assert.ok(f.api(f.creator).readState().projects.some(project => project.id === created.id));
      for (const resource of [f.collaborator, f.visitor]) {
        const api = f.api(resource); f.denied(() => api.mutate('projects', 'POST', { name: 'Interdit', zoneId: 'zone-transformation', startDate: '2026-10-01', endDate: '2026-11-30' }));
        f.denied(() => api.mutate('resources', 'PATCH', { role: 'administrator' }, resource.id)); f.denied(() => api.mutate('resources', 'POST', { name: 'Intrus' }));
        f.denied(() => api.mutate('zones', 'POST', { name: 'Intruse' })); f.denied(() => api.mutate('permission-policies', 'POST', DEFAULT_PERMISSION_POLICY));
        const updated = api.mutate('resources', 'PATCH', { weeklyCapacityHours: [4, 4, 4, 4, 4, 0, 0] }, resource.id).value as Resource; assert.equal(updated.weeklyCapacityHours?.[0], 4);
      }
      f.denied(() => f.api(f.creator).mutate('projects', 'POST', { name: 'Zone non affectée', zoneId: 'zone-produit', startDate: '2026-10-01', endDate: '2026-11-30' }));
    } finally { f.close(); }
  });

  test(`${backend}: project roles govern details, roles, budgets, times, observer discussions and documents`, () => {
    const f = fixture(); try {
      const manager = f.api(f.manager); const collaborator = f.api(f.collaborator); const visitor = f.api(f.visitor);
      manager.mutate('projects', 'PATCH', { description: 'Pilotage autorisé', budget: 12345 }, 'project-nova');
      manager.mutate('expenses', 'POST', { projectId: 'project-nova', label: 'Dépense autorisée', amount: 120, plannedDate: '2026-10-06' });
      manager.mutate('time-integrations', 'POST', { scope: 'project', projectId: 'project-nova', date: null });
      f.denied(() => collaborator.mutate('projects', 'PATCH', { budget: 1 }, 'project-nova'));
      f.denied(() => collaborator.mutate('projects', 'PATCH', { projectRoles: { [f.collaborator.id]: 'manager' } }, 'project-nova'));
      f.denied(() => collaborator.mutate('time-integrations', 'POST', { scope: 'project', projectId: 'project-nova', date: '2026-10-06' }));
      f.denied(() => manager.mutate('projects', 'PATCH', { projectRoles: { [f.visitor.id]: 'manager' } }, 'project-nova'), 400);
      f.denied(() => manager.mutate('expenses', 'POST', { projectId: 'project-mobile', label: 'Projet étranger', amount: 20, plannedDate: '2026-10-06' }));
      collaborator.mutate('tasks', 'PATCH', { allocatedHours: 10 }, f.own.id); collaborator.mutate('tasks', 'PATCH', { status: 'done', progress: 100 }, f.own.id);
      f.denied(() => visitor.mutate('tasks', 'PATCH', { status: 'todo' }, f.own.id));
      visitor.mutate('comments', 'POST', { projectId: 'project-nova', taskId: null, body: 'Commentaire de l’observateur' });
      f.denied(() => visitor.mutate('document-folders', 'POST', { projectId: 'project-nova', name: 'Dossier interdit', parentId: null }));
      collaborator.mutate('document-folders', 'POST', { projectId: 'project-nova', name: 'Dossier collaborateur', parentId: null });
      const read = visitor.readState(); assert.deepEqual(read.projects.map(project => project.id), ['project-nova']); assert.equal(read.projects[0].budget, 0); assert.deepEqual(read.expenses, []); assert.deepEqual(read.revenues, []); assert.deepEqual(read.profiles, []);
      assert.ok(!JSON.stringify(read).includes('Application mobile clients'));
    } finally { f.close(); }
  });

  test(`${backend}: moving records cannot bypass destination project permissions`, () => {
    const f = fixture(); try {
      const manager = f.api(f.manager);
      f.denied(() => manager.mutate('tasks', 'PATCH', { projectId: 'project-mobile' }, f.own.id));
      const expense = manager.mutate('expenses', 'POST', { projectId: 'project-nova', label: 'Interne', amount: 10, plannedDate: '2026-10-06' }).value!;
      f.denied(() => manager.mutate('expenses', 'PATCH', { projectId: 'project-mobile' }, expense.id));
      const folder = manager.mutate('document-folders', 'POST', { projectId: 'project-nova', name: 'Interne', parentId: null }).value!;
      f.denied(() => manager.mutate('document-folders', 'PATCH', { projectId: 'project-mobile' }, folder.id));
    } finally { f.close(); }
  });

  test(`${backend}: conditional collaborator actions are configurable and financial mutation responses stay redacted`, () => {
    const f = fixture(); try {
      const api = f.api(f.collaborator);
      f.denied(() => api.mutate('tasks', 'POST', { projectId: 'project-nova', title: 'Avant ouverture' }));
      const policy = f.admin.mutate('permission-policies', 'POST', { ...DEFAULT_PERMISSION_POLICY, collaborator: { ...DEFAULT_PERMISSION_POLICY.collaborator, taskCreate: true, taskEdit: true }, resourcesRead: ['user'] }).value!;
      api.mutate('tasks', 'POST', { projectId: 'project-nova', title: 'Après ouverture', allocatedHours: 0 });
      f.denied(() => api.mutate('tasks', 'PATCH', { dependsOnId: 'task-cadrage' }, f.own.id));
      const event = f.admin.mutate('calendar-events', 'POST', { title: 'Événement périmètre', projectId: 'project-nova', resourceIds: [f.collaborator.id], startDate: '2026-10-06', endDate: '2026-10-06', allDay: true }).value!;
      f.denied(() => f.api(f.manager).mutate('calendar-events', 'PATCH', { projectId: null }, event.id));
      f.denied(() => api.mutate('tasks', 'POST', { projectId: 'project-nova', title: 'Allocation interdite', assigneeId: f.manager.id, allocatedHours: 8 }));
      f.admin.mutate('permission-policies', 'PATCH', { collaborator: { taskCreate: false } }, policy.id);
      assert.equal(f.admin.readState().permissionPolicies?.[0].collaborator.taskEdit, true);
      f.denied(() => api.mutate('tasks', 'POST', { projectId: 'project-nova', title: 'Après fermeture' }));
      const result = api.mutate('projects', 'PATCH', { customValues: {} }, 'project-nova').value as Project; assert.equal(result.budget, 0);
      f.admin.mutate('resources', 'PATCH', { profileId: 'profile-pilot' }, f.collaborator.id);
      const ownEntry = api.mutate('time-entries', 'POST', { taskId: f.own.id, resourceId: f.collaborator.id, date: '2026-10-06', hours: 1 }).value as TimeEntry;
      assert.equal(f.store.get('timeEntries', ownEntry.id)?.rateSnapshot, 650);
      assert.equal(ownEntry.rateSnapshot, null); assert.equal(ownEntry.eqjtSnapshot, null);
      f.denied(() => f.api(f.visitor).mutate('time-entries', 'POST', { taskId: f.own.id, resourceId: f.visitor.id, date: '2026-10-06', hours: 1 }));
      f.denied(() => api.mutate('time-entries', 'POST', { taskId: 'task-cadrage', resourceId: 'resource-claire', date: '2026-10-06', hours: 1 }));
      const before = f.snapshot(); new MemoryStore(before as import('../server/contracts').WorkspaceSnapshot); assert.deepEqual(f.snapshot(), before);
    } finally { f.close(); }
  });
}
