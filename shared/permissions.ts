import { permittedCapacityPlans } from './capaplan';
import { RESOURCE_ROLE_LABELS, type AppData, type Project, type ProjectRole, type ResourceRole, type Task } from './types';
import { normalizeResource } from './resources';
import { rolesForView, type WorkspaceView } from './view-access';

export const COLLABORATOR_ACTIONS = ['taskCreate', 'taskEdit', 'taskDelete', 'milestoneCreate', 'milestoneEdit', 'milestoneDelete', 'listCreate', 'listEdit', 'listDelete', 'eventCreate', 'eventEdit', 'eventDelete'] as const;
export type CollaboratorAction = typeof COLLABORATOR_ACTIONS[number];
export interface PermissionPolicy {
  collaborator: Record<CollaboratorAction, boolean>;
  resourcesRead: ResourceRole[];
  customizationManage: ResourceRole[];
  personalTimeEdit: boolean;
  personalTimeValidate: boolean;
}
export interface PermissionPolicyRecord extends PermissionPolicy { id: string; }
export const DEFAULT_PERMISSION_POLICY: PermissionPolicy = {
  collaborator: Object.fromEntries(COLLABORATOR_ACTIONS.map(action => [action, false])) as Record<CollaboratorAction, boolean>,
  resourcesRead: [], customizationManage: [], personalTimeEdit: true, personalTimeValidate: true,
};
export function permissionPolicy(data: AppData): PermissionPolicy { const record = data.permissionPolicies?.[0]; if (!record) return DEFAULT_PERMISSION_POLICY; const { id: _id, ...policy } = record; return policy; }
export function globalRole(data: AppData): ResourceRole {
  return (Object.entries(RESOURCE_ROLE_LABELS).find(([, label]) => label === data.currentUser.role)?.[0] as ResourceRole | undefined) ?? 'visitor';
}
export function isAdmin(data: AppData): boolean { return globalRole(data) === 'administrator'; }
export function canSeeView(data: AppData, view: WorkspaceView): boolean { return rolesForView(data, view).includes(globalRole(data)); }
export function canCreateProject(data: AppData): boolean { return ['administrator', 'project_creator'].includes(globalRole(data)); }
export function canReadResources(data: AppData): boolean { return canSeeView(data, 'resources'); }
export function canCustomize(data: AppData): boolean { return isAdmin(data) || globalRole(data) !== 'visitor' && permissionPolicy(data).customizationManage.includes(globalRole(data)); }
export function projectMemberIds(data: AppData, project: Project): Set<string> {
  return new Set([...Object.keys(project.projectRoles ?? {}), ...(project.createdByResourceId ? [project.createdByResourceId] : []),
    ...data.resources.filter(resource => resource.projectIds?.includes(project.id)).map(resource => resource.id),
    ...data.tasks.filter(task => task.projectId === project.id && task.assigneeId).map(task => task.assigneeId!)]);
}
export function canReadProject(data: AppData, projectId: string): boolean {
  const project = data.projects.find(project => project.id === projectId);
  return !!project && (isAdmin(data) || projectMemberIds(data, project).has(data.currentUser.id));
}
export function projectRoleFor(data: AppData, project: Project, resourceId = data.currentUser.id): ProjectRole | null {
  if (!projectMemberIds(data, project).has(resourceId)) return resourceId === data.currentUser.id && isAdmin(data) ? 'manager' : null;
  const resource = data.resources.find(resource => resource.id === resourceId);
  const role = resourceId === data.currentUser.id ? globalRole(data) : resource ? normalizeResource(resource).role : 'visitor';
  if (role === 'visitor') return 'observer';
  if (resourceId === data.currentUser.id && isAdmin(data)) return 'manager';
  return project.projectRoles?.[resourceId] ?? (project.createdByResourceId === resourceId ? 'manager' : 'collaborator');
}
export type ProjectAction = 'read' | 'details' | 'team' | 'budget' | 'time' | 'report' | 'documents' | 'externalLink' | 'comment' | 'customValues' | 'taskComplete' | 'ownAllocation' | CollaboratorAction;
export function canProject(data: AppData, projectId: string, action: ProjectAction, task?: Task): boolean {
  const project = data.projects.find(project => project.id === projectId);
  if (!project || !canReadProject(data, projectId)) return false;
  if ((action === 'documents' || action === 'externalLink') && (!canSeeView(data, 'documents') || !canSeeView(data, 'document-edit'))) return false;
  if (action === 'report' && !canSeeView(data, 'reports')) return false;
  if (isAdmin(data)) return true;
  const role = projectRoleFor(data, project);
  if (action === 'read' || action === 'comment') return true;
  if (role === 'manager') return true;
  if (role !== 'collaborator') return false;
  if (action === 'documents' || action === 'customValues') return true;
  if (action === 'ownAllocation') return task?.assigneeId === data.currentUser.id;
  if (action === 'taskComplete') return task?.assigneeId === data.currentUser.id || !!task && permissionPolicy(data).collaborator[task.kind === 'milestone' ? 'milestoneEdit' : 'taskEdit'];
  return COLLABORATOR_ACTIONS.includes(action as CollaboratorAction) && permissionPolicy(data).collaborator[action as CollaboratorAction];
}
export function canUseProjectView(data: AppData, project: Project, view: string): boolean {
  if (!canReadProject(data, project.id)) return false;
  if (view === 'documents' && !canSeeView(data, 'documents') || view === 'reports' && !canSeeView(data, 'reports')) return false;
  return view === 'budget' ? canProject(data, project.id, 'budget') : view === 'time' ? canProject(data, project.id, 'time') : view === 'reports' ? canProject(data, project.id, 'report') : true;
}
export function canEditTime(data: AppData, taskId: string, resourceId: string): boolean {
  const task = data.tasks.find(task => task.id === taskId);
  return !!task && canReadProject(data, task.projectId) && (canProject(data, task.projectId, 'time') || globalRole(data) !== 'visitor' && resourceId === data.currentUser.id && permissionPolicy(data).personalTimeEdit);
}
export function canValidateTime(data: AppData, resourceId: string, projectId?: string): boolean {
  if (isAdmin(data)) return true;
  if (globalRole(data) === 'visitor') return false;
  if (projectId && canProject(data, projectId, 'time')) return true;
  const own = data.resources.find(resource => resource.id === data.currentUser.id);
  return permissionPolicy(data).personalTimeValidate && !!own?.active && !!own.validatesTimeForIds?.includes(resourceId);
}

/** Never send inaccessible projects or financial data to non-administrators. */
export function permittedState(data: AppData): AppData {
  if (isAdmin(data)) return { ...data, projectDocuments: canSeeView(data, 'documents') ? data.projectDocuments : [], documentFolders: canSeeView(data, 'documents') ? data.documentFolders : [], projectReports: canSeeView(data, 'reports') ? data.projectReports : [] };
  const projects = data.projects.filter(project => canReadProject(data, project.id));
  const projectIds = new Set(projects.map(project => project.id));
  const budgetIds = new Set(projects.filter(project => canProject(data, project.id, 'budget')).map(project => project.id));
  const timeIds = new Set(projects.filter(project => canProject(data, project.id, 'time')).map(project => project.id));
  const own = data.resources.find(resource => resource.id === data.currentUser.id);
  const resourceIds = new Set([data.currentUser.id, ...(globalRole(data) !== 'visitor' ? own?.validatesTimeForIds ?? [] : []), ...projects.flatMap(project => [...projectMemberIds(data, project)])]);
  const budgetResources = new Set(projects.filter(project => budgetIds.has(project.id)).flatMap(project => [...projectMemberIds(data, project)]));
  const planning = ['capacity', 'load', 'occupancy'].some(view => canSeeView(data, view as WorkspaceView));
  const costCatalog = canSeeView(data, 'profiles');
  const directory = canReadResources(data) || canSeeView(data, 'organization') || planning || projects.some(project => canProject(data, project.id, 'team'));
  const resources = data.resources.filter(resource => directory || resourceIds.has(resource.id)).map(resource => {
    if (resource.id === data.currentUser.id || budgetResources.has(resource.id)) return { ...resource, profileId: budgetResources.has(resource.id) || costCatalog ? resource.profileId : null };
    return { ...resource, email: '', description: '', customValues: {}, customFields: [], validatesTimeForIds: [],
      profileId: costCatalog ? resource.profileId : null, projectIds: resource.projectIds?.filter(id => projectIds.has(id)) ?? [],
      ...(resourceIds.has(resource.id) || canReadResources(data) || planning ? {} : { dailyHours: 0, mondayHours: 0, weeklyCapacityHours: [0, 0, 0, 0, 0, 0, 0] as const }) };
  }).map(resource => ({ ...resource, weeklyCapacityHours: resource.weeklyCapacityHours ? [...resource.weeklyCapacityHours] as import('./types').WeeklyCapacity : undefined, projectIds: resource.projectIds?.filter(id => projectIds.has(id)),
    validatesTimeForIds: resource.validatesTimeForIds?.filter(id => resourceIds.has(id)) }));
  const tasks = data.tasks.filter(task => projectIds.has(task.projectId)); const taskIds = new Set(tasks.map(task => task.id));
  const entries = data.timeEntries.filter(entry => taskIds.has(entry.taskId) && (entry.resourceId === data.currentUser.id || timeIds.has(tasks.find(task => task.id === entry.taskId)!.projectId) || own?.validatesTimeForIds?.includes(entry.resourceId)))
    .map(entry => budgetIds.has(tasks.find(task => task.id === entry.taskId)!.projectId) ? entry : { ...entry, rateSnapshot: null, eqjtSnapshot: null });
  const profiles = new Set(resources.filter(resource => budgetResources.has(resource.id)).map(resource => resource.profileId));
  return { ...data, projects: projects.map(project => budgetIds.has(project.id) ? project : { ...project, budget: 0 }),
    zones: data.zones.filter(zone => own?.zoneIds?.includes(zone.id) || projects.some(project => project.zoneId === zone.id)),
    tasks, resources: resources.map(resource => ({ ...resource, managerId: resources.some(item => item.id === resource.managerId) ? resource.managerId : null })),
    capacityPlans: permittedCapacityPlans(data),
    organizationUnits: canSeeView(data, 'organization') ? data.organizationUnits?.map(unit => ({ ...unit, resourceIds: unit.resourceIds.filter(id => resources.some(resource => resource.id === id)) })) : [],
    profiles: data.profiles.filter(profile => costCatalog || profiles.has(profile.id)), timeEntries: entries,
    expenses: data.expenses.filter(item => budgetIds.has(item.projectId)), revenues: data.revenues.filter(item => budgetIds.has(item.projectId)),
    comments: data.comments.filter(item => item.projectId && projectIds.has(item.projectId) || item.taskId && taskIds.has(item.taskId)),
    projectReports: canSeeView(data, 'reports') ? data.projectReports?.filter(item => projectIds.has(item.projectId)) : [], projectDocuments: canSeeView(data, 'documents') ? data.projectDocuments?.filter(item => projectIds.has(item.projectId)) : [],
    documentFolders: canSeeView(data, 'documents') ? data.documentFolders?.filter(item => projectIds.has(item.projectId)) : [], taskLists: data.taskLists?.filter(item => projectIds.has(item.projectId)),
    projectTemplates: canCreateProject(data) || canSeeView(data, 'project-templates') ? data.projectTemplates : [],
    calendarEvents: data.calendarEvents.filter(item => item.projectId ? projectIds.has(item.projectId) : item.resourceIds.includes(data.currentUser.id)),
    unavailabilities: data.unavailabilities.filter(item => resourceIds.has(item.resourceId)), userAccounts: undefined,
  };
}
