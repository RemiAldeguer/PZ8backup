import test from 'node:test';
import assert from 'node:assert/strict';
import { buildZoneElementTree, flattenZoneElements } from '../shared/zone-elements';
import type { Project, Task, TimeEntry, ProjectTaskList } from '../shared/types';

function project(id: string, zoneId = 'zone-a'): Project { return { id, zoneId, name: id, description: '', startDate: '2026-01-01', endDate: '2027-12-31', status: 'open', weather: 4, color: '#123456', budget: 0 }; }
function task(id: string, projectId: string, extra: Partial<Task> = {}): Task { return { id, projectId, title: id, description: '', phase: 'Préparation', status: 'todo', progress: 0, assigneeId: 'resource-a', startDate: '2026-03-01', endDate: '2026-03-05', allocatedHours: 8, kind: 'task', tags: [], dependsOnId: null, ...extra }; }
function entry(id: string, taskId: string, hours: number): TimeEntry { return { id, taskId, hours, resourceId: 'resource-a', date: '2026-03-02', note: '', validated: false, rateSnapshot: null, eqjtSnapshot: null }; }
function fixture() {
  const projects = [project('Alpha'), project('Bêta'), project('Hors zone', 'zone-b'), project('Vide')];
  const taskLists: ProjectTaskList[] = [{ id: 'list-a', projectId: 'Alpha', name: 'Planification', parentId: null, position: 0 }, { id: 'child-a', projectId: 'Alpha', name: 'Sous-liste', parentId: 'list-a', position: 0 }];
  const tasks = [task('racine', 'Alpha', { phase: '', position: 1 }), task('imbriquée', 'Alpha', { listId: 'child-a', allocatedHours: 12, tags: ['Client'] }), task('jalon', 'Alpha', { listId: 'child-a', kind: 'milestone', allocatedHours: 90, startDate: null, endDate: '2026-03-06', position: 1 }), task('ancienne-a', 'Alpha'), task('ancienne-b', 'Bêta'), task('hors-zone', 'Hors zone', { allocatedHours: 100 })];
  return { projects, tasks, taskLists, timeEntries: [entry('t1', 'imbriquée', 2.5), entry('t2', 'racine', 1), entry('t3', 'hors-zone', 100)] };
}

test('zone trees scope projects and work without counting nested lists or milestones twice', () => {
  const data = fixture(); const before = JSON.stringify(data); const roots = buildZoneElementTree(data, { zoneId: 'zone-a' });
  assert.deepEqual(roots.map(row => row.project.id), ['Alpha', 'Bêta', 'Vide']);
  const alpha = roots[0]; assert.equal(alpha.aggregate.allocatedHours, 28); assert.equal(alpha.aggregate.taskCount, 4); assert.equal(alpha.spentHours, 3.5);
  const list = alpha.children.find(row => row.list?.id === 'list-a')!; assert.equal(list.aggregate.allocatedHours, 12); assert.equal(list.spentHours, 2.5); assert.equal(list.aggregate.taskCount, 2);
  assert.equal(list.children[0].depth, 2); assert.equal(list.children[0].children[0].depth, 3);
  assert.equal(flattenZoneElements(roots).filter(row => row.kind === 'task').length, 5); assert.equal(JSON.stringify(data), before);
});

test('zone filters retain ancestors and full list aggregates while matching task tags, resources and kinds', () => {
  const data = fixture(); const rows = flattenZoneElements(buildZoneElementTree(data, { zoneId: 'zone-a', search: 'client', kind: 'task', resourceId: 'resource-a', status: 'todo' }));
  assert.deepEqual(rows.map(row => row.name), ['Alpha', 'Planification', 'Sous-liste', 'imbriquée']); assert.equal(rows[0].aggregate.allocatedHours, 28); assert.equal(rows[1].aggregate.taskCount, 2);
  assert.equal(buildZoneElementTree(data, { zoneId: 'zone-a', resourceId: 'unassigned' }).length, 0);
  assert.equal(buildZoneElementTree(data, { zoneId: 'zone-a', projectId: 'Hors zone' }).length, 0);
  assert.equal(flattenZoneElements(buildZoneElementTree(data, { zoneId: 'zone-a', search: 'bêta' })).filter(row => row.kind === 'task').length, 1);
});

test('zone legacy phase keys keep identical phase names independently collapsible across projects', () => {
  const roots = buildZoneElementTree(fixture(), { zoneId: 'zone-a' }); const phases = flattenZoneElements(roots).filter(row => row.list?.kind === 'legacy-phase');
  assert.equal(phases.length, 2); assert.notEqual(phases[0].id, phases[1].id);
  const collapsed = flattenZoneElements(roots, new Set([phases[0].id])); assert.equal(collapsed.some(row => row.task?.id === 'ancienne-a'), false); assert.equal(collapsed.some(row => row.task?.id === 'ancienne-b'), true);
});

test('all-zone views and empty projects remain available; undated tasks expose no invalid date', () => {
  const data = fixture(); data.tasks.push(task('sans-date', 'Vide', { phase: '', startDate: null, endDate: null }));
  const roots = buildZoneElementTree(data, { zoneId: null }); assert.equal(roots.length, 4); assert.equal(flattenZoneElements(roots).some(row => row.task?.id === 'hors-zone'), true);
  const undated = flattenZoneElements(roots).find(row => row.task?.id === 'sans-date')!; assert.equal(undated.startDate, null); assert.equal(undated.endDate, null);
  assert.deepEqual(buildZoneElementTree(data, { zoneId: 'empty-zone' }), []);
});
