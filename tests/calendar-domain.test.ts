import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarItemOccursOnDate, remainingDailyCapacity } from '../shared/calendar.ts';
import { resourceCapacity, resourceLoad } from '../shared/domain.ts';
import type { Resource, Task, Unavailability } from '../shared/types.ts';

const resource: Resource = {
  id: 'resource-absences', name: 'Camille', jobTitle: '', type: 'human', classification: 'internal',
  initials: 'C', color: '#123456', dailyHours: 8, mondayHours: 4, profileId: null, active: true,
};
function absence(overrides: Partial<Unavailability> = {}): Unavailability {
  return {
    id: 'absence-1', title: 'Congé', resourceId: resource.id, reason: 'leave', allDay: true,
    startDate: '2026-10-06', endDate: '2026-10-07', startTime: null, endTime: null,
    ...overrides,
  };
}
function partial(startTime: string, endTime: string, overrides: Partial<Unavailability> = {}): Unavailability {
  return absence({ allDay: false, startDate: '2026-10-06', endDate: '2026-10-06', startTime, endTime, ...overrides });
}

test('une indisponibilité totale retire chaque jour inclus sans affecter les autres ressources', () => {
  const full = absence();
  assert.equal(resourceCapacity(resource, '2026-10-05', '2026-10-11', [full]), 20);
  assert.equal(resourceCapacity(resource, '2026-10-06', '2026-10-06', [full]), 0);
  assert.equal(resourceCapacity(resource, '2026-10-07', '2026-10-07', [full]), 0);
  assert.equal(resourceCapacity(resource, '2026-10-08', '2026-10-08', [full]), 8);
  assert.equal(resourceCapacity(resource, '2026-10-05', '2026-10-11', [absence({ resourceId: 'another-resource' })]), 36);
  assert.equal(calendarItemOccursOnDate(full, '2026-10-06'), true);
  assert.equal(calendarItemOccursOnDate(full, '2026-10-07'), true);
  assert.equal(calendarItemOccursOnDate(full, '2026-10-08'), false);
});

test('les indisponibilités partielles fusionnent les chevauchements et les doublons', () => {
  const absences = [partial('11:00', '14:00'), partial('09:00', '12:00'), partial('09:00', '12:00')];
  assert.equal(remainingDailyCapacity(8, resource.id, '2026-10-06', absences), 3);
  assert.equal(resourceCapacity(resource, '2026-10-05', '2026-10-11', absences), 31);
  assert.equal(remainingDailyCapacity(8, resource.id, '2026-10-05', absences), 8);
  assert.equal(remainingDailyCapacity(8, 'other', '2026-10-06', absences), 8);
});

test('les durées disjointes et contiguës sont additionnées en conservant les minutes', () => {
  const absences = [partial('09:00', '10:30'), partial('10:30', '11:00'), partial('15:00', '15:15')];
  assert.equal(remainingDailyCapacity(8, resource.id, '2026-10-06', absences), 5.75);
  assert.equal(remainingDailyCapacity(8, resource.id, '2026-10-06', [partial('00:00', '01:30')]), 6.5);
});

test('une journée totale prime sur les plages partielles et la capacité ne devient jamais négative', () => {
  const all = absence({ startDate: '2026-10-06', endDate: '2026-10-06' });
  assert.equal(remainingDailyCapacity(8, resource.id, '2026-10-06', [partial('09:00', '12:00'), all]), 0);
  assert.equal(remainingDailyCapacity(8, resource.id, '2026-10-06', [all, partial('09:00', '12:00')]), 0);
  assert.equal(remainingDailyCapacity(4, resource.id, '2026-10-06', [partial('08:00', '18:00')]), 0);
  assert.equal(remainingDailyCapacity(0, resource.id, '2026-10-06', [partial('09:00', '12:00')]), 0);
});

test('la capacité restante respecte les jours fériés, la semaine configurée et les ressources inactives', () => {
  const french: Resource = { ...resource, holidayCalendarId: 'fr', weeklyCapacityHours: [8, 8, 8, 8, 8, 0, 0] };
  const publicHoliday = partial('09:00', '12:00', { startDate: '2026-05-14', endDate: '2026-05-14' });
  const weekend = partial('09:00', '12:00', { startDate: '2026-05-16', endDate: '2026-05-16' });
  assert.equal(resourceCapacity(french, '2026-05-11', '2026-05-17', [publicHoliday, weekend]), 32);
  assert.equal(resourceCapacity({ ...french, active: false }, '2026-05-11', '2026-05-17', []), 0);
  const configuredWeekend: Resource = { ...resource, weeklyCapacityHours: [8, 0, 8, 8, 8, 4, 0] };
  assert.equal(resourceCapacity(configuredWeekend, '2026-10-06', '2026-10-06', [partial('09:00', '12:00')]), 0);
  assert.equal(resourceCapacity(configuredWeekend, '2026-10-10', '2026-10-10', [partial('09:00', '10:30', { startDate: '2026-10-10', endDate: '2026-10-10' })]), 2.5);
});

test('supprimer une indisponibilité restitue la capacité sans déplacer la charge planifiée', () => {
  const task: Task = {
    id: 'task-absence', projectId: 'p1', title: 'Travail planifié', description: '', phase: '',
    status: 'todo', progress: 0, assigneeId: resource.id, startDate: '2026-10-05', endDate: '2026-10-09',
    allocatedHours: 40, kind: 'task', tags: [], dependsOnId: null,
  };
  assert.equal(resourceCapacity(resource, '2026-10-06', '2026-10-06', [absence()]), 0);
  assert.equal(resourceLoad(resource, [task], '2026-10-06', '2026-10-06'), 8);
  assert.equal(resourceCapacity(resource, '2026-10-06', '2026-10-06', []), 8);
});

test('les dates civiles restent inclusives autour des changements d’heure et du changement d’année', () => {
  const everyDay: Resource = { ...resource, weeklyCapacityHours: [8, 8, 8, 8, 8, 8, 8] };
  for (const date of ['2026-03-29', '2026-10-25']) {
    const partialAbsence = partial('01:00', '04:00', { startDate: date, endDate: date });
    assert.equal(resourceCapacity(everyDay, date, date, [partialAbsence]), 5);
  }
  assert.equal(resourceCapacity(everyDay, '2026-03-27', '2026-03-31', [absence({ startDate: '2026-03-28', endDate: '2026-03-30' })]), 16);
  assert.equal(resourceCapacity(everyDay, '2026-10-23', '2026-10-27', [absence({ startDate: '2026-10-24', endDate: '2026-10-26' })]), 16);
  assert.equal(resourceCapacity(everyDay, '2026-12-30', '2027-01-02', [absence({ startDate: '2026-12-31', endDate: '2027-01-01' })]), 16);
});

test('les durées partielles utilisent une capacité quotidienne, sans fenêtre de bureau implicite', () => {
  assert.equal(remainingDailyCapacity(8, resource.id, '2026-10-06', [partial('20:00', '22:00')]), 6);
  assert.equal(remainingDailyCapacity(8, resource.id, '2026-10-06', [partial('12:00', '11:00')]), 8);
  assert.equal(remainingDailyCapacity(8, resource.id, '2026-10-06', [partial('09:00', '12:00', { endDate: '2026-10-07' })]), 8);
});
