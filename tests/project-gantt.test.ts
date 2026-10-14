import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectTaskListTree, legacyPhaseTaskListId } from '../shared/task-lists.ts';
import { dependencyProblem, ganttBarRange, ganttStamp, ganttTicks, projectGanttRange, projectGanttRows } from '../shared/project-gantt.ts';
import type { Project, Task } from '../shared/types.ts';

const project: Project = { id: 'p', name: 'Projet Gantt', zoneId: 'z', description: '', startDate: '2026-10-01', endDate: '2032-12-31', status: 'open', weather: 4, budget: 0, color: '#123456' };
const task = (id: string, input: Partial<Task> = {}): Task => ({ id, projectId: 'p', title: id, description: '', phase: 'Sans phase', status: 'todo', progress: 0, assigneeId: null, startDate: null, endDate: null, allocatedHours: 4, kind: 'task', tags: [], dependsOnId: null, ...input });

test('Gantt shares manual mixed order, nested depths, undated items and legacy phases without mutations', () => {
  const tasks = [task('root', { position: 2 }), task('nested', { listId: 'child', allocatedHours: 12 }), task('first', { position: 0 }), task('legacy', { phase: 'Historique', endDate: '2026-10-08' }), task('foreign', { projectId: 'other' })];
  const data = { tasks, taskLists: [{ id: 'a', name: 'A', parentId: null, projectId: 'p', position: 1 }, { id: 'child', name: 'Sous-liste', parentId: 'a', projectId: 'p' }, { id: 'empty', name: 'Vide', parentId: null, projectId: 'p' }] };
  const before = structuredClone(data); const tree = buildProjectTaskListTree(data, 'p'); const rows = projectGanttRows(project, tree, new Set());
  assert.deepEqual(rows.slice(1, 6).map(row => row.name), ['first', 'A', 'Sous-liste', 'nested', 'root']);
  assert.equal(rows.find(row => row.task?.id === 'nested')?.depth, 2); assert.ok(rows.some(row => row.name === 'Vide')); assert.ok(rows.some(row => row.name === 'Historique')); assert.ok(!rows.some(row => row.name === 'foreign'));
  assert.equal(rows.find(row => row.node?.id === 'a')?.allocatedHours, 12);
  assert.ok(!projectGanttRows(project, tree, new Set(['list:a'])).some(row => row.task?.id === 'nested'));
  assert.equal(projectGanttRows(project, tree, new Set([`project:${project.id}`])).length, 1);
  assert.ok(projectGanttRows(project, tree, new Set([`list:${legacyPhaseTaskListId('Historique')}`])).some(row => row.name === 'Historique'));
  assert.deepEqual(data, before);
});
test('Gantt filters retain parents and complete aggregates, while period covers every project date beyond one year', () => {
  const tasks = [task('match', { listId: 'a', allocatedHours: 8, startDate: '2026-09-01', endDate: '2026-10-05' }), task('hidden', { listId: 'a', allocatedHours: 20, endDate: '2033-01-03' })];
  const tree = buildProjectTaskListTree({ tasks, taskLists: [{ id: 'a', name: 'A', parentId: null, projectId: 'p' }] }, 'p', { search: 'match' });
  const rows = projectGanttRows(project, tree, new Set()); assert.deepEqual(rows.map(row => row.name), [project.name, 'A', 'match']); assert.equal(rows[1].allocatedHours, 28);
  const range = projectGanttRange(project, tasks, 'project', '2026-10-01'); assert.ok(range.start < ganttStamp('2026-09-01')); assert.ok(range.end > ganttStamp('2033-01-03'));
  const ticks = ganttTicks(range, true); assert.ok(ticks.some(tick => tick.label === '2032')); assert.ok(ticks.every(tick => tick.width > 0 && tick.left >= 0 && tick.left + tick.width <= 1.00001));
  const huge = ganttTicks({ start: ganttStamp('1000-01-01'), end: ganttStamp('9000-01-01') }, false); assert.ok(huge.length <= 170); assert.ok(huge.at(-1)!.left + huge.at(-1)!.width >= .9999);
});
test('Gantt calendar ranges include leap days and exclude bars ending immediately before the visible period', () => {
  const range = projectGanttRange(project, [], 'month', '2028-02-12'); assert.equal((range.end - range.start) / 86400000, 29);
  const rows = projectGanttRows(project, buildProjectTaskListTree({ tasks: [task('edge', { startDate: '2028-01-01', endDate: '2028-01-31' }), task('flag', { kind: 'milestone', endDate: '2028-02-01' }), task('partial', { startDate: '2028-02-05' })], taskLists: [] }, 'p'), new Set());
  assert.equal(ganttBarRange(rows.find(row => row.task?.id === 'edge')!, range), null);
  assert.equal(ganttBarRange(rows.find(row => row.task?.id === 'flag')!, range)?.left, 0);
  assert.ok(ganttBarRange(rows.find(row => row.task?.id === 'partial')!, range));
});
test('Finish-start constraints reject self links, cross-project links, chain cycles and unfinished predecessors of started tasks', () => {
  const tasks = [task('a'), task('b', { dependsOnId: 'a' }), task('c', { dependsOnId: 'b' }), task('foreign', { projectId: 'elsewhere' }), task('started', { status: 'in_progress' }), task('done', { status: 'done', progress: 100 })];
  assert.equal(dependencyProblem(tasks, 'a', 'c'), null); assert.match(dependencyProblem(tasks, 'a', 'a')!, /elle-même/); assert.match(dependencyProblem(tasks, 'c', 'a')!, /cycle/); assert.match(dependencyProblem(tasks, 'foreign', 'a')!, /même projet/); assert.match(dependencyProblem(tasks, 'a', 'started')!, /déjà démarré/); assert.equal(dependencyProblem(tasks, 'done', 'started'), null);
});

test('multi-project Gantt keeps legacy lists with identical names independently folded and identifies every row project', () => {
  const other = { ...project, id: 'other', name: 'Second projet' };
  const tasks = [task('alpha', { phase: 'Préparation' }), task('beta', { phase: 'Préparation', projectId: other.id })];
  const data = { tasks, taskLists: [] };
  const first = projectGanttRows(project, buildProjectTaskListTree(data, project.id), new Set(), true, true);
  const second = projectGanttRows(other, buildProjectTaskListTree(data, other.id), new Set(), true, true);
  const firstList = first.find(row => row.kind === 'list')!;
  assert.notEqual(firstList.id, second.find(row => row.kind === 'list')!.id);
  const collapsed = new Set([firstList.id]);
  assert.ok(!projectGanttRows(project, buildProjectTaskListTree(data, project.id), collapsed, true, true).some(row => row.task));
  assert.ok(projectGanttRows(other, buildProjectTaskListTree(data, other.id), collapsed, true, true).some(row => row.task?.id === 'beta'));
  assert.ok(first.every(row => row.projectId === project.id));
  assert.ok(second.every(row => row.projectId === other.id));
});
