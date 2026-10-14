import { calendarItemOccursOnDate } from './calendar';
import { isLate } from './domain';
import { mondayOfWeek } from './time-sheets';
import type { AppData, CalendarEvent, Task, Unavailability } from './types';

export type PersonalCalendarItem =
  | { kind: 'task'; item: Task }
  | { kind: 'milestone'; item: Task }
  | { kind: 'event'; item: CalendarEvent }
  | { kind: 'unavailability'; item: Unavailability };

/** A dependency is blocked only while its actual predecessor remains unfinished. */
export function personalTaskDependency(task: Task, tasks: Task[]): Task | undefined {
  if (!task.dependsOnId || task.dependencyConstraint || task.status === 'done') return undefined;
  return tasks.find(parent => parent.id === task.dependsOnId && parent.status !== 'done');
}

export function personalTaskGroups(data: AppData, resourceId: string, includeBlocked = true) {
  const assigned = data.tasks.filter(task => task.assigneeId === resourceId && task.kind === 'task');
  const open = assigned.filter(task => task.status !== 'done');
  const visible = open.filter(task => includeBlocked || !personalTaskDependency(task, data.tasks));
  const compare = (a: Task, b: Task) => (a.endDate ?? '9999-12-31').localeCompare(b.endDate ?? '9999-12-31')
    || a.title.localeCompare(b.title, 'fr');
  return {
    completed: assigned.filter(task => task.status === 'done'),
    blockedCount: open.filter(task => personalTaskDependency(task, data.tasks)).length,
    upcoming: visible.filter(task => !isLate(task, data.today)).sort(compare),
    overdue: visible.filter(task => isLate(task, data.today)).sort(compare),
  };
}

function minutes(value: string | null): number | null {
  if (!value || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hours, minute] = value.split(':').map(Number);
  return hours * 60 + minute;
}

/** Only events and partial absences have times. Task dates are never midnight appointments. */
export function personalCalendarTimeRange(entry: PersonalCalendarItem, date: string): { start: number; end: number } | null {
  if (entry.kind === 'task' || entry.kind === 'milestone' || entry.item.allDay) return null;
  if (!calendarItemOccursOnDate(entry.item, date)) return null;
  const first = minutes(entry.item.startTime);
  const last = minutes(entry.item.endTime);
  if (first === null || last === null) return null;
  const start = entry.item.startDate === date ? first : 0;
  const end = entry.item.endDate === date ? last : 24 * 60;
  return end > start ? { start, end } : null;
}

export function personalCalendarItems(data: AppData, resourceId: string, date: string, includeBlocked = true): PersonalCalendarItem[] {
  const tasks = data.tasks.flatMap(task => {
    if (task.assigneeId !== resourceId || task.status === 'done'
      || (!includeBlocked && personalTaskDependency(task, data.tasks))) return [];
    const first = task.startDate ?? task.endDate;
    const last = task.endDate ?? task.startDate;
    if (!first || !last || !calendarItemOccursOnDate({ startDate: first, endDate: last }, date)) return [];
    return [{ kind: task.kind, item: task } satisfies PersonalCalendarItem];
  });
  const events = (data.calendarEvents ?? []).filter(event => event.resourceIds.includes(resourceId)
    && calendarItemOccursOnDate(event, date)).map(item => ({ kind: 'event', item } as const));
  const absences = (data.unavailabilities ?? []).filter(absence => absence.resourceId === resourceId
    && calendarItemOccursOnDate(absence, date)).map(item => ({ kind: 'unavailability', item } as const));
  const entries: PersonalCalendarItem[] = [...tasks, ...events, ...absences];
  return entries
    .filter(entry => entry.kind === 'task' || entry.kind === 'milestone' || entry.item.allDay || personalCalendarTimeRange(entry, date))
    .sort((a, b) => (personalCalendarTimeRange(a, date)?.start ?? -1) - (personalCalendarTimeRange(b, date)?.start ?? -1)
      || a.item.title.localeCompare(b.item.title, 'fr'));
}

export interface PersonalTimedItem {
  entry: PersonalCalendarItem; start: number; end: number; lane: number; lanes: number;
}

/** Connected groups share a column count; touching appointments do not overlap. */
export function personalTimedLayout(entries: PersonalCalendarItem[], date: string): PersonalTimedItem[] {
  const sorted = entries.flatMap(entry => {
    const range = personalCalendarTimeRange(entry, date);
    return range ? [{ entry, ...range, lane: 0, lanes: 1 }] : [];
  }).sort((a, b) => a.start - b.start || a.end - b.end);
  let group: PersonalTimedItem[] = [];
  let groupEnd = 0;
  let laneEnds: number[] = [];
  const finish = () => { for (const item of group) item.lanes = laneEnds.length; };
  for (const item of sorted) {
    if (group.length && item.start >= groupEnd) {
      finish(); group = []; laneEnds = []; groupEnd = 0;
    }
    let lane = laneEnds.findIndex(end => end <= item.start);
    if (lane === -1) lane = laneEnds.length;
    item.lane = lane;
    laneEnds[lane] = item.end;
    groupEnd = Math.max(groupEnd, item.end);
    group.push(item);
  }
  finish();
  return sorted;
}

export function personalWeekNumber(date: string): number {
  const thursday = new Date(`${mondayOfWeek(date)}T12:00:00Z`);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const first = mondayOfWeek(`${thursday.getUTCFullYear()}-01-04`);
  return Math.round((Date.parse(`${mondayOfWeek(date)}T12:00:00Z`) - Date.parse(`${first}T12:00:00Z`)) / (7 * 86_400_000)) + 1;
}
