import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../server/app.ts';
import type { CompatibleWorkspaceSnapshot, Table } from '../server/contracts.ts';
import { MemoryStore } from '../server/memory-store.ts';
import { seed } from '../server/seed.ts';
import { ApiError, ApiService } from '../server/service.ts';
import { Store } from '../server/store.ts';
import type { AppData, CalendarEvent, Unavailability } from '../shared/types.ts';

const eventInput = {
  title: 'Atelier équipe', description: 'Préparer la livraison', projectId: 'project-nova',
  resourceIds: ['resource-claire', 'resource-ines'], startDate: '2026-10-12', endDate: '2026-10-12',
  allDay: false, startTime: '09:30', endTime: '11:00',
};
const absenceInput = {
  title: 'Congé personnel', resourceId: 'resource-claire', reason: 'leave',
  startDate: '2026-10-13', endDate: '2026-10-16', allDay: true,
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

  test(`${backend}: calendar events and full or partial unavailability support independent persistent CRUD`, () => {
    const { store, api, close } = fixture();
    try {
      const before = api.readState('2026-10-12');
      assert.deepEqual(before.calendarEvents, []);
      assert.deepEqual(before.unavailabilities, []);
      const event = api.mutate('calendar-events', 'POST', eventInput).value as CalendarEvent;
      const allDay = api.mutate('unavailabilities', 'POST', absenceInput).value as Unavailability;
      assert.equal(event.title, eventInput.title);
      assert.equal(event.startTime, '09:30');
      assert.equal(allDay.startTime, null);
      assert.equal(allDay.endTime, null);
      assert.equal(allDay.reason, 'leave');
      const partial = api.mutate('unavailabilities', 'PATCH', {
        allDay: false, endDate: absenceInput.startDate, startTime: '13:00', endTime: '16:30', reason: 'sick',
      }, allDay.id).value as Unavailability;
      assert.equal(partial.allDay, false);
      assert.equal(partial.startDate, partial.endDate);
      assert.equal(partial.reason, 'sick');
      assert.equal(partial.endTime, '16:30');
      const entireDay = api.mutate('calendar-events', 'PATCH', { allDay: true }, event.id).value as CalendarEvent;
      assert.equal(entireDay.startTime, null);
      assert.equal(entireDay.endTime, null);
      assert.deepEqual(entireDay.resourceIds, eventInput.resourceIds);
      const multiDay = api.mutate('calendar-events', 'PATCH', {
        allDay: false, startTime: '23:00', endDate: '2026-10-13', endTime: '01:00',
      }, event.id).value as CalendarEvent;
      assert.equal(multiDay.endDate, '2026-10-13');
      assert.equal(multiDay.endTime, '01:00');
      const state = api.readState('2026-10-12');
      assert.deepEqual(state.tasks, before.tasks);
      assert.deepEqual(state.timeEntries, before.timeEntries);
      assert.deepEqual(state.resources, before.resources);
      assert.deepEqual(state.calendarEvents, [multiDay]);
      assert.deepEqual(state.unavailabilities, [partial]);
      if (store instanceof MemoryStore) {
        assert.deepEqual(new ApiService(new MemoryStore(JSON.parse(JSON.stringify(store.snapshot())))).readState('2026-10-12'), state);
      }
      assert.equal(api.mutate('calendar-events', 'DELETE', undefined, event.id).status, 204);
      assert.equal(api.mutate('unavailabilities', 'DELETE', undefined, allDay.id).status, 204);
      assert.deepEqual(api.readState().calendarEvents, []);
      assert.deepEqual(api.readState().unavailabilities, []);
    } finally { close(); }
  });

  test(`${backend}: impossible calendar dates and clock times are rejected without partial writes`, () => {
    const { api, close } = fixture();
    try {
      for (const patch of [
        { title: ' ' }, { startDate: '2026-02-29' }, { endDate: '2026-13-01' },
        { startDate: '2026-10-14', endDate: '2026-10-12' },
        { startTime: '24:00' }, { endTime: '10:60' }, { startTime: '9:00' },
        { endTime: '09:30' }, { endTime: '08:00' }, { startTime: null },
        { resourceIds: ['resource-claire', 'resource-claire'] }, { unknown: true },
      ]) rejectsStatus(400, () => api.mutate('calendar-events', 'POST', { ...eventInput, ...patch }));
      for (const patch of [
        { reason: 'vacation' }, { startDate: '2026-02-30' }, { endDate: '2026-10-12' },
        { allDay: false, startTime: '09:00', endTime: '10:00' },
        { allDay: false, endDate: absenceInput.startDate, startTime: '09:00', endTime: '09:00' },
        { allDay: false, endDate: absenceInput.startDate, startTime: '10:00', endTime: '09:00' },
        { allDay: false, endDate: absenceInput.startDate, startTime: null, endTime: '09:00' },
        { allDay: true, startTime: '99:99' }, { unknown: true },
      ]) rejectsStatus(400, () => api.mutate('unavailabilities', 'POST', { ...absenceInput, ...patch }));
      assert.deepEqual(api.readState().calendarEvents, []);
      assert.deepEqual(api.readState().unavailabilities, []);
      const absence = api.mutate('unavailabilities', 'POST', absenceInput).value as Unavailability;
      rejectsStatus(400, () => api.mutate('unavailabilities', 'PATCH', { allDay: false }, absence.id));
      rejectsStatus(400, () => api.mutate('unavailabilities', 'PATCH', {}, absence.id));
      assert.deepEqual(api.readState().unavailabilities, [absence]);
    } finally { close(); }
  });

  test(`${backend}: calendar references reject missing or newly inactive resources and retain historical links`, () => {
    const { api, close } = fixture();
    try {
      rejectsStatus(404, () => api.mutate('calendar-events', 'POST', { ...eventInput, projectId: 'missing' }));
      rejectsStatus(404, () => api.mutate('calendar-events', 'POST', { ...eventInput, resourceIds: ['missing'] }));
      rejectsStatus(404, () => api.mutate('unavailabilities', 'POST', { ...absenceInput, resourceId: 'missing' }));
      const event = api.mutate('calendar-events', 'POST', eventInput).value as CalendarEvent;
      const absence = api.mutate('unavailabilities', 'POST', absenceInput).value as Unavailability;
      api.mutate('resources', 'PATCH', { active: false }, 'resource-claire');
      rejectsStatus(409, () => api.mutate('calendar-events', 'POST', eventInput));
      rejectsStatus(409, () => api.mutate('unavailabilities', 'POST', absenceInput));
      assert.equal((api.mutate('calendar-events', 'PATCH', { title: 'Historique' }, event.id).value as CalendarEvent).title, 'Historique');
      assert.equal((api.mutate('unavailabilities', 'PATCH', { title: 'Congé historique' }, absence.id).value as Unavailability).title, 'Congé historique');
      api.mutate('resources', 'PATCH', { active: false }, 'resource-thomas');
      rejectsStatus(409, () => api.mutate('calendar-events', 'PATCH', { resourceIds: ['resource-thomas'] }, event.id));
      rejectsStatus(409, () => api.mutate('unavailabilities', 'PATCH', { resourceId: 'resource-thomas' }, absence.id));
      rejectsStatus(405, () => api.mutate('resources', 'DELETE', undefined, 'resource-claire'));
      assert.equal(api.mutate('unavailabilities', 'DELETE', undefined, absence.id).status, 204);
    } finally { close(); }
  });

  test(`${backend}: linked events protect project history and old or new paused projects`, () => {
    const { api, close } = fixture();
    try {
      const project = api.mutate('projects', 'POST', {
        name: 'Calendrier sans tâches', zoneId: api.readState().zones[0]!.id,
        startDate: '2026-10-01', endDate: '2026-10-31',
      }).value!;
      const event = api.mutate('calendar-events', 'POST', { ...eventInput, projectId: project.id }).value as CalendarEvent;
      rejectsStatus(409, () => api.mutate('projects', 'DELETE', undefined, project.id));
      api.mutate('projects', 'PATCH', { status: 'paused' }, project.id);
      rejectsStatus(409, () => api.mutate('calendar-events', 'POST', { ...eventInput, projectId: project.id }));
      rejectsStatus(409, () => api.mutate('calendar-events', 'PATCH', { title: 'Modification' }, event.id));
      rejectsStatus(409, () => api.mutate('calendar-events', 'PATCH', { projectId: null }, event.id));
      rejectsStatus(409, () => api.mutate('calendar-events', 'DELETE', undefined, event.id));
      const global = api.mutate('calendar-events', 'POST', { ...eventInput, projectId: null }).value as CalendarEvent;
      rejectsStatus(409, () => api.mutate('calendar-events', 'PATCH', { projectId: project.id }, global.id));
      assert.equal(api.mutate('calendar-events', 'DELETE', undefined, global.id).status, 204);
      api.mutate('projects', 'PATCH', { status: 'closed' }, project.id);
      rejectsStatus(409, () => api.mutate('calendar-events', 'DELETE', undefined, event.id));
      api.mutate('projects', 'PATCH', { status: 'open' }, project.id);
      api.mutate('calendar-events', 'DELETE', undefined, event.id);
      assert.equal(api.mutate('projects', 'DELETE', undefined, project.id).status, 204);
    } finally { close(); }
  });
}

test('legacy Worker snapshots default only absent calendar arrays and keep the complete prior workspace', () => {
  const initial = new MemoryStore();
  seed(initial);
  const snapshot = initial.snapshot();
  const { calendarEvents: _events, unavailabilities: _absences, ...legacy } = snapshot;
  legacy.projects[0]!.name = 'Projet existant conservé';
  const original = structuredClone(legacy);
  const resumed = new MemoryStore(legacy);
  seed(resumed);
  assert.deepEqual(resumed.snapshot(), { ...original, calendarEvents: [], unavailabilities: [] });
  assert.deepEqual(legacy, original);
  for (const malformed of [
    { calendarEvents: null }, { unavailabilities: {} }, { calendarEvents: undefined }, { tasks: undefined },
    { calendarEvents: [{ id: 'duplicate' }, { id: 'duplicate' }] },
  ]) {
    assert.throws(() => new MemoryStore({ ...legacy, ...malformed } as unknown as CompatibleWorkspaceSnapshot), /Invalid workspace table/);
  }
});

test('adding SQLite calendar tables preserves prior records and is idempotent across reopen', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'planzone8-calendar-upgrade-'));
  const dbPath = join(directory, 'legacy.sqlite');
  t.after(() => rm(directory, { recursive: true, force: true }));
  let store = new Store(dbPath);
  seed(store);
  const api = new ApiService(store);
  api.mutate('projects', 'PATCH', { name: 'Projet original' }, 'project-nova');
  const tables: Table[] = ['zones', 'projects', 'tasks', 'resources', 'profiles', 'timeEntries', 'comments', 'expenses'];
  const original = Object.fromEntries(tables.map(table => [table, store.all(table)]));
  store.db.exec('DROP TABLE calendarEvents; DROP TABLE unavailabilities;');
  store.close();
  store = new Store(dbPath);
  try {
    seed(store);
    assert.deepEqual(Object.fromEntries(tables.map(table => [table, store.all(table)])), original);
    const event = new ApiService(store).mutate('calendar-events', 'POST', eventInput).value as CalendarEvent;
    store.close();
    store = new Store(dbPath);
    assert.deepEqual(store.get('calendarEvents', event.id), event);
    assert.deepEqual(Object.fromEntries(tables.map(table => [table, store.all(table)])), original);
  } finally { store.close(); }
});

test('authenticated calendar HTTP endpoints enforce origin and persist full and partial absences through restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'planzone8-calendar-http-'));
  const dbPath = join(directory, 'calendar.sqlite');
  const admin = { username: 'admin', password: 'Planzone8-Test-Admin!2026', name: 'Administrateur' };
  let instance = createApp({ dbPath, today: '2026-10-12', admin });
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
  for (const [entity, body] of [['calendar-events', eventInput], ['unavailabilities', absenceInput]] as const) {
    const response = await fetch(`${url()}/api/${entity}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 401);
  }
  const login = await fetch(`${url()}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: admin.username, password: admin.password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';', 1)[0]!;
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };
  const crossOrigin = await fetch(`${url()}/api/unavailabilities`, {
    method: 'POST', headers: { ...headers, Origin: 'https://untrusted.example' }, body: JSON.stringify(absenceInput),
  });
  assert.equal(crossOrigin.status, 403);
  const eventResponse = await fetch(`${url()}/api/calendar-events`, { method: 'POST', headers, body: JSON.stringify(eventInput) });
  assert.equal(eventResponse.status, 201, await eventResponse.clone().text());
  const event = await eventResponse.json() as CalendarEvent;
  const absenceResponse = await fetch(`${url()}/api/unavailabilities`, { method: 'POST', headers, body: JSON.stringify(absenceInput) });
  assert.equal(absenceResponse.status, 201);
  const absence = await absenceResponse.json() as Unavailability;
  const partialResponse = await fetch(`${url()}/api/unavailabilities/${absence.id}`, {
    method: 'PATCH', headers, body: JSON.stringify({ allDay: false, endDate: absence.startDate, startTime: '08:30', endTime: '12:00' }),
  });
  assert.equal(partialResponse.status, 200);
  const partial = await partialResponse.json() as Unavailability;
  await stop();
  instance = createApp({ dbPath, today: '2026-10-12' });
  await instance.ready;
  server = instance.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const response = await fetch(`${url()}/api/state`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const state = await response.json() as AppData;
  assert.deepEqual(state.calendarEvents, [event]);
  assert.deepEqual(state.unavailabilities, [partial]);
  for (const [entity, record] of [['calendar-events', event], ['unavailabilities', partial]] as const) {
    const deleted = await fetch(`${url()}/api/${entity}/${record.id}`, { method: 'DELETE', headers });
    assert.equal(deleted.status, 204);
  }
});
