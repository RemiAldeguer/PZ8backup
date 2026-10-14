export const TASK_STATUSES = ['todo', 'ready', 'in_progress', 'validation', 'done'] as const;
export type TaskStatus = typeof TASK_STATUSES[number];
export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'À faire', ready: 'Prêt à démarrer', in_progress: 'En cours', validation: 'En validation', done: 'Terminé',
};
export type ProjectStatus = 'requested' | 'open' | 'paused' | 'closed';
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  requested: 'Demandé', open: 'Ouvert', paused: 'Interrompu', closed: 'Clos',
};
export interface Zone { id: string; name: string; color: string; }
export interface Project {
  id: string; name: string; description: string; zoneId: string;
  startDate: string; endDate: string; status: ProjectStatus;
  weather: number; budget: number; color: string;
  timeIntegrationDate?: string | null;
  customStatusId?: string | null; customValues?: Record<string, string>; strategicRatings?: Record<string, number>;
  tags?: string[]; portfolioNames?: string[];
  enabledViews?: ProjectViewId[];
  descriptionFormat?: 'plain' | 'markdown';
  projectRoles?: Record<string, ProjectRole>;
  createdByResourceId?: string;
}
export const PROJECT_ROLES = ['manager', 'collaborator', 'observer'] as const;
export type ProjectRole = typeof PROJECT_ROLES[number];
export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = { manager: 'Chef(fe) de projet', collaborator: 'Collaborateur', observer: 'Observateur' };
export const PROJECT_VIEW_IDS = ['summary', 'list', 'gantt', 'calendar', 'board', 'time', 'discussions', 'documents', 'budget', 'reports'] as const;
export type ProjectViewId = typeof PROJECT_VIEW_IDS[number];
/** View preferences affect navigation; they are not access permissions. Legacy projects retain every view. */
export function projectViewEnabled(project: Project, view: string): boolean {
  return view === 'team' || project.enabledViews === undefined || project.enabledViews.includes(view as ProjectViewId);
}
export interface Task {
  id: string; projectId: string; title: string; description: string;
  phase: string; status: TaskStatus; progress: number;
  assigneeId: string | null; startDate: string | null; endDate: string | null;
  allocatedHours: number; kind: 'task' | 'milestone'; tags: string[];
  dependsOnId: string | null;
  listId?: string | null;
  position?: number;
  customValues?: Record<string, string>;
}
export interface ProjectTaskList { id: string; projectId: string; name: string; parentId: string | null; position?: number; }
export interface OrganizationUnit { id: string; name: string; parentId: string | null; resourceIds: string[]; }
export const GLOBAL_ROLES = ['administrator', 'project_creator', 'user', 'visitor'] as const;
export type ResourceRole = typeof GLOBAL_ROLES[number];
export const RESOURCE_ROLE_LABELS = { administrator: 'Administrateur', project_creator: 'Créateur de projet', user: 'Usager', visitor: 'Visiteur' } as const satisfies Record<ResourceRole, string>;
export type WeeklyCapacity = [number, number, number, number, number, number, number];
export interface ResourceCustomField { id: string; label: string; type: 'text' | 'number' | 'date' | 'url'; value: string; }
export interface Resource {
  id: string; name: string; jobTitle: string;
  type: 'human' | 'virtual' | 'material'; classification: 'internal' | 'external';
  initials: string; color: string; dailyHours: number; mondayHours: number;
  profileId: string | null; active: boolean;
  email?: string; description?: string; role?: ResourceRole;
  tags?: { label: string; color: string }[];
  validatesTimeForIds?: string[];
  weeklyCapacityHours?: WeeklyCapacity;
  capacityUnit?: 'hours' | 'days'; hoursPerDay?: number;
  holidayCalendarId?: 'none' | 'fr';
  projectIds?: string[]; customFields?: ResourceCustomField[];
  zoneIds?: string[];
  timeIntegrationDate?: string | null;
  customValues?: Record<string, string>;
  /** Organisational responsibility only; does not grant project or time-validation permissions. */
  managerId?: string | null;
}
export interface CostProfile { id: string; name: string; dailyRate: number; eqjtHours: number; currency: 'EUR'; }
export interface TimeEntry {
  id: string; taskId: string; resourceId: string; date: string; hours: number;
  note: string; validated: boolean; rateSnapshot: number | null; eqjtSnapshot: number | null;
  /** Derived in API responses; individual validation stays stored independently. */
  integrationValidated?: boolean;
  manuallyValidated?: boolean;
  customValues?: Record<string, string>;
}
export interface Comment {
  id: string; taskId: string | null; projectId?: string;
  authorId?: string; authorName: string; body: string; createdAt: string; updatedAt?: string;
  mentionResourceIds?: string[];
}
export interface ProjectDocument {
  id: string; projectId: string; name: string; description: string; kind: 'file' | 'link';
  url: string | null; fileName: string | null; mimeType: string | null; contentBase64: string | null; sizeBytes: number | null;
  authorId: string; authorName: string; createdAt: string; updatedAt: string;
  folderId?: string | null;
}
export interface DocumentFolder {
  id: string; projectId: string; name: string; parentId: string | null;
  authorId: string; authorName: string; createdAt: string; updatedAt: string;
}
export interface Expense {
  id: string; projectId: string; label: string; amount: number;
  plannedDate: string; paidDate: string | null; category: 'software' | 'training' | 'equipment' | 'supplies' | 'legal' | 'other';
}
export interface Revenue {
  id: string; projectId: string; label: string; amount: number;
  plannedDate: string; receivedDate: string | null; category: 'sales' | 'services' | 'grants' | 'other';
}
export interface CalendarEvent {
  id: string; title: string; description: string; projectId: string | null;
  resourceIds: string[]; startDate: string; endDate: string; allDay: boolean;
  startTime: string | null; endTime: string | null;
}
export interface Unavailability {
  id: string; title: string; resourceId: string; reason: 'leave' | 'sick' | 'other';
  allDay: boolean; startDate: string; endDate: string;
  startTime: string | null; endTime: string | null;
}
export interface ProjectReport {
  id: string; projectId: string; templateId: string | null; templateName: string;
  title: string; reportDate: string; authorName: string; createdAt: string; updatedAt: string;
  indicators: { id: string; label: string; rating: number }[];
  fields: { id: string; label: string; type: 'text' | 'number' | 'date' | 'url'; value: string }[];
}
export interface AppData {
  zones: Zone[]; projects: Project[]; tasks: Task[]; resources: Resource[];
  profiles: CostProfile[]; timeEntries: TimeEntry[]; comments: Comment[]; expenses: Expense[]; revenues: Revenue[];
  calendarEvents: CalendarEvent[]; unavailabilities: Unavailability[];
  projectTemplates?: import('./customization').ProjectTemplate[];
  customFieldDefinitions?: import('./customization').CustomFieldDefinition[];
  reportTemplates?: import('./customization').ReportTemplate[];
  projectStatusDefinitions?: import('./customization').ProjectStatusDefinition[];
  strategicAxes?: import('./customization').StrategicAxis[];
  projectReports?: ProjectReport[];
  projectDocuments?: ProjectDocument[];
  documentFolders?: DocumentFolder[];
  taskLists?: ProjectTaskList[];
  permissionPolicies?: import('./permissions').PermissionPolicyRecord[];
  organizationUnits?: OrganizationUnit[];
  capacityPlans?: import('./capaplan').CapacityPlan[];
  planzonePreferences?: import('./planzone-preferences').PlanzonePreferences[];
  viewRoleCatalog?: { id: ResourceRole; label: string }[];
  userAccounts?: { resourceId: string; username: string }[];
  currentUser: { id: string; name: string; role: typeof RESOURCE_ROLE_LABELS[ResourceRole]; };
  today: string;
}
export type Entity = 'zones' | 'projects' | 'tasks' | 'resources' | 'profiles' | 'time-entries' | 'comments' | 'expenses' | 'revenues' | 'calendar-events' | 'unavailabilities'
  | 'project-templates' | 'custom-field-definitions' | 'report-templates' | 'project-status-definitions' | 'strategic-axes' | 'project-reports' | 'project-documents' | 'document-folders' | 'task-lists' | 'project-item-moves' | 'time-integrations' | 'permission-policies' | 'organization-units' | 'capacity-plan' | 'planzone-preferences' | 'task-self-assignment';
export type Mutation = (entity: Entity, method: 'POST' | 'PATCH' | 'DELETE', payload?: unknown, id?: string) => Promise<void>;
export interface TaskCreationOptions { kind?: Task['kind']; listId?: string | null; phase?: string; }
export interface ViewProps {
  data: AppData; project: Project; mutate: Mutation;
  openTask: (task: Task) => void; createTask: (options?: TaskCreationOptions, projectId?: string) => void;
  openProject: (project: Project) => void; notify: (message: string) => void;
  editProject?: (project: Project) => void;
  openResource?: (resource: Resource | null) => void;
  createReport?: () => void;
  openReport?: (report: ProjectReport) => void;
  openFlashReport?: () => void;
  saveReportDraft?: (draft: import('./customization').ReportDraft) => void;
}
