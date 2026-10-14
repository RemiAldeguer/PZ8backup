import type { AppData, ProjectTaskList, Task } from './types';
import { buildProjectTaskListTree, orderedTaskListItems, type TaskListNode } from './task-lists';

export type ProjectItemReference = { type: 'task' | 'list'; id: string } | { type: 'phase'; phase: string };
export type ProjectItemTarget = ProjectItemReference | { type: 'root' };
export type ProjectItemPlacement = 'before' | 'inside' | 'after';
export interface ProjectItemMove { projectId: string; source: ProjectItemReference; target: ProjectItemTarget; placement: ProjectItemPlacement; }
export class ProjectItemMoveError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const projectItemKey = (item: ProjectItemTarget): string => item.type === 'root' ? 'root' : item.type === 'phase' ? `phase:${item.phase.trim()}` : `${item.type}:${item.id}`;
export const taskListNodeReference = (node: TaskListNode): ProjectItemReference => node.kind === 'legacy-phase' ? { type: 'phase', phase: node.legacyPhase! } : { type: 'list', id: node.id };

/** Plans one complete move without changing the supplied records. The API commits it atomically. */
export function planProjectItemMove(data: Pick<AppData, 'projects' | 'tasks' | 'taskLists'>, move: ProjectItemMove, createId: () => string) {
  const fail = (status: number, message: string): never => { throw new ProjectItemMoveError(status, message); };
  if (!data.projects.some(project => project.id === move.projectId)) fail(404, 'Ce projet est introuvable.');
  const tree = buildProjectTaskListTree(data, move.projectId);
  const tasks = tree.tasks.map(task => ({ ...task }));
  const lists = (data.taskLists ?? []).filter(list => list.projectId === move.projectId).map(list => ({ ...list }));
  const taskById = new Map(tasks.map(task => [task.id, task]));
  const listById = new Map(lists.map(list => [list.id, list]));
  const aliases = new Map<string, string>();
  const containers = new Map<string, string[]>();
  const parents = new Map<string, string>();
  function collect(parent: string, direct: Task[], children: TaskListNode[]) {
    const keys = orderedTaskListItems(direct, children).map(item => item.type === 'task' ? `task:${item.task.id}` : projectItemKey(taskListNodeReference(item.node)));
    containers.set(parent, keys);
    for (const key of keys) parents.set(key, parent);
    for (const child of children) collect(projectItemKey(taskListNodeReference(child)), child.tasks, child.children);
  }
  collect('root', tree.rootTasks, tree.roots);
  const sourceKey = projectItemKey(move.source);
  const targetKey = projectItemKey(move.target);
  if (!parents.has(sourceKey) || (targetKey !== 'root' && !parents.has(targetKey))) fail(404, 'Cet élément a changé ou appartient à un autre projet. Actualisez la liste.');
  if (sourceKey === targetKey) fail(409, 'Un élément ne peut pas être déposé sur lui-même.');
  if (move.placement === 'inside' && move.target.type === 'task') fail(400, 'Une tâche ne peut pas contenir d’autres éléments.');
  if (move.placement !== 'inside' && move.target.type === 'root') fail(400, 'Choisissez une tâche ou une liste pour placer un élément avant ou après.');
  let destination = move.placement === 'inside' ? targetKey : parents.get(targetKey)!;
  // Check the destination before creating any IDs or converting phases.
  for (let ancestor = destination; ancestor !== 'root'; ancestor = parents.get(ancestor) ?? 'root') {
    if (ancestor === sourceKey) fail(409, 'Une liste ne peut pas être déplacée dans l’un de ses descendants.');
  }
  // Preserve the entire visible sibling order when old phases become genuine lists.
  // This happens only during this explicit mutation, never while reading the workspace.
  for (const node of tree.roots.filter(node => node.kind === 'legacy-phase')) {
    const id = createId();
    if (listById.has(id) || taskById.has(id)) fail(409, 'Impossible de créer un identifiant de liste unique.');
    const list: ProjectTaskList = { id, projectId: move.projectId, name: node.name, parentId: null };
    lists.push(list); listById.set(id, list);
    const old = projectItemKey(taskListNodeReference(node));
    const next = `list:${id}`;
    aliases.set(old, next);
    for (const task of node.tasks) taskById.get(task.id)!.listId = id;
  }
  const resolve = (key: string) => aliases.get(key) ?? key;
  const translated = new Map<string, string[]>();
  for (const [parent, keys] of containers) translated.set(resolve(parent), keys.map(resolve));
  const from = resolve(parents.get(sourceKey)!);
  destination = resolve(destination);
  const source = resolve(sourceKey);
  const target = resolve(targetKey);
  const siblings = translated.get(from)!;
  siblings.splice(siblings.indexOf(source), 1);
  const destinationItems = translated.get(destination) ?? [];
  translated.set(destination, destinationItems);
  const index = move.placement === 'inside' ? destinationItems.length : destinationItems.indexOf(target) + (move.placement === 'after' ? 1 : 0);
  if (index < 0) fail(409, 'La destination a changé. Actualisez la liste.');
  destinationItems.splice(index, 0, source);
  if (move.source.type === 'task') {
    const task = taskById.get(move.source.id)!;
    task.listId = destination === 'root' ? null : destination.slice(5);
    task.phase = task.listId ? listById.get(task.listId)!.name : 'Sans phase';
  } else listById.get(source.slice(5))!.parentId = destination === 'root' ? null : destination.slice(5);
  for (const keys of translated.values()) keys.forEach((key, position) => {
    if (key.startsWith('task:')) taskById.get(key.slice(5))!.position = position;
    else listById.get(key.slice(5))!.position = position;
  });
  return { tasks, taskLists: lists, moved: { type: move.source.type === 'task' ? 'task' as const : 'list' as const, id: source.slice(5) } };
}
