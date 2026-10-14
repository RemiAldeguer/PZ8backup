import type { CustomFieldDefinition } from './customization';

export interface GanttColumn { id: string; label: string; width: number; field?: CustomFieldDefinition; }
export interface GanttColumnPreferences { version: 1; order: string[]; hidden: string[]; }
export const GANTT_COLUMNS: GanttColumn[] = [
  { id: 'status', label: 'Statut', width: 105 }, { id: 'start', label: 'Début', width: 96 }, { id: 'end', label: 'Fin', width: 96 },
  { id: 'duration', label: 'Durée', width: 72 }, { id: 'allocated', label: 'Alloué', width: 88 }, { id: 'spent', label: 'Passé', width: 88 },
  { id: 'remaining', label: 'Restant', width: 88 }, { id: 'progress', label: 'Avancement', width: 92 },
  { id: 'tags', label: 'Tags', width: 165 }, { id: 'assignee', label: 'Responsable', width: 155 },
];
const defaultVisible = ['status', 'start', 'end', 'allocated', 'spent'];
export function availableGanttColumns(definitions: CustomFieldDefinition[]): GanttColumn[] {
  return [...GANTT_COLUMNS, ...definitions.filter(field => field.scope === 'task' || field.scope === 'project').map(field => ({ id: `custom:${field.id}`, label: (field.translations.fr || field.name) + (field.scope === 'project' ? ' (projet)' : ''), width: field.type === 'image' ? 95 : 160, field }))];
}
/** Reconcile saved choices with additions/removals in the live custom-field catalogue. */
export function normalizeGanttColumns(value: unknown, columns: GanttColumn[]): GanttColumnPreferences {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<GanttColumnPreferences> : {};
  const ids = columns.map(column => column.id); const valid = (id: unknown): id is string => typeof id === 'string' && ids.includes(id);
  const previous = input.version === 1 && Array.isArray(input.order) ? input.order.filter(valid) : [];
  const order = [...new Set([...previous, ...ids])];
  const hidden = input.version === 1 && Array.isArray(input.hidden) ? [...new Set([...input.hidden.filter(valid), ...ids.filter(id => !previous.includes(id))])] : ids.filter(id => !defaultVisible.includes(id));
  return { version: 1, order, hidden };
}
export function ganttColumnStorageKey(userId: string, projectId: string): string { return `planzone8-gantt-columns:v1:${encodeURIComponent(userId)}:${encodeURIComponent(projectId)}`; }
export function readGanttColumns(key: string, columns: GanttColumn[]): GanttColumnPreferences {
  try { return normalizeGanttColumns(JSON.parse(localStorage.getItem(key) ?? 'null'), columns); } catch { return normalizeGanttColumns(null, columns); }
}
