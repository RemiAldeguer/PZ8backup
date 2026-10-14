import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectAssignedResources, projectTaskTags, projectZoneMetrics } from '../shared/zone-projects.ts';
import type { AppData, Project, Resource, Task, TimeEntry } from '../shared/types.ts';

function project(id: string, weather = 5, status: Project['status'] = 'open'): Project {
  return { id, name: id, description: '', zoneId: 'zone', startDate: '2026-01-01', endDate: '2026-12-31', status, weather, budget: 0, color: '#123456' };
}
function task(id: string, projectId: string, allocatedHours = 0, progress = 0, endDate: string | null = null): Task {
  return { id, projectId, title: id, description: '', phase: '', status: progress === 100 ? 'done' : 'todo', progress, assigneeId: null, startDate: null, endDate, allocatedHours, kind: 'task', tags: [], dependsOnId: null };
}
function entry(id: string, taskId: string, hours: number): TimeEntry {
  return { id, taskId, resourceId: 'r1', date: '2026-01-01', hours, note: '', validated: false, rateSnapshot: null, eqjtSnapshot: null };
}
function resource(id: string, active = true): Resource {
  return { id, name: id, jobTitle: '', type: 'human', classification: 'internal', initials: id, color: '#123456', dailyHours: 8, mondayHours: 8, profileId: null, active };
}
function fixture(): AppData {
  return {
    zones: [], projects: [], tasks: [], resources: [], profiles: [], timeEntries: [], comments: [], expenses: [], revenues: [], calendarEvents: [], unavailabilities: [],
    currentUser: { id: 'admin', name: 'Administrateur', role: 'Administrateur' }, today: '2026-10-06',
  };
}

test('la synthèse pondère toutes les tâches du périmètre et conserve les projets interrompus ou clos', () => {
  const data = fixture();
  data.projects = [project('p1', 5, 'closed'), project('p2', 1, 'paused'), project('other', 1)];
  data.tasks = [task('done', 'p1', 20, 100, '2026-10-01'), task('late', 'p2', 80, 50, '2026-10-05'), task('outside', 'other', 900, 0, '2026-01-01')];
  const metrics = projectZoneMetrics(data, data.projects.slice(0, 2));
  assert.deepEqual(metrics, {
    allocatedHours: 100, spentHours: 0, remainingHours: 100, realizedPercent: 60, latePercent: 40, openPercent: 0,
    weather: 3, totalTasks: 2, completedTasks: 1, overdueTasks: 1, activityBasis: 'allocated_hours',
  });
});

test('les saisies sont comptées une fois, y compris celles des jalons, et restent limitées aux projets affichés', () => {
  const data = fixture();
  data.projects = [project('p1'), project('p2')];
  data.tasks = [task('work', 'p1', 10), { ...task('milestone', 'p1', 500, 100), kind: 'milestone' }, task('outside', 'p2', 300)];
  data.timeEntries = [entry('e1', 'work', 8), entry('e2', 'work', 9), entry('e3', 'milestone', 2), entry('e4', 'outside', 200), entry('orphan', 'missing', 300)];
  const metrics = projectZoneMetrics(data, [data.projects[0]]);
  assert.equal(metrics.allocatedHours, 10);
  assert.equal(metrics.spentHours, 19);
  assert.equal(metrics.remainingHours, -9);
  assert.equal(metrics.totalTasks, 1);
  assert.equal(metrics.completedTasks, 0);
});

test('sans allocation, le réalisé suit le progrès des tâches et partage le reste entre retard et ouvert', () => {
  const data = fixture();
  data.projects = [project('p1')];
  data.tasks = [task('done', 'p1', 0, 100, '2026-10-01'), task('late', 'p1', 0, 50, '2026-10-05'), task('future', 'p1', 0, 25, '2026-10-07'), { ...task('milestone', 'p1', 0, 0, '2026-10-01'), kind: 'milestone' }];
  const metrics = projectZoneMetrics(data, data.projects);
  assert.equal(metrics.activityBasis, 'tasks');
  assert.equal(metrics.realizedPercent, 58.333333333333);
  assert.equal(metrics.latePercent, 16.666666666667);
  assert.equal(metrics.openPercent, 25);
  assert.equal(metrics.overdueTasks, 1);
  assert.equal(metrics.totalTasks, 3);
});

test('une fin à la date du jour et une tâche sans date restent dans le travail ouvert', () => {
  const data = fixture();
  data.projects = [project('p1')];
  data.tasks = [task('today', 'p1', 10, 20, data.today), task('unplanned', 'p1', 30, 0)];
  const metrics = projectZoneMetrics(data, data.projects);
  assert.equal(metrics.realizedPercent, 5);
  assert.equal(metrics.latePercent, 0);
  assert.equal(metrics.openPercent, 95);
  assert.equal(metrics.overdueTasks, 0);
});

test('un périmètre vide et les projets sans tâche n’inventent ni activité ni météo', () => {
  const data = fixture();
  data.projects = [project('p1', 4)];
  data.tasks = [task('work', 'p1', 10, 100)];
  const empty = projectZoneMetrics(data, []);
  assert.deepEqual(empty, {
    allocatedHours: 0, spentHours: 0, remainingHours: 0, realizedPercent: 0, latePercent: 0, openPercent: 0,
    weather: null, totalTasks: 0, completedTasks: 0, overdueTasks: 0, activityBasis: 'none',
  });
  const withoutTasks = projectZoneMetrics(data, [project('new', 4)]);
  assert.equal(withoutTasks.weather, 4);
  assert.equal(withoutTasks.activityBasis, 'none');
  assert.equal(withoutTasks.openPercent, 0);
});

test('les décimales sont additionnées avant l’affichage et les projets ne sont pas dupliqués', () => {
  const data = fixture();
  data.projects = [project('p1', 5), project('p2', 1)];
  data.tasks = [task('a', 'p1', 0.1), task('b', 'p2', 0.2)];
  data.timeEntries = [entry('a', 'a', 0.1), entry('b', 'b', 0.2), entry('c', 'b', 0.015)];
  const metrics = projectZoneMetrics(data, [data.projects[0], data.projects[0], data.projects[1]]);
  assert.equal(metrics.allocatedHours, 0.3);
  assert.equal(metrics.spentHours, 0.315);
  assert.equal(metrics.remainingHours, -0.015);
  assert.equal(metrics.weather, 3);
  assert.equal(metrics.totalTasks, 2);
});

test('l’équipe réunit les membres explicites et les affectations sans doublons et conserve les ressources inactives', () => {
  const data = fixture();
  data.resources = [
    { ...resource('r1'), projectIds: ['p1', 'p1'] }, resource('r2', false),
    { ...resource('explicit'), projectIds: ['p1'] },
    { ...resource('inactive-explicit', false), projectIds: ['p1'] },
    { ...resource('outside'), projectIds: ['p2'] }, resource('unrelated'),
  ];
  data.tasks = [
    { ...task('a', 'p1'), assigneeId: 'r1' }, { ...task('b', 'p1'), assigneeId: 'r1' },
    { ...task('milestone', 'p1'), assigneeId: 'r2', kind: 'milestone' },
    { ...task('missing', 'p1'), assigneeId: 'not-a-resource' },
    { ...task('outside', 'p2'), assigneeId: 'outside' }, task('unassigned', 'p1'),
  ];
  assert.deepEqual(projectAssignedResources(data, 'p1').map(item => item.id), ['r1', 'r2', 'explicit', 'inactive-explicit']);
  assert.deepEqual(projectAssignedResources(data, 'p2').map(item => item.id), ['outside']);
  assert.deepEqual(projectAssignedResources(data, 'empty'), []);
});

test('les tags proviennent seulement des tâches du projet, sans altérer les données enregistrées', () => {
  const data = fixture();
  data.projects = [project('p1')];
  data.tasks = [{ ...task('a', 'p1'), tags: ['Support', ' Client ', ''] }, { ...task('b', 'p1'), tags: ['Support', 'Client', 'Déploiement'] }, { ...task('outside', 'p2'), tags: ['Autre'] }];
  const before = structuredClone(data);
  assert.deepEqual(projectTaskTags(data, 'p1'), ['Client', 'Déploiement', 'Support']);
  assert.deepEqual(projectTaskTags(data, 'empty'), []);
  projectZoneMetrics(data, data.projects);
  projectAssignedResources(data, 'p1');
  assert.deepEqual(data, before);
});
