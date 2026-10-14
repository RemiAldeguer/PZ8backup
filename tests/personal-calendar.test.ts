import { test } from 'node:test';
import assert from 'node:assert/strict';
import { personalCalendarItems, personalCalendarTimeRange, personalTaskDependency, personalTaskGroups, personalTimedLayout, personalWeekNumber, type PersonalCalendarItem } from '../shared/personal-calendar.ts';
import type { AppData, CalendarEvent, Task, Unavailability } from '../shared/types.ts';

function task(id: string, patch: Partial<Task> = {}): Task {
  return { id, projectId: 'p1', title: id, description: '', phase: '', status: 'todo', progress: 0,
    assigneeId: 'me', startDate: '2026-10-12', endDate: '2026-10-16', allocatedHours: 8,
    kind: 'task', tags: [], dependsOnId: null, ...patch };
}
function event(id: string, patch: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id, title: id, description: '', projectId: 'p1', resourceIds: ['me'],
    startDate: '2026-10-12', endDate: '2026-10-12', allDay: false,
    startTime: '09:00', endTime: '10:00', ...patch };
}
function absence(id: string, patch: Partial<Unavailability> = {}): Unavailability {
  return { id, title: id, resourceId: 'me', reason: 'leave', allDay: true,
    startDate: '2026-10-12', endDate: '2026-10-13', startTime: null, endTime: null, ...patch };
}
function fixture(): AppData {
  return { zones: [], projects: [], resources: [], profiles: [], timeEntries: [], comments: [], expenses: [], revenues: [],
    calendarEvents: [], unavailabilities: [], tasks: [], today: '2026-10-12', currentUser: { id: 'me', name: 'Moi', role: 'Administrateur' } };
}

test('les cartes personnelles séparent échéances dépassées, échéances du jour, tâches non datées et comptes terminés', () => {
  const data = fixture();
  data.tasks = [
    task('today', { endDate: data.today }), task('late', { endDate: '2026-10-11' }),
    task('undated', { startDate: null, endDate: null }), task('done', { status: 'done', endDate: '2026-10-01' }),
    task('milestone', { kind: 'milestone', status: 'done' }), task('other', { assigneeId: 'other' }),
  ];
  const groups = personalTaskGroups(data, 'me');
  assert.deepEqual(groups.upcoming.map(item => item.id), ['today', 'undated']);
  assert.deepEqual(groups.overdue.map(item => item.id), ['late']);
  assert.deepEqual(groups.completed.map(item => item.id), ['done']);
  assert.equal(groups.blockedCount, 0);
  assert.deepEqual(personalTaskGroups(data, 'missing').upcoming, []);
});

test('masquer les tâches bloquées repose sur le prédécesseur réel même assigné à une autre ressource', () => {
  const data = fixture();
  data.tasks = [task('parent', { assigneeId: 'other' }), task('blocked', { dependsOnId: 'parent' }),
    task('complete-parent', { assigneeId: 'other', status: 'done' }), task('unblocked', { dependsOnId: 'complete-parent' }),
    task('unknown-parent', { dependsOnId: 'removed' }), task('finished', { status: 'done', dependsOnId: 'parent' })];
  assert.equal(personalTaskDependency(data.tasks[1], data.tasks)?.id, 'parent');
  assert.equal(personalTaskDependency(data.tasks[3], data.tasks), undefined);
  assert.equal(personalTaskDependency(data.tasks[4], data.tasks), undefined);
  assert.equal(personalTaskDependency(data.tasks[5], data.tasks), undefined);
  assert.equal(personalTaskGroups(data, 'me', false).blockedCount, 1);
  assert.deepEqual(personalTaskGroups(data, 'me', false).upcoming.map(item => item.id), ['unblocked', 'unknown-parent']);
  assert.equal(personalCalendarItems(data, 'me', data.today, false).some(entry => entry.item.id === 'blocked'), false);
  data.tasks[0].status = 'done';
  assert.equal(personalTaskGroups(data, 'me', false).blockedCount, 0);
  assert.equal(personalTaskGroups(data, 'me', false).upcoming.length, 3);
});

test('le calendrier personnel inclut seulement les affectations, participations et absences de la ressource sélectionnée', () => {
  const data = fixture();
  data.tasks = [task('assigned'), task('other-task', { assigneeId: 'other' }), task('unassigned', { assigneeId: null }),
    task('milestone', { kind: 'milestone', startDate: null, endDate: '2026-10-12' }),
    task('finished', { status: 'done' }), task('undated', { startDate: null, endDate: null })];
  data.calendarEvents = [event('meeting'), event('all-day', { allDay: true, startTime: null, endTime: null }),
    event('global', { resourceIds: [] }), event('other-meeting', { resourceIds: ['other'] })];
  data.unavailabilities = [absence('leave'), absence('other-leave', { resourceId: 'other' })];
  assert.deepEqual(new Set(personalCalendarItems(data, 'me', data.today).map(entry => entry.item.id)), new Set(['assigned', 'milestone', 'meeting', 'all-day', 'leave']));
  assert.deepEqual(new Set(personalCalendarItems(data, 'other', data.today).map(entry => entry.item.id)), new Set(['other-task', 'other-meeting', 'other-leave']));
  assert.equal(personalCalendarItems(data, 'me', '2026-10-16').some(entry => entry.item.id === 'assigned'), true);
  assert.equal(personalCalendarItems(data, 'me', '2026-10-17').length, 0);
});

test('les tâches datées restent sur la journée entière et les événements traversant minuit sont coupés selon chaque jour', () => {
  const taskEntry = { kind: 'task', item: task('work') } as const;
  assert.equal(personalCalendarTimeRange(taskEntry, '2026-10-12'), null);
  const allDay = { kind: 'event', item: event('all-day', { allDay: true, startTime: null, endTime: null }) } as const;
  assert.equal(personalCalendarTimeRange(allDay, '2026-10-12'), null);
  const span = { kind: 'event', item: event('span', { startDate: '2026-10-24', endDate: '2026-10-26', startTime: '22:15', endTime: '02:30' }) } as const;
  assert.deepEqual(personalCalendarTimeRange(span, '2026-10-24'), { start: 1335, end: 1440 });
  assert.deepEqual(personalCalendarTimeRange(span, '2026-10-25'), { start: 0, end: 1440 });
  assert.deepEqual(personalCalendarTimeRange(span, '2026-10-26'), { start: 0, end: 150 });
  assert.equal(personalCalendarTimeRange(span, '2026-10-27'), null);
  const data = fixture();
  data.calendarEvents = [event('ends-at-midnight', { startDate: '2026-10-24', endDate: '2026-10-25', startTime: '23:00', endTime: '00:00' })];
  assert.equal(personalCalendarItems(data, 'me', '2026-10-24').length, 1);
  assert.equal(personalCalendarItems(data, 'me', '2026-10-25').length, 0);
  const partial = { kind: 'unavailability', item: absence('partial', { allDay: false, startDate: '2026-10-25', endDate: '2026-10-25', startTime: '01:30', endTime: '04:00' }) } as const;
  assert.deepEqual(personalCalendarTimeRange(partial, '2026-10-25'), { start: 90, end: 240 });
});

test('les rendez-vous chevauchants occupent des colonnes distinctes sans confondre des horaires contigus', () => {
  const entries: PersonalCalendarItem[] = [
    { kind: 'event', item: event('a', { startTime: '09:00', endTime: '11:00' }) },
    { kind: 'event', item: event('b', { startTime: '10:00', endTime: '12:00' }) },
    { kind: 'unavailability', item: absence('partial', { allDay: false, endDate: '2026-10-12', startTime: '10:30', endTime: '11:30' }) },
    { kind: 'event', item: event('c', { startTime: '12:00', endTime: '13:00' }) },
    { kind: 'task', item: task('day-task') },
  ];
  const layout = personalTimedLayout(entries, '2026-10-12');
  assert.deepEqual(layout.map(item => [item.entry.item.id, item.lane, item.lanes]), [['a', 0, 3], ['b', 1, 3], ['partial', 2, 3], ['c', 0, 1]]);
  assert.equal(new Set(layout.map(item => item.entry.item.id)).size, 4);
});

test('la numérotation des semaines reste ISO lors des changements d’année et d’heure', () => {
  assert.equal(personalWeekNumber('2026-10-12'), 42);
  assert.equal(personalWeekNumber('2026-10-18'), 42);
  assert.equal(personalWeekNumber('2027-01-01'), 53);
  assert.equal(personalWeekNumber('2027-01-04'), 1);
  assert.equal(personalWeekNumber('2026-03-29'), 13);
  assert.equal(personalWeekNumber('2026-10-25'), 43);
});
