import type { Project, Resource, Task, WeeklyCapacity } from './types';

/** A complete resource sheet, including defaults for snapshots created before it existed. */
export type NormalizedResource = Resource & Required<Pick<Resource,
  'email' | 'description' | 'role' | 'tags' | 'validatesTimeForIds' |
  'weeklyCapacityHours' | 'capacityUnit' | 'hoursPerDay' | 'holidayCalendarId' |
  'projectIds' | 'customFields'
>>;

export function normalizeResource(resource: Resource): NormalizedResource {
  const weeklyCapacityHours: WeeklyCapacity = resource.weeklyCapacityHours
    ? [...resource.weeklyCapacityHours]
    : [resource.mondayHours, resource.dailyHours, resource.dailyHours, resource.dailyHours, resource.dailyHours, 0, 0];
  return {
    ...resource,
    email: resource.email ?? '',
    description: resource.description ?? '',
    role: resource.role ?? (resource.id === 'resource-claire' ? 'administrator' : 'user'),
    tags: (resource.tags ?? []).map(tag => ({ ...tag })),
    validatesTimeForIds: [...new Set(resource.validatesTimeForIds ?? [])],
    weeklyCapacityHours,
    capacityUnit: resource.capacityUnit ?? 'hours',
    hoursPerDay: resource.hoursPerDay ?? 8,
    holidayCalendarId: resource.holidayCalendarId ?? 'none',
    projectIds: [...new Set(resource.projectIds ?? [])],
    customFields: (resource.customFields ?? []).map(field => ({ ...field })),
  };
}

export function canValidateResourceTime(validator: Resource | undefined, targetResourceId: string): boolean {
  if (!validator?.active) return false;
  const resource = normalizeResource(validator);
  return resource.role === 'administrator' ||
    (['user', 'project_creator'].includes(resource.role) && resource.validatesTimeForIds.includes(targetResourceId));
}

/** Task assignments imply project membership and survive removal of an explicit membership. */
export function associatedResourceProjectIds(resource: Resource, tasks: Task[], projects: Project[] = []): string[] {
  return [...new Set([
    ...(resource.projectIds ?? []),
    ...projects.filter(project => project.createdByResourceId === resource.id || Object.hasOwn(project.projectRoles ?? {}, resource.id)).map(project => project.id),
    ...tasks.filter(task => task.assigneeId === resource.id).map(task => task.projectId),
  ])];
}
