import type { AppData, CalendarEvent, Comment, CostProfile, DocumentFolder, OrganizationUnit, Expense, Project, ProjectDocument, ProjectReport, ProjectTaskList, Resource, Revenue, Task, TimeEntry, Unavailability, Zone } from '../shared/types.ts';
import type { CustomFieldDefinition, ProjectStatusDefinition, ProjectTemplate, ReportTemplate, StrategicAxis } from '../shared/customization.ts';

export interface Records {
  zones: Zone; projects: Project; tasks: Task; resources: Resource; profiles: CostProfile;
  timeEntries: TimeEntry; comments: Comment; expenses: Expense; revenues: Revenue;
  calendarEvents: CalendarEvent; unavailabilities: Unavailability;
  projectTemplates: ProjectTemplate; customFieldDefinitions: CustomFieldDefinition;
  reportTemplates: ReportTemplate; projectStatusDefinitions: ProjectStatusDefinition; strategicAxes: StrategicAxis;
  projectReports: ProjectReport; projectDocuments: ProjectDocument; documentFolders: DocumentFolder;
  capacityPlans: import('../shared/capaplan.ts').CapacityPlan;
  planzonePreferences: import('../shared/planzone-preferences.ts').PlanzonePreferences;
  organizationUnits: OrganizationUnit; taskLists: ProjectTaskList; permissionPolicies: import('../shared/permissions.ts').PermissionPolicyRecord;
}
export type Table = keyof Records;
export type WorkspaceSnapshot = { [K in Table]: Records[K][] };
/** Older saved workspaces predate calendar records and revenues; their original tables remain mandatory. */
export type NewerTable = 'calendarEvents' | 'unavailabilities' | 'revenues' | 'projectTemplates' | 'customFieldDefinitions' | 'reportTemplates' | 'projectStatusDefinitions' | 'strategicAxes' | 'projectReports' | 'projectDocuments' | 'documentFolders' | 'taskLists' | 'permissionPolicies' | 'organizationUnits' | 'capacityPlans' | 'planzonePreferences';
export type CompatibleWorkspaceSnapshot = Omit<WorkspaceSnapshot, NewerTable> & Partial<Pick<WorkspaceSnapshot, NewerTable>>;

/** Synchronous unit of work; persistence adapters commit after its transaction succeeds. */
export interface StoreLike {
  all<K extends Table>(table: K): Records[K][];
  get<K extends Table>(table: K, id: string): Records[K] | undefined;
  put<K extends Table>(table: K, value: Records[K]): void;
  remove(table: Table, id: string): void;
  transaction<T>(action: () => T): T;
}

export const CUSTOMIZATION_TABLES = ['projectTemplates', 'customFieldDefinitions', 'reportTemplates', 'projectStatusDefinitions', 'strategicAxes'] as const;
export const NEWER_TABLES: NewerTable[] = ['calendarEvents', 'unavailabilities', 'revenues', ...CUSTOMIZATION_TABLES, 'projectReports', 'projectDocuments', 'documentFolders', 'taskLists', 'permissionPolicies', 'organizationUnits', 'capacityPlans', 'planzonePreferences'];
export const TABLES: Table[] = ['zones', 'projects', 'tasks', 'resources', 'profiles', 'timeEntries', 'comments', 'expenses', 'calendarEvents', 'unavailabilities', 'revenues', ...CUSTOMIZATION_TABLES, 'projectReports', 'projectDocuments', 'documentFolders', 'taskLists', 'permissionPolicies', 'organizationUnits', 'capacityPlans', 'planzonePreferences'];
