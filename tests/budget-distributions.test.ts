import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectBudgetOverview } from '../shared/budget-distributions.ts';
import { projectBudgetMetrics } from '../shared/project-budget.ts';
import type { AppData, CostProfile, Expense, Project, Resource, Revenue, Task, TimeEntry } from '../shared/types.ts';

function project(id: string, status: Project['status'] = 'open'): Project {
  return { id, name: id, description: '', zoneId: 'zone', startDate: '2026-01-01', endDate: '2026-12-31', status, weather: 5, budget: 2500, color: '#123456' };
}
function profile(id: string, dailyRate: number, eqjtHours = 8): CostProfile {
  return { id, name: id, dailyRate, eqjtHours, currency: 'EUR' };
}
function resource(id: string, profileId: string | null, type: Resource['type'] = 'human', classification: Resource['classification'] = 'internal'): Resource {
  return { id, name: id, profileId, type, classification, active: true, jobTitle: '', initials: id, color: '#123456', dailyHours: 8, mondayHours: 8 };
}
function task(id: string, assigneeId: string | null, allocatedHours: number, progress: number, projectId = 'p1'): Task {
  return { id, assigneeId, allocatedHours, progress, projectId, title: id, description: '', phase: '', status: progress === 100 ? 'done' : 'in_progress', startDate: null, endDate: null, kind: 'task', tags: [], dependsOnId: null };
}
function entry(id: string, taskId: string, resourceId: string, hours: number, rateSnapshot: number | null, eqjtSnapshot: number | null, validated = false): TimeEntry {
  return { id, taskId, resourceId, hours, rateSnapshot, eqjtSnapshot, validated, date: '2026-10-05', note: '' };
}
function expense(id: string, category: Expense['category'], amount: number, paidDate: string | null = null, projectId = 'p1'): Expense {
  return { id, category, amount, paidDate, projectId, label: id, plannedDate: '2026-10-05' };
}
function revenue(id: string, amount: number, receivedDate: string | null = null, projectId = 'p1'): Revenue {
  return { id, amount, receivedDate, projectId, label: id, plannedDate: '2026-11-01', category: 'services' };
}
function empty(): AppData {
  return { zones: [], projects: [], tasks: [], resources: [], profiles: [], timeEntries: [], comments: [], expenses: [], revenues: [], calendarEvents: [], unavailabilities: [], currentUser: { id: 'admin', name: 'Admin', role: 'Administrateur' }, today: '2026-10-12' };
}
function fixture(): AppData {
  const data = empty();
  data.projects = [project('p1'), project('p2', 'paused')];
  data.profiles = [profile('eight', 800), profile('seven', 70, 7)];
  data.resources = [
    resource('internal', 'eight'), resource('external', 'seven', 'human', 'external'),
    resource('material', 'eight', 'material', 'external'), resource('virtual', 'seven', 'virtual'),
    resource('uncosted', null),
  ];
  data.tasks = [
    task('internal', 'internal', 8, 50), task('external', 'external', 14, 25),
    task('material', 'material', 2, 100), task('virtual', 'virtual', 7, 0),
    task('uncosted', 'uncosted', 8, 50), task('unassigned', null, 4, 0),
    task('outside', 'internal', 800, 100, 'p2'),
  ];
  data.timeEntries = [
    // Recorded resources intentionally differ from the tasks' current assignees.
    entry('external', 'internal', 'external', 2, 56, 7),
    entry('internal', 'external', 'internal', 3, 80, 8, true),
    entry('material', 'material', 'material', 1, 200, 5),
    entry('virtual', 'virtual', 'virtual', 0.5, 70, 7),
    entry('historical-resource', 'uncosted', 'removed-resource', 4, 40, 8),
    entry('missing', 'uncosted', 'internal', 2, null, null),
    entry('outside', 'outside', 'internal', 800, 800, 8),
    entry('orphan-task', 'removed-task', 'internal', 800, 800, 8),
  ];
  data.expenses = [
    expense('software', 'software', 20), expense('training', 'training', 10, '2026-10-05'),
    expense('legal', 'legal', 30, '2026-10-05'), expense('supplies', 'supplies', 25),
    expense('equipment', 'equipment', 5, '2026-10-05'), expense('other', 'other', 0),
    expense('outside', 'software', 10000, '2026-10-05', 'p2'),
  ];
  data.revenues = [revenue('forecast', 1500), revenue('received', 300, '2026-10-01'), revenue('outside', 10000, '2026-10-01', 'p2')];
  return data;
}
function precise(value: number): number { return Number(value.toFixed(12)); }

test('les répartitions conservent les coûts et les compteurs du budget existant', () => {
  const data = fixture();
  const overview = projectBudgetOverview(data, 'p1');
  assert.deepEqual(overview.metrics, projectBudgetMetrics(data, [data.projects[0]]));
  assert.deepEqual(overview.resourceCosts, { planned: 1210, actual: 111, earned: 635, plannedMissing: 2, actualMissing: 1, earnedMissing: 1 });
  assert.deepEqual(overview.expenseCosts, { planned: 90, actual: 45 });
  assert.equal(overview.resourceCosts.planned + overview.expenseCosts.planned, overview.metrics.planned);
  assert.equal(overview.resourceCosts.actual + overview.expenseCosts.actual, overview.metrics.actual);
  for (const key of ['planned', 'actual', 'earned', 'plannedMissing', 'actualMissing', 'earnedMissing'] as const) {
    assert.equal(precise(overview.resourceTypes.reduce((sum, group) => sum + group[key], 0)), overview.resourceCosts[key]);
  }
  for (const key of ['planned', 'actual'] as const) {
    assert.equal(precise(overview.expenseTypes.reduce((sum, group) => sum + group[key], 0)), overview.expenseCosts[key]);
  }
  assert.deepEqual(overview.resourceTypes.map(group => group.key), ['external', 'internal', 'material', 'virtual', 'unclassified']);
});

test('le planifié suit la tâche affectée et le réel suit la ressource qui a saisi les temps', () => {
  const overview = projectBudgetOverview(fixture(), 'p1');
  assert.deepEqual(overview.resourceTypes.map(({ key, planned, actual, earned }) => ({ key, planned, actual, earned })), [
    { key: 'external', planned: 140, actual: 16, earned: 35 },
    { key: 'internal', planned: 800, actual: 30, earned: 400 },
    { key: 'material', planned: 200, actual: 40, earned: 200 },
    { key: 'virtual', planned: 70, actual: 5, earned: 0 },
    { key: 'unclassified', planned: 0, actual: 20, earned: 0 },
  ]);
  assert.equal(overview.resourceTypes.find(group => group.key === 'internal')!.actualMissing, 1);
  assert.equal(overview.resourceTypes.find(group => group.key === 'unclassified')!.plannedMissing, 1);
  assert.equal(overview.resourceTypes.find(group => group.key === 'unclassified')!.actualMissing, 0);
});

test('les tarifs historiques restent acquis quand le profil, le classement ou l’affectation changent', () => {
  const data = fixture();
  const before = projectBudgetOverview(data, 'p1');
  data.profiles = [profile('eight', 400, 4), profile('seven', 1000, 5)];
  data.resources[1].classification = 'internal';
  data.resources[1].active = false;
  data.tasks[0].assigneeId = 'virtual';
  const after = projectBudgetOverview(data, 'p1');
  assert.equal(after.resourceCosts.actual, before.resourceCosts.actual);
  assert.equal(after.resourceTypes.find(group => group.key === 'external')!.actual, 0);
  assert.equal(after.resourceTypes.find(group => group.key === 'internal')!.actual, 46);
  assert.equal(after.resourceTypes.find(group => group.key === 'virtual')!.planned, 3000);
  assert.equal(after.resourceTypes.find(group => group.key === 'material')!.actual, 40);
  assert.equal(after.resourceTypes.find(group => group.key === 'unclassified')!.actual, 20);
});

test('six catégories de dépenses distinguent les sommes prévues et réglées sans les compter dans l’acquis', () => {
  const overview = projectBudgetOverview(fixture(), 'p1');
  assert.deepEqual(overview.expenseTypes.map(({ key, planned, actual }) => ({ key, planned, actual })), [
    { key: 'software', planned: 20, actual: 0 }, { key: 'training', planned: 10, actual: 10 },
    { key: 'equipment', planned: 5, actual: 5 }, { key: 'supplies', planned: 25, actual: 0 },
    { key: 'legal', planned: 30, actual: 30 }, { key: 'other', planned: 0, actual: 0 },
  ]);
  assert.equal(overview.metrics.earned, overview.resourceCosts.earned);
  const data = fixture();
  data.expenses.find(item => item.id === 'software')!.paidDate = '2026-10-12';
  const paid = projectBudgetOverview(data, 'p1');
  assert.equal(paid.expenseCosts.actual, 65);
  assert.equal(paid.metrics.actual - overview.metrics.actual, 20);
  assert.equal(paid.metrics.earned, overview.metrics.earned);
});

test('les recettes restent séparées de l’enveloppe allouée et leurs résultats retirent les coûts du projet', () => {
  const data = fixture();
  const overview = projectBudgetOverview(data, 'p1');
  assert.deepEqual(overview.revenues, { planned: 1800, received: 300, pending: 1500, plannedResult: 500, actualResult: 144 });
  assert.equal(overview.metrics.allocated, 2500);
  const unchanged = structuredClone(overview.metrics);
  data.revenues[0].receivedDate = '2026-09-01'; // An early receipt is valid and counts once.
  const received = projectBudgetOverview(data, 'p1');
  assert.deepEqual(received.metrics, unchanged);
  assert.deepEqual(received.revenues, { planned: 1800, received: 1800, pending: 0, plannedResult: 500, actualResult: 1644 });
  data.projects[0].status = 'closed';
  assert.deepEqual(projectBudgetOverview(data, 'p1').revenues, received.revenues);
});

test('un tarif gratuit connu ne devient pas manquant et les absences de tarif restent localisées', () => {
  const data = empty();
  data.projects = [project('p1')];
  data.resources = [resource('free', 'free', 'material'), resource('missing', null, 'virtual')];
  data.profiles = [profile('free', 0, 7)];
  data.tasks = [task('free', 'free', 999, 100), task('missing', 'missing', 2, 50), task('zero', null, 0, 100)];
  data.timeEntries = [entry('free', 'free', 'free', 999, 0, 7), entry('missing', 'missing', 'missing', 1, null, 7), entry('legacy-zero', 'missing', 'missing', 0, null, null)];
  const overview = projectBudgetOverview(data, 'p1');
  const material = overview.resourceTypes.find(group => group.key === 'material')!;
  const virtual = overview.resourceTypes.find(group => group.key === 'virtual')!;
  assert.equal(material.planned, 0);
  assert.equal(material.actual, 0);
  assert.equal(material.plannedMissing, 0);
  assert.equal(material.actualMissing, 0);
  assert.equal(virtual.plannedMissing, 1);
  assert.equal(virtual.actualMissing, 2);
  assert.equal(virtual.earnedMissing, 1);
  assert.equal(overview.metrics.plannedMissing, 1);
});

test('les fractions et décimales conservent les agrégats après répartition sans arrondir aux centimes', () => {
  const data = empty();
  data.projects = [project('p1')];
  data.profiles = [profile('thirds', 1, 3)];
  data.resources = [resource('internal', 'thirds'), resource('external', 'thirds', 'human', 'external'), resource('material', 'thirds', 'material')];
  data.tasks = data.resources.map(item => task(item.id, item.id, 1, 50));
  data.timeEntries = data.resources.map(item => entry(item.id, item.id, item.id, 1, 1, 3));
  data.expenses = [expense('software', 'software', 0.1), expense('legal', 'legal', 0.2)];
  data.revenues = [revenue('a', 0.1), revenue('b', 0.2)];
  const overview = projectBudgetOverview(data, 'p1');
  assert.equal(overview.metrics.planned, 1.3);
  assert.equal(overview.resourceCosts.planned, 1);
  assert.equal(overview.revenues.planned, 0.3);
  assert.equal(overview.revenues.plannedResult, -1);
  assert.equal(overview.resourceCosts.earned, 0.5);
  for (const key of ['planned', 'actual', 'earned'] as const) {
    assert.equal(precise(overview.resourceTypes.reduce((sum, group) => sum + group[key], 0)), overview.resourceCosts[key]);
  }
  assert.equal(overview.expenseTypes.find(group => group.key === 'software')!.planned, 0.1);
  assert.equal(overview.expenseTypes.find(group => group.key === 'legal')!.planned, 0.2);
});

test('le calcul ne modifie pas les données, les collections historiques absentes valent zéro et un projet absent est vide', () => {
  const data = fixture();
  const before = structuredClone(data);
  projectBudgetOverview(data, 'p1');
  assert.deepEqual(data, before);
  const missing = projectBudgetOverview(data, 'no-project');
  assert.equal(missing.metrics.planned, 0);
  assert.equal(missing.revenues.planned, 0);
  assert.ok(missing.resourceTypes.every(group => group.planned === 0 && group.actual === 0 && group.earned === 0));
  assert.ok(missing.expenseTypes.every(group => group.planned === 0 && group.actual === 0));
  const legacy = { ...data } as AppData & { revenues?: Revenue[] };
  delete (legacy as Partial<AppData>).revenues;
  assert.deepEqual(projectBudgetOverview(legacy, 'p1').revenues, { planned: 0, received: 0, pending: 0, plannedResult: -1300, actualResult: -156 });
});
