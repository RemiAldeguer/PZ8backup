import type { DocumentFolder } from './types';

/** The caller supplies folders from one project. Stops safely on missing parents or cycles. */
export function documentFolderPath(folders: readonly DocumentFolder[], folderId: string | null | undefined): DocumentFolder[] {
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const path: DocumentFolder[] = [];
  const seen = new Set<string>();
  let id = folderId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const folder = byId.get(id);
    if (!folder) break;
    path.unshift(folder);
    id = folder.parentId;
  }
  return path;
}

/** Includes the selected folder, so it can also be excluded from move destinations. */
export function documentFolderDescendantIds(folders: readonly DocumentFolder[], folderId: string): Set<string> {
  const ids = new Set([folderId]);
  const children = new Map<string, string[]>();
  for (const folder of folders) {
    if (!folder.parentId) continue;
    const list = children.get(folder.parentId) ?? [];
    list.push(folder.id); children.set(folder.parentId, list);
  }
  const queue = [folderId];
  for (let index = 0; index < queue.length; index++) {
    for (const id of children.get(queue[index]) ?? []) {
      if (ids.has(id)) continue;
      ids.add(id); queue.push(id);
    }
  }
  return ids;
}

export function documentFoldersByPath(folders: readonly DocumentFolder[]): DocumentFolder[] {
  return [...folders].sort((left, right) => {
    const leftPath = documentFolderPath(folders, left.id).map(folder => folder.name).join(' / ');
    const rightPath = documentFolderPath(folders, right.id).map(folder => folder.name).join(' / ');
    return leftPath.localeCompare(rightPath, 'fr', { numeric: true, sensitivity: 'base' }) || left.id.localeCompare(right.id);
  });
}
