import type { AppData, Project, Task, TaskStatus } from './types';
import { aggregateTaskListTasks, buildProjectTaskListTree, orderedTaskListItems, type TaskListNode, type TaskListAggregate } from './task-lists';

export interface ZoneElementRow {
  id: string; kind: 'project' | 'list' | 'task'; name: string; project: Project;
  task?: Task; list?: TaskListNode; depth: number; children: ZoneElementRow[];
  aggregate: TaskListAggregate; spentHours: number; startDate: string | null; endDate: string | null;
}
export interface ZoneElementOptions {
  zoneId: string | null; projectId?: string; search?: string; status?: TaskStatus;
  resourceId?: string; kind?: 'task' | 'milestone';
}
const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').trim();

/** Reuses each project's hierarchy. Keys include project IDs because legacy phase names can repeat. */
export function buildZoneElementTree(data: Pick<AppData, 'projects' | 'tasks' | 'taskLists' | 'timeEntries'>, options: ZoneElementOptions): ZoneElementRow[] {
  const projects = data.projects.filter(project => (!options.zoneId || project.zoneId === options.zoneId) && (!options.projectId || project.id === options.projectId));
  const search = normalized(options.search ?? '');
  const filtered = Boolean(search || options.status || options.resourceId || options.kind);
  const taskHours = new Map<string, number>();
  for (const entry of data.timeEntries) taskHours.set(entry.taskId, (taskHours.get(entry.taskId) ?? 0) + entry.hours);
  const spent = (aggregate: TaskListAggregate) => aggregate.taskIds.reduce((total, id) => total + (taskHours.get(id) ?? 0), 0);
  return projects.flatMap(project => {
    const projectMatches = Boolean(search && normalized(`${project.name} ${project.description}`).includes(search));
    const tree = buildProjectTaskListTree(data, project.id, {
      search: projectMatches ? '' : search,
      ...((options.status || options.resourceId || options.kind) ? { matchesTask: (task: Task) => (!options.status || task.status === options.status) && (!options.resourceId || (options.resourceId === 'unassigned' ? !task.assigneeId : task.assigneeId === options.resourceId)) && (!options.kind || task.kind === options.kind) } : {}),
    });
    if (filtered && !projectMatches && !tree.visibleTasks.length && !tree.roots.length) return [];
    if ((options.status || options.resourceId || options.kind) && !tree.visibleTasks.length && !tree.roots.length) return [];
    function rows(tasks: Task[], lists: TaskListNode[], depth: number): ZoneElementRow[] {
      return orderedTaskListItems(tasks, lists).map(item => {
        if (item.type === 'task') {
          const task = item.task; const aggregate = aggregateTaskListTasks([task]);
          return { id: `task:${task.id}`, kind: 'task', name: task.title, project, task, depth, children: [], aggregate, spentHours: spent(aggregate), startDate: aggregate.startDate, endDate: aggregate.endDate };
        }
        const list = item.node;
        return { id: `list:${project.id}:${list.id}`, kind: 'list', name: list.name, project, list, depth, children: rows(list.tasks, list.children, depth + 1), aggregate: list.aggregate, spentHours: spent(list.aggregate), startDate: list.aggregate.startDate, endDate: list.aggregate.endDate };
      });
    }
    const aggregate = aggregateTaskListTasks(tree.tasks);
    return [{ id: `project:${project.id}`, kind: 'project', name: project.name, project, depth: 0, children: rows(tree.rootTasks, tree.roots, 1), aggregate, spentHours: spent(aggregate), startDate: project.startDate, endDate: project.endDate }];
  });
}

export function flattenZoneElements(roots: ZoneElementRow[], collapsed: ReadonlySet<string> = new Set()): ZoneElementRow[] {
  const result: ZoneElementRow[] = [];
  function visit(row: ZoneElementRow) { result.push(row); if (!collapsed.has(row.id)) row.children.forEach(visit); }
  roots.forEach(visit); return result;
}
