import type { AppData } from './types';
import { resourceLoad } from './domain';
import { addCalendarDays } from './time-sheets';
import { personalCalendarTimeRange } from './personal-calendar';
import { planzonePreferences } from './planzone-preferences';

export interface PlanningWarning { id: string; date: string; message: string; kind: 'span' | 'work' | 'rest' | 'absence' }
const decimal = (hours: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(hours);
/** Warnings use visible planning only; date-only tasks never invent a start/end clock. */
export function planningWarnings(data: AppData, resourceId: string, startDate: string, endDate: string): PlanningWarning[] {
  const resource = data.resources.find(item => item.id === resourceId);
  if (!resource || !startDate || !endDate || startDate > endDate) return [];
  const preferences = planzonePreferences(data), result: PlanningWarning[] = [];
  if (preferences.criticalDailySpanHours === 0 && preferences.criticalDailyWorkHours === 0 && preferences.minimumRestHours === 0 && !preferences.warnDuringUnavailability) return [];
  const tasks = data.tasks.filter(task => task.assigneeId === resourceId && task.kind === 'task' && task.status !== 'done');
  const events = data.calendarEvents.filter(event => event.resourceIds.includes(resourceId) && !event.allDay);
  function ranges(date: string) {
    return events.filter(event => event.startDate <= date && event.endDate >= date)
      .map(event => personalCalendarTimeRange({ kind: 'event', item: event }, date)).filter(range => range !== null);
  }
  let date = startDate;
  for (let count = 0; count < 31 && date <= endDate; count++, date = addCalendarDays(date, 1)) {
    const timed = ranges(date);
    const first = timed.length ? Math.min(...timed.map(range => range.start)) : null;
    const last = timed.length ? Math.max(...timed.map(range => range.end)) : null;
    const span = first !== null && last !== null ? (last - first) / 60 : 0;
    const load = preferences.criticalDailyWorkHours > 0 ? resourceLoad(resource, tasks, date, date) + timed.reduce((sum, range) => sum + (range.end - range.start) / 60, 0) : 0;
    if (preferences.criticalDailySpanHours > 0 && span > preferences.criticalDailySpanHours) result.push({ id: 'span:' + date, date, kind: 'span', message: `Amplitude de ${decimal(span)} h supérieure au seuil de ${decimal(preferences.criticalDailySpanHours)} h.` });
    if (preferences.criticalDailyWorkHours > 0 && load > preferences.criticalDailyWorkHours) result.push({ id: 'work:' + date, date, kind: 'work', message: `Charge planifiée de ${decimal(load)} h supérieure au seuil de ${decimal(preferences.criticalDailyWorkHours)} h.` });
    if (preferences.minimumRestHours > 0 && first !== null) {
      const previous = ranges(addCalendarDays(date, -1));
      const previousEnd = previous.length ? Math.max(...previous.map(range => range.end)) : null;
      const rest = previousEnd === null ? null : (1440 - previousEnd + first) / 60;
      if (rest !== null && rest < preferences.minimumRestHours) result.push({ id: 'rest:' + date, date, kind: 'rest', message: `Repos entre deux journées de ${decimal(rest)} h inférieur au seuil de ${decimal(preferences.minimumRestHours)} h.` });
    }
    if (preferences.warnDuringUnavailability) {
      const absences = data.unavailabilities.filter(absence => absence.resourceId === resourceId && absence.startDate <= date && absence.endDate >= date);
      const active = tasks.filter(task => task.startDate && task.endDate && task.startDate <= date && task.endDate >= date);
      if (absences.length && active.length) result.push({ id: 'absence:' + date, date, kind: 'absence', message: `Indisponibilité pendant ${active.length} tâche${active.length > 1 ? 's' : ''} planifiée${active.length > 1 ? 's' : ''}.` });
    }
  }
  return result;
}
