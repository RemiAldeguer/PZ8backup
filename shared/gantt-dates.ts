import { GANTT_DAY, ganttStamp } from './project-gantt';

export interface GanttDateRecord { id: string; kind: 'task' | 'milestone' | 'project'; startDate: string | null; endDate: string | null; }
export type GanttDatePart = 'start' | 'end' | 'move';
export interface GanttDatePatch { startDate: string | null; endDate: string | null; }
const MIN_DATE = ganttStamp('0001-01-01'); const MAX_DATE = ganttStamp('9999-12-31');
const iso = (stamp: number) => new Date(stamp).toISOString().slice(0, 10);
/** Calendar-day edits, independent of the host timezone, zoom and daylight saving. */
export function ganttDatePatch(record: GanttDateRecord, part: GanttDatePart, deltaDays: number): GanttDatePatch | null {
  const start = record.startDate ?? record.endDate; const end = record.endDate ?? record.startDate;
  if (!start || !end || !Number.isFinite(deltaDays)) return null;
  const a = ganttStamp(start); const b = ganttStamp(end); let delta = Math.round(deltaDays) * GANTT_DAY;
  if (record.kind === 'milestone') {
    const date = iso(Math.max(MIN_DATE, Math.min(MAX_DATE, b + delta)));
    return { startDate: record.startDate ? date : null, endDate: record.endDate ? date : null };
  }
  if (part === 'start') return { startDate: iso(Math.max(MIN_DATE, Math.min(b, a + delta))), endDate: end };
  if (part === 'end') return { startDate: start, endDate: iso(Math.min(MAX_DATE, Math.max(a, b + delta))) };
  delta = Math.max(MIN_DATE - a, Math.min(MAX_DATE - b, delta));
  return { startDate: record.startDate ? iso(a + delta) : null, endDate: record.endDate ? iso(b + delta) : null };
}
export function ganttDurationDays(dates: GanttDatePatch): number | null {
  if (!dates.startDate && !dates.endDate) return null;
  return Math.max(1, Math.round((ganttStamp(dates.endDate ?? dates.startDate!) - ganttStamp(dates.startDate ?? dates.endDate!)) / GANTT_DAY) + 1);
}
