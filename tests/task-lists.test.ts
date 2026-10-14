import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateTaskListTasks, buildProjectTaskListTree, legacyPhaseTaskListId,
  projectTaskListParentOptions, projectTaskListPath, taskListDescendantIds, taskListRecursiveTasks,
} from '../shared/task-lists.ts';
import type { ProjectTaskList, Task } from '../shared/types.ts';

function list(id: string, name = id, parentId: string | null = null, projectId = 'project'): ProjectTaskList {
  return { id, name, parentId, projectId };
}

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id, projectId: 'project', title: id, description: '', phase: '', status: 'todo', progress: 0,
    assigneeId: null, startDate: '2026-10-05', endDate: '2026-10-09', allocatedHours: 8,
    kind: 'task', tags: [], dependsOnId: null, ...overrides,
  };
}

test('trois niveaux de listes conservent les listes vides et agrègent les tâches une seule fois', () => {
  const tasks = [
    task('direct', { listId: 'root', allocatedHours: 2 }),
    task('child-task', { listId: 'child', allocatedHours: 4, startDate: '2026-10-01' }),
    task('nested-task', { listId: 'nested', allocatedHours: 6, endDate: '2026-10-31' }),
    task('flag', { listId: 'nested', kind: 'milestone', allocatedHours: 500, startDate: null, endDate: '2026-11-03' }),
  ];
  const tree = buildProjectTaskListTree({ taskLists: [list('root'), list('child', 'Préparation', 'root'), list('nested', 'Recette', 'child'), list('empty', 'Liste vide', 'root')], tasks }, 'project');
  const root = tree.nodes.get('root')!;
  assert.deepEqual(tree.roots.map(node => node.id), ['root']);
  assert.equal(tree.nodes.get('nested')?.depth, 2);
  assert.deepEqual(root.children.map(node => node.id), ['child', 'empty']);
  assert.deepEqual(root.aggregate, { taskCount: 4, allocatedHours: 12, startDate: '2026-10-01', endDate: '2026-11-03', taskIds: ['direct', 'child-task', 'nested-task', 'flag'] });
  assert.deepEqual(taskListRecursiveTasks(root).map(item => item.id), ['direct', 'child-task', 'nested-task', 'flag']);
  assert.equal(tree.nodes.get('empty')?.aggregate.taskCount, 0);
});

test('les phases historiques sont virtuelles sans réécriture et les tâches sans phase restent racines', () => {
  const tasks = [
    task('old-a', { phase: ' Préparation ' }), task('old-b', { phase: 'Préparation', listId: null }),
    task('root-a', { phase: 'Sans phase' }), task('root-b', { phase: ' ' }),
    task('explicit', { phase: 'Préparation', listId: 'real' }),
  ];
  const input = { tasks, taskLists: [list('real', 'Préparation')] };
  const before = structuredClone(input);
  const tree = buildProjectTaskListTree(input, 'project');
  const legacyId = legacyPhaseTaskListId('Préparation');
  assert.deepEqual(tree.nodes.get(legacyId)?.tasks.map(item => item.id), ['old-a', 'old-b']);
  assert.equal(tree.nodes.get(legacyId)?.legacyPhase, 'Préparation');
  assert.equal(tree.nodes.get(legacyId)?.list, null);
  assert.deepEqual(tree.nodes.get('real')?.tasks.map(item => item.id), ['explicit']);
  assert.deepEqual(tree.rootTasks.map(item => item.id), ['root-a', 'root-b']);
  assert.deepEqual(input, before);
  assert.equal(buildProjectTaskListTree({ tasks: [task('legacy', { phase: 'Phase' })] }, 'project').roots.length, 1);
});

test('deux listes de même nom et une phase du même nom gardent des identités séparées', () => {
  const tree = buildProjectTaskListTree({ taskLists: [list('a', 'Recette'), list('b', 'Recette')], tasks: [task('ta', { listId: 'a' }), task('tb', { listId: 'b' }), task('old', { phase: 'Recette' })] }, 'project');
  assert.equal(tree.roots.length, 3);
  assert.deepEqual(tree.roots.map(node => node.aggregate.taskIds), [['ta'], ['tb'], ['old']]);
  assert.equal(new Set(tree.roots.map(node => node.id)).size, 3);
});

test('les références manquantes ou étrangères ne masquent ni ne déplacent les tâches vers un autre projet', () => {
  const lists = [list('local', 'Locale', 'foreign'), list('foreign', 'Étrangère', null, 'other')];
  const tree = buildProjectTaskListTree({ taskLists: lists, tasks: [task('foreign-ref', { listId: 'foreign', phase: 'Ancienne phase' }), task('missing', { listId: 'missing', phase: 'Ancienne phase' }), task('local-task', { listId: 'local' }), task('other-task', { projectId: 'other', listId: 'local' })] }, 'project');
  assert.deepEqual(tree.roots.map(node => node.id), ['local']);
  assert.equal(tree.nodes.get('local')?.parentId, null);
  assert.deepEqual(tree.rootTasks.map(item => item.id), ['foreign-ref', 'missing']);
  assert.deepEqual(tree.tasks.map(item => item.id), ['foreign-ref', 'missing', 'local-task']);
  assert.deepEqual(projectTaskListPath(lists, 'project', 'local').map(item => item.id), ['local']);
  assert.deepEqual(projectTaskListPath(lists, 'project', 'foreign'), []);
  assert.deepEqual([...taskListDescendantIds(lists, 'foreign', 'project')], []);
});

test('un filtre de tâches conserve les ancêtres et les agrégats complets sans afficher les branches vides', () => {
  const input = {
    taskLists: [list('root'), list('child', 'Préparation', 'root'), list('nested', 'Recette', 'child'), list('empty', 'Vide', 'root'), list('unrelated')],
    tasks: [task('kept', { listId: 'nested', assigneeId: 'alice' }), task('hidden', { listId: 'root', assigneeId: 'bob', allocatedHours: 2 }), task('hidden-root', { assigneeId: 'bob' })],
  };
  const tree = buildProjectTaskListTree(input, 'project', { matchesTask: item => item.assigneeId === 'alice' });
  assert.deepEqual(tree.roots.map(node => node.id), ['root']);
  assert.deepEqual(tree.nodes.get('root')?.children.map(node => node.id), ['child']);
  assert.equal(tree.nodes.get('root')?.aggregate.taskCount, 2);
  assert.equal(tree.nodes.get('root')?.aggregate.allocatedHours, 10);
  assert.deepEqual(tree.nodes.get('root')?.tasks, []);
  assert.deepEqual(tree.visibleTasks.map(item => item.id), ['kept']);
  assert.equal(tree.tasks.length, 3);
});

test('la recherche trouve les tâches, les noms de listes et leurs descendants en conservant le filtre de ressource', () => {
  const input = {
    taskLists: [list('root', 'Formation'), list('child', 'Documentation', 'root'), list('empty', 'Réunion'), list('other', 'Autre')],
    tasks: [task('manual', { title: 'Rédaction du guide', listId: 'child', assigneeId: 'alice' }), task('support', { listId: 'root', assigneeId: 'bob' }), task('other-task', { listId: 'other' })],
  };
  const searchedTask = buildProjectTaskListTree(input, 'project', { search: 'redaction' });
  assert.deepEqual(searchedTask.roots.map(node => node.id), ['root']);
  assert.deepEqual(searchedTask.nodes.get('child')?.tasks.map(item => item.id), ['manual']);
  const searchedList = buildProjectTaskListTree(input, 'project', { search: 'FORMATION' });
  assert.deepEqual(searchedList.visibleTasks.map(item => item.id), ['manual', 'support']);
  const resourceSearch = buildProjectTaskListTree(input, 'project', { search: 'formation', matchesTask: item => item.assigneeId === 'alice' });
  assert.deepEqual(resourceSearch.visibleTasks.map(item => item.id), ['manual']);
  assert.deepEqual(buildProjectTaskListTree(input, 'project', { search: 'reunion' }).roots.map(node => node.id), ['empty']);
  assert.equal(buildProjectTaskListTree(input, 'project', { search: 'absent' }).roots.length, 0);
});

test('les chemins et parents excluent toute la descendance même avec des noms identiques', () => {
  const lists = [list('root', 'A'), list('child', 'B', 'root'), list('nested', 'C', 'child'), list('other', 'A'), list('foreign', 'Étrangère', 'root', 'other')];
  assert.deepEqual(projectTaskListPath(lists, 'project', 'nested').map(item => item.id), ['root', 'child', 'nested']);
  assert.deepEqual([...taskListDescendantIds(lists, 'root')], ['root', 'child', 'nested']);
  assert.deepEqual(projectTaskListParentOptions(lists, 'project', 'child'), [
    { id: 'root', name: 'A', label: 'A', depth: 0 }, { id: 'other', name: 'A', label: 'A', depth: 0 },
  ]);
  assert.deepEqual(projectTaskListParentOptions(lists, 'project').find(option => option.id === 'nested'), { id: 'nested', name: 'C', label: 'A / B / C', depth: 2 });
});

test('une hiérarchie cyclique ou trop profonde se récupère à la lecture sans boucle ni écriture', () => {
  const lists = [list('a', 'A', 'b'), list('b', 'B', 'a'), list('child', 'C', 'b'), list('self', 'S', 'self')];
  for (let index = 0; index < 30; index++) lists.push(list(`deep-${index}`, `${index}`, index ? `deep-${index - 1}` : null));
  const before = structuredClone(lists);
  const tree = buildProjectTaskListTree({ taskLists: lists, tasks: [task('deep-task', { listId: 'deep-29' })] }, 'project');
  assert.equal(tree.nodes.size, lists.length);
  assert.equal(tree.nodes.get('a')?.parentId, null);
  assert.equal(tree.nodes.get('b')?.parentId, null);
  assert.equal(tree.nodes.get('child')?.parentId, 'b');
  assert.equal(tree.nodes.get('self')?.parentId, null);
  assert.ok([...tree.nodes.values()].every(node => node.depth < 20));
  assert.ok(projectTaskListPath(lists, 'project', 'deep-29').length <= 20);
  assert.deepEqual([...taskListDescendantIds(lists, 'a')], ['a', 'b', 'child']);
  assert.deepEqual(lists, before);
});

test('les tris restent stables et les doublons d’identifiants ne doublent pas les heures', () => {
  const tasks = [task('one', { title: 'Égalité', listId: 'a', allocatedHours: 1 }), task('two', { title: 'Égalité', listId: 'a', allocatedHours: 2 }), task('one', { allocatedHours: 300, listId: 'a' }), task('three', { title: 'Avant', listId: 'b' })];
  const lists = [list('a', 'Égalité'), list('b', 'Égalité'), list('a', 'Dupliquée')];
  const tree = buildProjectTaskListTree({ tasks, taskLists: lists }, 'project', { sortTasks: (left, right) => left.title.localeCompare(right.title), sortLists: (left, right) => left.name.localeCompare(right.name) });
  assert.deepEqual(tree.roots.map(node => node.id), ['a', 'b']);
  assert.deepEqual(tree.nodes.get('a')?.tasks.map(item => item.id), ['one', 'two']);
  assert.equal(tree.nodes.get('a')?.aggregate.allocatedHours, 3);
  assert.equal(tree.tasks.length, 3);
  assert.deepEqual(tasks.map(item => item.id), ['one', 'two', 'one', 'three']);
  assert.deepEqual(aggregateTaskListTasks([task('invalid', { startDate: '2026-02-30', endDate: null, allocatedHours: -20 }), task('invalid', { allocatedHours: 100 }), task('milestone', { kind: 'milestone', allocatedHours: 900, startDate: null, endDate: '2026-11-03' })]), { taskCount: 2, allocatedHours: 0, startDate: '2026-11-03', endDate: '2026-11-03', taskIds: ['invalid', 'milestone'] });
});
