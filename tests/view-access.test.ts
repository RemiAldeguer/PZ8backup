import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.ts';
import { MemoryStore } from '../server/memory-store.ts';
import { ApiError, ApiService } from '../server/service.ts';
import { seed } from '../server/seed.ts';
import { TABLES, type WorkspaceSnapshot } from '../server/contracts.ts';
import { DEFAULT_PLANZONE_PREFERENCES } from '../shared/planzone-preferences.ts';
import { canReadResources, canSeeView, canUseProjectView } from '../shared/permissions.ts';
import { RESOURCE_ROLE_LABELS, type Resource, type ProjectDocument } from '../shared/types.ts';
import type { ViewRoleAssignments } from '../shared/view-access.ts';

for (const backend of ['sqlite', 'memory'] as const) test(backend + ': view access persists, restricts documents and keeps business permissions separate', () => {
  const store = backend === 'sqlite' ? new Store(':memory:') : new MemoryStore(); seed(store);
  const admin = new ApiService(store, { id: 'resource-claire', name: 'Administrateur', role: RESOURCE_ROLE_LABELS.administrator });
  const member = admin.mutate('resources', 'POST', { name: 'Responsable des vues', role: 'user', projectIds: ['project-nova'] }).value as Resource;
  admin.mutate('projects', 'PATCH', { projectRoles: { [member.id]: 'manager' } }, 'project-nova');
  const api = new ApiService(store, { id: member.id, name: member.name, role: RESOURCE_ROLE_LABELS.user });
  const file = admin.mutate('project-documents', 'POST', { projectId: 'project-nova', name: 'Fichier privé', kind: 'file', fileName: 'prive.txt', mimeType: 'text/plain', contentBase64: Buffer.from('Informations privées').toString('base64') }).value as ProjectDocument;
  const save = (viewRoles?: ViewRoleAssignments) => {
    const { id, version, ...options } = admin.readState().planzonePreferences?.[0] ?? DEFAULT_PLANZONE_PREFERENCES;
    return admin.mutate('planzone-preferences', 'POST', { ...options, ...(viewRoles ? { viewRoles } : {}), expectedVersion: version });
  };
  const denied = (status: number, action: () => unknown) => assert.throws(action, error => error instanceof ApiError && error.status === status);
  try {
    assert.equal(canReadResources(api.readState()), false);
    assert.equal(api.readDocument(file.id).contentBase64, file.contentBase64 ?? Buffer.from('Informations privées').toString('base64'));
    save({ resources: ['administrator', 'user'], profiles: ['administrator', 'user'], capacity: ['administrator', 'user'], documents: ['administrator'], 'document-edit': ['administrator'] });
    const data = api.readState();
    assert.equal(canReadResources(data), true); assert.equal(canSeeView(data, 'capacity'), true);
    assert.ok(data.profiles.length); assert.equal(data.projectDocuments?.length, 0);
    assert.equal(canUseProjectView(data, data.projects.find(project => project.id === 'project-nova')!, 'documents'), false);
    denied(404, () => api.readDocument(file.id));
    denied(403, () => api.mutate('project-documents', 'POST', { projectId: 'project-nova', name: 'Contournement', kind: 'link', url: 'https://example.com' }));
    denied(403, () => api.mutate('profiles', 'POST', { name: 'Tarif interdit', dailyRate: 100, eqjtHours: 8 }));
    const { id, version, ...options } = admin.readState().planzonePreferences![0];
    denied(403, () => api.mutate('planzone-preferences', 'POST', { ...options, expectedVersion: version }));
    denied(400, () => admin.mutate('planzone-preferences', 'POST', { ...options, expectedVersion: version, viewRoles: { resources: ['role_inconnu'] } }));
    denied(409, () => admin.mutate('planzone-preferences', 'POST', { ...options, expectedVersion: version - 1, viewRoles: {} }));
    const { viewRoles, ...legacyOptions } = options;
    admin.mutate('planzone-preferences', 'POST', { ...legacyOptions, expectedVersion: version });
    assert.deepEqual(admin.readState().planzonePreferences![0].viewRoles, viewRoles, 'An older settings client must not erase the visibility matrix');
    save({ ...viewRoles, documents: ['administrator', 'user'], 'document-edit': ['administrator'] });
    assert.ok(api.readState().projectDocuments?.some(item => item.id === file.id));
    assert.ok(api.readDocument(file.id).contentBase64);
    denied(403, () => api.mutate('project-documents', 'PATCH', { name: 'Modification interdite' }, file.id));
    const snapshot = Object.fromEntries(TABLES.map(table => [table, store.all(table)])) as WorkspaceSnapshot;
    const restored = new ApiService(new MemoryStore(snapshot), { id: member.id, name: member.name, role: RESOURCE_ROLE_LABELS.user }).readState();
    assert.equal(canReadResources(restored), true); assert.equal(canSeeView(restored, 'document-edit'), false);
  } finally { if (store instanceof Store) store.close(); }
});
