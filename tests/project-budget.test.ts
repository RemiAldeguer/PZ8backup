import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectBudgetMetrics } from '../shared/project-budget.ts';
import type { AppData, CostProfile, Expense, Project, Resource, Task, TimeEntry } from '../shared/types.ts';

function project(id: string, budget: number): Project {
  return { id, name: id, description: '', zoneId: 'zone', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open', weather: 5, budget, color: '#123456' };
}
function resource(id: string, profileId: string | null, active = true): Resource {
  return { id, name: id, profileId, active, jobTitle: '', type: 'human', classification: 'internal', initials: id, color: '#123456', dailyHours: 8, mondayHours: 8 };
}
function profile(id: string, dailyRate: number, eqjtHours = 8): CostProfile {
  return { id, name: id, dailyRate, eqjtHours, currency: 'EUR' };
}
function task(id: string, projectId: string, assigneeId: string | null, allocatedHours: number, progress: number): Task {
  return { id, projectId, title: id, assigneeId, allocatedHours, progress, description: '', phase: '', status: progress === 100 ? 'done' : 'in_progress', startDate: null, endDate: null, kind: 'task', tags: [], dependsOnId: null };
}
function entry(id: string, taskId: string, hours: number, rateSnapshot: number | null, eqjtSnapshot: number | null, validated = false): TimeEntry {
  return { id, taskId, resourceId: 'historical-resource', date: '2026-10-05', hours, rateSnapshot, eqjtSnapshot, validated, note: '' };
}
function expense(id: string, projectId: string, amount: number, paidDate: string | null = null): Expense {
  return { id, projectId, amount, paidDate, label: id, plannedDate: '2026-10-05', category: 'other' };
}
function empty(): AppData {
  return { zones: [], projects: [], tasks: [], resources: [], profiles: [], timeEntries: [], comments: [], expenses: [], revenues: [], calendarEvents: [], unavailabilities: [], currentUser: { id: 'admin', name: 'Admin', role: 'Administrateur' }, today: '2026-10-06' };
}
function fixture(): AppData {
  const data = empty();
  data.projects = [project('p1', 1000), { ...project('p2', 300), status: 'paused' }, project('outside', 10000)];
  data.resources = [resource('a', 'eight'), { ...resource('b', 'seven', false), type: 'virtual' }, resource('outside', 'eight')];
  data.profiles = [profile('eight', 800), profile('seven', 700, 7)];
  data.tasks = [task('a', 'p1', 'a', 8, 25), task('b', 'p1', 'b', 14, 75), { ...task('milestone', 'p1', null, 0, 100), kind: 'milestone' }, task('second', 'p2', 'b', 7, 50), task('outside', 'outside', 'outside', 1000, 100)];
  data.timeEntries = [entry('a', 'a', 4, 640, 8), entry('b', 'b', 2, 140, 7, true), entry('old-milestone', 'milestone', 1, 100, 5), entry('second', 'second', 3, 280, 7), entry('outside', 'outside', 400, 800, 8), entry('orphan', 'no-task', 400, 800, 8)];
  data.expenses = [expense('unpaid', 'p1', 200), expense('paid', 'p1', 100, '2026-10-05'), expense('second', 'p2', 50), expense('outside', 'outside', 10000, '2026-10-05')];
  return data;
}

test('les six montants utilisent les unités Eqjt et un acquis pondéré par les coûts de chaque tâche', () => {
  const data = fixture();
  assert.deepEqual(projectBudgetMetrics(data, [data.projects[0]]), {
    allocated: 1000, planned: 2500, actual: 480, plannedMargin: -1500, actualMargin: 520, earned: 1250,
    plannedMissing: 0, actualMissing: 0, earnedMissing: 0,
  });
  // (800 × 25%) + (1400 × 75%) differs from applying average progress to all costs.
  assert.notEqual(projectBudgetMetrics(data, [data.projects[0]]).earned, 2200 * 0.5);
});

test('une synthèse additionne le périmètre une fois et conserve le budget des projets interrompus', () => {
  const data = fixture();
  assert.deepEqual(projectBudgetMetrics(data, [data.projects[0], data.projects[1], data.projects[0]]), {
    allocated: 1300, planned: 3250, actual: 600, plannedMargin: -1950, actualMargin: 700, earned: 1600,
    plannedMissing: 0, actualMissing: 0, earnedMissing: 0,
  });
});

test('le réel conserve les tarifs historiques des temps validés ou non même après modification du profil', () => {
  const data = fixture();
  const before = projectBudgetMetrics(data, [data.projects[0]]);
  data.profiles = [profile('eight', 1000, 5), profile('seven', 350, 7)];
  const changed = projectBudgetMetrics(data, [data.projects[0]]);
  assert.equal(changed.planned, 2600); // 8 × 200 + 14 × 50 + 300.
  assert.equal(changed.earned, 925); // 1600 × 25% + 700 × 75%.
  assert.equal(changed.actual, before.actual);
  assert.equal(changed.actualMargin, before.actualMargin);
  data.resources = [];
  assert.equal(projectBudgetMetrics(data, [data.projects[0]]).actual, before.actual);
});

test('les dépenses ne contribuent au réel que si réglées et ne contribuent pas à l’acquis', () => {
  const data = empty();
  data.projects = [project('p1', 500)];
  data.expenses = [expense('planned', 'p1', 200), expense('paid', 'p1', 75, '2026-11-01')];
  assert.deepEqual(projectBudgetMetrics(data, data.projects), {
    allocated: 500, planned: 275, actual: 75, plannedMargin: 225, actualMargin: 425, earned: 0,
    plannedMissing: 0, actualMissing: 0, earnedMissing: 0,
  });
  data.expenses[0].paidDate = '2026-10-06';
  assert.equal(projectBudgetMetrics(data, data.projects).actual, 275);
  data.expenses[1].paidDate = null;
  assert.equal(projectBudgetMetrics(data, data.projects).actual, 200);
});

test('les tarifs absents laissent des sous-totaux connus et un progrès nul donne un acquis connu de zéro', () => {
  const data = empty();
  data.projects = [project('p1', 50)];
  data.resources = [resource('known', 'rate'), resource('unknown', null)];
  data.profiles = [profile('rate', 40)];
  data.tasks = [task('known', 'p1', 'known', 2, 50), task('unknown', 'p1', 'unknown', 8, 50), task('unassigned', 'p1', null, 8, 0), task('zero', 'p1', 'missing-resource', 0, 100)];
  data.timeEntries = [entry('known', 'known', 1, 40, 8), entry('unknown', 'unknown', 2, null, null), entry('legacy-zero', 'unknown', 0, null, 8)];
  data.expenses = [expense('paid', 'p1', 20, '2026-10-05'), expense('planned', 'p1', 10)];
  assert.deepEqual(projectBudgetMetrics(data, data.projects), {
    allocated: 50, planned: 40, actual: 25, plannedMargin: 10, actualMargin: 25, earned: 5,
    plannedMissing: 2, actualMissing: 2, earnedMissing: 1,
  });
  data.tasks.find(item => item.id === 'unknown')!.progress = 0;
  assert.equal(projectBudgetMetrics(data, data.projects).earnedMissing, 0);
  assert.equal(projectBudgetMetrics(data, data.projects).plannedMissing, 2);
});

test('un tarif nul connu ne devient pas un coût manquant et un dépassement réel conserve sa marge négative', () => {
  const data = empty();
  data.projects = [project('p1', 10)];
  data.resources = [resource('free', 'free')];
  data.profiles = [profile('free', 0, 7)];
  data.tasks = [task('free', 'p1', 'free', 500, 75)];
  data.timeEntries = [entry('free', 'free', 500, 0, 7), entry('old', 'free', 2, 80, 8)];
  assert.deepEqual(projectBudgetMetrics(data, data.projects), {
    allocated: 10, planned: 0, actual: 20, plannedMargin: 10, actualMargin: -10, earned: 0,
    plannedMissing: 0, actualMissing: 0, earnedMissing: 0,
  });
});

test('les décimales sont additionnées avant affichage, sans arrondir les sous-totaux de projet', () => {
  const data = empty();
  data.projects = [project('a', 0.1), project('b', 0.2)];
  data.resources = [resource('r', 'rate')];
  data.profiles = [profile('rate', 1, 3)];
  data.tasks = [task('a', 'a', 'r', 0.01, 50), task('b', 'b', 'r', 0.02, 50)];
  data.timeEntries = [entry('a', 'a', 0.1, 1, 3), entry('b', 'b', 0.2, 1, 3)];
  const metrics = projectBudgetMetrics(data, data.projects);
  assert.equal(metrics.allocated, 0.3);
  assert.equal(metrics.planned, 0.01);
  assert.equal(metrics.actual, 0.1);
  assert.equal(metrics.earned, 0.005);
  assert.equal(metrics.plannedMargin, 0.29);
  assert.equal(metrics.actualMargin, 0.2);
});

test('un périmètre vide ne retient aucun coût et le calcul ne modifie pas les données', () => {
  const data = fixture();
  const before = structuredClone(data);
  assert.deepEqual(projectBudgetMetrics(data, []), {
    allocated: 0, planned: 0, actual: 0, plannedMargin: 0, actualMargin: 0, earned: 0,
    plannedMissing: 0, actualMissing: 0, earnedMissing: 0,
  });
  projectBudgetMetrics(data, data.projects);
  assert.deepEqual(data, before);
});

test('des écarts flottants infimes ne produisent pas une marge de moins zéro', () => {
  const data = empty();
  data.projects = [project('p1', 0.3)];
  data.resources = [resource('r', 'rate')];
  data.profiles = [profile('rate', 1, 1)];
  data.tasks = [task('a', 'p1', 'r', 0.1, 100), task('b', 'p1', 'r', 0.2, 100)];
  data.timeEntries = [entry('a', 'a', 0.1, 1, 1), entry('b', 'b', 0.2, 1, 1)];
  const metrics = projectBudgetMetrics(data, data.projects);
  assert.equal(metrics.planned, 0.3);
  assert.equal(metrics.actual, 0.3);
  assert.equal(metrics.plannedMargin, 0);
  assert.equal(metrics.actualMargin, 0);
  assert.equal(Object.is(metrics.plannedMargin, -0), false);
  assert.equal(Object.is(metrics.actualMargin, -0), false);
});
