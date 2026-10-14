import type { AppData, Entity, Project, Resource, Task } from '../shared/types.ts';
import { canCreateProject, canCustomize, canEditTime, canProject, canReadProject, canValidateTime, globalRole, isAdmin, type ProjectAction } from '../shared/permissions.ts';
import type { StoreLike, Table } from './contracts.ts';

/** Called on each authenticated mutation, before any record is written. */
export function authorizeMutation(store: StoreLike, data: AppData, entity: Entity, method: string, body: unknown, recordId: string | undefined,
  deny: (status: number, message: string) => never): void {
  if (isAdmin(data)) return;
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const assert = (allowed: boolean) => { if (!allowed) deny(403, 'Votre rôle ne permet pas cette action dans ce périmètre.'); };
  const previous = (table: Table) => recordId ? store.get(table, recordId) as unknown as Record<string, unknown> | undefined : undefined;
  const changed = (old: Record<string, unknown> | undefined) => Object.keys(input).filter(key => JSON.stringify(input[key] ?? null) !== JSON.stringify(old?.[key] ?? null));
  const check = (id: unknown, action: ProjectAction, task?: Task) => { assert(typeof id === 'string' && canProject(data, id, action, task)); };
  const suffix = method === 'POST' ? 'Create' : method === 'DELETE' ? 'Delete' : 'Edit';
  if (entity === 'projects') {
    if (method === 'DELETE') { assert(false); return; }
    if (method === 'POST') {
      assert(canCreateProject(data));
      const own = data.resources.find(resource => resource.id === data.currentUser.id);
      assert(typeof input.zoneId === 'string' && (own?.zoneIds?.includes(input.zoneId) || data.projects.some(project => project.zoneId === input.zoneId && canReadProject(data, project.id))));
      assert(!Object.hasOwn(input, 'projectRoles')); return;
    }
    const old = previous('projects'); const fields = changed(old);
    check(recordId, method === 'PATCH' && fields.every(key => key === 'customValues') ? 'customValues' : fields.every(key => key === 'projectRoles') && method === 'PATCH' ? 'team' : 'details'); return;
  }
  if (entity === 'resources') {
    assert(method === 'PATCH'); const old = previous('resources') as unknown as Resource | undefined; assert(!!old);
    if (Object.keys(input).every(key => key === 'projectIds')) {
      assert(Array.isArray(input.projectIds) && input.projectIds.every(id => typeof id === 'string'));
      const before = old?.projectIds ?? []; const after = input.projectIds as string[];
      for (const id of new Set([...before, ...after])) if (before.includes(id) !== after.includes(id)) check(id, 'team');
      return;
    }
    assert(recordId === data.currentUser.id && Object.keys(input).every(key => ['weeklyCapacityHours', 'dailyHours', 'mondayHours', 'capacityUnit', 'hoursPerDay'].includes(key))); return;
  }
  if (entity === 'organization-units' || entity === 'permission-policies' || entity === 'zones' || entity === 'profiles' || entity === 'strategic-axes') { assert(false); return; }
  if (['project-templates', 'custom-field-definitions', 'report-templates', 'project-status-definitions'].includes(entity)) { assert(canCustomize(data)); return; }
  if (entity === 'tasks') {
    const old = previous('tasks') as unknown as Task | undefined; const projectId = old?.projectId ?? input.projectId;
    const fields = changed(old as unknown as Record<string, unknown> | undefined);
    if (method === 'PATCH' && old && fields.every(key => ['status', 'progress', 'allocatedHours', 'customValues'].includes(key))) {
      for (const key of fields) check(projectId, key === 'allocatedHours' ? 'ownAllocation' : key === 'customValues' ? 'customValues' : 'taskComplete', old);
      if (!fields.length) check(projectId, 'read'); return;
    }
    check(projectId, `${(old?.kind ?? input.kind) === 'milestone' ? 'milestone' : 'task'}${suffix}` as ProjectAction, old);
    if (method !== 'DELETE' && Object.hasOwn(input, 'kind') && old && input.kind !== old.kind) check(projectId, `${input.kind === 'milestone' ? 'milestone' : 'task'}Edit`);
    if (method !== 'DELETE' && (input.assigneeId ?? null) !== (old?.assigneeId ?? null) && Object.hasOwn(input, 'assigneeId')) check(projectId, 'team');
    if (method !== 'DELETE' && Object.hasOwn(input, 'dependsOnId') && (input.dependsOnId ?? null) !== (old?.dependsOnId ?? null)) check(projectId, 'details');
    if (Object.hasOwn(input, 'allocatedHours') && input.allocatedHours !== (old?.allocatedHours ?? 0)) check(projectId, 'ownAllocation', old); return;
  }
  if (entity === 'task-lists') { const projectId = previous('taskLists')?.projectId ?? input.projectId; check(projectId, `list${suffix}`); if (input.parentPhase || input.sourcePhase) check(projectId, 'listEdit'); return; }
  if (entity === 'project-item-moves') {
    const source = input.source as { type?: string } | undefined;
    const task = source?.type === 'task' && typeof (source as { id?: string }).id === 'string' ? store.get('tasks', (source as { id: string }).id) : undefined;
    check(input.projectId, source?.type === 'task' ? task?.kind === 'milestone' ? 'milestoneEdit' : 'taskEdit' : 'listEdit');
    if (source?.type === 'phase' || (input.target as { type?: string } | undefined)?.type === 'phase') check(input.projectId, 'listCreate'); return;
  }
  if (entity === 'expenses' || entity === 'revenues') { check(previous(entity)?.projectId ?? input.projectId, 'budget'); return; }
  if (entity === 'project-reports') { check(previous('projectReports')?.projectId ?? input.projectId, 'report'); return; }
  if (entity === 'project-documents' || entity === 'document-folders') {
    const old = previous(entity === 'project-documents' ? 'projectDocuments' : 'documentFolders');
    check(old?.projectId ?? input.projectId, entity === 'project-documents' && (input.kind ?? old?.kind) === 'link' ? 'externalLink' : 'documents'); return;
  }
  if (entity === 'comments') {
    const old = previous('comments'); const taskId = input.taskId ?? old?.taskId;
    const task = typeof taskId === 'string' ? store.get('tasks', taskId) : undefined;
    check(task?.projectId ?? old?.projectId ?? input.projectId, 'comment'); return;
  }
  if (entity === 'calendar-events') {
    const old = previous('calendarEvents'); const projectId = Object.hasOwn(input, 'projectId') ? input.projectId : old?.projectId;
    if (old?.projectId) check(old.projectId, `event${suffix}`);
    if (projectId) { if (projectId !== old?.projectId) check(projectId, `event${suffix}`); }
    else { const participants = input.resourceIds ?? old?.resourceIds; assert(globalRole(data) !== 'visitor' && Array.isArray(participants) && participants.length === 1 && participants[0] === data.currentUser.id); }
    return;
  }
  if (entity === 'unavailabilities') { const old = previous('unavailabilities'); assert(globalRole(data) !== 'visitor' && (old?.resourceId ?? input.resourceId) === data.currentUser.id && (!Object.hasOwn(input, 'resourceId') || input.resourceId === data.currentUser.id)); return; }
  if (entity === 'time-integrations') {
    if (input.scope === 'project') check(input.projectId, 'time');
    else assert(typeof input.resourceId === 'string' && canValidateTime(data, input.resourceId)); return;
  }
  if (entity === 'time-entries') {
    const old = previous('timeEntries'); const taskId = old?.taskId ?? input.taskId; const resourceId = old?.resourceId ?? input.resourceId;
    const task = typeof taskId === 'string' ? store.get('tasks', taskId) : undefined;
    assert(!!task && canReadProject(data, task.projectId));
    if (method === 'PATCH' && Object.keys(input).every(key => key === 'validated')) { assert(typeof resourceId === 'string' && canValidateTime(data, resourceId, task?.projectId)); return; }
    assert(typeof taskId === 'string' && typeof resourceId === 'string' && canEditTime(data, taskId, resourceId));
    if (input.validated === true) assert(typeof resourceId === 'string' && canValidateTime(data, resourceId, task?.projectId)); return;
  }
  assert(false);
}
