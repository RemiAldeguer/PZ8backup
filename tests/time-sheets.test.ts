import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addCalendarDays, buildTimeSheet, mondayOfWeek, projectTimeResources, weekDates, type TimeSheetRow } from '../shared/time-sheets.ts';
import type { AppData, Project, Resource, Task, TimeEntry } from '../shared/types.ts';

function project(id: string, status: Project['status'] = 'open'): Project {
  return { id, name: `Projet ${id}`, description: '', zoneId: 'zone', startDate: '2026-01-01', endDate: '2026-12-31', status, weather: 5, budget: 0, color: '#123456' };
}
function resource(id: string, active = true, projectIds: string[] = []): Resource {
  return { id, name: `Ressource ${id}`, jobTitle: 'Métier', type: 'human', classification: 'internal', initials: id, color: '#123456', dailyHours: 8, mondayHours: 8, profileId: null, active, projectIds };
}
function task(id: string, projectId: string, assigneeId: string | null, allocatedHours: number, phase = 'Préparation', status: Task['status'] = 'todo'): Task {
  return { id, projectId, title: `Tâche ${id}`, description: '', assigneeId, allocatedHours, phase, status, progress: 0, startDate: null, endDate: null, kind: 'task', tags: [], dependsOnId: null };
}
function entry(id: string, taskId: string, resourceId: string, date: string, hours: number, validated = false): TimeEntry {
  return { id, taskId, resourceId, date, hours, validated, note: '', rateSnapshot: 600, eqjtSnapshot: 8 };
}
function fixture(): AppData {
  return {
    zones: [], profiles: [], comments: [], expenses: [], revenues: [], calendarEvents: [], unavailabilities: [], today: '2026-10-06',
    currentUser: { id: 'r1', name: 'Administrateur', role: 'Administrateur' },
    projects: [project('p1'), project('p2', 'closed'), project('p3', 'paused')],
    resources: [resource('r1', true, ['p3']), resource('r2'), resource('r3', false)],
    tasks: [task('t1', 'p1', 'r1', 10), task('t2', 'p1', 'r2', 20), task('t3', 'p2', 'r1', 8, '', 'done'), task('t4', 'p1', null, 40, 'Exécution'), task('t5', 'p1', 'r3', 5), { ...task('m1', 'p1', 'r1', 0), kind: 'milestone' }],
    timeEntries: [
      entry('e1', 't1', 'r1', '2026-10-05', 0.1, true),
      entry('e2', 't1', 'r1', '2026-10-05', 0.2),
      entry('e3', 't1', 'r1', '2026-10-02', 3, true),
      entry('e4', 't1', 'r2', '2026-10-06', 2, true),
      entry('e5', 't2', 'r1', '2026-10-06', 4),
      entry('e6', 't2', 'r2', '2026-10-07', 6),
      entry('e7', 't3', 'r1', '2026-10-09', 1, true),
      entry('e8', 't4', 'r1', '2026-10-11', 7),
      entry('e9', 't5', 'r3', '2026-10-05', 2, true),
      entry('orphan', 'missing-task', 'r1', '2026-10-05', 20),
      entry('milestone', 'm1', 'r1', '2026-10-05', 20),
    ],
  };
}
const options = { weekStart: '2026-10-05' };
function descendants(rows: TimeSheetRow[]): TimeSheetRow[] { return rows.flatMap(row => [row, ...descendants(row.children)]); }

test('la semaine couvre les changements de mois, d’année et d’heure sans décaler les dates', () => {
  assert.equal(mondayOfWeek('2027-01-01'), '2026-12-28');
  assert.deepEqual(weekDates('2027-01-03'), ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
  assert.deepEqual(weekDates('2026-03-29'), ['2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27', '2026-03-28', '2026-03-29']);
  assert.equal(addCalendarDays('2026-03-28', 2), '2026-03-30');
  assert.equal(addCalendarDays('2026-10-25', -1), '2026-10-24');
  assert.equal(addCalendarDays('2024-02-28', 1), '2024-02-29');
  assert.equal(mondayOfWeek('2026-10-05'), '2026-10-05');
});

test('les dates impossibles et les décalages non entiers sont refusés', () => {
  for (const date of ['2026-02-30', '2026-13-01', '2026-1-01', '2026-10-05T00:00:00Z', '']) {
    assert.throws(() => weekDates(date), RangeError);
  }
  assert.throws(() => addCalendarDays('2026-10-05', 0.5), RangeError);
});

test('les totaux séparent le passé global de la semaine et additionnent plusieurs saisies sans erreur décimale', () => {
  const [alice, bob] = buildTimeSheet(fixture(), options);
  assert.deepEqual({ allocated: alice.allocated, spent: alice.spent, weekSpent: alice.weekSpent, remaining: alice.remaining }, { allocated: 18, spent: 15.3, weekSpent: 12.3, remaining: 2.7 });
  assert.deepEqual(alice.days, [0.3, 4, 0, 0, 1, 0, 7]);
  assert.deepEqual(bob.days, [0, 2, 6, 0, 0, 0, 0]);
  const cadrage = descendants([alice]).find(row => row.taskId === 't1')!;
  assert.equal(cadrage.days[0], 0.3);
  assert.equal(cadrage.spent, 3.3);
  assert.equal(cadrage.weekSpent, 0.3);
  assert.deepEqual(cadrage.entries.map(item => item.id), ['e1', 'e2', 'e3']);
});

test('les fractions autorisées par l’API sont additionnées avant l’arrondi d’affichage', () => {
  const data = fixture();
  data.projects = [project('p1')];
  data.resources = [resource('r1')];
  data.tasks = [task('t1', 'p1', 'r1', 0.015), task('t2', 'p1', 'r1', 0.015, 'Exécution')];
  data.timeEntries = [
    entry('e1', 't1', 'r1', '2026-10-05', 0.015),
    entry('e2', 't1', 'r1', '2026-10-05', 0.015),
    entry('e3', 't2', 'r1', '2026-10-05', 0.015),
  ];
  const [row] = buildTimeSheet(data, options);
  const first = descendants([row]).find(item => item.taskId === 't1')!;
  assert.equal(first.spent, 0.03);
  assert.equal(first.days[0], 0.03);
  assert.equal(first.allocated, 0.015);
  assert.equal(first.remaining, -0.015);
  assert.equal(row.allocated, 0.03);
  assert.equal(row.spent, 0.045);
  assert.equal(row.weekSpent, 0.045);
  assert.equal(row.days[0], 0.045);
  assert.equal(row.remaining, -0.015);
});

test('la réaffectation conserve le temps de son auteur et ne duplique jamais l’allocation', () => {
  const rows = buildTimeSheet(fixture(), options);
  const leaves = descendants(rows).filter(row => row.kind === 'task');
  const former = leaves.find(row => row.taskId === 't2' && row.resourceId === 'r1')!;
  const current = leaves.find(row => row.taskId === 't2' && row.resourceId === 'r2')!;
  assert.deepEqual({ allocated: former.allocated, spent: former.spent, remaining: former.remaining }, { allocated: 0, spent: 4, remaining: -4 });
  assert.deepEqual({ allocated: current.allocated, spent: current.spent, remaining: current.remaining }, { allocated: 20, spent: 6, remaining: 14 });
  assert.equal(rows.reduce((sum, row) => sum + row.allocated, 0), 38);
  assert.equal(leaves.reduce((sum, row) => sum + row.allocated, 0), 38);
  const ids = rows.flatMap(row => row.entries.map(item => item.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 8);
});

test('les tâches sans affectation gardent les temps saisis sans distribuer leur budget à chaque ressource', () => {
  const rows = buildTimeSheet(fixture(), options);
  const unassigned = descendants(rows).find(row => row.taskId === 't4')!;
  assert.equal(unassigned.allocated, 0);
  assert.equal(unassigned.spent, 7);
  assert.equal(unassigned.remaining, -7);
  assert.equal(descendants(rows).filter(row => row.taskId === 't4').length, 1);
});

test('le filtre de validation agit sur les saisies, sans changer l’allocation ni effacer les branches historiques', () => {
  const data = fixture();
  const [validatedAlice, validatedBob] = buildTimeSheet(data, { ...options, validation: 'validated' });
  const [pendingAlice, pendingBob] = buildTimeSheet(data, { ...options, validation: 'pending' });
  assert.equal(validatedAlice.allocated, 18);
  assert.equal(pendingAlice.allocated, 18);
  assert.equal(validatedAlice.spent, 4.1);
  assert.equal(validatedAlice.weekSpent, 1.1);
  assert.equal(pendingAlice.spent, 11.2);
  assert.equal(pendingAlice.weekSpent, 11.2);
  assert.equal(validatedBob.spent, 2);
  assert.equal(pendingBob.spent, 6);
  assert.ok(validatedAlice.entries.every(item => item.validated));
  assert.ok(pendingAlice.entries.every(item => !item.validated));
  const emptyHistorical = descendants([validatedAlice]).find(row => row.taskId === 't2')!;
  assert.equal(emptyHistorical.spent, 0);
  assert.equal(emptyHistorical.allocated, 0);
});

test('les filtres de projet, statut et fin de tâche ne laissent pas passer de temps d’un autre périmètre', () => {
  const data = fixture();
  const [openAlice] = buildTimeSheet(data, { ...options, projectStatuses: ['open'] });
  assert.equal(openAlice.allocated, 10);
  assert.equal(openAlice.spent, 14.3);
  assert.ok(openAlice.children.every(row => row.projectId === 'p1'));
  const [closedAlice] = buildTimeSheet(data, { ...options, projectId: 'p2' });
  assert.equal(closedAlice.allocated, 8);
  assert.equal(closedAlice.spent, 1);
  const [unfinishedAlice] = buildTimeSheet(data, { ...options, includeFinished: false });
  assert.equal(unfinishedAlice.allocated, 10);
  assert.equal(unfinishedAlice.spent, 14.3);
  assert.ok(!descendants([unfinishedAlice]).some(row => row.taskId === 't3'));
  assert.ok(buildTimeSheet(data, { ...options, projectStatuses: [] }).every(row => row.children.length === 0 && row.spent === 0));
});

test('les ressources inactives restent consultables sur demande et les ressources actives sans saisie restent présentes', () => {
  const data = fixture();
  data.resources.push(resource('r4'));
  assert.deepEqual(buildTimeSheet(data, options).map(row => row.resourceId), ['r1', 'r2', 'r4']);
  const inactive = buildTimeSheet(data, { ...options, includeInactive: true, resourceId: 'r3' });
  assert.equal(inactive.length, 1);
  assert.equal(inactive[0].allocated, 5);
  assert.equal(inactive[0].spent, 2);
  assert.deepEqual(buildTimeSheet(data, { ...options, resourceId: 'r3' }), []);
  const [empty] = buildTimeSheet(data, { ...options, resourceId: 'r4' });
  assert.equal(empty.allocated, 0);
  assert.deepEqual(empty.days, [0, 0, 0, 0, 0, 0, 0]);
});

test('une appartenance explicite au projet conserve une branche vide et les phases manquantes restent lisibles', () => {
  const [alice] = buildTimeSheet(fixture(), options);
  const emptyProject = alice.children.find(row => row.projectId === 'p3')!;
  assert.equal(emptyProject.label, 'Projet p3');
  assert.deepEqual(emptyProject.children, []);
  assert.equal(emptyProject.spent, 0);
  assert.equal(alice.children.find(row => row.projectId === 'p2')!.children[0].label, 'Sans phase');
});

test('chaque parent correspond exactement à ses feuilles et les jalons et saisies orphelines sont exclus', () => {
  const rows = buildTimeSheet(fixture(), { ...options, includeInactive: true });
  for (const row of descendants(rows).filter(row => row.children.length)) {
    const leaves = descendants(row.children).filter(child => child.kind === 'task');
    const rounded = (values: number[]) => Math.round(values.reduce((sum, value) => sum + value, 0) * 100) / 100;
    assert.equal(row.allocated, rounded(leaves.map(leaf => leaf.allocated)));
    assert.equal(row.spent, rounded(leaves.map(leaf => leaf.spent)));
    assert.deepEqual(row.days, Array.from({ length: 7 }, (_, index) => rounded(leaves.map(leaf => leaf.days[index]))));
  }
  assert.ok(!descendants(rows).some(row => row.taskId === 'm1'));
  assert.ok(rows.every(row => row.entries.every(item => !['orphan', 'milestone'].includes(item.id))));
});

test('la consultation d’une autre semaine garde allocations et passé global sans modifier les données', () => {
  const data = fixture();
  const before = JSON.stringify(data);
  const [previousAlice] = buildTimeSheet(data, { ...options, weekStart: '2026-10-02', resourceId: 'r1' });
  assert.equal(previousAlice.allocated, 18);
  assert.equal(previousAlice.spent, 15.3);
  assert.equal(previousAlice.weekSpent, 3);
  assert.deepEqual(previousAlice.days, [0, 0, 0, 0, 3, 0, 0]);
  assert.equal(JSON.stringify(data), before);
});

test('le suivi projet inclut les membres explicites, affectés et historiques, et exclut les ressources étrangères', () => {
  const data = fixture();
  data.resources = [resource('explicit', true, ['p1']), resource('assigned'), resource('milestone'), resource('historical'), resource('inactive-history', false), resource('foreign', true, ['p2']), resource('orphan')];
  data.tasks = [task('project-task', 'p1', 'assigned', 10), { ...task('project-milestone', 'p1', 'milestone', 99), kind: 'milestone' }, task('foreign-task', 'p2', 'foreign', 50)];
  data.timeEntries = [entry('old-work', 'project-task', 'historical', '2026-10-02', 3), entry('inactive-work', 'project-task', 'inactive-history', '2026-10-06', 2), entry('foreign-work', 'foreign-task', 'foreign', '2026-10-06', 20), entry('orphan-work', 'missing-task', 'orphan', '2026-10-06', 100)];
  const before = JSON.stringify(data);
  assert.deepEqual(projectTimeResources(data, 'p1').map(item => item.id), ['explicit', 'assigned', 'milestone', 'historical', 'inactive-history']);
  const rows = buildTimeSheet(data, { ...options, projectId: 'p1', includeInactive: true });
  assert.deepEqual(rows.map(row => row.resourceId), ['explicit', 'assigned', 'milestone', 'historical', 'inactive-history']);
  assert.ok(rows.every(row => row.children.length === 1 && row.children[0].projectId === 'p1'));
  assert.equal(rows.find(row => row.resourceId === 'explicit')!.children[0].children.length, 0);
  const milestone = rows.find(row => row.resourceId === 'milestone')!;
  assert.equal(milestone.allocated, 0);
  assert.deepEqual(milestone.children[0].children, []);
  assert.ok(!descendants(rows).some(row => row.taskId === 'project-milestone'));
  assert.equal(rows.reduce((sum, row) => sum + row.allocated, 0), 10);
  assert.equal(rows.reduce((sum, row) => sum + row.spent, 0), 5);
  assert.equal(rows.reduce((sum, row) => sum + row.weekSpent, 0), 2);
  assert.equal(rows.find(row => row.resourceId === 'inactive-history')!.remaining, -2);
  assert.equal(JSON.stringify(data), before);
});

test('la réaffectation du projet garde son auteur historique sans déplacer ni dupliquer son temps', () => {
  const data = fixture();
  data.resources = [resource('former', false), resource('current'), resource('outside')];
  data.tasks = [task('reassigned', 'p1', 'current', 12)];
  data.timeEntries = [entry('former-work', 'reassigned', 'former', '2026-10-05', 4, true), entry('current-work', 'reassigned', 'current', '2026-10-06', 2)];
  const rows = buildTimeSheet(data, { ...options, projectId: 'p1', includeInactive: true });
  const [former, current] = rows;
  assert.deepEqual({ allocated: former.allocated, spent: former.spent, remaining: former.remaining }, { allocated: 0, spent: 4, remaining: -4 });
  assert.deepEqual({ allocated: current.allocated, spent: current.spent, remaining: current.remaining }, { allocated: 12, spent: 2, remaining: 10 });
  assert.equal(rows.reduce((sum, row) => sum + row.allocated, 0), 12);
  assert.deepEqual(rows.flatMap(row => row.entries.map(item => item.id)), ['former-work', 'current-work']);
  assert.deepEqual(buildTimeSheet(data, { ...options, projectId: 'p1' }).map(row => row.resourceId), ['current']);
  const onlyFormer = buildTimeSheet(data, { ...options, projectId: 'p1', resourceId: 'former', includeInactive: true, validation: 'pending' });
  assert.equal(onlyFormer.length, 1);
  assert.equal(onlyFormer[0].spent, 0);
  assert.equal(onlyFormer[0].children[0].children[0].children[0].allocated, 0);
  assert.deepEqual(buildTimeSheet(data, { ...options, projectId: 'p1', resourceId: 'outside', includeInactive: true }), []);
});

test('les filtres du projet ne suppriment pas l’appartenance et n’inventent pas de temps sur une branche vide', () => {
  const data = fixture();
  data.resources = [resource('completed-owner'), resource('old-worker', false), resource('explicit', true, ['p1']), resource('outside')];
  data.tasks = [task('complete', 'p1', 'completed-owner', 20, '', 'done')];
  data.timeEntries = [entry('old-complete', 'complete', 'old-worker', '2026-10-25', 5, true)];
  const hiddenComplete = buildTimeSheet(data, { ...options, projectId: 'p1', includeInactive: true, includeFinished: false, validation: 'pending' });
  assert.deepEqual(hiddenComplete.map(row => row.resourceId), ['completed-owner', 'old-worker', 'explicit']);
  assert.ok(hiddenComplete.every(row => row.spent === 0 && row.allocated === 0 && row.children.length === 1));
  const autumnRows = buildTimeSheet(data, { ...options, projectId: 'p1', weekStart: '2026-10-25', includeInactive: true });
  assert.deepEqual(autumnRows.find(row => row.resourceId === 'old-worker')!.days, [0, 0, 0, 0, 0, 0, 5]);
  assert.equal(autumnRows.reduce((sum, row) => sum + row.spent, 0), 5);
  assert.deepEqual(buildTimeSheet(data, { ...options, projectId: 'p1', projectStatuses: ['closed'], includeInactive: true }), []);
  assert.deepEqual(buildTimeSheet(data, { ...options, projectId: 'unknown', includeInactive: true }), []);
  assert.deepEqual(projectTimeResources(data, 'unknown'), []);
  assert.ok(buildTimeSheet(data, { ...options, includeInactive: true }).some(row => row.resourceId === 'outside' && row.children.length === 0));
});
