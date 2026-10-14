import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../server/memory-store.ts';
import { ApiService } from '../server/service.ts';
import { seed } from '../server/seed.ts';
import { Store } from '../server/store.ts';
import { actualCost } from '../shared/domain.ts';
import type { Task, TimeEntry } from '../shared/types.ts';

const TODAY = '2026-10-06';
type Payload = Record<string, unknown>;

function fixture() {
  const store = new MemoryStore();
  seed(store);
  const service = new ApiService(store);
  return { store, service };
}

function expectStatus(action: () => unknown, status: number) {
  assert.throws(action, error => error instanceof Error && 'status' in error && error.status === status);
}

function createTask(service: ApiService, title: string, attributes: Payload = {}): Task {
  const result = service.mutate('tasks', 'POST', { projectId: 'project-nova', title, ...attributes });
  assert.equal(result.status, 201);
  const task = result.value as Task;
  assert.ok(task.id);
  return task;
}

function createEntry(service: ApiService, taskId: string, attributes: Payload = {}): TimeEntry {
  const result = service.mutate('time-entries', 'POST', {
    taskId, resourceId: 'resource-claire', date: TODAY, hours: 2, ...attributes,
  });
  assert.equal(result.status, 201);
  return result.value as TimeEntry;
}

test('seeding is idempotent and does not replace persisted user changes', () => {
  const { store, service } = fixture();
  service.mutate('projects', 'PATCH', { name: 'Projet renommé par l’équipe' }, 'project-nova');
  service.mutate('resources', 'PATCH', { jobTitle: 'Responsable du programme' }, 'resource-claire');
  const before = store.snapshot();
  seed(store);
  assert.deepEqual(store.snapshot(), before);
  const resumed = new MemoryStore(JSON.parse(JSON.stringify(before)));
  seed(resumed);
  assert.deepEqual(new ApiService(resumed).readState(TODAY), service.readState(TODAY));
});

test('store inputs and returned records cannot mutate the persisted workspace through aliases', () => {
  const { store, service } = fixture();
  const before = store.snapshot();
  const task = store.get('tasks', 'task-ateliers')!;
  task.title = 'Modification du clone';
  task.tags.push('Clone');
  store.all('tasks')[0]!.tags.push('Autre clone');
  store.snapshot().resources[0]!.active = false;
  const state = service.readState(TODAY);
  state.projects[0]!.name = 'État modifié localement';
  state.tasks[0]!.tags.push('État local');
  assert.deepEqual(store.snapshot(), before);

  const profile = { ...store.get('profiles', 'profile-pilot')!, id: 'profile-test-clone' };
  store.put('profiles', profile);
  profile.dailyRate = 1;
  assert.equal(store.get('profiles', profile.id)?.dailyRate, 650);
  const result = service.mutate('tasks', 'PATCH', { tags: ['Persisté'] }, 'task-ateliers');
  (result.value as Task).tags.push('Retour modifié');
  assert.deepEqual(store.get('tasks', 'task-ateliers')?.tags, ['Persisté']);

  const snapshot = store.snapshot();
  const resumed = new MemoryStore(snapshot);
  snapshot.tasks[0]!.title = 'Mutation après construction';
  assert.equal(resumed.get('tasks', 'task-cadrage')?.title, store.get('tasks', 'task-cadrage')?.title);
});

test('a failed transaction rolls back related tariff, resource and time changes together', () => {
  const { store } = fixture();
  const before = store.snapshot();
  const failure = new Error('Échec de persistence simulé');
  assert.throws(() => store.transaction(() => {
    store.put('profiles', { ...store.get('profiles', 'profile-pilot')!, dailyRate: 999 });
    store.put('resources', { ...store.get('resources', 'resource-claire')!, active: false });
    store.remove('timeEntries', 'time-ateliers');
    throw failure;
  }), error => error === failure);
  assert.deepEqual(store.snapshot(), before);
  assert.equal(actualCost(store.all('timeEntries')).amount, actualCost(before.timeEntries).amount);
});

test('a serialized workspace round trip preserves dependencies, tariff snapshots and validation', () => {
  const { store, service } = fixture();
  const task = createTask(service, 'Activité sauvegardée', { dependsOnId: 'task-cadrage', tags: ['Suivi'] });
  const entry = createEntry(service, task.id, { validated: true, note: 'Justificatif de la saisie' });
  service.mutate('profiles', 'PATCH', { dailyRate: 900, eqjtHours: 7 }, 'profile-pilot');
  const snapshot = store.snapshot();
  assert.ok(Object.values(snapshot).every(Array.isArray));
  const restored = new ApiService(new MemoryStore(JSON.parse(JSON.stringify(snapshot))));
  const data = restored.readState(TODAY);
  assert.deepEqual(data, service.readState(TODAY));
  assert.deepEqual(data.timeEntries.find(item => item.id === entry.id), entry);
  assert.equal(data.tasks.find(item => item.id === task.id)?.dependsOnId, 'task-cadrage');
  assert.equal(actualCost(data.timeEntries.filter(item => item.id === entry.id)).amount, 162.5);
});

test('memory service rejects orphan references and referenced deletions without relying on SQL foreign keys', () => {
  const { store, service } = fixture();
  const before = store.snapshot();
  expectStatus(() => createTask(service, 'Projet manquant', { projectId: 'missing-project' }), 404);
  expectStatus(() => createTask(service, 'Ressource manquante', { assigneeId: 'missing-resource' }), 404);
  expectStatus(() => service.mutate('comments', 'POST', { taskId: 'missing-task', body: 'Orphelin' }), 404);
  expectStatus(() => service.mutate('resources', 'PATCH', { profileId: 'missing-profile' }, 'resource-claire'), 404);
  expectStatus(() => service.mutate('profiles', 'DELETE', undefined, 'profile-pilot'), 409);
  expectStatus(() => service.mutate('tasks', 'DELETE', undefined, 'task-cadrage'), 409);
  assert.deepEqual(store.snapshot(), before);
});

test('dependency cycles and premature starts are rejected in the memory-backed service', () => {
  const { store, service } = fixture();
  const predecessor = createTask(service, 'Prédécesseur mémoire');
  const successor = createTask(service, 'Successeur mémoire', { dependsOnId: predecessor.id });
  expectStatus(() => service.mutate('tasks', 'PATCH', { dependsOnId: successor.id }, predecessor.id), 409);
  expectStatus(() => service.mutate('tasks', 'PATCH', { status: 'in_progress' }, successor.id), 409);
  service.mutate('tasks', 'PATCH', { status: 'done' }, predecessor.id);
  service.mutate('tasks', 'PATCH', { status: 'in_progress' }, successor.id);
  expectStatus(() => service.mutate('tasks', 'PATCH', { status: 'todo', progress: 0 }, predecessor.id), 409);
  assert.equal(store.get('tasks', predecessor.id)?.status, 'done');
  assert.equal(store.get('tasks', successor.id)?.status, 'in_progress');
});

test('validated time cannot be corrected or deleted before validation is withdrawn separately', () => {
  const { store, service } = fixture();
  const task = createTask(service, 'Validation en mémoire');
  const entry = createEntry(service, task.id, { validated: true });
  expectStatus(() => service.mutate('time-entries', 'PATCH', { hours: 1, validated: false }, entry.id), 409);
  expectStatus(() => service.mutate('time-entries', 'PATCH', { note: 'Nouvelle note' }, entry.id), 409);
  expectStatus(() => service.mutate('time-entries', 'DELETE', undefined, entry.id), 409);
  expectStatus(() => service.mutate('time-entries', 'PATCH', { rateSnapshot: 1 }, entry.id), 400);
  assert.deepEqual(store.get('timeEntries', entry.id), entry);
  service.mutate('time-entries', 'PATCH', { validated: false }, entry.id);
  service.mutate('profiles', 'PATCH', { dailyRate: 1000, eqjtHours: 7 }, 'profile-pilot');
  service.mutate('time-entries', 'PATCH', { hours: 3 }, entry.id);
  const corrected = store.get('timeEntries', entry.id)!;
  assert.equal(corrected.rateSnapshot, 650);
  assert.equal(corrected.eqjtSnapshot, 8);
  assert.equal(actualCost([corrected]).amount, 243.75);
  assert.equal(service.mutate('time-entries', 'DELETE', undefined, entry.id).status, 204);
  assert.equal(store.get('timeEntries', entry.id), undefined);
});

test('resource inactivation keeps existing history and prevents new assignments or time', () => {
  const { store, service } = fixture();
  const existing = store.get('timeEntries', 'time-ateliers')!;
  service.mutate('resources', 'PATCH', { active: false }, 'resource-claire');
  expectStatus(() => createTask(service, 'Affectation inactive', { assigneeId: 'resource-claire' }), 409);
  expectStatus(() => createEntry(service, 'task-ateliers'), 409);
  service.mutate('time-entries', 'PATCH', { hours: 4 }, 'time-ateliers');
  assert.equal(store.get('tasks', 'task-ateliers')?.assigneeId, 'resource-claire');
  assert.equal(store.get('timeEntries', existing.id)?.rateSnapshot, existing.rateSnapshot);
  assert.equal(store.get('timeEntries', existing.id)?.eqjtSnapshot, existing.eqjtSnapshot);
  assert.equal(store.get('timeEntries', existing.id)?.hours, 4);
});

test('backdated time without a current profile stays explicitly unpriced after profiles are reassigned', () => {
  const { store, service } = fixture();
  service.mutate('resources', 'PATCH', { profileId: null }, 'resource-claire');
  const entry = createEntry(service, 'task-ateliers', { date: '2026-01-05' });
  assert.equal(entry.rateSnapshot, null);
  assert.equal(entry.eqjtSnapshot, null);
  assert.deepEqual(actualCost([entry]), { amount: 0, missing: 1 });
  service.mutate('resources', 'PATCH', { profileId: 'profile-pilot' }, 'resource-claire');
  service.mutate('time-entries', 'PATCH', { hours: 3 }, entry.id);
  assert.deepEqual(actualCost([store.get('timeEntries', entry.id)!]), { amount: 0, missing: 1 });
});

test('memory and SQLite adapters produce the same business state for the same existing-record operations', () => {
  const memory = new MemoryStore();
  const sqlite = new Store(':memory:');
  try {
    seed(memory);
    seed(sqlite);
    const services = [new ApiService(memory), new ApiService(sqlite)];
    for (const service of services) {
      expectStatus(() => service.mutate('tasks', 'PATCH', { status: 'in_progress' }, 'task-portail'), 409);
      expectStatus(() => service.mutate('time-entries', 'PATCH', { hours: 1 }, 'time-cadrage'), 409);
      service.mutate('profiles', 'PATCH', { dailyRate: 700, eqjtHours: 7 }, 'profile-pilot');
      service.mutate('resources', 'PATCH', { dailyHours: 9, mondayHours: 6 }, 'resource-claire');
      service.mutate('projects', 'PATCH', { budget: 100000 }, 'project-nova');
      service.mutate('time-entries', 'PATCH', { validated: false }, 'time-cadrage');
      service.mutate('time-entries', 'PATCH', { hours: 6, note: 'Correction explicite' }, 'time-cadrage');
    }
    assert.deepEqual(services[0]!.readState(TODAY), services[1]!.readState(TODAY));
    assert.deepEqual(actualCost(memory.all('timeEntries')), actualCost(sqlite.all('timeEntries')));
  } finally {
    sqlite.close();
  }
});
