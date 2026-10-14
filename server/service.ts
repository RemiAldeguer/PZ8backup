import { z } from 'zod';
import { GLOBAL_ROLES, RESOURCE_ROLE_LABELS, TASK_STATUSES, type AppData, type CalendarEvent, type Entity, type Project, type ProjectDocument, type Resource, type Task, type Unavailability } from '../shared/types.ts';
import type { CustomFieldDefinition, CustomFieldScope, ProjectTemplate } from '../shared/customization.ts';
import { customizationCreateSchemas, customizationPatchSchemas, customValuesInput, orderedTemplateLists, orderedTemplateTasks, strategicRatingsInput, validCustomValue, validDefinitionOptions } from './customization-validation.ts';
import { projectReportInput, projectReportPatch } from './project-report-validation.ts';
import { commentInput, commentPatch, documentFileSize, projectDocumentInput, projectDocumentPatch, storageGrowthExceedsLimit, workspaceStorageUsage } from './collaboration-validation.ts';
import { validateFormulaDefinitions } from '../shared/custom-field-values.ts';
import { documentFolderInput, documentFolderPatch, validateDocumentFolderTree } from './document-folder-validation.ts';
import { taskListInput, taskListPatch, projectItemMoveInput, projectItemPosition, validateTaskListTree } from './task-list-validation.ts';
import { planProjectItemMove, ProjectItemMoveError } from '../shared/project-item-moves.ts';
import { timeIntegrationIndex } from '../shared/time-integration.ts';
import { planzonePreferences, DEFAULT_PLANZONE_PREFERENCES } from '../shared/planzone-preferences.ts';
import { durationAllocation, workingDurationDays, workingMoveEnd, preferenceConstraintShift } from '../shared/planning-preferences.ts';
import { planTaskConstraints, TaskConstraintError } from '../shared/task-constraints.ts';
import { taskConstraintInput } from './task-constraint-validation.ts';
import { planzonePreferencesInput } from './planzone-preferences-validation.ts';
import { authorizeMutation } from './authorize-mutation.ts';
import { permissionPolicyInput, permissionPolicyPatch } from './permission-validation.ts';
import { canProject, canReadProject, canValidateTime, globalRole, isAdmin, permittedState } from '../shared/permissions.ts';
import { projectMetadataInput } from './project-metadata-validation.ts';
import { organizationUnitInput, organizationUnitPatch } from './organization-validation.ts';
import { validateOrganizationTree, validateResourceManagers } from '../shared/organization.ts';
import { dateInParis } from '../shared/domain.ts';
import { canValidateResourceTime, normalizeResource } from '../shared/resources.ts';
import { TABLES, type Records, type StoreLike, type Table } from './contracts.ts';
import { CURRENT_USER } from './seed.ts';
import { mutateCapacityPlan, CapacityPlanError } from './capaplan-service.ts';
import { deleteZoneContents } from './zone-deletion.ts';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Cette date n’existe pas.');
const name = z.string().trim().min(1).max(200);
const id = z.string().min(1).max(100);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const money = z.number().finite().min(0).max(1e12);
const hours = z.number().finite().min(0).max(100000);
const capacity = z.number().finite().min(0).max(168);
const uniqueIds = z.array(id).max(200).refine(values => new Set(values).size === values.length, 'Chaque élément doit être sélectionné une seule fois.');
const resourceTag = z.object({ label: z.string().trim().min(1).max(50), color }).strict();
const customField = z.object({
  id, label: name, type: z.enum(['text', 'number', 'date', 'url']), value: z.string().trim().max(10000),
}).strict().superRefine((field, context) => {
  if (!field.value) return;
  if (field.type === 'date' && !date.safeParse(field.value).success) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'Cette date n’existe pas.' });
  }
  if (field.type === 'number' && (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(field.value) || !Number.isFinite(Number(field.value)))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'Indiquez un nombre valide.' });
  }
  if (field.type === 'url') {
    try {
      const url = new URL(field.value);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Unsupported protocol');
    } catch {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'Indiquez un lien HTTP ou HTTPS valide.' });
    }
  }
});

const zoneInput = z.object({ name, color: color.default('#0F766E') }).strict();
const zoneDeleteInput = z.object({ deleteProjects: z.literal(true), expectedProjectIds: z.array(id).max(1000).refine(values => new Set(values).size === values.length) }).strict();
const projectInput = z.object({
  name, description: z.string().max(10000).default(''), zoneId: id,
  startDate: date.nullable().default(null), endDate: date.nullable().default(null), status: z.enum(['requested', 'open', 'paused', 'closed']).default('open'),
  weather: z.number().int().min(0).max(5).default(4), budget: money.default(0), color: color.default('#6366F1'),
  templateId: id.optional(), customStatusId: id.nullable().optional(), customValues: customValuesInput.optional(), strategicRatings: strategicRatingsInput.optional(),
  ...projectMetadataInput.shape,
}).strict();
const taskInput = z.object({
  projectId: id, title: name, description: z.string().max(10000).default(''), phase: z.string().trim().max(200).default('Sans phase'),
  status: z.enum(TASK_STATUSES).default('todo'), progress: z.number().finite().min(0).max(100).default(0),
  assigneeId: id.nullable().default(null), startDate: date.nullable().default(null), endDate: date.nullable().default(null),
  allocatedHours: hours.default(0), kind: z.enum(['task', 'milestone']).default('task'),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]), dependsOnId: id.nullable().default(null),
  dependencyConstraint: taskConstraintInput.nullable().optional(),
  customValues: customValuesInput.optional(),
  listId: id.nullable().optional(),
  position: projectItemPosition.optional(),
}).strict();
const resourceInput = z.object({
  name, jobTitle: z.string().trim().max(200).default(''), type: z.enum(['human', 'virtual', 'material']).default('human'),
  classification: z.enum(['internal', 'external']).default('internal'), initials: z.string().trim().min(1).max(4).optional(),
  color: color.default('#6366F1'), dailyHours: capacity.default(8),
  mondayHours: capacity.default(8), profileId: id.nullable().default(null), active: z.boolean().default(true),
  email: z.union([z.string().trim().email().max(254), z.literal('')]).default(''),
  description: z.string().max(10000).default(''), role: z.enum(GLOBAL_ROLES).default('user'),
  tags: z.array(resourceTag).max(20).refine(values => new Set(values.map(tag => tag.label.toLocaleLowerCase())).size === values.length, 'Chaque tag doit être unique.').default([]),
  validatesTimeForIds: uniqueIds.default([]),
  weeklyCapacityHours: z.tuple([capacity, capacity, capacity, capacity, capacity, capacity, capacity]).optional(),
  capacityUnit: z.enum(['hours', 'days']).default('hours'), hoursPerDay: z.number().finite().positive().max(24).default(8),
  zoneIds: uniqueIds.default([]),
  holidayCalendarId: z.enum(['none', 'fr']).default('none'), projectIds: uniqueIds.default([]),
  customFields: z.array(customField).max(25).refine(values => new Set(values.map(field => field.id)).size === values.length, 'Chaque champ doit avoir un identifiant unique.')
    .refine(values => new Set(values.map(field => field.label.toLocaleLowerCase())).size === values.length, 'Chaque champ doit avoir un nom unique.').default([]),
  customValues: customValuesInput.optional(), managerId: id.nullable().optional(),
}).strict();
const profileInput = z.object({ name, dailyRate: money, eqjtHours: z.number().finite().positive().max(24).default(8), currency: z.literal('EUR').default('EUR') }).strict();
const timeInput = z.object({
  taskId: id, resourceId: id, date, hours: z.number().finite().positive().max(24),
  note: z.string().max(10000).default(''), validated: z.boolean().default(false),
  customValues: customValuesInput.optional(),
}).strict();
const timeIntegrationInput = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('project'), projectId: id, date: date.nullable() }).strict(),
  z.object({ scope: z.literal('resource'), resourceId: id, date: date.nullable() }).strict(),
]);
const expenseInput = z.object({
  projectId: id, label: name, amount: money, plannedDate: date, paidDate: date.nullable().default(null),
  category: z.enum(['software', 'training', 'equipment', 'supplies', 'legal', 'other']).default('other'),
}).strict();
const revenueInput = z.object({
  projectId: id, label: name, amount: money, plannedDate: date, receivedDate: date.nullable().default(null),
  category: z.enum(['sales', 'services', 'grants', 'other']).default('other'),
}).strict();
const clockTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Indiquez une heure au format HH:MM.');
const calendarEventInput = z.object({
  title: name, description: z.string().max(10000).default(''), projectId: id.nullable().default(null),
  resourceIds: uniqueIds.default([]), startDate: date, endDate: date, allDay: z.boolean().default(true),
  startTime: clockTime.nullable().default(null), endTime: clockTime.nullable().default(null),
}).strict();
const unavailabilityInput = z.object({
  title: name, resourceId: id, reason: z.enum(['leave', 'sick', 'other']).default('other'),
  startDate: date, endDate: date, allDay: z.boolean().default(true),
  startTime: clockTime.nullable().default(null), endTime: clockTime.nullable().default(null),
}).strict();
const createSchemas = {
  zones: zoneInput, projects: projectInput, tasks: taskInput, resources: resourceInput, profiles: profileInput,
  'time-entries': timeInput, comments: commentInput, expenses: expenseInput, revenues: revenueInput,
  'calendar-events': calendarEventInput, unavailabilities: unavailabilityInput,
  'project-reports': projectReportInput,
  'project-documents': projectDocumentInput,
  'document-folders': documentFolderInput,
  'task-lists': taskListInput,
  'permission-policies': permissionPolicyInput, 'organization-units': organizationUnitInput,
  ...customizationCreateSchemas,
};
const patchSchemas = {
  zones: zoneInput.partial(), projects: projectInput.omit({ templateId: true }).partial(), tasks: taskInput.omit({ projectId: true }).partial(), resources: resourceInput.partial(),
  profiles: profileInput.partial(), 'time-entries': timeInput.omit({ taskId: true, resourceId: true }).partial(),
  comments: commentPatch, expenses: expenseInput.omit({ projectId: true }).partial(),
  revenues: revenueInput.omit({ projectId: true }).partial(),
  'calendar-events': calendarEventInput.partial(), unavailabilities: unavailabilityInput.partial(),
  'project-reports': projectReportPatch,
  'project-documents': projectDocumentPatch,
  'document-folders': documentFolderPatch,
  'task-lists': taskListPatch,
  'permission-policies': permissionPolicyPatch, 'organization-units': organizationUnitPatch,
  ...customizationPatchSchemas,
};
type StoredEntity = Exclude<Entity, 'project-item-moves' | 'time-integrations' | 'capacity-plan' | 'planzone-preferences' | 'task-self-assignment' | 'zone-order'>;
const tables: Record<StoredEntity, Table> = {
  zones: 'zones', projects: 'projects', tasks: 'tasks', resources: 'resources', profiles: 'profiles',
  'time-entries': 'timeEntries', comments: 'comments', expenses: 'expenses', revenues: 'revenues',
  'calendar-events': 'calendarEvents', unavailabilities: 'unavailabilities',
  'project-templates': 'projectTemplates', 'custom-field-definitions': 'customFieldDefinitions',
  'report-templates': 'reportTemplates', 'project-status-definitions': 'projectStatusDefinitions', 'strategic-axes': 'strategicAxes',
  'project-reports': 'projectReports',
  'project-documents': 'projectDocuments',
  'document-folders': 'documentFolders',
  'task-lists': 'taskLists', 'permission-policies': 'permissionPolicies', 'organization-units': 'organizationUnits',
};
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function reject(status: number, message: string): never { throw new ApiError(status, message); }
export type MutationMethod = 'POST' | 'PATCH' | 'DELETE';
export interface MutationResult { status: 200 | 201 | 204; value?: Records[Table]; }
/** Authentication binds the account to a resource; only authorized administrators can change its global role. */
export type ServiceActor = AppData['currentUser'];

/** The same synchronous business rules serve Express/SQLite and Workers/D1. */
export class ApiService {
  readonly readState: (today?: string) => AppData;
  readonly readDocument: (id: string) => ProjectDocument;
  readonly mutate: (entity: Entity, method: MutationMethod, body?: unknown, recordId?: string) => MutationResult;
  constructor(store: StoreLike, actor?: ServiceActor) {
    function workspaceUsage() { return workspaceStorageUsage(Object.fromEntries(TABLES.map(table => [table, store.all(table)]))); }
    function commit<T>(action: () => T): T {
      return store.transaction(() => {
        const before = workspaceUsage();
        const result = action();
        if (storageGrowthExceedsLimit(before, workspaceUsage())) reject(413, 'Cet espace de démonstration a atteint sa limite de stockage.');
        return result;
      });
    }
    function requireRecord<K extends Table>(table: K, recordId: string): Records[K] {
      return store.get(table, recordId) ?? reject(404, 'Cet élément est introuvable.');
    }
    function assertProjectWritable(projectId: string): void {
      const project = requireRecord('projects', projectId);
      if (project.status === 'paused' || project.status === 'closed') reject(409, 'Ce projet est interrompu ou clos. Rouvrez-le pour modifier ses données.');
    }
    function assertDates(startDate: string | null, endDate: string | null): void {
      if (startDate && endDate && startDate > endDate) reject(400, 'La date de fin doit suivre la date de début.');
    }
    function validateValues(scope: CustomFieldScope, values?: Record<string, string>, previous?: Record<string, string>): void {
      for (const [definitionId, originalValue] of Object.entries(values ?? {})) {
        let value = originalValue;
        const definition = store.get('customFieldDefinitions', definitionId);
        // Preserve opaque, unchanged values from older workspaces; never allow new unknown data.
        if (!definition && Object.hasOwn(previous ?? {}, definitionId) && previous?.[definitionId] === value) continue;
        if (!definition) reject(404, 'Ce champ personnalisé est introuvable.');
        if (definition.scope !== scope) reject(400, 'Ce champ personnalisé ne concerne pas cet élément.');
        if (['number', 'date', 'url', 'image'].includes(definition.type) && !value.startsWith('data:')) {
          value = value.trim();
          // Preserve untouched imported values while canonicalizing new typed form input.
          if (previous?.[definitionId] !== originalValue) values![definitionId] = value;
        }
        if (!validCustomValue(definition, value)) reject(400, `La valeur du champ « ${definition.name} » est invalide.`);
      }
    }
    function fieldReferences(definitionId: string): { scope: CustomFieldScope; value: string }[] {
      return (['projects', 'tasks', 'resources', 'timeEntries'] as const).flatMap(table => store.all(table)
        .filter(record => Object.hasOwn(record.customValues ?? {}, definitionId))
        .map(record => ({ scope: ({ projects: 'project', tasks: 'task', resources: 'resource', timeEntries: 'time-entry' } as const)[table], value: record.customValues![definitionId] })));
    }
    function validateDefinition(definition: CustomFieldDefinition): void {
      if (!validDefinitionOptions(definition)) reject(400, 'Les listes demandent au moins une option ; les autres types n’ont pas d’options.');
      if (fieldReferences(definition.id).some(reference => reference.scope !== definition.scope || !validCustomValue(definition, reference.value))) {
        reject(409, 'Ce changement rendrait des valeurs existantes incompatibles. Conservez leur type et leurs options.');
      }
      try { validateFormulaDefinitions([...store.all('customFieldDefinitions').filter(existing => existing.id !== definition.id), definition]); }
      catch (error) { reject(400, error instanceof Error ? error.message : 'Cette formule est invalide.'); }
    }
    function validateProject(project: Project, changes: Partial<Project>, previous?: Project): Project {
      requireRecord('zones', project.zoneId); assertDates(project.startDate, project.endDate);
      if (changes.customStatusId) {
        const definition = store.get('projectStatusDefinitions', changes.customStatusId);
        if (!definition && previous?.customStatusId === changes.customStatusId && project.status === previous.status) {
          // Full legacy forms may echo an opaque ID and its unchanged base state.
        } else {
          if (!definition) reject(404, 'Ce statut personnalisé est introuvable.');
          if (Object.hasOwn(changes, 'status') && changes.status !== definition.baseStatus) reject(400, 'Le statut choisi ne correspond pas à son état de projet.');
          project.status = definition.baseStatus;
        }
      } else if (previous && Object.hasOwn(changes, 'status') && !Object.hasOwn(changes, 'customStatusId')) {
        // A built-in status selection explicitly replaces the custom workflow label.
        delete project.customStatusId;
      } else if (project.customStatusId) {
        const definition = store.get('projectStatusDefinitions', project.customStatusId);
        if (!definition && previous?.customStatusId === project.customStatusId) {
          // Unknown legacy workflow IDs remain opaque when untouched.
        } else if (!definition) reject(404, 'Ce statut personnalisé est introuvable.');
        else project.status = definition.baseStatus;
      }
      for (const [resourceId, role] of Object.entries(project.projectRoles ?? {})) {
        const member = requireRecord('resources', resourceId);
        if (resourceId !== 'resource-claire' && normalizeResource(member).role === 'visitor' && role !== 'observer') reject(400, 'Un visiteur ne peut être qu’observateur sur un projet.');
      }
      validateValues('project', project.customValues, previous?.customValues);
      for (const [axisId, rating] of Object.entries(project.strategicRatings ?? {})) {
        if (!store.get('strategicAxes', axisId) && !(Object.hasOwn(previous?.strategicRatings ?? {}, axisId) && previous?.strategicRatings?.[axisId] === rating)) {
          reject(404, 'Cet axe stratégique est introuvable.');
        }
      }
      return project;
    }
    function validateTemplate(template: ProjectTemplate): ProjectTemplate['tasks'] {
      try { return orderedTemplateTasks(template); }
      catch (error) { return reject(400, error instanceof Error ? error.message : 'Ce modèle est invalide.'); }
    }
    function cloneTemplate(project: Project, template: ProjectTemplate): void {
      const ordered = validateTemplate(template);
      const clonedIds = new Map(ordered.map(task => [task.key, crypto.randomUUID()]));
      const orderedLists = orderedTemplateLists(template);
      const listIds = new Map(orderedLists.map(list => [list.key, crypto.randomUUID()]));
      for (const source of orderedLists) {
        store.put('taskLists', { id: listIds.get(source.key)!, projectId: project.id, name: source.name,
          parentId: source.parentKey ? listIds.get(source.parentKey)! : null,
          ...(source.position !== undefined ? { position: source.position } : {}) });
      }
      const shiftedDate = (offset: number | null) => {
        if (offset === null) return null;
        if (!project.startDate) reject(400, 'Indiquez une date de début pour créer les éléments datés de ce modèle.');
        const shifted = new Date(`${project.startDate}T00:00:00.000Z`);
        shifted.setUTCDate(shifted.getUTCDate() + offset);
        const formatted = shifted.toISOString().slice(0, 10);
        if (!date.safeParse(formatted).success) reject(400, 'Les dates du modèle dépassent la plage de dates autorisée.');
        return formatted;
      };
      for (const source of ordered) {
        const task: Task = {
          id: clonedIds.get(source.key)!, projectId: project.id, title: source.title, description: source.description,
          phase: source.phase, kind: source.kind, allocatedHours: source.allocatedHours, tags: [...source.tags],
          status: 'todo', progress: 0, assigneeId: null,
          startDate: shiftedDate(source.startOffsetDays), endDate: shiftedDate(source.endOffsetDays),
          dependsOnId: source.dependsOnKey ? clonedIds.get(source.dependsOnKey)! : null,
          ...(source.dependencyConstraint ? { dependencyConstraint: { ...source.dependencyConstraint } } : {}),
          ...(Object.hasOwn(source, 'listKey') ? { listId: source.listKey ? listIds.get(source.listKey)! : null } : {}),
          ...(source.position !== undefined ? { position: source.position } : {}),
        };
        persistTask(task);
      }
    }
    function assertActiveResource(resourceId: string): Records['resources'] {
      const resource = requireRecord('resources', resourceId);
      if (!resource.active) reject(409, 'Cette ressource est inactive. Réactivez-la avant de l’utiliser.');
      return resource;
    }
    function validateCalendarRange(record: CalendarEvent | Unavailability, partialSingleDay: boolean): void {
      assertDates(record.startDate, record.endDate);
      if (record.allDay) {
        record.startTime = null; record.endTime = null;
        return;
      }
      if (!record.startTime || !record.endTime) reject(400, 'Indiquez les heures de début et de fin.');
      if (partialSingleDay && record.startDate !== record.endDate) {
        reject(400, 'Une indisponibilité partielle doit porter sur une seule journée.');
      }
      if (`${record.endDate}T${record.endTime}` <= `${record.startDate}T${record.startTime}`) {
        reject(400, 'La fin doit suivre le début.');
      }
    }
    function validateCalendarEvent(event: CalendarEvent, previous?: CalendarEvent): CalendarEvent {
      if (previous?.projectId) assertProjectWritable(previous.projectId);
      if (event.projectId) assertProjectWritable(event.projectId);
      for (const resourceId of event.resourceIds) {
        if (previous?.resourceIds.includes(resourceId)) requireRecord('resources', resourceId);
        else assertActiveResource(resourceId);
      }
      validateCalendarRange(event, false);
      return event;
    }
    function validateUnavailability(unavailability: Unavailability, previous?: Unavailability): Unavailability {
      if (previous?.resourceId === unavailability.resourceId) requireRecord('resources', unavailability.resourceId);
      else assertActiveResource(unavailability.resourceId);
      validateCalendarRange(unavailability, true);
      return unavailability;
    }
    function currentUser(): AppData['currentUser'] {
      if (actor) return { ...actor };
      const resource = store.get('resources', CURRENT_USER.id);
      if (!resource) return { ...CURRENT_USER };
      const normalized = normalizeResource(resource);
      return { id: normalized.id, name: normalized.name, role: RESOURCE_ROLE_LABELS[normalized.role] };
    }
    function validateComment(comment: Records['comments']): Records['comments'] {
      const task = comment.taskId ? requireRecord('tasks', comment.taskId) : undefined;
      if (task && comment.projectId && task.projectId !== comment.projectId) reject(400, 'La tâche doit appartenir au projet de cette discussion.');
      const projectId = task?.projectId ?? comment.projectId;
      if (!projectId) reject(400, 'Sélectionnez un projet ou une tâche.');
      assertProjectWritable(projectId);
      for (const resourceId of comment.mentionResourceIds ?? []) requireRecord('resources', resourceId);
      return { ...comment, projectId };
    }
    function assertCollaborationOwner(record: { authorId?: string; authorName: string }): void {
      const user = currentUser();
      if ((actor?.role ?? user.role) === 'Administrateur') return;
      if (record.authorId ? record.authorId === user.id : record.authorName === user.name) return;
      reject(403, 'Seul l’auteur ou un administrateur peut modifier cet élément.');
    }
    function validateDocumentFolder(folder: Records['documentFolders']): void {
      assertProjectWritable(folder.projectId);
      if (folder.parentId) {
        const parent = requireRecord('documentFolders', folder.parentId);
        if (parent.projectId !== folder.projectId) reject(400, 'Le dossier parent doit appartenir au même projet.');
      }
      try {
        validateDocumentFolderTree([...store.all('documentFolders').filter(existing => existing.id !== folder.id), folder], new Set(store.all('projects').map(project => project.id)));
      } catch (error) { reject(409, error instanceof Error ? error.message : 'Cette organisation de dossiers est invalide.'); }
    }
    function assertDocumentFolder(projectId: string, folderId?: string | null): void {
      if (!folderId) return;
      if (requireRecord('documentFolders', folderId).projectId !== projectId) reject(400, 'Le dossier doit appartenir au même projet que le document.');
    }
    function validateTaskList(list: Records['taskLists']): void {
      assertProjectWritable(list.projectId);
      if (list.parentId && requireRecord('taskLists', list.parentId).projectId !== list.projectId) {
        reject(400, 'La liste parent doit appartenir au même projet.');
      }
      try {
        validateTaskListTree([...store.all('taskLists').filter(existing => existing.id !== list.id), list], new Set(store.all('projects').map(project => project.id)));
      } catch (error) { reject(409, error instanceof Error ? error.message : 'Cette hiérarchie de listes est invalide.'); }
    }
    function materializePhase(projectId: string, phase: string): Records['taskLists'] {
      const tasks = store.all('tasks').filter(task => task.projectId === projectId && !task.listId && task.phase.trim() === phase);
      const roots = store.all('taskLists').filter(list => list.projectId === projectId && list.parentId === null && list.name === phase);
      if (!tasks.length) {
        if (roots.length === 1) return roots[0];
        reject(409, 'Cette phase a changé. Actualisez la liste avant de réessayer.');
      }
      const parent: Records['taskLists'] = { id: crypto.randomUUID(), projectId, name: phase, parentId: null };
      validateTaskList(parent); store.put('taskLists', parent);
      for (const task of tasks) store.put('tasks', { ...task, listId: parent.id });
      return parent;
    }
    function assertTimeValidationPermission(resourceId: string, projectId?: string): void {
      if (actor && canValidateTime(state(), resourceId, projectId)) return;
      if (actor?.role === 'Administrateur') return;
      if (actor?.role === 'Visiteur') reject(403, 'Vous ne pouvez pas valider les temps de cette ressource.');
      const validator = requireRecord('resources', actor?.id ?? CURRENT_USER.id);
      if (!canValidateResourceTime(validator, resourceId)) {
        reject(403, 'Vous n’avez pas la délégation nécessaire pour valider les temps de cette ressource.');
      }
    }
    function assertTimePeriodWritable(entry: Records['timeEntries']): void {
      if (!planzonePreferences({ planzonePreferences: store.all('planzonePreferences') }).blockIntegratedDates) return;
      const integration = timeIntegrationIndex({ projects: store.all('projects'), resources: store.all('resources'), tasks: store.all('tasks') });
      if (integration.entryCovered(entry)) reject(409, 'Cette journée est validée par une date d’intégration. Ajustez cette date avant de modifier les temps de cette période.');
    }
    function validateOrganizationUnit(unit: Records['organizationUnits']): void {
      if (unit.parentId) requireRecord('organizationUnits', unit.parentId);
      for (const resourceId of unit.resourceIds) requireRecord('resources', resourceId);
      try { validateOrganizationTree([...store.all('organizationUnits').filter(existing => existing.id !== unit.id), unit], store.all('resources')); }
      catch (error) { reject(400, error instanceof Error ? error.message : 'L’unité est invalide.'); }
    }
    function validateResource(resource: Resource, previous?: Resource): Resource {
      const normalized = normalizeResource(resource);
      validateValues('resource', normalized.customValues, previous?.customValues);
      if (normalized.managerId && normalized.managerId !== normalized.id) requireRecord('resources', normalized.managerId);
      try { validateResourceManagers([...store.all('resources').filter(item => item.id !== normalized.id), normalized]); }
      catch (error) { reject(400, error instanceof Error ? error.message : 'Le responsable est invalide.'); }
      if (normalized.profileId) requireRecord('profiles', normalized.profileId);
      for (const resourceId of normalized.validatesTimeForIds) requireRecord('resources', resourceId);
      for (const projectId of normalized.projectIds) requireRecord('projects', projectId);
      for (const zoneId of normalized.zoneIds ?? []) requireRecord('zones', zoneId);
      if (actor && resource.id === 'resource-claire' && (normalized.role !== 'administrator' || !normalized.active || normalized.type !== 'human')) reject(409, 'Le compte administrateur principal doit rester actif et administrateur.');
      // Legacy clients continue to see Monday and the representative Tuesday capacity.
      normalized.mondayHours = normalized.weeklyCapacityHours[0];
      normalized.dailyHours = normalized.weeklyCapacityHours[1];
      return normalized;
    }
    function started(task: Task): boolean {
      return ['in_progress', 'validation', 'done'].includes(task.status) || task.progress > 0;
    }
    function validateTask(task: Task, previous?: Task, adjustMovement = true, authority?: AppData): Task {
      assertProjectWritable(task.projectId);
      if (task.listId && requireRecord('taskLists', task.listId).projectId !== task.projectId) {
        reject(400, 'La liste doit appartenir au même projet que la tâche.');
      }
      validateValues('task', task.customValues, previous?.customValues);
      assertDates(task.startDate, task.endDate);
      const preferences = planzonePreferences({ planzonePreferences: store.all('planzonePreferences') });
      const resource = task.assigneeId ? store.get('resources', task.assigneeId) : undefined;
      const startShift = previous?.startDate && task.startDate ? Date.parse(task.startDate) - Date.parse(previous.startDate) : 0;
      const endShift = previous?.endDate && task.endDate ? Date.parse(task.endDate) - Date.parse(previous.endDate) : 0;
      if (adjustMovement && preferences.extendAcrossNonWorkingDays && task.kind === 'task' && previous?.startDate && previous.endDate && task.startDate && startShift !== 0 && startShift === endShift) {
        const duration = Math.max(1, workingDurationDays(previous.startDate, previous.endDate, resource));
        task.endDate = workingMoveEnd(task.startDate, duration, resource) ?? reject(400, 'Le calendrier de la ressource ne permet pas ce déplacement.');
      }
      if (preferences.linkAllocationToDuration && task.kind === 'task' && (!previous || task.startDate !== previous.startDate || task.endDate !== previous.endDate || task.assigneeId !== previous.assigneeId)) {
        const allocation = durationAllocation(task, resource);
        if (task.startDate && task.endDate && (allocation === null || !Number.isFinite(allocation) || allocation > 100000)) reject(400, 'La période dépasse la durée ou l’allocation prise en charge.');
        if (allocation !== null) {
          if (actor && !canProject(authority ?? state(), task.projectId, 'ownAllocation', task)) reject(403, 'La modification de durée nécessite aussi le droit de modifier l’allocation.');
          task.allocatedHours = allocation;
        }
      }
      if (task.kind === 'milestone' && task.allocatedHours !== 0) reject(400, 'Un jalon ne porte aucune charge allouée.');
      if (task.kind === 'milestone' && previous?.kind === 'task' && store.all('timeEntries').some(entry => entry.taskId === task.id)) {
        reject(409, 'Cette tâche contient des temps déclarés et ne peut pas être convertie en jalon.');
      }
      if (task.assigneeId) {
        if (previous?.assigneeId === task.assigneeId) requireRecord('resources', task.assigneeId);
        else assertActiveResource(task.assigneeId);
      }
      if (task.status === 'done') task.progress = 100;
      if (task.dependsOnId) {
        let predecessor = requireRecord('tasks', task.dependsOnId);
        if (predecessor.projectId !== task.projectId) reject(409, 'La dépendance doit appartenir au même projet.');
        if (!task.dependencyConstraint && started(task) && predecessor.status !== 'done') reject(409, 'Terminez la tâche précédente avant de démarrer cette tâche.');
        const visited = new Set([task.id]);
        while (true) {
          if (visited.has(predecessor.id)) reject(409, 'Cette dépendance crée un cycle.');
          visited.add(predecessor.id);
          if (!predecessor.dependsOnId) break;
          predecessor = requireRecord('tasks', predecessor.dependsOnId);
        }
      }
      if (previous?.status === 'done' && task.status !== 'done') {
        if (store.all('tasks').some(dependent => dependent.dependsOnId === task.id && !dependent.dependencyConstraint && started(dependent))) {
          reject(409, 'Une tâche dépendante a déjà démarré. Sa dépendance doit rester terminée.');
        }
      }
      return task;
    }
    function persistTask(task: Task, previous?: Task): Task {
      const updated = validateTask(task, previous);
      let plan: Task[];
      const authority = state();
      try { plan = planTaskConstraints(store.all('tasks'), updated, previous, preferenceConstraintShift(authority)); }
      catch (error) { if (error instanceof TaskConstraintError) reject(409, error.message); throw error; }
      const validated = plan.map(next => {
        const old = next.id === task.id ? previous : store.get('tasks', next.id);
        if (actor && !(next.id === task.id && !previous) && (next.startDate !== old?.startDate || next.endDate !== old?.endDate) && !canProject(authority, next.projectId, next.kind === 'milestone' ? 'milestoneEdit' : 'taskEdit', next)) {
          reject(403, `La replanification nécessite le droit de modifier « ${next.title} ». Aucune date n’a été modifiée.`);
        }
        return validateTask(next, old, false, authority);
      });
      for (const next of validated) store.put('tasks', next);
      return validated.find(next => next.id === task.id)!;
    }
    function state(today?: string): AppData {
      const data: AppData = {
        zones: store.all('zones').sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER)), projects: store.all('projects'), tasks: store.all('tasks'),
        resources: store.all('resources').map(resource => actor && resource.id === 'resource-claire' ? normalizeResource({ ...resource, role: 'administrator', active: true, type: 'human' }) : normalizeResource(resource)), profiles: store.all('profiles'), timeEntries: store.all('timeEntries'),
        comments: store.all('comments'), expenses: store.all('expenses'), revenues: store.all('revenues'), currentUser: currentUser(),
        calendarEvents: store.all('calendarEvents'), unavailabilities: store.all('unavailabilities'),
        projectTemplates: store.all('projectTemplates'), customFieldDefinitions: store.all('customFieldDefinitions'),
        reportTemplates: store.all('reportTemplates'), projectStatusDefinitions: store.all('projectStatusDefinitions'), strategicAxes: store.all('strategicAxes'),
        projectReports: store.all('projectReports'),
        projectDocuments: store.all('projectDocuments'),
        documentFolders: store.all('documentFolders'),
        capacityPlans: store.all('capacityPlans'), planzonePreferences: store.all('planzonePreferences'), organizationUnits: store.all('organizationUnits'), taskLists: store.all('taskLists'), permissionPolicies: store.all('permissionPolicies'),
        viewRoleCatalog: GLOBAL_ROLES.map(id => ({ id, label: RESOURCE_ROLE_LABELS[id] })),
        today: today ?? dateInParis(),
      };
      const integration = timeIntegrationIndex(data);
      data.timeEntries = data.timeEntries.map(integration.decorate);
      return data;
    }
    function create(entity: StoredEntity, body: unknown): MutationResult {
      const table = tables[entity];

      const parsed = createSchemas[entity].safeParse(body);
      if (!parsed.success) reject(400, parsed.error.issues.map(issue => `${issue.path.join('.') || 'Données'} : ${issue.message}`).join(' '));
      const value = { ...parsed.data, id: crypto.randomUUID() } as Records[typeof table];
      const result = commit(() => {
        switch (entity) {
          case 'organization-units': { const unit = value as Records['organizationUnits']; validateOrganizationUnit(unit); store.put('organizationUnits', unit); break; }
          case 'permission-policies': {
            if (store.all('permissionPolicies').length) reject(409, 'Une configuration des droits existe déjà. Modifiez-la.');
            store.put('permissionPolicies', value as Records['permissionPolicies']); break;
          }
          case 'zones': store.put('zones', value as Records['zones']); break;
          case 'projects': {
            const project = value as Records['projects'] & { templateId?: string };
            const changes = body as Partial<Project>;
            const template = project.templateId ? requireRecord('projectTemplates', project.templateId) : undefined;
            delete project.templateId;
            if (actor && store.get('resources', currentUser().id)) { project.createdByResourceId = currentUser().id; project.projectRoles = { ...project.projectRoles, [currentUser().id]: 'manager' }; }
            if (template) {
              if (!Object.hasOwn(changes, 'description')) project.description = template.description;
              if (!Object.hasOwn(changes, 'descriptionFormat') && template.descriptionFormat) project.descriptionFormat = template.descriptionFormat;
              if (!Object.hasOwn(changes, 'budget')) project.budget = template.budget;
              if (!Object.hasOwn(changes, 'color')) project.color = template.color;
            }
            validateProject(project, changes);
            store.put('projects', project);
            if (template) cloneTemplate(project, template);
            break;
          }
          case 'tasks': Object.assign(value, persistTask(value as Task)); break;
          case 'task-lists': {
            const list = value as Records['taskLists'] & { sourcePhase?: string; parentPhase?: string };
            const { sourcePhase, parentPhase } = list; delete list.sourcePhase; delete list.parentPhase;
            assertProjectWritable(list.projectId);
            if (parentPhase) list.parentId = materializePhase(list.projectId, parentPhase).id;
            validateTaskList(list); store.put('taskLists', list);
            if (sourcePhase) {
              const tasks = store.all('tasks').filter(task => task.projectId === list.projectId && !task.listId && task.phase.trim() === sourcePhase);
              if (!tasks.length) reject(409, 'Cette phase a changé. Actualisez la liste avant de réessayer.');
              for (const task of tasks) store.put('tasks', { ...task, listId: list.id });
            }
            break;
          }
          case 'resources': {
            const resource = value as Records['resources'];
            resource.initials ||= resource.name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
            Object.assign(resource, validateResource(resource));
            store.put('resources', resource);
            if (normalizeResource(resource).role === 'visitor') for (const project of store.all('projects')) if (project.projectRoles?.[resource.id] && project.projectRoles[resource.id] !== 'observer') store.put('projects', { ...project, projectRoles: { ...project.projectRoles, [resource.id]: 'observer' } });
            break;
          }
          case 'profiles': store.put('profiles', value as Records['profiles']); break;
          case 'time-entries': {
            const entry = value as Records['timeEntries'];
            validateValues('time-entry', entry.customValues);
            const task = requireRecord('tasks', entry.taskId); assertProjectWritable(task.projectId);
            assertTimePeriodWritable(entry);
            if (task.kind === 'milestone') reject(400, 'Les temps se déclarent sur une tâche, pas sur un jalon.');
            const resource = assertActiveResource(entry.resourceId);
            if (entry.validated) assertTimeValidationPermission(entry.resourceId, task.projectId);
            const profile = resource.profileId ? requireRecord('profiles', resource.profileId) : null;
            entry.rateSnapshot = profile?.dailyRate ?? null; entry.eqjtSnapshot = profile?.eqjtHours ?? null;
            store.put('timeEntries', entry); break;
          }
          case 'comments': {
            const comment = validateComment(value as Records['comments']);
            comment.authorId = currentUser().id; comment.authorName = currentUser().name;
            comment.createdAt = new Date().toISOString(); comment.updatedAt = comment.createdAt;
            Object.assign(value, comment); store.put('comments', comment); break;
          }
          case 'project-documents': {
            const document = value as Records['projectDocuments']; assertProjectWritable(document.projectId);
            assertDocumentFolder(document.projectId, document.folderId);
            document.authorId = currentUser().id; document.authorName = currentUser().name;
            document.createdAt = new Date().toISOString(); document.updatedAt = document.createdAt;
            document.sizeBytes = document.kind === 'file' ? documentFileSize(document) : null;
            store.put('projectDocuments', document); break;
          }
          case 'document-folders': {
            const folder = value as Records['documentFolders']; validateDocumentFolder(folder);
            folder.authorId = currentUser().id; folder.authorName = currentUser().name;
            folder.createdAt = new Date().toISOString(); folder.updatedAt = folder.createdAt;
            store.put('documentFolders', folder); break;
          }
          case 'expenses': {
            const expense = value as Records['expenses']; assertProjectWritable(expense.projectId);
            store.put('expenses', expense); break;
          }
          case 'revenues': {
            const revenue = value as Records['revenues']; assertProjectWritable(revenue.projectId);
            store.put('revenues', revenue); break;
          }
          case 'project-reports': {
            const report = value as Records['projectReports']; assertProjectWritable(report.projectId);
            if (report.templateId) requireRecord('reportTemplates', report.templateId);
            report.authorName = currentUser().name;
            report.createdAt = new Date().toISOString(); report.updatedAt = report.createdAt;
            store.put('projectReports', report); break;
          }
          case 'calendar-events': store.put('calendarEvents', validateCalendarEvent(value as CalendarEvent)); break;
          case 'unavailabilities': store.put('unavailabilities', validateUnavailability(value as Unavailability)); break;
          case 'project-templates': {
            const template = value as Records['projectTemplates']; validateTemplate(template);
            store.put('projectTemplates', template); break;
          }
          case 'custom-field-definitions': {
            const definition = value as Records['customFieldDefinitions']; validateDefinition(definition);
            store.put('customFieldDefinitions', definition); break;
          }
          case 'report-templates': store.put('reportTemplates', value as Records['reportTemplates']); break;
          case 'project-status-definitions': store.put('projectStatusDefinitions', value as Records['projectStatusDefinitions']); break;
          case 'strategic-axes': store.put('strategicAxes', value as Records['strategicAxes']); break;
        }
        return value;
      });
      return { status: 201, value: result };
    }
    function update(entity: StoredEntity, body: unknown, recordId: string): MutationResult {
      const table = tables[entity];

      const parsed = patchSchemas[entity].safeParse(body);
      if (!parsed.success) reject(400, parsed.error.issues.map(issue => `${issue.path.join('.') || 'Données'} : ${issue.message}`).join(' '));
      if (!Object.keys(parsed.data).length) reject(400, 'Indiquez au moins un champ à modifier.');
      const result = commit(() => {
        const previous = requireRecord(table, recordId);
        const value = { ...previous, ...parsed.data } as Records[typeof table];
        switch (entity) {
          case 'organization-units': { const unit = value as Records['organizationUnits']; validateOrganizationUnit(unit); store.put('organizationUnits', unit); break; }
          case 'permission-policies': { const policy = value as Records['permissionPolicies']; const old = previous as Records['permissionPolicies']; policy.collaborator = { ...old.collaborator, ...policy.collaborator }; store.put('permissionPolicies', policy); break; }
          case 'zones': store.put('zones', value as Records['zones']); break;
          case 'projects': {
            const project = value as Records['projects'];
            store.put('projects', validateProject(project, parsed.data as Partial<Project>, previous as Project)); break;
          }
          case 'tasks': {
            const task = value as Task; const old = previous as Task;
            if (!task.dependsOnId && task.dependencyConstraint && Object.hasOwn(parsed.data, 'dependencyConstraint')) reject(409, 'Choisissez un prédécesseur pour cette contrainte.');
            if (!task.dependsOnId || (task.dependsOnId !== old.dependsOnId && !Object.hasOwn(parsed.data, 'dependencyConstraint'))) task.dependencyConstraint = null;
            if ((task.listId ?? null) !== (old.listId ?? null) || (!task.listId && task.phase !== old.phase)) delete task.position;
            Object.assign(task, persistTask(task, old)); break;
          }
          case 'task-lists': {
            const list = value as Records['taskLists'];
            if (list.parentId !== (previous as Records['taskLists']).parentId) delete list.position;
            validateTaskList(list); store.put('taskLists', list); break;
          }
          case 'resources': {
            const resource = value as Records['resources'];
            const patch = parsed.data as Partial<Resource>;
            if (!patch.weeklyCapacityHours) {
              const weekly = normalizeResource(previous as Resource).weeklyCapacityHours;
              if (patch.mondayHours !== undefined) weekly[0] = patch.mondayHours;
              if (patch.dailyHours !== undefined) for (let day = 1; day < 5; day++) weekly[day] = patch.dailyHours;
              resource.weeklyCapacityHours = weekly;
            }
            Object.assign(resource, validateResource(resource, previous as Resource));
            store.put('resources', resource);
            if (normalizeResource(resource).role === 'visitor') for (const project of store.all('projects')) if (project.projectRoles?.[resource.id] && project.projectRoles[resource.id] !== 'observer') store.put('projects', { ...project, projectRoles: { ...project.projectRoles, [resource.id]: 'observer' } });
            break;
          }
          case 'profiles': store.put('profiles', value as Records['profiles']); break;
          case 'time-entries': {
            const entry = value as Records['timeEntries']; assertProjectWritable(requireRecord('tasks', entry.taskId).projectId);
            assertTimePeriodWritable(previous as Records['timeEntries']); assertTimePeriodWritable(entry);
            if ((previous as Records['timeEntries']).validated) {
              const patch = parsed.data;
              if (Object.keys(patch).length !== 1 || !('validated' in patch) || patch.validated !== false) {
                reject(409, 'Retirez la validation dans une opération séparée avant de corriger cette saisie.');
              }
            }
            if (entry.validated !== (previous as Records['timeEntries']).validated) assertTimeValidationPermission(entry.resourceId, requireRecord('tasks', entry.taskId).projectId);
            validateValues('time-entry', entry.customValues, (previous as Records['timeEntries']).customValues);
            store.put('timeEntries', entry); break;
          }
          case 'comments': {
            assertCollaborationOwner(previous as Records['comments']);
            const comment = validateComment(value as Records['comments']); comment.updatedAt = new Date().toISOString();
            Object.assign(value, comment); store.put('comments', comment); break;
          }
          case 'project-documents': {
            const document = value as Records['projectDocuments']; assertProjectWritable(document.projectId);
            assertCollaborationOwner(document);
            assertDocumentFolder(document.projectId, document.folderId);
            if (document.kind === 'file' && Object.hasOwn(parsed.data, 'url')) reject(400, 'L’adresse web ne peut être modifiée que sur un lien.');
            document.updatedAt = new Date().toISOString(); store.put('projectDocuments', document); break;
          }
          case 'document-folders': {
            const folder = value as Records['documentFolders']; assertCollaborationOwner(folder); validateDocumentFolder(folder);
            folder.updatedAt = new Date().toISOString(); store.put('documentFolders', folder); break;
          }
          case 'expenses': {
            const expense = value as Records['expenses']; assertProjectWritable(expense.projectId);
            store.put('expenses', expense); break;
          }
          case 'revenues': {
            const revenue = value as Records['revenues']; assertProjectWritable(revenue.projectId);
            store.put('revenues', revenue); break;
          }
          case 'project-reports': {
            const report = value as Records['projectReports']; assertProjectWritable(report.projectId);
            // A deleted template does not invalidate an existing report snapshot.
            if (report.templateId && report.templateId !== (previous as Records['projectReports']).templateId) {
              requireRecord('reportTemplates', report.templateId);
            }
            report.updatedAt = new Date().toISOString();
            store.put('projectReports', report); break;
          }
          case 'calendar-events': store.put('calendarEvents', validateCalendarEvent(value as CalendarEvent, previous as CalendarEvent)); break;
          case 'unavailabilities': store.put('unavailabilities', validateUnavailability(value as Unavailability, previous as Unavailability)); break;
          case 'project-templates': {
            const template = value as Records['projectTemplates']; validateTemplate(template);
            store.put('projectTemplates', template); break;
          }
          case 'custom-field-definitions': {
            const definition = value as Records['customFieldDefinitions']; validateDefinition(definition);
            store.put('customFieldDefinitions', definition); break;
          }
          case 'report-templates': store.put('reportTemplates', value as Records['reportTemplates']); break;
          case 'project-status-definitions': {
            const definition = value as Records['projectStatusDefinitions'];
            if (definition.baseStatus !== (previous as Records['projectStatusDefinitions']).baseStatus
              && store.all('projects').some(project => project.customStatusId === definition.id)) {
              reject(409, 'Ce statut est utilisé par un projet. Son état de projet doit rester inchangé.');
            }
            store.put('projectStatusDefinitions', definition); break;
          }
          case 'strategic-axes': store.put('strategicAxes', value as Records['strategicAxes']); break;
        }
        return value;
      });
      return { status: 200, value: result };
    }
    function remove(entity: StoredEntity, recordId: string, body?: unknown): MutationResult {
      const table = tables[entity];

      commit(() => {
        const value = requireRecord(table, recordId);
        switch (entity) {
          case 'zones': {
            const projects = store.all('projects').filter(project => project.zoneId === value.id);
            if (body !== undefined) {
              const parsed = zoneDeleteInput.safeParse(body);
              if (!parsed.success) reject(400, 'Confirmez explicitement la suppression de la zone et de ses projets.');
              const expected = new Set(parsed.data.expectedProjectIds);
              if (expected.size !== projects.length || projects.some(project => !expected.has(project.id))) {
                reject(409, 'Les projets de cette zone ont changé. Rechargez la page et vérifiez la liste avant de confirmer à nouveau.');
              }
            } else if (projects.length) {
              reject(409, 'Cette zone contient des projets. Confirmez leur suppression dans la fenêtre de suppression de zone.');
            }
            deleteZoneContents(store, value.id, projects);
            break;
          }
          case 'organization-units': {
            const unit = value as Records['organizationUnits'];
            if (unit.resourceIds.length || store.all('organizationUnits').some(child => child.parentId === unit.id) || store.all('capacityPlans').some(plan => plan.domains.some(domain => domain.teamIds.includes(unit.id)))) reject(409, 'Cette unité contient des ressources ou des sous-unités. Retirez-les avant de la supprimer.');
            break;
          }
          case 'resources': reject(405, 'Désactivez une ressource pour conserver son historique.');
          case 'projects': {
            const project = value as Records['projects'];
            if (store.all('capacityPlans').some(plan => plan.demands.some(demand => demand.projectId === project.id) || plan.baselines.some(baseline => baseline.projectId === project.id)) || store.all('tasks').some(task => task.projectId === project.id) || store.all('expenses').some(expense => expense.projectId === project.id)
              || store.all('revenues').some(revenue => revenue.projectId === project.id)
              || store.all('projectReports').some(report => report.projectId === project.id)
              || store.all('projectDocuments').some(document => document.projectId === project.id)
              || store.all('documentFolders').some(folder => folder.projectId === project.id)
              || store.all('taskLists').some(list => list.projectId === project.id)
              || store.all('comments').some(comment => comment.projectId === project.id)
              || store.all('resources').some(resource => resource.projectIds?.includes(project.id))
              || store.all('calendarEvents').some(event => event.projectId === project.id)) {
              reject(409, 'Ce projet contient des données. Clôturez-le pour conserver son historique.');
            }
            break;
          }
          case 'tasks': {
            const task = value as Task; assertProjectWritable(task.projectId);
            if (store.all('timeEntries').some(entry => entry.taskId === task.id)) reject(409, 'Cette tâche contient des temps déclarés et doit être conservée.');
            if (store.all('tasks').some(dependent => dependent.dependsOnId === task.id)) reject(409, 'Une autre tâche dépend de cet élément.');
            store.all('comments').filter(comment => comment.taskId === task.id).forEach(comment => store.remove('comments', comment.id));
            break;
          }
          case 'task-lists': {
            const list = value as Records['taskLists']; assertProjectWritable(list.projectId);
            if (store.all('taskLists').some(child => child.parentId === list.id) || store.all('tasks').some(task => task.listId === list.id)) {
              reject(409, 'Cette liste contient des tâches ou des sous-listes. Déplacez-les avant de la supprimer.');
            }
            break;
          }
          case 'profiles': {
            if (store.all('resources').some(resource => resource.profileId === value.id)) reject(409, 'Ce profil est affecté à une ressource. Retirez son affectation avant de le supprimer.');
            break;
          }
          case 'time-entries': {
            const entry = value as Records['timeEntries'];
            assertProjectWritable(requireRecord('tasks', entry.taskId).projectId);
            assertTimePeriodWritable(entry);
            if (entry.validated) reject(409, 'Retirez la validation avant de supprimer cette saisie.');
            break;
          }
          case 'comments': validateComment(value as Records['comments']); assertCollaborationOwner(value as Records['comments']); break;
          case 'project-documents': assertProjectWritable((value as Records['projectDocuments']).projectId); assertCollaborationOwner(value as Records['projectDocuments']); break;
          case 'document-folders': {
            const folder = value as Records['documentFolders']; assertProjectWritable(folder.projectId); assertCollaborationOwner(folder);
            if (store.all('documentFolders').some(child => child.parentId === folder.id) || store.all('projectDocuments').some(document => document.folderId === folder.id)) {
              reject(409, 'Ce dossier contient des documents ou des sous-dossiers. Déplacez-les avant de le supprimer.');
            }
            break;
          }
          case 'expenses': assertProjectWritable((value as Records['expenses']).projectId); break;
          case 'revenues': assertProjectWritable((value as Records['revenues']).projectId); break;
          case 'project-reports': assertProjectWritable((value as Records['projectReports']).projectId); break;
          case 'calendar-events': {
            const event = value as CalendarEvent;
            if (event.projectId) assertProjectWritable(event.projectId);
            break;
          }
          case 'custom-field-definitions': {
            if (fieldReferences(value.id).length) reject(409, 'Ce champ contient des valeurs existantes. Retirez-les avant de le supprimer.');
            try { validateFormulaDefinitions(store.all('customFieldDefinitions').filter(definition => definition.id !== value.id)); }
            catch (error) { reject(409, error instanceof Error ? error.message : 'Ce champ est utilisé par une formule.'); }
            break;
          }
          case 'project-status-definitions': {
            if (store.all('projects').some(project => project.customStatusId === value.id)) reject(409, 'Ce statut est utilisé par un projet. Changez son statut avant de le supprimer.');
            break;
          }
          case 'strategic-axes': {
            if (store.all('projects').some(project => Object.hasOwn(project.strategicRatings ?? {}, value.id))) reject(409, 'Cet axe est évalué dans un projet. Retirez son évaluation avant de le supprimer.');
            break;
          }
        }
        store.remove(table, value.id);
      });
      return { status: 204 };
    }
    this.readState = today => {
      const visible = actor ? permittedState(state(today)) : state(today);
      return { ...visible, projectDocuments: visible.projectDocuments?.map(document => ({ ...document, contentBase64: null })) };
    };
    this.readDocument = id => {
      const document = store.get('projectDocuments', id);
      // Document reads use project visibility, including observers and closed projects.
      if (!document || !this.readState().projectDocuments?.some(item => item.id === id)) reject(404, 'Ce document est introuvable.');
      return document!;
    };
    this.mutate = (entity, method, body, recordId) => {
      if (entity === 'zone-order') {
        if (method !== 'POST' || recordId) reject(405, 'L’ordre des zones utilise un enregistrement contrôlé.');
        if (!isAdmin(state())) reject(403, 'Seul un administrateur peut organiser les zones.');
        const parsed = z.object({ zoneIds: z.array(id).max(1000).refine(values => new Set(values).size === values.length) }).strict().safeParse(body);
        if (!parsed.success) reject(400, 'Sélectionnez chaque zone une seule fois.');
        commit(() => {
          const zones = store.all('zones');
          const ids = new Set(parsed.data.zoneIds);
          if (ids.size !== zones.length || zones.some(zone => !ids.has(zone.id))) reject(409, 'Les zones ont changé. Rechargez la page avant de réorganiser leur ordre.');
          const positions = new Map(parsed.data.zoneIds.map((id, position) => [id, position]));
          for (const zone of zones) store.put('zones', { ...zone, position: positions.get(zone.id)! });
        });
        return { status: 204 };
      }
      if (entity === 'planzone-preferences') {
        if (method !== 'POST' || recordId) reject(405, 'Les préférences utilisent un enregistrement contrôlé.');
        if (!isAdmin(state())) reject(403, 'Seul un administrateur peut modifier les paramètres de la Planzone.');
        const parsed = planzonePreferencesInput.safeParse(body);
        if (!parsed.success) reject(400, 'Vérifiez les options et les seuils horaires entre 0 et 24.');
        const value = commit(() => {
          const previous = store.get('planzonePreferences', 'planzone-preferences') ?? DEFAULT_PLANZONE_PREFERENCES;
          if (parsed.data.expectedVersion !== previous.version) reject(409, 'Ces préférences ont été modifiées. Rechargez-les avant d’enregistrer.');
          const { expectedVersion, ...options } = parsed.data;
          const next = { ...previous, ...options, id: 'planzone-preferences' as const, version: expectedVersion + 1 };
          store.put('planzonePreferences', next); return next;
        });
        return { status: 200, value };
      }
      if (entity === 'task-self-assignment') {
        if (method !== 'POST' || recordId) reject(405, 'L’auto-affectation utilise une requête de création.');
        const parsed = z.object({ taskId: id }).strict().safeParse(body);
        if (!parsed.success) reject(400, 'Choisissez une tâche.');
        const data = state(), preferences = planzonePreferences(data), resource = requireRecord('resources', data.currentUser.id);
        const task = requireRecord('tasks', parsed.data.taskId);
        if (!preferences.allowSelfAssignment || !resource.active || globalRole(data) === 'visitor' || !canReadProject(data, task.projectId) || !canProject(data, task.projectId, 'taskComplete', { ...task, assigneeId: resource.id })) reject(403, 'L’auto-affectation n’est pas autorisée.');
        if (task.kind !== 'task' || task.status === 'done') reject(400, 'Choisissez une tâche ouverte.');
        if (task.assigneeId && task.assigneeId !== resource.id) reject(409, 'Cette tâche est déjà affectée à une autre ressource.');
        const value = commit(() => { const next = validateTask({ ...task, assigneeId: resource.id }, task); store.put('tasks', next); return next; });
        return { status: 200, value };
      }
      if (entity === 'capacity-plan') {
        if (method !== 'POST' || recordId) reject(405, 'Le capacitaire utilise des actions de création contrôlées.');
        try {
          const value = commit(() => mutateCapacityPlan(store, state(), body));
          return { status: 200, value: actor ? permittedState(state()).capacityPlans?.[0] : value };
        }
        catch (error) { if (error instanceof CapacityPlanError) reject(error.status, error.message); throw error; }
      }
      if (actor) authorizeMutation(store, state(), entity, method, body, recordId, reject);
      if (entity === 'time-integrations') {
        if (method !== 'POST' || recordId) reject(405, 'Les dates d’intégration utilisent une requête de création sans identifiant de route.');
        const parsed = timeIntegrationInput.safeParse(body);
        if (!parsed.success) reject(400, 'Indiquez un projet ou une ressource et une date d’intégration valide.');
        const input = parsed.data;
        const result = commit(() => {
          if (input.scope === 'project') {
            if (currentUser().role !== 'Administrateur' && !(actor && canProject(state(), input.projectId, 'time'))) reject(403, 'La date d’intégration projet nécessite le rôle chef de projet.');
            assertProjectWritable(input.projectId);
            const project = { ...requireRecord('projects', input.projectId), timeIntegrationDate: input.date };
            store.put('projects', project); return project;
          }
          const resource = requireRecord('resources', input.resourceId);
          assertTimeValidationPermission(input.resourceId);
          const updated = { ...resource, timeIntegrationDate: input.date };
          store.put('resources', updated); return updated;
        });
        return { status: 200, value: result };
      }
      if (entity === 'project-item-moves') {
        if (method !== 'POST' || recordId) reject(405, 'Les déplacements utilisent une requête de création sans identifiant de route.');
        const parsed = projectItemMoveInput.safeParse(body);
        if (!parsed.success) reject(400, 'Indiquez un élément, une destination et un emplacement valides.');
        const result = commit(() => {
          assertProjectWritable(parsed.data.projectId);
          let plan;
          try { plan = planProjectItemMove({ projects: store.all('projects'), tasks: store.all('tasks'), taskLists: store.all('taskLists') }, parsed.data, () => crypto.randomUUID()); }
          catch (error) { if (error instanceof ProjectItemMoveError) return reject(error.status, error.message); throw error; }
          const allLists = [...store.all('taskLists').filter(list => list.projectId !== parsed.data.projectId), ...plan.taskLists];
          const allTasks = [...store.all('tasks').filter(task => task.projectId !== parsed.data.projectId), ...plan.tasks];
          try { validateTaskListTree(allLists, new Set(store.all('projects').map(project => project.id)), allTasks); }
          catch (error) { reject(409, error instanceof Error ? error.message : 'Ce déplacement est impossible.'); }
          const planned = new Map(plan.taskLists.map(list => [list.id, list])); const written = new Set<string>();
          const write = (listId: string) => {
            if (written.has(listId)) return;
            const list = planned.get(listId)!;
            if (list.parentId) write(list.parentId);
            store.put('taskLists', list); written.add(listId);
          };
          for (const list of plan.taskLists) write(list.id);
          for (const task of plan.tasks) store.put('tasks', task);
          return plan.moved.type === 'task' ? store.get('tasks', plan.moved.id)! : store.get('taskLists', plan.moved.id)!;
        });
        return { status: 200, value: result };
      }
      if (!Object.hasOwn(tables, entity)) reject(404, 'Cette route API est introuvable.');
      if (method === 'POST') return create(entity, body);
      if (!recordId) reject(404, 'Cet élément est introuvable.');
      if (method === 'PATCH') return update(entity, body, recordId);
      if (method === 'DELETE') return remove(entity, recordId, body);
      return reject(405, 'Cette méthode n’est pas disponible.');
    };
    const originalMutate = this.mutate;
    this.mutate = (entity, method, body, recordId) => {
      const original = originalMutate(entity, method, body, recordId);
      const result = entity === 'project-documents' && original.value
        ? { ...original, value: { ...original.value, contentBase64: null } as ProjectDocument } : original;
      if (entity === 'zone-order' || !actor || !result.value || isAdmin(state())) return result;
      const data = this.readState();
      const table = entity === 'time-integrations' ? (body as { scope: string }).scope === 'project' ? 'projects' : 'resources'
        : entity === 'planzone-preferences' ? 'planzonePreferences' : entity === 'task-self-assignment' ? 'tasks' : entity === 'capacity-plan' ? 'capacityPlans' : entity === 'project-item-moves' ? 'title' in result.value ? 'tasks' : 'taskLists' : tables[entity];
      const collection = data[table] as { id: string }[] | undefined;
      return { ...result, value: (collection?.find(record => record.id === result.value!.id) ?? { id: result.value.id }) as Records[Table] };
    };
  }
}
