import { NEWER_TABLES, TABLES, type CompatibleWorkspaceSnapshot, type Records, type StoreLike, type Table, type WorkspaceSnapshot } from './contracts.ts';
import { customValuesInput, customizationRecordSchemas, orderedTemplateTasks, validDefinitionOptions } from './customization-validation.ts';
import { projectReportRecord } from './project-report-validation.ts';
import { commentRecord, projectDocumentRecord } from './collaboration-validation.ts';
import { validateFormulaDefinitions } from '../shared/custom-field-values.ts';
import { documentFolderRecord, validateDocumentFolderTree } from './document-folder-validation.ts';
import { taskListRecord, validateTaskListTree } from './task-list-validation.ts';
import { permissionPolicyRecord } from './permission-validation.ts';
import { projectMetadataInput } from './project-metadata-validation.ts';
import { organizationUnitRecord } from './organization-validation.ts';
import { capacityPlanRecord } from './capaplan-validation.ts';
import { planzonePreferencesRecord } from './planzone-preferences-validation.ts';
import { validateOrganizationTree, validateResourceManagers } from '../shared/organization.ts';
import { isCivilDate } from '../shared/time-integration.ts';

/** One isolated workspace per request. The worker persists snapshot() using a revision CAS. */
export class MemoryStore implements StoreLike {
  private data: WorkspaceSnapshot;
  constructor(snapshot?: CompatibleWorkspaceSnapshot) {
    const source = snapshot ?? {
      zones: [], projects: [], tasks: [], resources: [], profiles: [], timeEntries: [], comments: [], expenses: [],
      calendarEvents: [], unavailabilities: [], revenues: [],
    };
    // Default only absent newer tables. Reading a legacy snapshot never persists this upgrade.
    this.data = structuredClone(Object.fromEntries(TABLES.map(table => [table,
      NEWER_TABLES.includes(table as typeof NEWER_TABLES[number]) && !Object.hasOwn(source, table) ? [] : source[table as keyof typeof source],
    ]))) as WorkspaceSnapshot;
    for (const table of TABLES) {
      const values = this.data[table];
      if (!Array.isArray(values) || values.some(value => !value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id)
        || new Set(values.map(value => value.id)).size !== values.length
        || (['projects', 'resources'].includes(table) && !values.every(value => {
          const date = (value as Records['projects'] | Records['resources']).timeIntegrationDate;
          return date === undefined || date === null || isCivilDate(date);
        }))
        || (table === 'capacityPlans' && (values.length > 1 || !values.every(value => capacityPlanRecord.safeParse(value).success)))
        || (table === 'planzonePreferences' && (values.length > 1 || !values.every(value => planzonePreferencesRecord.safeParse(value).success)))
        || (table === 'organizationUnits' && !values.every(value => organizationUnitRecord.safeParse(value).success))
        || (table === 'permissionPolicies' && (values.length > 1 || !values.every(value => permissionPolicyRecord.safeParse(value).success)))
        || (table === 'projects' && !values.every(value => projectMetadataInput.safeParse(value).success))
        || (table === 'revenues' && !values.every(isRevenueRecord))
        || (table === 'projectReports' && !values.every(value => projectReportRecord.safeParse(value).success))
        || (table === 'projectDocuments' && !values.every(value => projectDocumentRecord.safeParse(value).success))
        || (table === 'documentFolders' && !values.every(value => documentFolderRecord.safeParse(value).success))
        || (table === 'taskLists' && !values.every(value => taskListRecord.safeParse(value).success))
        || (table === 'timeEntries' && !values.every(value => !Object.hasOwn(value, 'customValues') || customValuesInput.safeParse((value as Records['timeEntries']).customValues).success))
        || (table === 'comments' && !values.every(value => commentRecord.safeParse(value).success))
        || (Object.hasOwn(customizationRecordSchemas, table) && !values.every(value => {
          const schema = customizationRecordSchemas[table as keyof typeof customizationRecordSchemas];
          const parsed = schema.safeParse(value);
          if (!parsed.success) return false;
          if (table === 'projectTemplates') {
            try { orderedTemplateTasks(parsed.data as Records['projectTemplates']); } catch { return false; }
          }
          return table !== 'customFieldDefinitions' || validDefinitionOptions(parsed.data as Records['customFieldDefinitions']);
        }))) {
        throw new Error(`Invalid workspace table: ${table}`);
      }
    }
    validateOrganizationTree(this.data.organizationUnits, this.data.resources);
    validateResourceManagers(this.data.resources);
    validateFormulaDefinitions(this.data.customFieldDefinitions);
    validateDocumentFolderTree(this.data.documentFolders, new Set(this.data.projects.map(project => project.id)), this.data.projectDocuments);
    validateTaskListTree(this.data.taskLists, new Set(this.data.projects.map(project => project.id)), this.data.tasks);
  }
  all<K extends Table>(table: K): Records[K][] {
    return structuredClone(this.data[table]) as Records[K][];
  }
  get<K extends Table>(table: K, id: string): Records[K] | undefined {
    const value = this.data[table].find(record => record.id === id);
    return value ? structuredClone(value) as Records[K] : undefined;
  }
  put<K extends Table>(table: K, value: Records[K]): void {
    const values = this.data[table] as Records[K][];
    const position = values.findIndex(record => record.id === value.id);
    if (position === -1) values.push(structuredClone(value));
    else values[position] = structuredClone(value);
  }
  remove(table: Table, id: string): void {
    const values = this.data[table];
    const position = values.findIndex(record => record.id === id);
    if (position !== -1) values.splice(position, 1);
  }
  transaction<T>(action: () => T): T {
    const previous = structuredClone(this.data);
    try { return action(); }
    catch (error) { this.data = previous; throw error; }
  }
  snapshot(): WorkspaceSnapshot { return structuredClone(this.data); }
}

function isRevenueRecord(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const identifier = (field: unknown) => typeof field === 'string' && field.length > 0 && field.length <= 100;
  const validDate = (field: unknown) => {
    if (typeof field !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(field)) return false;
    const date = new Date(`${field}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === field;
  };
  return identifier(record.id) && identifier(record.projectId)
    && typeof record.label === 'string' && record.label.trim().length > 0 && record.label.length <= 200
    && typeof record.amount === 'number' && Number.isFinite(record.amount) && record.amount >= 0 && record.amount <= 1e12
    && validDate(record.plannedDate) && (record.receivedDate === null || validDate(record.receivedDate))
    && typeof record.category === 'string' && ['sales', 'services', 'grants', 'other'].includes(record.category);
}
