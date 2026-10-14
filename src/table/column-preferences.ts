export interface TableColumn { id: string; label: string; width: number; minWidth?: number; pinned?: boolean; defaultHidden?: boolean; }
export interface TableColumnPreferences { version: 1; order: string[]; hidden: string[]; widths: Record<string, number>; }
export function normalizeTableColumns(value: unknown, columns: TableColumn[]): TableColumnPreferences {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<TableColumnPreferences> : {};
  const ids = new Set(columns.map(column => column.id)); const saved = source.version === 1 ? source : {};
  const recorded = Array.isArray(saved.order) ? saved.order.filter(id => ids.has(id)) : [];
  const pinned = columns.filter(column => column.pinned).map(column => column.id);
  const order = [...pinned, ...new Set([...recorded, ...columns.map(column => column.id)].filter(id => !pinned.includes(id)))];
  const hidden = Array.isArray(saved.hidden) ? saved.hidden.filter(id => ids.has(id) && !pinned.includes(id)) : [];
  for (const column of columns) if (column.defaultHidden && !recorded.includes(column.id)) hidden.push(column.id);
  const widths: Record<string, number> = {};
  for (const column of columns) {
    const width = saved.widths && typeof saved.widths === 'object' ? saved.widths[column.id] : undefined;
    if (typeof width === 'number' && Number.isFinite(width)) widths[column.id] = Math.round(Math.min(900, Math.max(column.minWidth ?? 60, width)));
  }
  return { version: 1, order, hidden: [...new Set(hidden)], widths };
}
export function readTableColumns(key: string, columns: TableColumn[]): TableColumnPreferences {
  try { return normalizeTableColumns(JSON.parse(localStorage.getItem(key) ?? 'null'), columns); } catch { return normalizeTableColumns(null, columns); }
}
