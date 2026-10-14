import type { AppData, Project, ProjectStatus, ProjectTaskList, Task } from './types';

export type CustomizationPage = 'project-templates' | 'custom-fields' | 'report-templates' | 'project-statuses' | 'strategic-axes';
export const CUSTOMIZATION_PAGES: { id: CustomizationPage; label: string }[] = [
  { id: 'project-templates', label: 'Modèles de projet' },
  { id: 'custom-fields', label: 'Champs personnalisés' },
  { id: 'report-templates', label: 'Modèle de compte rendu' },
  { id: 'project-statuses', label: 'Statuts de projet' },
  { id: 'strategic-axes', label: 'Axes stratégiques' },
];
export type CustomFieldScope = 'project' | 'task' | 'resource' | 'report' | 'time-entry';
export type CustomFieldType = 'text' | 'rich_text' | 'multi_select' | 'select' | 'formula' | 'image' | 'url' | 'number' | 'date';
export interface CustomFieldDefinition {
  id: string; name: string; scope: CustomFieldScope; type: CustomFieldType;
  translations: { fr: string; en: string }; options: string[];
  formula?: string;
}
export interface TemplateTask {
  key: string; title: string; description: string; phase: string; kind: 'task' | 'milestone';
  allocatedHours: number; tags: string[]; startOffsetDays: number | null; endOffsetDays: number | null;
  dependsOnKey: string | null;
  listKey?: string | null;
  position?: number;
}
export interface TemplateTaskList { key: string; name: string; parentKey: string | null; position?: number; }
export interface ProjectTemplate {
  id: string; name: string; description: string; budget: number; color: string; tasks: TemplateTask[];
  descriptionFormat?: 'plain' | 'markdown';
  taskLists?: TemplateTaskList[];
}
export interface ReportTemplate {
  id: string; name: string; titlePattern: string;
  indicators: { id: string; label: string }[];
  fields: { id: string; label: string; type: 'text' | 'number' | 'date' | 'url' }[];
}
export interface ReportDraft { template: ReportTemplate; date: string; ratings: Record<string, number>; values: Record<string, string>; }
export interface ProjectStatusDefinition { id: string; name: string; description: string; color: string; baseStatus: ProjectStatus; }
export interface StrategicAxis { id: string; code: string; name: string; color: string; weight: number; scale: [string, string, string, string, string]; }

export function projectStatusLabel(project: Project, data: AppData): string {
  return data.projectStatusDefinitions?.find(status => status.id === project.customStatusId)?.name
    ?? ({ requested: 'Demandé', open: 'Ouvert', paused: 'Interrompu', closed: 'Clos' } as const)[project.status];
}
export function strategicScore(project: Project, axes: StrategicAxis[]): number {
  return axes.reduce((sum, axis) => sum + axis.weight * (project.strategicRatings?.[axis.id] ?? 0), 0);
}
export function templateFromProject(project: Project, tasks: Task[], lists?: ProjectTaskList[]): Omit<ProjectTemplate, 'id'> {
  const origin = Date.parse(`${project.startDate}T00:00:00Z`);
  const offset = (date: string | null) => date ? Math.round((Date.parse(`${date}T00:00:00Z`) - origin) / 86_400_000) : null;
  const selected = tasks.filter(task => task.projectId === project.id);
  const keys = new Set(selected.map(task => task.id));
  const selectedLists = lists?.filter(list => list.projectId === project.id);
  const listKeys = new Set(selectedLists?.map(list => list.id));
  return { name: project.name, description: project.description, budget: project.budget, color: project.color,
    ...(project.descriptionFormat ? { descriptionFormat: project.descriptionFormat } : {}),
    ...(selectedLists ? { taskLists: selectedLists.map(list => ({ key: list.id, name: list.name,
      parentKey: list.parentId && listKeys.has(list.parentId) ? list.parentId : null,
      ...(list.position !== undefined ? { position: list.position } : {}) })) } : {}),
    tasks: selected.map(task => ({ key: task.id, title: task.title, description: task.description, phase: task.phase,
      kind: task.kind, allocatedHours: task.allocatedHours, tags: [...task.tags],
      startOffsetDays: offset(task.startDate), endOffsetDays: offset(task.endDate),
      ...(selectedLists && Object.hasOwn(task, 'listId') ? { listKey: task.listId && listKeys.has(task.listId) ? task.listId : null } : {}),
      ...(task.position !== undefined ? { position: task.position } : {}),
      dependsOnKey: task.dependsOnId && keys.has(task.dependsOnId) ? task.dependsOnId : null })) };
}
