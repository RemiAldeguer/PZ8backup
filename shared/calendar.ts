import type { Unavailability } from './types';

/** Calendar dates are inclusive ISO days, independent of the viewer's timezone. */
export function calendarItemOccursOnDate(item: { startDate: string; endDate: string }, date: string): boolean {
  return item.startDate <= date && date <= item.endDate;
}

function timeInMinutes(time: string | null): number | null {
  if (!time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Deduct unavailable local-clock hours from a day's configured capacity.
 * Resources have a daily number of hours, not a work-start/work-end schedule:
 * no office-hours window is assumed. Overlapping absences are deducted once.
 * Partial absences apply to one ISO day and use wall-clock duration, including
 * on daylight-saving transition days; full-day absences override partial ones.
 */
export function remainingDailyCapacity(
  baseHours: number,
  resourceId: string,
  date: string,
  unavailabilities: Unavailability[] = [],
): number {
  if (baseHours <= 0) return 0;
  const intervals: [number, number][] = [];
  for (const absence of unavailabilities) {
    if (absence.resourceId !== resourceId || !calendarItemOccursOnDate(absence, date)) continue;
    if (absence.allDay) return 0;
    if (absence.startDate !== date || absence.endDate !== date) continue;
    const start = timeInMinutes(absence.startTime);
    const end = timeInMinutes(absence.endTime);
    if (start !== null && end !== null && end > start) intervals.push([start, end]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let unavailableMinutes = 0;
  let mergedStart = 0;
  let mergedEnd = 0;
  for (const [start, end] of intervals) {
    if (start > mergedEnd) {
      unavailableMinutes += mergedEnd - mergedStart;
      mergedStart = start;
      mergedEnd = end;
    } else {
      mergedEnd = Math.max(mergedEnd, end);
    }
  }
  unavailableMinutes += mergedEnd - mergedStart;
  return Math.max(0, baseHours - unavailableMinutes / 60);
}
