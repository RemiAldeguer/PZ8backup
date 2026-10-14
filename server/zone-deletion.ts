import type { Project } from '../shared/types.ts';
import type { StoreLike } from './contracts.ts';

/** Called inside the authorized zone-deletion transaction, after confirmation is checked. */
export function deleteZoneContents(store: StoreLike, zoneId: string, projects: Project[]): void {
  const projectIds = new Set(projects.map(project => project.id));
  const tasks = store.all('tasks');
  const taskIds = new Set(tasks.filter(task => projectIds.has(task.projectId)).map(task => task.id));
  for (const entry of store.all('timeEntries')) if (taskIds.has(entry.taskId)) store.remove('timeEntries', entry.id);
  for (const comment of store.all('comments')) {
    if (projectIds.has(comment.projectId ?? '') || taskIds.has(comment.taskId ?? '')) store.remove('comments', comment.id);
  }
  // Remove references before deleting their targets, including self-referencing task chains.
  for (const task of tasks) {
    if (task.dependsOnId && taskIds.has(task.dependsOnId)) store.put('tasks', { ...task, dependsOnId: null, dependencyConstraint: null });
  }
  for (const taskId of taskIds) store.remove('tasks', taskId);
  for (const table of ['taskLists', 'documentFolders'] as const) {
    const records = store.all(table).filter(item => projectIds.has(item.projectId));
    for (const item of records) if (item.parentId) store.put(table, { ...item, parentId: null });
  }
  // Documents reference folders; both must disappear before their project.
  for (const table of ['projectDocuments', 'documentFolders', 'taskLists', 'expenses', 'revenues', 'projectReports', 'calendarEvents'] as const) {
    for (const item of store.all(table)) if (projectIds.has(item.projectId ?? '')) store.remove(table, item.id);
  }
  for (const plan of store.all('capacityPlans')) {
    const removedDemandIds = new Set(plan.demands.filter(demand => projectIds.has(demand.projectId)).map(demand => demand.id));
    if (!removedDemandIds.size && !plan.baselines.some(baseline => projectIds.has(baseline.projectId))) continue;
    store.put('capacityPlans', {
      ...plan,
      demands: plan.demands.filter(demand => !projectIds.has(demand.projectId)),
      allocations: plan.allocations.filter(allocation => !removedDemandIds.has(allocation.demandId)),
      baselines: plan.baselines.filter(baseline => !projectIds.has(baseline.projectId)),
    });
  }
  for (const resource of store.all('resources')) {
    const removeZone = resource.zoneIds?.includes(zoneId);
    const removeProjects = resource.projectIds?.some(id => projectIds.has(id));
    if (removeZone || removeProjects) store.put('resources', {
      ...resource,
      ...(removeZone ? { zoneIds: resource.zoneIds!.filter(id => id !== zoneId) } : {}),
      ...(removeProjects ? { projectIds: resource.projectIds!.filter(id => !projectIds.has(id)) } : {}),
    });
  }
  for (const projectId of projectIds) store.remove('projects', projectId);
}
