import type { CostProfile, Resource, Task, TimeEntry, Unavailability } from './types';
import { normalizeResource, type NormalizedResource } from './resources';
import { remainingDailyCapacity } from './calendar';

export function dateInParis(date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' }).format(date);
}
export function formatDate(date: string | null | undefined): string {
  if (!date) return 'Non planifié';
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}
export function formatHours(hours: number): string {
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(hours)} h`;
}
export function formatMoney(amount: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);
}
export function isLate(task: Task, today = dateInParis()): boolean {
  return Boolean(task.endDate && task.endDate < today && task.status !== 'done');
}
export function taskMetrics(tasks: Task[], entries: TimeEntry[], today = dateInParis()) {
  const work = tasks.filter(t => t.kind === 'task');
  const ids = new Set(tasks.map(t => t.id));
  const allocatedHours = work.reduce((n, t) => n + t.allocatedHours, 0);
  const realizedHours = work.reduce((n, t) => n + t.allocatedHours * t.progress / 100, 0);
  const lateHours = work.filter(t => isLate(t, today)).reduce((n, t) => n + t.allocatedHours * (1 - t.progress / 100), 0);
  return {
    total: work.length,
    completed: work.filter(t => t.status === 'done').length,
    overdue: work.filter(t => isLate(t, today)).length,
    inProgress: work.filter(t => t.status === 'in_progress').length,
    allocatedHours,
    spentHours: entries.filter(e => ids.has(e.taskId)).reduce((n, e) => n + e.hours, 0),
    progress: allocatedHours > 0 ? realizedHours / allocatedHours * 100 : 0,
    realizedHours, lateHours, openHours: Math.max(0, allocatedHours - realizedHours - lateHours),
    milestones: tasks.filter(t => t.kind === 'milestone').length,
    completedMilestones: tasks.filter(t => t.kind === 'milestone' && t.status === 'done').length,
  };
}
function dayRange(start: string, end: string): Date[] {
  const days: Date[] = [];
  const from = new Date(`${start}T12:00:00Z`);
  const to = new Date(`${end}T12:00:00Z`);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) return days;
  for (const cursor = new Date(from); cursor <= to; cursor.setUTCDate(cursor.getUTCDate() + 1)) days.push(new Date(cursor));
  return days;
}
export function businessDays(start: string, end: string): number {
  return dayRange(start, end).filter(d => d.getUTCDay() > 0 && d.getUTCDay() < 6).length;
}
const holidayCache = new Map<number, ReadonlySet<string>>();
/** National French public holidays; regional additions require a separate calendar. */
export function frenchHolidayDates(year: number): ReadonlySet<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  // Gregorian Easter (Meeus/Jones/Butcher), expressed at UTC noon to avoid DST shifts.
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = (h + l - 7 * m + 114) % 31 + 1;
  const easter = new Date(Date.UTC(year, month - 1, day, 12));
  const dates = new Set(['01-01', '05-01', '05-08', '07-14', '08-15', '11-01', '11-11', '12-25'].map(date => `${year}-${date}`));
  for (const offset of [1, 39, 50]) {
    const movableHoliday = new Date(easter);
    movableHoliday.setUTCDate(movableHoliday.getUTCDate() + offset);
    dates.add(movableHoliday.toISOString().slice(0, 10));
  }
  holidayCache.set(year, dates);
  return dates;
}
function isResourceHoliday(resource: NormalizedResource, date: Date): boolean {
  return resource.holidayCalendarId === 'fr' && frenchHolidayDates(date.getUTCFullYear()).has(date.toISOString().slice(0, 10));
}
function resourceHoursOnDay(resource: NormalizedResource, date: Date): number {
  if (isResourceHoliday(resource, date)) return 0;
  return resource.weeklyCapacityHours[(date.getUTCDay() + 6) % 7];
}
export function resourceCapacity(resource: Resource, start: string, end: string, unavailabilities: Unavailability[] = []): number {
  if (!resource.active) return 0;
  const normalized = normalizeResource(resource);
  return dayRange(start, end).reduce((hours, day) => hours + remainingDailyCapacity(
    resourceHoursOnDay(normalized, day), resource.id, day.toISOString().slice(0, 10), unavailabilities,
  ), 0);
}
/** Keep scheduled load unchanged by absences so overload remains visible. */
export function resourceLoad(resource: Resource, tasks: Task[], start: string, end: string): number {
  const normalized = normalizeResource(resource);
  return tasks.filter(t => t.assigneeId === resource.id && t.startDate && t.endDate && t.kind === 'task').reduce((hours, task) => {
    const first = task.startDate! > start ? task.startDate! : start;
    const last = task.endDate! < end ? task.endDate! : end;
    if (first > last) return hours;
    const taskDays = dayRange(task.startDate!, task.endDate!);
    if (taskDays.length === 0) return hours;
    let scheduledDays = taskDays.filter(day => resourceHoursOnDay(normalized, day) > 0);
    // Keep allocations visible even when no capacity is available: otherwise overload disappears.
    if (!scheduledDays.length) scheduledDays = taskDays.filter(day => day.getUTCDay() > 0 && day.getUTCDay() < 6);
    if (!scheduledDays.length) scheduledDays = taskDays;
    const overlap = scheduledDays.filter(day => {
      const date = day.toISOString().slice(0, 10);
      return date >= first && date <= last;
    }).length;
    return hours + task.allocatedHours * overlap / scheduledDays.length;
  }, 0);
}
export function plannedCost(tasks: Task[], resources: Resource[], profiles: CostProfile[]) {
  return tasks.reduce((sum, task) => {
    if (task.allocatedHours === 0) return sum;
    const resource = resources.find(r => r.id === task.assigneeId);
    const profile = profiles.find(p => p.id === resource?.profileId);
    if (!profile) return { ...sum, missing: sum.missing + 1 };
    return { ...sum, amount: sum.amount + task.allocatedHours / profile.eqjtHours * profile.dailyRate };
  }, { amount: 0, missing: 0 });
}
export function actualCost(entries: TimeEntry[]) {
  return entries.reduce((sum, entry) => {
    if (entry.rateSnapshot === null || entry.eqjtSnapshot === null) return { ...sum, missing: sum.missing + 1 };
    return { ...sum, amount: sum.amount + entry.hours / entry.eqjtSnapshot * entry.rateSnapshot };
  }, { amount: 0, missing: 0 });
}
