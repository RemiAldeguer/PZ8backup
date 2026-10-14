import type { AppData, ProjectTaskList, Task } from './types';

export interface TaskListAggregate {
  taskCount: number;
  allocatedHours: number;
  startDate: string | null;
  endDate: string | null;
  taskIds: string[];
}

export interface TaskListNode {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  kind: 'list' | 'legacy-phase';
  list: ProjectTaskList | null;
  legacyPhase: string | null;
  position?: number;
  children: TaskListNode[];
  /** Direct tasks visible after filtering. Aggregates always describe the complete list. */
  tasks: Task[];
  aggregate: TaskListAggregate;
}

export interface ProjectTaskListTree {
  roots: TaskListNode[];
  rootTasks: Task[];
  nodes: Map<string, TaskListNode>;
  /** All distinct tasks in this project, including those hidden by a filter. */
  tasks: Task[];
  visibleTasks: Task[];
}

export interface TaskListTreeOptions {
  search?: string;
  matchesTask?: (task: Task) => boolean;
  sortTasks?: (left: Task, right: Task) => number;
  sortLists?: (left: TaskListNode, right: TaskListNode) => number;
}

export interface TaskListParentOption {
  id: string;
  name: string;
  label: string;
  depth: number;
}

export type TaskListItem = { type: 'task'; task: Task } | { type: 'list'; node: TaskListNode };
/** Lists and tasks share a sibling order. Missing positions retain the previous display order. */
export function orderedTaskListItems(tasks: readonly Task[], lists: readonly TaskListNode[], manual = true): TaskListItem[] {
  const items: TaskListItem[] = [...tasks.map(task => ({ type: 'task' as const, task })), ...lists.map(node => ({ type: 'list' as const, node }))];
  if (!manual) return items;
  return items.sort((left, right) => {
    const a = left.type === 'task' ? left.task.position : left.node.position;
    const b = right.type === 'task' ? right.task.position : right.node.position;
    return (Number.isSafeInteger(a) && a! >= 0 ? a! : Infinity) - (Number.isSafeInteger(b) && b! >= 0 ? b! : Infinity) || 0;
  });
}

const MAX_LIST_DEPTH = 20;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function normalizedSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').trim();
}

/** Existing phases remain virtual until the user explicitly creates or changes a list. */
export function legacyTaskPhase(task: Pick<Task, 'phase'>): string | null {
  const phase = (task.phase ?? '').trim();
  return !phase || normalizedSearch(phase) === 'sans phase' ? null : phase;
}

export function legacyPhaseTaskListId(phase: string): string {
  return `legacy-phase:${encodeURIComponent(phase.trim())}`;
}

function dateValue(value: string | null): string | null {
  if (!value || !ISO_DATE.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

/** Counts distinct tasks and milestones; a milestone never adds allocated work. */
export function aggregateTaskListTasks(tasks: readonly Task[]): TaskListAggregate {
  const seen = new Set<string>();
  let allocatedHours = 0;
  let startDate: string | null = null;
  let endDate: string | null = null;
  for (const task of tasks) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    if (task.kind !== 'milestone' && Number.isFinite(task.allocatedHours) && task.allocatedHours > 0) allocatedHours += task.allocatedHours;
    const start = dateValue(task.startDate) ?? dateValue(task.endDate);
    const end = dateValue(task.endDate) ?? dateValue(task.startDate);
    if (start && (!startDate || start < startDate)) startDate = start;
    if (end && (!endDate || end > endDate)) endDate = end;
  }
  return { taskCount: seen.size, allocatedHours, startDate, endDate, taskIds: [...seen] };
}

function scopedLists(lists: readonly ProjectTaskList[], projectId: string): ProjectTaskList[] {
  const seen = new Set<string>();
  return lists.filter(list => {
    if (list.projectId !== projectId || seen.has(list.id)) return false;
    seen.add(list.id);
    return true;
  });
}

/** Produces safe display parents without writing back malformed legacy relationships. */
function displayParents(lists: readonly ProjectTaskList[]): Map<string, string | null> {
  const byId = new Map(lists.map(list => [list.id, list]));
  const parents = new Map(lists.map(list => [list.id, list.parentId !== list.id && byId.has(list.parentId ?? '') ? list.parentId : null]));
  const resolved = new Set<string>();
  for (const list of lists) {
    const chain: string[] = [];
    const positions = new Map<string, number>();
    let id: string | null = list.id;
    while (id && !resolved.has(id)) {
      const cycleStart = positions.get(id);
      if (cycleStart !== undefined) {
        for (const cycleId of chain.slice(cycleStart)) parents.set(cycleId, null);
        break;
      }
      positions.set(id, chain.length);
      chain.push(id);
      id = parents.get(id) ?? null;
    }
    for (const chainId of chain) resolved.add(chainId);
  }
  // Valid records already have at most 20 levels. Recover unexpectedly deep old data
  // in separate root branches, keeping every list and task accessible.
  for (const list of lists) {
    let id = parents.get(list.id) ?? null;
    let depth = 1;
    while (id && depth < MAX_LIST_DEPTH) {
      depth++;
      id = parents.get(id) ?? null;
    }
    if (id) parents.set(list.id, null);
  }
  return parents;
}

/** Includes the selected list and never follows lists from a different project. */
export function taskListDescendantIds(lists: readonly ProjectTaskList[], listId: string, projectId?: string): Set<string> {
  const selected = lists.find(list => list.id === listId && (!projectId || list.projectId === projectId));
  if (!selected) return new Set();
  const projectLists = scopedLists(lists, selected.projectId);
  const children = new Map<string, string[]>();
  for (const list of projectLists) {
    if (!list.parentId) continue;
    const ids = children.get(list.parentId) ?? [];
    ids.push(list.id);
    children.set(list.parentId, ids);
  }
  const result = new Set([selected.id]);
  const queue = [selected.id];
  for (let index = 0; index < queue.length; index++) {
    for (const childId of children.get(queue[index]) ?? []) {
      if (result.has(childId)) continue;
      result.add(childId);
      queue.push(childId);
    }
  }
  return result;
}

function pathFromParents(byId: ReadonlyMap<string, ProjectTaskList>, parents: ReadonlyMap<string, string | null>, listId: string | null | undefined): ProjectTaskList[] {
  const result: ProjectTaskList[] = [];
  let id = listId;
  while (id) {
    const list = byId.get(id);
    if (!list) break;
    result.unshift(list);
    id = parents.get(id) ?? null;
  }
  return result;
}

export function projectTaskListPath(lists: readonly ProjectTaskList[], projectId: string, listId: string | null | undefined): ProjectTaskList[] {
  const projectLists = scopedLists(lists, projectId);
  return pathFromParents(new Map(projectLists.map(list => [list.id, list])), displayParents(projectLists), listId);
}

/** Actual lists only: virtual legacy phases cannot be used as server parent IDs. */
export function projectTaskListParentOptions(lists: readonly ProjectTaskList[], projectId: string, excludeListId?: string): TaskListParentOption[] {
  const projectLists = scopedLists(lists, projectId);
  const excluded = excludeListId ? taskListDescendantIds(projectLists, excludeListId, projectId) : new Set<string>();
  const byId = new Map(projectLists.map(list => [list.id, list]));
  const parents = displayParents(projectLists);
  return projectLists.filter(list => !excluded.has(list.id)).map(list => {
    const path = pathFromParents(byId, parents, list.id);
    return { id: list.id, name: list.name, label: path.map(item => item.name).join(' / '), depth: Math.max(0, path.length - 1) };
  }).sort((left, right) => left.label.localeCompare(right.label, 'fr', { numeric: true, sensitivity: 'base' }));
}

export function taskListRecursiveTasks(node: TaskListNode): Task[] {
  const tasks: Task[] = [];
  const seenNodes = new Set<string>();
  const seenTasks = new Set<string>();
  const queue = [node];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (seenNodes.has(current.id)) continue;
    seenNodes.add(current.id);
    for (const task of current.tasks) {
      if (seenTasks.has(task.id)) continue;
      seenTasks.add(task.id);
      tasks.push(task);
    }
    queue.push(...current.children);
  }
  return tasks;
}

export function buildProjectTaskListTree(data: Pick<AppData, 'tasks' | 'taskLists'>, projectId: string, options: TaskListTreeOptions = {}): ProjectTaskListTree {
  const lists = scopedLists(data.taskLists ?? [], projectId);
  const parents = displayParents(lists);
  const nodes = new Map<string, TaskListNode>();
  const roots: TaskListNode[] = [];
  for (const list of lists) {
    nodes.set(list.id, { id: list.id, name: list.name, parentId: parents.get(list.id) ?? null, depth: 0, kind: 'list', list, legacyPhase: null, position: list.position, children: [], tasks: [], aggregate: aggregateTaskListTasks([]) });
  }
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const tasks: Task[] = [];
  const rootTasks: Task[] = [];
  const seenTasks = new Set<string>();
  for (const task of data.tasks) {
    if (task.projectId !== projectId || seenTasks.has(task.id)) continue;
    seenTasks.add(task.id);
    tasks.push(task);
    if (typeof task.listId === 'string') {
      const explicitList = nodes.get(task.listId);
      if (explicitList?.kind === 'list') explicitList.tasks.push(task);
      else rootTasks.push(task);
      continue;
    }
    const phase = legacyTaskPhase(task);
    if (!phase) {
      rootTasks.push(task);
      continue;
    }
    const id = legacyPhaseTaskListId(phase);
    let node = nodes.get(id);
    if (!node) {
      node = { id, name: phase, parentId: null, depth: 0, kind: 'legacy-phase', list: null, legacyPhase: phase, children: [], tasks: [], aggregate: aggregateTaskListTasks([]) };
      nodes.set(id, node);
      roots.push(node);
    }
    node.tasks.push(task);
  }
  function prepare(node: TaskListNode, depth: number): Task[] {
    node.depth = depth;
    const descendants = node.children.flatMap(child => prepare(child, depth + 1));
    node.aggregate = aggregateTaskListTasks([...node.tasks, ...descendants]);
    if (options.sortTasks) node.tasks.sort(options.sortTasks);
    if (options.sortLists) node.children.sort(options.sortLists);
    return [...node.tasks, ...descendants];
  }
  for (const node of roots) prepare(node, 0);
  if (options.sortTasks) rootTasks.sort(options.sortTasks);
  if (options.sortLists) roots.sort(options.sortLists);

  const query = normalizedSearch(options.search ?? '');
  const hasTaskFilter = Boolean(options.matchesTask);
  if (!query && !hasTaskFilter) return { roots, rootTasks, nodes, tasks, visibleTasks: [...tasks] };

  const visibleNodes = new Map<string, TaskListNode>();
  const visibleTaskIds = new Set<string>();
  function taskMatches(task: Task, listMatches = false): boolean {
    if (options.matchesTask && !options.matchesTask(task)) return false;
    return !query || listMatches || normalizedSearch(`${task.title} ${task.description} ${(task.tags ?? []).join(' ')}`).includes(query);
  }
  function filterNode(node: TaskListNode, ancestorMatches = false): TaskListNode | null {
    const listMatches = ancestorMatches || Boolean(query && normalizedSearch(node.name).includes(query));
    const filteredTasks = node.tasks.filter(task => taskMatches(task, listMatches));
    const children = node.children.map(child => filterNode(child, listMatches)).filter((child): child is TaskListNode => child !== null);
    if (!filteredTasks.length && !children.length && (hasTaskFilter || !listMatches)) return null;
    const visibleNode = { ...node, tasks: filteredTasks, children };
    visibleNodes.set(visibleNode.id, visibleNode);
    for (const task of filteredTasks) visibleTaskIds.add(task.id);
    return visibleNode;
  }
  const visibleRoots = roots.map(node => filterNode(node)).filter((node): node is TaskListNode => node !== null);
  const visibleRootTasks = rootTasks.filter(task => taskMatches(task));
  for (const task of visibleRootTasks) visibleTaskIds.add(task.id);
  return { roots: visibleRoots, rootTasks: visibleRootTasks, nodes: visibleNodes, tasks, visibleTasks: tasks.filter(task => visibleTaskIds.has(task.id)) };
}
