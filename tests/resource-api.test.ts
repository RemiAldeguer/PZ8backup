import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../server/app.ts';
import { MemoryStore } from '../server/memory-store.ts';
import { seed } from '../server/seed.ts';
import { ApiError, ApiService } from '../server/service.ts';
import { Store } from '../server/store.ts';
import type { Resource, TimeEntry } from '../shared/types.ts';

const sheet = {
  name: 'Ressource complète', email: 'ressource@example.org', jobTitle: 'Responsable produit',
  description: 'Coordination de l’équipe', role: 'user', type: 'human', classification: 'external',
  profileId: 'profile-pilot', tags: [{ label: 'MOE', color: '#2563EB' }, { label: 'Commune 1', color: '#334155' }],
  validatesTimeForIds: ['resource-thomas', 'resource-ines'],
  weeklyCapacityHours: [8, 7, 6, 5, 4, 3, 2], capacityUnit: 'days', hoursPerDay: 8,
  holidayCalendarId: 'fr', projectIds: ['project-nova', 'project-mobile'],
  customFields: [
    { id: 'field-lien', label: 'Lien SharePoint', type: 'url', value: 'https://docs.example.org/projet' },
    { id: 'field-date', label: 'Date d’envoi', type: 'date', value: '2028-02-29' },
    { id: 'field-number', label: 'Ancienneté', type: 'number', value: '1.5' },
    { id: 'field-text', label: 'Équipe', type: 'text', value: 'Innovation' },
  ],
};

function rejectsStatus(status: number, operation: () => unknown) {
  assert.throws(operation, error => error instanceof ApiError && error.status === status);
}

for (const backend of ['sqlite', 'memory'] as const) {
  const fixture = () => {
    const store = backend === 'sqlite' ? new Store(':memory:') : new MemoryStore();
    seed(store);
    return { store, api: new ApiService(store), close: () => { if (store instanceof Store) store.close(); } };
  };

  test(`${backend}: legacy resource sheets gain defaults on read without rewriting stored snapshots`, () => {
    const { store, api, close } = fixture();
    try {
      const before = store.all('resources');
      const state = api.readState('2026-10-06');
      const claire = state.resources.find(resource => resource.id === 'resource-claire')!;
      assert.equal(claire.role, 'administrator');
      assert.equal(state.currentUser.role, 'Administrateur');
      assert.deepEqual(claire.weeklyCapacityHours, [7, 8, 8, 8, 8, 0, 0]);
      assert.equal(claire.holidayCalendarId, 'none');
      assert.deepEqual(claire.customFields, []);
      assert.deepEqual(store.all('resources'), before);
      assert.equal(before.find(resource => resource.id === 'resource-claire')!.weeklyCapacityHours, undefined);
    } finally { close(); }
  });

  test(`${backend}: complete resource sheets persist with legacy capacity compatibility and validated references`, () => {
    const { store, api, close } = fixture();
    try {
      const created = api.mutate('resources', 'POST', sheet).value as Resource;
      assert.equal(created.dailyHours, 7);
      assert.equal(created.mondayHours, 8);
      assert.deepEqual(created.projectIds, sheet.projectIds);
      assert.deepEqual(created.customFields, sheet.customFields);
      const patched = api.mutate('resources', 'PATCH', { description: 'Nouvelle description' }, created.id).value as Resource;
      assert.deepEqual(patched.tags, created.tags);
      assert.deepEqual(patched.weeklyCapacityHours, created.weeklyCapacityHours);
      const legacy = api.mutate('resources', 'PATCH', { mondayHours: 0, dailyHours: 2 }, created.id).value as Resource;
      assert.deepEqual(legacy.weeklyCapacityHours, [0, 2, 2, 2, 2, 3, 2]);
      const weekly = api.mutate('resources', 'PATCH', { weeklyCapacityHours: [1, 2, 3, 4, 5, 6, 7], dailyHours: 99, mondayHours: 99 }, created.id).value as Resource;
      assert.equal(weekly.dailyHours, 2);
      assert.equal(weekly.mondayHours, 1);
      assert.deepEqual(api.readState().resources.find(resource => resource.id === created.id), store.get('resources', created.id));

      const before = store.get('resources', created.id);
      for (const payload of [
        { email: 'adresse invalide' }, { role: 'owner' }, { weeklyCapacityHours: [8, 8] },
        { weeklyCapacityHours: [8, 8, 8, 8, 8, -1, 0] }, { hoursPerDay: 0 }, { holidayCalendarId: 'inconnu' },
        { validatesTimeForIds: ['resource-thomas', 'resource-thomas'] }, { projectIds: ['project-nova', 'project-nova'] },
        { tags: [{ label: 'MOE', color: '#2563EB' }, { label: 'moe', color: '#334155' }] },
        { customFields: [{ id: 'x', label: 'Nombre', type: 'number', value: '1e309' }] },
        { customFields: [{ id: 'x', label: 'Date', type: 'date', value: '2026-02-29' }] },
        { customFields: [{ id: 'x', label: 'Lien', type: 'url', value: 'javascript:alert(1)' }] },
        { customFields: [{ id: 'x', label: 'Champ A', type: 'text', value: '' }, { id: 'x', label: 'Champ B', type: 'text', value: '' }] },
        { customFields: [{ id: 'x', label: 'Champ', type: 'text', value: '' }, { id: 'y', label: 'champ', type: 'text', value: '' }] },
      ]) rejectsStatus(400, () => api.mutate('resources', 'PATCH', payload, created.id));
      for (const payload of [{ projectIds: ['missing'] }, { validatesTimeForIds: ['missing'] }, { profileId: 'missing' }]) {
        rejectsStatus(404, () => api.mutate('resources', 'PATCH', payload, created.id));
      }
      assert.deepEqual(store.get('resources', created.id), before);
    } finally { close(); }
  });

  test(`${backend}: delegated time validation follows the resource role and protects withdrawal and creation`, () => {
    const { store, api, close } = fixture();
    try {
      const createTime = (resourceId: string, validated = false) => api.mutate('time-entries', 'POST', {
        taskId: 'task-ateliers', resourceId, date: '2026-10-06', hours: 1, validated,
      }).value as TimeEntry;
      const other = createTime('resource-thomas');
      const self = createTime('resource-claire');
      api.mutate('resources', 'PATCH', { name: 'Claire modifiée', role: 'user', validatesTimeForIds: ['resource-thomas'] }, 'resource-claire');
      assert.deepEqual(api.readState().currentUser, { id: 'resource-claire', name: 'Claire modifiée', role: 'Usager' });
      api.mutate('time-entries', 'PATCH', { validated: true }, other.id);
      rejectsStatus(403, () => api.mutate('time-entries', 'PATCH', { validated: true }, self.id));
      rejectsStatus(403, () => createTime('resource-ines', true));
      assert.equal(createTime('resource-thomas', true).validated, true);
      rejectsStatus(409, () => api.mutate('time-entries', 'PATCH', { validated: false, hours: 2 }, other.id));
      api.mutate('resources', 'PATCH', { role: 'visitor' }, 'resource-claire');
      rejectsStatus(403, () => api.mutate('time-entries', 'PATCH', { validated: false }, other.id));
      rejectsStatus(403, () => createTime('resource-thomas', true));
      assert.equal(store.get('timeEntries', other.id)!.validated, true);
      api.mutate('resources', 'PATCH', { role: 'administrator', active: false }, 'resource-claire');
      rejectsStatus(403, () => api.mutate('time-entries', 'PATCH', { validated: false }, other.id));
      api.mutate('resources', 'PATCH', { active: true }, 'resource-claire');
      api.mutate('time-entries', 'PATCH', { validated: false }, other.id);
      assert.equal(store.get('timeEntries', other.id)!.validated, false);
      const comment = api.mutate('comments', 'POST', { taskId: 'task-ateliers', body: 'Décision' }).value;
      assert.ok(comment && 'authorName' in comment && comment.authorName === 'Claire modifiée');
    } finally { close(); }
  });

  test(`${backend}: explicit project membership prevents deletion until the membership is removed`, () => {
    const { api, close } = fixture();
    try {
      const project = api.mutate('projects', 'POST', {
        name: 'Équipe sans tâches', zoneId: api.readState().zones[0]!.id,
        startDate: '2026-10-01', endDate: '2026-10-31',
      }).value!;
      api.mutate('resources', 'PATCH', { projectIds: [project.id] }, 'resource-claire');
      rejectsStatus(409, () => api.mutate('projects', 'DELETE', undefined, project.id));
      api.mutate('resources', 'PATCH', { projectIds: [] }, 'resource-claire');
      assert.equal(api.mutate('projects', 'DELETE', undefined, project.id).status, 204);
    } finally { close(); }
  });
}

test('the HTTP API saves the complete resource sheet across a SQLite restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'planzone8-resource-api-'));
  const dbPath = join(directory, 'resource.sqlite');
  const testAdmin = { username: 'admin', password: 'Planzone8-Test-Admin!2026', name: 'Administrateur' };
  let instance = createApp({ dbPath, today: '2026-10-06', admin: testAdmin });
  await instance.ready;
  let server = instance.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = () => {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    return `http://127.0.0.1:${address.port}`;
  };
  const stop = async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    instance.close();
  };
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  const login = await fetch(`${url()}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: testAdmin.username, password: testAdmin.password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';', 1)[0]!;
  const created = await fetch(`${url()}/api/resources`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(sheet) });
  assert.equal(created.status, 201, await created.clone().text());
  const resource = await created.json() as Resource;
  await stop();
  instance = createApp({ dbPath, today: '2026-10-06' });
  await instance.ready;
  server = instance.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const response = await fetch(`${url()}/api/state`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const state = await response.json() as { resources: Resource[] };
  assert.deepEqual(state.resources.find(item => item.id === resource.id), resource);
});
