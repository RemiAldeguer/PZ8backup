export const LIST_COLUMNS = [
  { id: 'task', label: 'Tâche' },
  { id: 'status', label: 'Statut' },
  { id: 'tags', label: 'Tags' },
  { id: 'assignee', label: 'Responsable' },
  { id: 'dates', label: 'Dates planifiées' },
  { id: 'allocated', label: 'Alloué' },
] as const;

export type ListColumnId = typeof LIST_COLUMNS[number]['id'];
export interface ListColumnPreferences { version: 1; order: ListColumnId[]; hidden: ListColumnId[]; }

const columnIds = LIST_COLUMNS.map(column => column.id);
const isColumnId = (value: unknown): value is ListColumnId => typeof value === 'string' && columnIds.includes(value as ListColumnId);

/** Keeps the recorded order while introducing new columns and discarding removed or duplicate IDs. */
export function normalizeListColumns(value: unknown): ListColumnPreferences {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as { order?: unknown; hidden?: unknown; version?: unknown } : {};
  if (source.version !== undefined && source.version !== 1) return { version: 1, order: [...columnIds], hidden: [] };
  const recorded = Array.isArray(source.order) ? source.order.filter(isColumnId) : [];
  const order = [...new Set([...recorded, ...columnIds])];
  const hidden = [...new Set(Array.isArray(source.hidden) ? source.hidden.filter(isColumnId).filter(id => id !== 'task') : [])];
  return { version: 1, order, hidden };
}

export function visibleListColumns(preferences: ListColumnPreferences): ListColumnId[] {
  const safe = normalizeListColumns(preferences);
  return safe.order.filter(id => !safe.hidden.includes(id));
}

export function moveListColumn(preferences: ListColumnPreferences, id: ListColumnId, direction: -1 | 1): ListColumnPreferences {
  const safe = normalizeListColumns(preferences);
  const index = safe.order.indexOf(id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= safe.order.length) return safe;
  [safe.order[index], safe.order[target]] = [safe.order[target], safe.order[index]];
  return safe;
}

export function listColumnStorageKey(userId: string, projectId: string): string {
  return `planzone8-list-columns:v1:${encodeURIComponent(userId)}:${encodeURIComponent(projectId)}`;
}

export function readListColumns(raw: string | null): ListColumnPreferences {
  try { return normalizeListColumns(raw ? JSON.parse(raw) : undefined); }
  catch { return normalizeListColumns(undefined); }
}
