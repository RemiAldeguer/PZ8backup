import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actualCost, businessDays, frenchHolidayDates, isLate, plannedCost, resourceCapacity, resourceLoad, taskMetrics } from '../shared/domain.ts';
import type { Resource, Task, TimeEntry } from '../shared/types.ts';

const resource: Resource = { id: 'r1', name: 'Ressource 7 h', jobTitle: '', type: 'human', classification: 'internal', initials: 'R', color: '#123456', dailyHours: 8, mondayHours: 4, profileId: 'p1', active: true };
const task: Task = { id: 't1', projectId: 'p1', title: 'Tâche', description: '', phase: '', status: 'in_progress', progress: 50, assigneeId: 'r1', startDate: '2026-10-05', endDate: '2026-10-09', allocatedHours: 40, kind: 'task', tags: [], dependsOnId: null };
const entry: TimeEntry = { id: 'e1', taskId: 't1', resourceId: 'r1', date: '2026-10-05', hours: 8, note: '', validated: false, rateSnapshot: 640, eqjtSnapshot: 8 };

test('la capacité tient compte du lundi réduit sans modifier Eqjt', () => {
  assert.equal(resourceCapacity(resource, '2026-10-05', '2026-10-11'), 36);
  assert.equal(resourceCapacity({ ...resource, dailyHours: 7, mondayHours: 7 }, '2026-10-05', '2026-10-11'), 35);
  assert.equal(resourceCapacity({ ...resource, active: false }, '2026-10-05', '2026-10-11'), 0);
  assert.equal(resourceCapacity(resource, '2026-10-10', '2026-10-11'), 0);
});
test('la charge consolide deux projets et la capacité ne se répète pas', () => {
  const other = { ...task, id: 't2', projectId: 'p2', allocatedHours: 20 };
  assert.equal(resourceLoad(resource, [task, other], '2026-10-05', '2026-10-09'), 60);
  assert.equal(resourceLoad(resource, [task, other], '2026-10-05', '2026-10-05'), 12);
  assert.equal(resourceLoad({ ...resource, dailyHours: 0, mondayHours: 0 }, [task], '2026-10-05', '2026-10-09'), 40);
  assert.equal(businessDays('2026-10-05', '2026-10-09'), 5);
});
test('les bornes inclusives et les dates absentes ne créent pas de retard infini', () => {
  assert.equal(isLate(task, '2026-10-09'), false);
  assert.equal(isLate(task, '2026-10-10'), true);
  assert.equal(isLate({ ...task, endDate: null }, '2026-10-10'), false);
  assert.equal(resourceLoad(resource, [{ ...task, startDate: null }], '2026-10-05', '2026-10-09'), 0);
});
test('avancement pondéré, comptes et temps passé sont des métriques distinctes', () => {
  const tasks = [{ ...task, status: 'done' as const, progress: 100, allocatedHours: 20 }, { ...task, id: 't2', allocatedHours: 80 }];
  const metrics = taskMetrics(tasks, [entry], '2026-10-06');
  assert.equal(metrics.progress, 60);
  assert.equal(metrics.completed, 1);
  assert.equal(metrics.spentHours, 8);
  assert.equal(metrics.realizedHours + metrics.lateHours + metrics.openHours, 100);
  assert.equal(taskMetrics([{ ...task, allocatedHours: 0 }], [], '2026-10-06').progress, 0);
});
test('un coût inconnu reste inconnu et le réel conserve le tarif enregistré', () => {
  assert.deepEqual(plannedCost([task], [resource], [{ id: 'p1', name: 'Métier', dailyRate: 640, eqjtHours: 8, currency: 'EUR' }]), { amount: 3200, missing: 0 });
  assert.deepEqual(plannedCost([task], [{ ...resource, profileId: null }], []), { amount: 0, missing: 1 });
  assert.deepEqual(actualCost([entry]), { amount: 640, missing: 0 });
  assert.deepEqual(actualCost([{ ...entry, rateSnapshot: null, eqjtSnapshot: null }]), { amount: 0, missing: 1 });
});

test('la capacité hebdomadaire couvre les sept jours et garde les heures indépendantes de l’unité affichée', () => {
  const weekendResource: Resource = { ...resource, weeklyCapacityHours: [8, 0, 4, 6, 8, 2, 3], capacityUnit: 'days', hoursPerDay: 7 };
  assert.equal(resourceCapacity(weekendResource, '2026-10-05', '2026-10-11'), 31);
  assert.equal(resourceCapacity(weekendResource, '2026-10-10', '2026-10-11'), 5);
  assert.equal(resourceCapacity(weekendResource, '2026-10-06', '2026-10-06'), 0);
  assert.equal(resourceCapacity({ ...weekendResource, active: false }, '2026-10-05', '2026-10-11'), 0);
});

test('le calendrier français calcule les dates mobiles et retire les jours fériés de la capacité', () => {
  const holidays = frenchHolidayDates(2026);
  assert.equal(holidays.size, 11);
  for (const date of ['2026-01-01', '2026-04-06', '2026-05-14', '2026-05-25', '2026-07-14', '2026-12-25']) {
    assert.ok(holidays.has(date), date);
  }
  for (const date of ['2027-03-29', '2027-05-06', '2027-05-17']) assert.ok(frenchHolidayDates(2027).has(date), date);
  for (const date of ['2024-04-01', '2024-05-09', '2024-05-20']) assert.ok(frenchHolidayDates(2024).has(date), date);
  const frenchResource: Resource = { ...resource, mondayHours: 8, weeklyCapacityHours: [8, 8, 8, 8, 8, 2, 0], holidayCalendarId: 'fr' };
  assert.equal(resourceCapacity(frenchResource, '2026-05-11', '2026-05-15'), 32);
  assert.equal(resourceCapacity({ ...frenchResource, holidayCalendarId: 'none' }, '2026-05-11', '2026-05-15'), 40);
  assert.equal(resourceCapacity(frenchResource, '2026-08-15', '2026-08-15'), 0);
  assert.equal(resourceCapacity(frenchResource, '2026-12-28', '2027-01-03'), 34);
});

test('la charge suit les jours disponibles et reste visible quand aucune capacité n’existe', () => {
  const customWeek: Resource = { ...resource, weeklyCapacityHours: [8, 0, 8, 8, 8, 0, 0] };
  assert.equal(resourceLoad(customWeek, [task], '2026-10-05', '2026-10-09'), 40);
  assert.equal(resourceLoad(customWeek, [task], '2026-10-06', '2026-10-06'), 0);
  assert.equal(resourceLoad(customWeek, [task], '2026-10-05', '2026-10-05'), 10);
  const weekendTask: Task = { ...task, startDate: '2026-10-10', endDate: '2026-10-11' };
  assert.equal(resourceLoad(resource, [weekendTask], '2026-10-10', '2026-10-10'), 20);
  assert.equal(resourceLoad({ ...customWeek, active: false }, [task], '2026-10-05', '2026-10-09'), 40);
  const noCapacity: Resource = { ...resource, weeklyCapacityHours: [0, 0, 0, 0, 0, 0, 0] };
  assert.equal(resourceLoad(noCapacity, [task], '2026-10-05', '2026-10-09'), 40);
  const frenchResource: Resource = { ...resource, weeklyCapacityHours: [8, 8, 8, 8, 8, 0, 0], holidayCalendarId: 'fr' };
  const holidayWeek: Task = { ...task, startDate: '2026-05-11', endDate: '2026-05-15' };
  assert.equal(resourceLoad(frenchResource, [holidayWeek], '2026-05-14', '2026-05-14'), 0);
  assert.equal(resourceLoad(frenchResource, [holidayWeek], '2026-05-15', '2026-05-15'), 10);
  const holidayOnly: Task = { ...task, startDate: '2026-05-14', endDate: '2026-05-14' };
  assert.equal(resourceCapacity(frenchResource, '2026-05-14', '2026-05-14'), 0);
  assert.equal(resourceLoad(frenchResource, [holidayOnly], '2026-05-14', '2026-05-14'), 40);
});
