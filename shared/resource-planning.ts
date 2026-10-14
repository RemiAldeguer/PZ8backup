import { resourceCapacity, resourceLoad } from './domain';
import { normalizeResource } from './resources';
import type { AppData, Project, Resource } from './types';

export type ResourcePlanningMode = 'capacity' | 'load' | 'occupancy';
export type ResourcePlanningGranularity = 'monthly' | 'weekly';
export type ResourcePlanningUnit = 'hours' | 'days';
export interface ResourcePlanningPeriod {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
}
export interface ResourcePlanningCell {
  capacityHours: number;
  loadHours: number;
  occupancyRate: number | null;
}
export interface ResourcePlanningProject {
  project: Project;
  loadHours: number[];
  undatedTaskCount: number;
}
export interface ResourcePlanningRow {
  resource: Resource;
  cells: ResourcePlanningCell[];
  projects: ResourcePlanningProject[];
  undatedTaskCount: number;
  undatedAllocatedHours: number;
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const utcDay = (date: string) => new Date(`${date}T12:00:00Z`);
const monthFormatter = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' });
function isoWeek(date: Date): { week: number; year: number } {
  const thursday = new Date(date);
  thursday.setUTCDate(thursday.getUTCDate() + 3 - (thursday.getUTCDay() + 6) % 7);
  const year = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4, 12));
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 3 - (firstThursday.getUTCDay() + 6) % 7);
  return { year, week: 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86400000)) };
}

/** Calendar buckets partition the chosen year, including its incomplete boundary weeks. */
export function resourcePlanningPeriods(year: number, granularity: ResourcePlanningGranularity): ResourcePlanningPeriod[] {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) throw new RangeError('L’année doit être comprise entre 1900 et 2200.');
  if (granularity === 'monthly') return Array.from({ length: 12 }, (_, month) => {
    const first = new Date(Date.UTC(year, month, 1, 12));
    const last = new Date(Date.UTC(year, month + 1, 0, 12));
    return { id: `${year}-${String(month + 1).padStart(2, '0')}`, label: monthFormatter.format(first), startDate: isoDay(first), endDate: isoDay(last) };
  });
  const periods: ResourcePlanningPeriod[] = [];
  const lastDay = new Date(Date.UTC(year, 11, 31, 12));
  const cursor = new Date(Date.UTC(year, 0, 1, 12));
  while (cursor <= lastDay) {
    const start = new Date(cursor);
    const end = new Date(cursor);
    end.setUTCDate(end.getUTCDate() + 6 - (end.getUTCDay() + 6) % 7);
    if (end > lastDay) end.setTime(lastDay.getTime());
    const week = isoWeek(start);
    const label = `S. ${String(week.week).padStart(2, '0')}${week.year === year ? '' : ` (${week.year})`}`;
    periods.push({ id: isoDay(start), label, startDate: isoDay(start), endDate: isoDay(end) });
    cursor.setTime(end.getTime());
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return periods;
}

/** The current resource sheet supplies capacity; actual time entries are never redistributed. */
export function buildResourcePlanningRows(
  data: Pick<AppData, 'resources' | 'tasks' | 'projects' | 'unavailabilities'>,
  periods: ResourcePlanningPeriod[],
): ResourcePlanningRow[] {
  return data.resources.map(resource => {
    const tasks = data.tasks.filter(task => task.assigneeId === resource.id && task.kind === 'task');
    const undated = tasks.filter(task => task.allocatedHours > 0 && (!task.startDate || !task.endDate));
    const projectIds = new Set([...(resource.projectIds ?? []), ...tasks.map(task => task.projectId)]);
    const projects = data.projects.filter(project => projectIds.has(project.id)).map(project => {
      const projectTasks = tasks.filter(task => task.projectId === project.id);
      return {
        project,
        loadHours: periods.map(period => resourceLoad(resource, projectTasks, period.startDate, period.endDate)),
        undatedTaskCount: undated.filter(task => task.projectId === project.id).length,
      };
    });
    return {
      resource,
      cells: periods.map(period => {
        const capacityHours = resourceCapacity(resource, period.startDate, period.endDate, data.unavailabilities ?? []);
        const loadHours = resourceLoad(resource, tasks, period.startDate, period.endDate);
        return { capacityHours, loadHours, occupancyRate: capacityHours > 0 ? loadHours / capacityHours * 100 : null };
      }),
      projects,
      undatedTaskCount: undated.length,
      undatedAllocatedHours: undated.reduce((sum, task) => sum + task.allocatedHours, 0),
    };
  });
}

/** Days are a resource-specific display unit, independent of the cost profile's Eqjt. */
export function resourcePlanningAmount(hours: number, resource: Resource, unit: ResourcePlanningUnit): number | null {
  if (unit === 'hours') return hours;
  const hoursPerDay = normalizeResource(resource).hoursPerDay;
  return Number.isFinite(hoursPerDay) && hoursPerDay > 0 ? hours / hoursPerDay : null;
}
export function resourceOccupancyBand(rate: number | null): 'normal' | 'warning' | 'overload' | 'unavailable' {
  return rate === null ? 'unavailable' : rate > 120 ? 'overload' : rate > 100 ? 'warning' : 'normal';
}
export function resourceAvatarTextColor(color: string): '#000' | '#fff' {
  const hex = color.replace(/^#/, '');
  const expanded = hex.length === 3 ? [...hex].map(character => character.repeat(2)).join('') : hex;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return '#fff';
  const channels = [0, 2, 4].map(offset => parseInt(expanded.slice(offset, offset + 2), 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 > 0.179 ? '#000' : '#fff';
}

export function resourcePlanningPeriodDays(period: ResourcePlanningPeriod): number {
  return Math.round((utcDay(period.endDate).getTime() - utcDay(period.startDate).getTime()) / 86400000) + 1;
}
