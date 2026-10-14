import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.ts';
import { MemoryStore } from '../server/memory-store.ts';
import { ApiError, ApiService } from '../server/service.ts';
import { seed } from '../server/seed.ts';
import type { StoreLike } from '../server/contracts.ts';
import { DEFAULT_PLANZONE_PREFERENCES, projectTimeEntries } from '../shared/planzone-preferences.ts';
import { preferenceGanttPatch } from '../shared/planning-preferences.ts';
import { planningWarnings } from '../shared/planning-warnings.ts';
import { RESOURCE_ROLE_LABELS, type Project, type Resource, type Task, type TimeEntry } from '../shared/types.ts';

const admin = { id: 'resource-claire', name: 'Administrateur', role: RESOURCE_ROLE_LABELS.administrator };
function rejected(status: number, action: () => unknown) { assert.throws(action, error => error instanceof ApiError && error.status === status); }
function save(api: ApiService, changes: Partial<typeof DEFAULT_PLANZONE_PREFERENCES>) {
  const previous = api.readState().planzonePreferences?.[0] ?? DEFAULT_PLANZONE_PREFERENCES;
  const { id, version, ...options } = { ...previous, ...changes };
  return api.mutate('planzone-preferences', 'POST', { ...options, expectedVersion: version }).value;
}
for (const backend of ['sqlite', 'memory'] as const) test(backend + ': preferences preserve history, enforce rights/version and control calendar/time behaviour', () => {
  const directory = mkdtempSync(join(tmpdir(), 'planzone-prefs-')), path = join(directory, 'prefs.sqlite');
  let store: StoreLike = backend === 'sqlite' ? new Store(path) : new MemoryStore(); seed(store);
  let api = new ApiService(store, admin);
  try {
    store.put('resources', { ...store.get('resources', admin.id)!, weeklyCapacityHours: [8, 8, 8, 8, 8, 0, 0], hoursPerDay: 8, holidayCalendarId: 'none' });
    const project = api.mutate('projects', 'POST', { name: 'Projet des préférences', zoneId: store.all('zones')[0].id, startDate: '2026-01-01', endDate: '2027-12-31' }).value as Project;
    const task = api.mutate('tasks', 'POST', { projectId: project.id, title: 'Travail planifié', assigneeId: admin.id, startDate: '2026-10-05', endDate: '2026-10-06', allocatedHours: 2 }).value as Task;
    const entry = api.mutate('time-entries', 'POST', { taskId: task.id, resourceId: admin.id, date: '2026-10-06', hours: 2, note: 'Historique conservé' }).value as TimeEntry;
    api.mutate('time-integrations', 'POST', { scope: 'project', projectId: project.id, date: '2026-10-06' });
    rejected(409, () => api.mutate('time-entries', 'PATCH', { hours: 3 }, entry.id));
    save(api, { blockIntegratedDates: false, extendAcrossNonWorkingDays: true, linkAllocationToDuration: true });
    api.mutate('time-entries', 'PATCH', { hours: 3 }, entry.id);
    const updated = store.get('timeEntries', entry.id)!;
    assert.equal(updated.rateSnapshot, entry.rateSnapshot); assert.equal(updated.eqjtSnapshot, entry.eqjtSnapshot);
    const manual = api.mutate('time-entries', 'POST', { taskId: task.id, resourceId: admin.id, date: '2026-10-07', hours: 1, validated: true }).value as TimeEntry;
    rejected(409, () => api.mutate('time-entries', 'PATCH', { hours: 4 }, manual.id));
    const moved = api.mutate('tasks', 'PATCH', { startDate: '2026-10-09', endDate: '2026-10-10' }, task.id).value as Task;
    assert.equal(moved.endDate, '2026-10-12'); assert.equal(moved.allocatedHours, 16);
    const preview = preferenceGanttPatch(api.readState(), { ...moved, kind: 'task' }, 'move', 7);
    assert.equal(preview?.endDate, '2026-10-19');
    api.mutate('tasks', 'PATCH', { endDate: '2026-10-13' }, task.id);
    assert.equal(store.get('tasks', task.id)?.allocatedHours, 24);
    const pending = api.mutate('time-entries', 'POST', { taskId: task.id, resourceId: admin.id, date: '2026-10-14', hours: 1 }).value as TimeEntry;
    save(api, { automaticTimeIntegration: false });
    assert.equal(projectTimeEntries(api.readState()).some(value => value.id === pending.id), false);
    save(api, { automaticTimeIntegration: true });
    assert.equal(projectTimeEntries(api.readState()).some(value => value.id === pending.id), true);
    const visitor = api.mutate('resources', 'POST', { name: 'Membre de test', type: 'human', role: 'user', projectIds: [project.id] }).value as Resource;
    const memberApi = new ApiService(store, { id: visitor.id, name: visitor.name, role: RESOURCE_ROLE_LABELS.user });
    rejected(403, () => save(memberApi, { blockIntegratedDates: true }));
    const unassigned = api.mutate('tasks', 'POST', { projectId: project.id, title: 'À prendre' }).value as Task;
    save(api, { allowSelfAssignment: false }); rejected(403, () => memberApi.mutate('task-self-assignment', 'POST', { taskId: unassigned.id }));
    save(api, { allowSelfAssignment: true });
    store.put('projects', { ...store.get('projects', project.id)!, projectRoles: { [visitor.id]: 'observer' } });
    rejected(403, () => memberApi.mutate('task-self-assignment', 'POST', { taskId: unassigned.id }));
    store.put('projects', { ...store.get('projects', project.id)!, projectRoles: { [visitor.id]: 'collaborator' } });
    memberApi.mutate('task-self-assignment', 'POST', { taskId: unassigned.id });
    assert.equal(store.get('tasks', unassigned.id)?.assigneeId, visitor.id);
    const saved = api.readState().planzonePreferences![0];
    const { id, version, ...fields } = saved;
    rejected(409, () => api.mutate('planzone-preferences', 'POST', { ...fields, expectedVersion: version - 1 }));
    rejected(400, () => api.mutate('planzone-preferences', 'POST', { ...fields, expectedVersion: version, criticalDailySpanHours: -1 }));
    if (store instanceof Store) { store.close(); store = new Store(path); } else if (store instanceof MemoryStore) store = new MemoryStore(store.snapshot());
    api = new ApiService(store, admin); assert.deepEqual(api.readState().planzonePreferences?.[0], saved);
    assert.equal(store.get('timeEntries', entry.id)?.note, entry.note);
  } finally { if (store instanceof Store) store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('warnings use explicit clocks for span/rest and zero thresholds disable alerts', () => {
  const store = new MemoryStore(); seed(store); const api = new ApiService(store, admin);
  save(api, { criticalDailySpanHours: 10, criticalDailyWorkHours: 1, minimumRestHours: 11, warnDuringUnavailability: true });
  for (const [date, start, end] of [['2026-10-05', '09:00', '10:00'], ['2026-10-05', '18:00', '22:00'], ['2026-10-06', '06:00', '07:00']]) api.mutate('calendar-events', 'POST', { title: 'Activité horaire', resourceIds: [admin.id], startDate: date, endDate: date, allDay: false, startTime: start, endTime: end });
  api.mutate('unavailabilities', 'POST', { title: 'Absence', resourceId: admin.id, reason: 'leave', startDate: '2026-10-05', endDate: '2026-10-05', allDay: true });
  const data = api.readState(), warnings = planningWarnings(data, admin.id, '2026-10-05', '2026-10-06');
  for (const kind of ['span', 'work', 'rest', 'absence']) assert.equal(warnings.some(warning => warning.kind === kind), true, kind);
  assert.equal(planningWarnings({ ...data, calendarEvents: [] }, admin.id, '2026-10-05', '2026-10-06').some(warning => warning.kind === 'rest' || warning.kind === 'span'), false);
  save(api, { criticalDailySpanHours: 0, criticalDailyWorkHours: 0, minimumRestHours: 0, warnDuringUnavailability: false });
  assert.deepEqual(planningWarnings(api.readState(), admin.id, '2026-10-05', '2026-10-06'), []);
});
