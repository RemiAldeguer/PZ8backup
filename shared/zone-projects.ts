import { projectTimeEntries } from './planzone-preferences';
import { isLate, taskMetrics } from './domain';
import { associatedResourceProjectIds } from './resources';
import type { AppData, Project, Resource } from './types';

export interface ZoneProjectMetrics {
  allocatedHours: number;
  spentHours: number;
  remainingHours: number;
  realizedPercent: number;
  latePercent: number;
  openPercent: number;
  weather: number | null;
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
  activityBasis: 'allocated_hours' | 'tasks' | 'none';
}

function precise(value: number): number {
  return Number(value.toFixed(12));
}

/** Aggregate the scoped tasks once, rather than averaging project percentages. */
export function projectZoneMetrics(data: AppData, projects: Project[]): ZoneProjectMetrics {
  const scopedProjects = new Map(projects.map(project => [project.id, project]));
  const tasks = data.tasks.filter(task => scopedProjects.has(task.projectId));
  const metrics = taskMetrics(tasks, projectTimeEntries(data), data.today);
  const work = tasks.filter(task => task.kind === 'task');
  let realizedPercent = 0;
  let latePercent = 0;
  let openPercent = 0;
  let activityBasis: ZoneProjectMetrics['activityBasis'] = 'none';

  if (metrics.allocatedHours > 0) {
    activityBasis = 'allocated_hours';
    realizedPercent = metrics.realizedHours / metrics.allocatedHours * 100;
    latePercent = metrics.lateHours / metrics.allocatedHours * 100;
    openPercent = metrics.openHours / metrics.allocatedHours * 100;
  } else if (work.length) {
    // Without allocations, each work task contributes equally to the activity.
    activityBasis = 'tasks';
    realizedPercent = work.reduce((sum, task) => sum + task.progress, 0) / work.length;
    latePercent = work.filter(task => isLate(task, data.today))
      .reduce((sum, task) => sum + 100 - task.progress, 0) / work.length;
    openPercent = Math.max(0, 100 - realizedPercent - latePercent);
  }

  const weatherValues = [...scopedProjects.values()].map(project => project.weather);
  return {
    allocatedHours: precise(metrics.allocatedHours),
    spentHours: precise(metrics.spentHours),
    // Keep overruns visible; the actual time includes records on milestones.
    remainingHours: precise(metrics.allocatedHours - metrics.spentHours),
    realizedPercent: precise(realizedPercent),
    latePercent: precise(latePercent),
    openPercent: precise(openPercent),
    weather: weatherValues.length
      ? precise(weatherValues.reduce((sum, weather) => sum + weather, 0) / weatherValues.length)
      : null,
    totalTasks: metrics.total,
    completedTasks: metrics.completed,
    overdueTasks: metrics.overdue,
    activityBasis,
  };
}

/** Project team: explicit members and task assignees, including inactive history. */
export function projectAssignedResources(data: AppData, projectId: string): Resource[] {
  return data.resources.filter(resource => associatedResourceProjectIds(resource, data.tasks, data.projects).includes(projectId));
}

/** Zone tags combine project labels and labels carried by its tasks. */
export function projectTaskTags(data: AppData, projectId: string): string[] {
  return [...new Set([...(data.projects.find(project => project.id === projectId)?.tags ?? []), ...data.tasks.filter(task => task.projectId === projectId).flatMap(task => task.tags)].map(tag => tag.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'fr'));
}
