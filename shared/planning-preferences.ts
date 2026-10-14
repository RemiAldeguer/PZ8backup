import type { AppData, Resource, Task } from './types';
import { businessDays, resourceCapacity } from './domain';
import { normalizeResource } from './resources';
import { addCalendarDays } from './time-sheets';
import { ganttDatePatch, type GanttDatePart, type GanttDateRecord } from './gantt-dates';
import { planzonePreferences } from './planzone-preferences';

export function durationAllocation(task: Pick<Task, 'startDate' | 'endDate' | 'kind'>, resource?: Resource): number | null {
  if (task.kind === 'milestone') return 0;
  if (!task.startDate || !task.endDate) return null;
  if ((Date.parse(task.endDate) - Date.parse(task.startDate)) / 86400000 > 36_600) return null;
  return resource ? resourceCapacity(resource, task.startDate, task.endDate, []) : businessDays(task.startDate, task.endDate) * 8;
}
export function workingDurationDays(start: string, end: string, resource?: Resource): number {
  if (!resource) return businessDays(start, end);
  let days = 0, date = start;
  for (let count = 0; count < 36_600 && date <= end; count++, date = addCalendarDays(date, 1)) if (resourceCapacity(resource, date, date, []) > 0) days++;
  return days;
}
/** Working-calendar movement is bounded, including a resource with zero capacity. */
export function workingMoveEnd(startDate: string, durationDays: number, resource?: Resource): string | null {
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 36_600) return null;
  if (resource && normalizeResource(resource).weeklyCapacityHours.every(hours => hours === 0)) return null;
  let date = startDate, remaining = durationDays;
  for (let attempts = 0; attempts < 51_500; attempts++) {
    const working = resource ? resourceCapacity(resource, date, date, []) > 0 : businessDays(date, date) > 0;
    if (working && --remaining === 0) return date;
    if (date >= '9999-12-31') return null;
    date = addCalendarDays(date, 1);
  }
  return null;
}
export function preferenceGanttPatch(data: AppData, record: GanttDateRecord, part: GanttDatePart, delta: number) {
  const patch = ganttDatePatch(record, part, delta);
  if (!patch || record.kind !== 'task' || part !== 'move' || !patch.startDate || !patch.endDate || !planzonePreferences(data).extendAcrossNonWorkingDays || Math.round(delta) === 0) return patch;
  const task = data.tasks.find(item => item.id === record.id);
  const resource = data.resources.find(item => item.id === task?.assigneeId);
  const duration = record.startDate && record.endDate ? workingDurationDays(record.startDate, record.endDate, resource) : 1;
  const endDate = workingMoveEnd(patch.startDate, Math.max(1, duration), resource);
  return endDate ? { ...patch, endDate } : null;
}
