import type { AppData, ProjectStatus, Resource, TimeEntry } from './types';
import { timeIntegrationIndex } from './time-integration';

export interface TimeSheetRow {
  id: string;
  kind: 'resource' | 'project' | 'phase' | 'task';
  label: string;
  resourceId: string;
  projectId?: string;
  taskId?: string;
  jobTitle?: string;
  allocated: number;
  spent: number;
  weekSpent: number;
  remaining: number;
  days: number[];
  /** All-time entries matching the validation filter, including dates outside the week. */
  entries: TimeEntry[];
  children: TimeSheetRow[];
}

export interface TimeSheetOptions {
  weekStart: string;
  resourceId?: string;
  projectId?: string;
  projectStatuses?: ProjectStatus[];
  includeInactive?: boolean;
  includeFinished?: boolean;
  validation?: 'all' | 'pending' | 'validated';
}

function calendarDate(date: string): Date {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new RangeError('Une date de calendrier valide au format AAAA-MM-JJ est requise.');
  }
  return parsed;
}

/** Calendar arithmetic stays in UTC so a Paris DST transition never moves a day. */
export function addCalendarDays(date: string, days: number): string {
  if (!Number.isInteger(days)) throw new RangeError('Le décalage doit être un nombre entier de jours.');
  const result = calendarDate(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

export function mondayOfWeek(date: string): string {
  const parsed = calendarDate(date);
  return addCalendarDays(date, -((parsed.getUTCDay() + 6) % 7));
}

export function weekDates(date: string): string[] {
  const monday = mondayOfWeek(date);
  return Array.from({ length: 7 }, (_, index) => addCalendarDays(monday, index));
}

// Display formatting is separate from arithmetic: API entries may contain fractions
// smaller than 0.01 h. Only normalize floating-point noise after summing a group.
function canonicalHours(value: number): number { return Number(value.toFixed(12)); }
function total(values: number[]): number { return canonicalHours(values.reduce((sum, value) => sum + value, 0)); }
function difference(allocated: number, spent: number): number { return canonicalHours(allocated - spent); }
function rowId(...parts: string[]): string { return parts.map(encodeURIComponent).join('/'); }

function parentRow(identity: Pick<TimeSheetRow, 'id' | 'kind' | 'label' | 'resourceId' | 'projectId' | 'jobTitle'>, children: TimeSheetRow[]): TimeSheetRow {
  const allocated = total(children.map(row => row.allocated));
  const spent = total(children.map(row => row.spent));
  return {
    ...identity,
    allocated,
    spent,
    weekSpent: total(children.map(row => row.weekSpent)),
    remaining: difference(allocated, spent),
    days: Array.from({ length: 7 }, (_, index) => total(children.map(row => row.days[index]))),
    entries: children.flatMap(row => row.entries),
    children,
  };
}

/** Membership is independent of week, validation and task-display filters. */
export function projectTimeResources(data: AppData, projectId: string): Resource[] {
  if (!data.projects.some(project => project.id === projectId)) return [];
  const projectTasks = data.tasks.filter(task => task.projectId === projectId);
  const taskIds = new Set(projectTasks.map(task => task.id));
  const associatedIds = new Set(projectTasks.flatMap(task => task.assigneeId ? [task.assigneeId] : []));
  for (const entry of data.timeEntries) {
    if (taskIds.has(entry.taskId)) associatedIds.add(entry.resourceId);
  }
  return data.resources.filter(resource => resource.projectIds?.includes(projectId) || associatedIds.has(resource.id));
}

/**
 * One tree per resource. Allocations follow the current assignee; actual time follows
 * the resource recorded on each entry, including work performed before reassignment.
 * Totals are reduced from leaf rows only, so expanding a group cannot duplicate time.
 */
export function buildTimeSheet(data: AppData, options: TimeSheetOptions): TimeSheetRow[] {
  const integration = timeIntegrationIndex(data);
  const dates = weekDates(options.weekStart);
  const projects = data.projects.filter(project =>
    (!options.projectId || project.id === options.projectId)
    && (!options.projectStatuses || options.projectStatuses.includes(project.status)),
  );
  const projectIds = new Set(projects.map(project => project.id));
  const scopedResourceIds = options.projectId
    ? new Set(projectTimeResources(data, options.projectId).map(resource => resource.id))
    : undefined;
  const tasks = data.tasks.filter(task => task.kind === 'task'
    && projectIds.has(task.projectId)
    && (options.includeFinished !== false || task.status !== 'done'));
  const taskIds = new Set(tasks.map(task => task.id));
  const historyByResource = new Map<string, Set<string>>();
  const entriesByResourceTask = new Map<string, TimeEntry[]>();
  for (const original of data.timeEntries) {
    const entry = integration.decorate(original);
    if (!taskIds.has(entry.taskId)) continue;
    const history = historyByResource.get(entry.resourceId) ?? new Set<string>();
    history.add(entry.taskId);
    historyByResource.set(entry.resourceId, history);
    if (options.validation === 'pending' && entry.validated) continue;
    if (options.validation === 'validated' && !entry.validated) continue;
    const key = rowId(entry.resourceId, entry.taskId);
    const matching = entriesByResourceTask.get(key) ?? [];
    matching.push(entry);
    entriesByResourceTask.set(key, matching);
  }

  return data.resources.filter(resource => (!scopedResourceIds || (projectIds.size > 0 && scopedResourceIds.has(resource.id)))
    && (options.includeInactive || resource.active)
    && (!options.resourceId || resource.id === options.resourceId)).map(resource => {
    const history = historyByResource.get(resource.id);
    const relevantTasks = tasks.filter(task => task.assigneeId === resource.id || history?.has(task.id));
    const projectRows = projects.flatMap(project => {
      const projectTasks = relevantTasks.filter(task => task.projectId === project.id);
      if (!projectTasks.length && !resource.projectIds?.includes(project.id) && !scopedResourceIds?.has(resource.id)) return [];
      const phases = new Map<string, TimeSheetRow[]>();
      for (const task of projectTasks) {
        const entries = [...(entriesByResourceTask.get(rowId(resource.id, task.id)) ?? [])];
        const allocated = task.assigneeId === resource.id ? canonicalHours(task.allocatedHours) : 0;
        const spent = total(entries.map(entry => entry.hours));
        const daily = dates.map(date => total(entries.filter(entry => entry.date === date).map(entry => entry.hours)));
        const taskRow: TimeSheetRow = {
          id: rowId('resource', resource.id, 'project', project.id, 'task', task.id),
          kind: 'task', label: task.title, resourceId: resource.id, projectId: project.id, taskId: task.id,
          allocated, spent, weekSpent: total(daily), remaining: difference(allocated, spent),
          days: daily, entries, children: [],
        };
        const phaseRows = phases.get(task.phase) ?? [];
        phaseRows.push(taskRow);
        phases.set(task.phase, phaseRows);
      }
      const phaseRows = [...phases].map(([phase, children]) => parentRow({
        id: rowId('resource', resource.id, 'project', project.id, 'phase', phase),
        kind: 'phase', label: phase || 'Sans phase', resourceId: resource.id, projectId: project.id,
      }, children));
      return [parentRow({
        id: rowId('resource', resource.id, 'project', project.id),
        kind: 'project', label: project.name, resourceId: resource.id, projectId: project.id,
      }, phaseRows)];
    });
    return parentRow({
      id: rowId('resource', resource.id), kind: 'resource', label: resource.name,
      resourceId: resource.id, jobTitle: resource.jobTitle,
    }, projectRows);
  });
}
