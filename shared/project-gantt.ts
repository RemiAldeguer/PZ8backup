import type { Project, Task } from './types';
import { aggregateTaskListTasks, orderedTaskListItems, type ProjectTaskListTree, type TaskListNode } from './task-lists';

export interface ProjectGanttRow {
  id: string; kind: 'project' | 'list' | 'task'; name: string; depth: number;
  task?: Task; node?: TaskListNode; startDate: string | null; endDate: string | null;
  allocatedHours: number; taskCount: number;
}
/** Same mixed sibling order and depths as NestedListView, including undated and empty items. */
export function projectGanttRows(project: Project, tree: ProjectTaskListTree, collapsed: ReadonlySet<string>, manual = true): ProjectGanttRow[] {
  const aggregate = aggregateTaskListTasks(tree.tasks);
  const rows: ProjectGanttRow[] = [{ id: `project:${project.id}`, kind: 'project', name: project.name, depth: -1,
    startDate: project.startDate, endDate: project.endDate, allocatedHours: aggregate.allocatedHours, taskCount: aggregate.taskCount }];
  function visit(tasks: Task[], lists: TaskListNode[], depth: number) {
    for (const item of orderedTaskListItems(tasks, lists, manual)) {
      if (item.type === 'task') {
        rows.push({ id: `task:${item.task.id}`, kind: 'task', task: item.task, name: item.task.title, depth,
          startDate: item.task.startDate, endDate: item.task.endDate, allocatedHours: item.task.allocatedHours, taskCount: 1 });
      } else {
        const node = item.node; rows.push({ id: `list:${node.id}`, kind: 'list', node, name: node.name, depth,
          startDate: node.aggregate.startDate, endDate: node.aggregate.endDate, allocatedHours: node.aggregate.allocatedHours, taskCount: node.aggregate.taskCount });
        if (!collapsed.has(`list:${node.id}`)) visit(node.tasks, node.children, depth + 1);
      }
    }
  }
  if (!collapsed.has(`project:${project.id}`)) visit(tree.rootTasks, tree.roots, 0);
  return rows;
}

export const GANTT_DAY = 86_400_000;
export const ganttStamp = (date: string) => Date.parse(`${date}T00:00:00Z`);
export type GanttScale = 'project' | 'month' | 'quarter' | 'year';
export interface GanttRange { start: number; end: number; }
export function projectGanttRange(project: Project, tasks: Task[], scale: GanttScale, anchor: string, offset = 0): GanttRange {
  if (scale === 'project') {
    const dates = [project.startDate, project.endDate, ...tasks.flatMap(task => [task.startDate, task.endDate].filter((date): date is string => !!date))].map(ganttStamp);
    const start = Math.min(...dates) - 7 * GANTT_DAY;
    const end = Math.max(...dates) + 8 * GANTT_DAY;
    return { start: start + offset * (end - start), end: end + offset * (end - start) };
  }
  const date = new Date(ganttStamp(anchor)); const months = scale === 'month' ? 1 : scale === 'quarter' ? 3 : 12;
  const month = scale === 'year' ? 0 : scale === 'quarter' ? Math.floor(date.getUTCMonth() / 3) * 3 : date.getUTCMonth();
  return { start: Date.UTC(date.getUTCFullYear(), month + offset * months, 1), end: Date.UTC(date.getUTCFullYear(), month + (offset + 1) * months, 1) };
}
export function ganttBarRange(row: ProjectGanttRow, range: GanttRange): { left: number; right: number; milestone: boolean } | null {
  const date = row.startDate ?? row.endDate; const finish = row.endDate ?? row.startDate;
  if (!date || !finish) return null;
  const milestone = row.task?.kind === 'milestone';
  const start = ganttStamp(milestone ? finish : date); const end = ganttStamp(finish) + (milestone ? 0 : GANTT_DAY);
  if (start >= range.end || (milestone ? end < range.start : end <= range.start)) return null;
  const position = (value: number) => (value - range.start) / (range.end - range.start);
  return { left: Math.max(0, position(start)), right: Math.min(1, position(end)), milestone };
}
export interface GanttTick { left: number; width: number; label: string; date: string; }
export function ganttTicks(range: GanttRange, major: boolean): GanttTick[] {
  const days = (range.end - range.start) / GANTT_DAY;
  const unit = major ? days > 370 ? 'year' : 'month' : days <= 62 ? 'day' : days <= 180 ? 'week' : 'month';
  const first = new Date(range.start);
  if (unit === 'year') first.setUTCMonth(0, 1);
  if (unit === 'month') first.setUTCDate(1);
  if (unit === 'week') first.setUTCDate(first.getUTCDate() - (first.getUTCDay() + 6) % 7);
  const estimate = days / (unit === 'year' ? 365.25 : unit === 'month' ? 30.4 : unit === 'week' ? 7 : 1);
  const step = Math.max(1, Math.ceil(estimate / (major ? 40 : 160)));
  const result: GanttTick[] = [];
  for (let cursor = first.getTime(), count = 0; cursor < range.end && count < 170; count++) {
    const next = new Date(cursor);
    if (unit === 'year') next.setUTCFullYear(next.getUTCFullYear() + step);
    else if (unit === 'month') next.setUTCMonth(next.getUTCMonth() + step);
    else next.setUTCDate(next.getUTCDate() + step * (unit === 'week' ? 7 : 1));
    const left = Math.max(cursor, range.start); const end = Math.min(next.getTime(), range.end);
    const label = unit === 'year' ? String(new Date(cursor).getUTCFullYear()) : unit === 'month' ? new Intl.DateTimeFormat('fr-FR', { month: major ? 'short' : 'narrow', ...(major ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(cursor) : unit === 'week' ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(cursor) : String(new Date(cursor).getUTCDate());
    result.push({ left: (left - range.start) / (range.end - range.start), width: (end - left) / (range.end - range.start), label, date: new Date(cursor).toISOString().slice(0, 10) });
    cursor = next.getTime();
  }
  return result;
}
/** Validate a finish → start edge without changing dates or breaking the existing chain. */
export function dependencyProblem(tasks: Task[], predecessorId: string, successorId: string): string | null {
  const predecessor = tasks.find(task => task.id === predecessorId); const successor = tasks.find(task => task.id === successorId);
  if (!predecessor || !successor || predecessor.projectId !== successor.projectId) return 'Choisissez deux éléments du même projet.';
  if (predecessorId === successorId) return 'Une tâche ne peut pas dépendre d’elle-même.';
  const visited = new Set([successorId]); let current: Task | undefined = predecessor;
  while (current) {
    if (visited.has(current.id)) return 'Cette contrainte crée un cycle.';
    visited.add(current.id); current = tasks.find(task => task.id === current!.dependsOnId);
  }
  if ((successor.status === 'done' || successor.status === 'in_progress' || successor.status === 'validation' || successor.progress > 0) && predecessor.status !== 'done') return 'Le prédécesseur doit être terminé car la tâche suivante a déjà démarré.';
  return null;
}
