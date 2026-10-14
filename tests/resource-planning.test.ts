import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resourceCapacity, resourceLoad } from '../shared/domain.ts';
import {
  buildResourcePlanningRows, resourceAvatarTextColor, resourceOccupancyBand, resourcePlanningAmount,
  resourcePlanningPeriodDays, resourcePlanningPeriods,
} from '../shared/resource-planning.ts';
import type { AppData, Project, Resource, Task, Unavailability } from '../shared/types.ts';

const resource: Resource = { id: 'r1', name: 'Ressource', jobTitle: '', type: 'human', classification: 'internal', initials: 'R', color: '#64dafa', dailyHours: 8, mondayHours: 8, profileId: 'profile-8', active: true, weeklyCapacityHours: [8, 8, 8, 8, 8, 0, 0], hoursPerDay: 8 };
const project: Project = { id: 'p1', name: 'Premier', description: '', zoneId: 'zone', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open', weather: 5, budget: 0, color: '#123456' };
const task: Task = { id: 't1', projectId: 'p1', title: 'Tâche', description: '', phase: '', status: 'todo', progress: 0, assigneeId: 'r1', startDate: '2026-02-02', endDate: '2026-02-06', allocatedHours: 40, kind: 'task', tags: [], dependsOnId: null };
const data = (overrides: Partial<Pick<AppData, 'resources' | 'tasks' | 'projects' | 'unavailabilities'>> = {}) => ({ resources: [resource], tasks: [task], projects: [project], unavailabilities: [], ...overrides });
const absence = (overrides: Partial<Unavailability>): Unavailability => ({ id: 'a1', resourceId: 'r1', title: 'Absence', reason: 'leave', allDay: false, startDate: '2026-05-21', endDate: '2026-05-21', startTime: '09:00', endTime: '12:00', ...overrides });
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test('les douze mois couvrent exactement l’année, avec le 29 février des années bissextiles', () => {
  const periods = resourcePlanningPeriods(2024, 'monthly');
  assert.equal(periods.length, 12);
  assert.equal(periods[0].startDate, '2024-01-01');
  assert.equal(periods.at(-1)?.endDate, '2024-12-31');
  assert.equal(periods[1].endDate, '2024-02-29');
  assert.equal(periods.reduce((sum, period) => sum + resourcePlanningPeriodDays(period), 0), 366);
  assert.equal(resourcePlanningPeriods(2026, 'monthly').reduce((sum, period) => sum + resourcePlanningPeriodDays(period), 0), 365);
  assert.throws(() => resourcePlanningPeriods(NaN, 'monthly'), RangeError);
  assert.throws(() => resourcePlanningPeriods(2201, 'weekly'), RangeError);
});

test('les semaines UTC ne doublent pas les jours aux limites de l’année ni au changement d’heure', () => {
  for (const year of [2024, 2025, 2026, 2028]) {
    const periods = resourcePlanningPeriods(year, 'weekly');
    assert.equal(periods[0].startDate, `${year}-01-01`);
    assert.equal(periods.at(-1)?.endDate, `${year}-12-31`);
    const days = periods.flatMap(period => Array.from({ length: resourcePlanningPeriodDays(period) }, (_, offset) => {
      const date = new Date(`${period.startDate}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10);
    }));
    assert.equal(days.length, new Set(days).size);
    assert.equal(days.length, year % 4 === 0 ? 366 : 365);
    assert.ok(periods.every(period => resourcePlanningPeriodDays(period) <= 7));
    assert.ok(periods.slice(1).every(period => new Date(`${period.startDate}T12:00:00Z`).getUTCDay() === 1));
  }
  const periods = resourcePlanningPeriods(2026, 'weekly');
  const spring = periods.find(period => period.startDate === '2026-03-23');
  const autumn = periods.find(period => period.startDate === '2026-10-19');
  assert.equal(spring?.endDate, '2026-03-29');
  assert.equal(autumn?.endDate, '2026-10-25');
  assert.equal(resourcePlanningPeriodDays(spring!), 7);
  assert.equal(resourcePlanningPeriodDays(autumn!), 7);
  assert.equal(resourcePlanningPeriods(2024, 'weekly').at(-1)?.label, 'S. 01 (2025)');
});

test('la capacité mensuelle provient des sept jours configurés, y compris le week-end', () => {
  const custom = { ...resource, weeklyCapacityHours: [6, 4, 0, 8, 7, 2, 1] as Resource['weeklyCapacityHours'] };
  const rows = buildResourcePlanningRows(data({ resources: [custom], tasks: [] }), resourcePlanningPeriods(2024, 'monthly'));
  assert.equal(rows[0].cells[1].capacityHours, 120);
  assert.equal(rows[0].cells[1].loadHours, 0);
  assert.equal(rows[0].cells[1].occupancyRate, 0);
});

test('jours fériés FR et absences se chevauchant retirent uniquement la capacité de la bonne ressource', () => {
  const french = { ...resource, holidayCalendarId: 'fr' as const };
  const unavailabilities = [absence({}), absence({ id: 'a2', startTime: '11:00', endTime: '14:00' }), absence({ id: 'a3', startDate: '2026-05-22', endDate: '2026-05-22', allDay: true, startTime: null, endTime: null }), absence({ id: 'other', resourceId: 'r2', allDay: true, startDate: '2026-05-01', endDate: '2026-05-31', startTime: null, endTime: null })];
  const row = buildResourcePlanningRows(data({ resources: [french], tasks: [], unavailabilities }), resourcePlanningPeriods(2026, 'monthly'))[0];
  assert.equal(resourceCapacity(french, '2026-05-01', '2026-05-31'), 136);
  assert.equal(row.cells[4].capacityHours, 123);
  assert.equal(row.cells[4].occupancyRate, 0);
});

test('les charges par projet conservent leur somme et excluent jalons, tâches non datées et autre affectation', () => {
  const second = { ...project, id: 'p2', name: 'Deuxième' };
  const foreign = { ...project, id: 'p3', name: 'Étranger' };
  const tasks = [task, { ...task, id: 't2', projectId: 'p2', allocatedHours: 10 }, { ...task, id: 'foreign-task', assigneeId: 'r2', projectId: 'p3', allocatedHours: 500 }, { ...task, id: 'undated', startDate: null, allocatedHours: 18 }, { ...task, id: 'milestone', kind: 'milestone' as const, allocatedHours: 100 }];
  const row = buildResourcePlanningRows(data({ tasks, projects: [project, second, foreign] }), resourcePlanningPeriods(2026, 'monthly'))[0];
  assert.equal(row.cells[1].loadHours, 50);
  assert.equal(row.undatedTaskCount, 1);
  assert.equal(row.undatedAllocatedHours, 18);
  assert.deepEqual(row.projects.map(branch => branch.project.id), ['p1', 'p2']);
  assert.equal(row.projects[0].loadHours[1], 40);
  assert.equal(row.projects[1].loadHours[1], 10);
  row.cells.forEach((cell, index) => close(row.projects.reduce((sum, branch) => sum + branch.loadHours[index], 0), cell.loadHours));
});

test('une tâche couvrant deux années est répartie uniquement sur les jours de l’année choisie', () => {
  const crossing = { ...task, startDate: '2025-12-29', endDate: '2026-01-02', allocatedHours: 50 };
  const row = buildResourcePlanningRows(data({ tasks: [crossing] }), resourcePlanningPeriods(2026, 'monthly'))[0];
  assert.equal(row.cells[0].loadHours, 20);
  assert.equal(row.cells.slice(1).reduce((sum, cell) => sum + cell.loadHours, 0), 0);
  const older = buildResourcePlanningRows(data({ tasks: [crossing] }), resourcePlanningPeriods(2025, 'monthly'))[0];
  assert.equal(older.cells[11].loadHours, 30);
});

test('la vue hebdomadaire et la vue mensuelle conservent les mêmes charges et capacités annuelles', () => {
  const french = { ...resource, holidayCalendarId: 'fr' as const, weeklyCapacityHours: [7, 6, 5, 4, 3, 2, 1] as Resource['weeklyCapacityHours'] };
  const tasks = [{ ...task, startDate: '2025-12-23', endDate: '2027-01-15', allocatedHours: 1234.56 }, { ...task, id: 'weekend', startDate: '2026-10-24', endDate: '2026-10-25', allocatedHours: 7.5 }];
  const unavailabilities = [absence({ startDate: '2026-03-29', endDate: '2026-03-29', startTime: '01:00', endTime: '04:00' }), absence({ id: 'autumn', startDate: '2026-10-25', endDate: '2026-10-25', startTime: '01:00', endTime: '04:00' })];
  const fixture = data({ resources: [french], tasks, unavailabilities });
  const monthly = buildResourcePlanningRows(fixture, resourcePlanningPeriods(2026, 'monthly'))[0];
  const weekly = buildResourcePlanningRows(fixture, resourcePlanningPeriods(2026, 'weekly'))[0];
  const annualCapacity = resourceCapacity(french, '2026-01-01', '2026-12-31', unavailabilities);
  const annualLoad = resourceLoad(french, tasks, '2026-01-01', '2026-12-31');
  for (const row of [monthly, weekly]) {
    close(row.cells.reduce((sum, cell) => sum + cell.capacityHours, 0), annualCapacity);
    close(row.cells.reduce((sum, cell) => sum + cell.loadHours, 0), annualLoad);
    close(row.projects[0].loadHours.reduce((sum, hours) => sum + hours, 0), annualLoad);
  }
});

test('l’absence ne réduit pas la charge planifiée et une capacité nulle ne produit pas un faux taux de zéro', () => {
  const row = buildResourcePlanningRows(data({ unavailabilities: [absence({ startDate: '2026-02-01', endDate: '2026-02-28', allDay: true, startTime: null, endTime: null })] }), resourcePlanningPeriods(2026, 'monthly'))[0];
  assert.equal(row.cells[1].loadHours, 40);
  assert.equal(row.cells[1].capacityHours, 0);
  assert.equal(row.cells[1].occupancyRate, null);
  assert.equal(resourceOccupancyBand(row.cells[1].occupancyRate), 'unavailable');
  assert.equal(resourceOccupancyBand(100), 'normal');
  assert.equal(resourceOccupancyBand(100.1), 'warning');
  assert.equal(resourceOccupancyBand(120), 'warning');
  assert.equal(resourceOccupancyBand(120.1), 'overload');
});

test('les ressources inactives gardent leur charge et les memberships explicites gardent leurs branches vides', () => {
  const inactive = { ...resource, active: false, projectIds: ['p2'] };
  const row = buildResourcePlanningRows(data({ resources: [inactive], projects: [project, { ...project, id: 'p2' }] }), resourcePlanningPeriods(2026, 'monthly'))[0];
  assert.ok(row.cells.every(cell => cell.capacityHours === 0 && cell.occupancyRate === null));
  assert.equal(row.cells[1].loadHours, 40);
  assert.deepEqual(row.projects.map(branch => branch.project.id), ['p1', 'p2']);
  assert.ok(row.projects[1].loadHours.every(hours => hours === 0));
});

test('la conversion de jours suit les heures par jour de chaque ressource et le contraste de l’avatar suit sa couleur', () => {
  assert.equal(resourcePlanningAmount(24, resource, 'hours'), 24);
  assert.equal(resourcePlanningAmount(24, resource, 'days'), 3);
  assert.equal(resourcePlanningAmount(24, { ...resource, hoursPerDay: 5 }, 'days'), 4.8);
  assert.equal(resourcePlanningAmount(24, { ...resource, hoursPerDay: 0 }, 'days'), null);
  assert.equal(resourceAvatarTextColor('#ffffff'), '#000');
  assert.equal(resourceAvatarTextColor('#fff'), '#000');
  assert.equal(resourceAvatarTextColor('#000'), '#fff');
  assert.equal(resourceAvatarTextColor('#64dafa'), '#000');
  assert.equal(resourceAvatarTextColor('#220b54'), '#fff');
});
