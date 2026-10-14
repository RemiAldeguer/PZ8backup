import type { AppData, TimeEntry } from './types';

export function isCivilDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Project and resource periods are independent; either can validate a time entry. */
export function timeIntegrationIndex(data: Pick<AppData, 'projects' | 'resources' | 'tasks'>) {
  const projects = new Map(data.projects.map(project => [project.id, isCivilDate(project.timeIntegrationDate) ? project.timeIntegrationDate : null]));
  const resources = new Map(data.resources.map(resource => [resource.id, isCivilDate(resource.timeIntegrationDate) ? resource.timeIntegrationDate : null]));
  const taskProjects = new Map(data.tasks.map(task => [task.id, task.projectId]));
  function cutoff(resourceId: string, projectId?: string): string | null {
    const resource = resources.get(resourceId); const project = projectId ? projects.get(projectId) : null;
    return resource && project ? resource > project ? resource : project : resource || project || null;
  }
  function covers(date: string, resourceId: string, projectId?: string): boolean {
    const until = cutoff(resourceId, projectId);
    return Boolean(until && date <= until);
  }
  function entryCovered(entry: TimeEntry) { return covers(entry.date, entry.resourceId, taskProjects.get(entry.taskId)); }
  function decorate(entry: TimeEntry): TimeEntry {
    return entryCovered(entry) ? { ...entry, validated: true, integrationValidated: true } : entry;
  }
  return { cutoff, covers, entryCovered, decorate };
}
