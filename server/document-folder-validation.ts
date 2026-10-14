import { z } from 'zod';
import type { DocumentFolder, ProjectDocument } from '../shared/types.ts';

export const MAX_DOCUMENT_FOLDER_DEPTH = 12;
const identifier = z.string().min(1).max(100);
const name = z.string().trim().min(1).max(200);
export const documentFolderInput = z.object({ projectId: identifier, name, parentId: identifier.nullable().default(null) }).strict();
export const documentFolderPatch = z.object({ name: name.optional(), parentId: identifier.nullable().optional() }).strict();
export const documentFolderRecord = documentFolderInput.extend({
  id: identifier, parentId: identifier.nullable(), authorId: identifier, authorName: name,
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});

/** Validate a prospective tree, including descendants affected by moving a parent. */
export function validateDocumentFolderTree(folders: DocumentFolder[], projectIds: ReadonlySet<string>, documents: ProjectDocument[] = []): void {
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  if (byId.size !== folders.length) throw new Error('Chaque dossier doit avoir un identifiant unique.');
  const depthById = new Map<string, number>();
  const visiting = new Set<string>();
  function depth(folder: DocumentFolder): number {
    const cached = depthById.get(folder.id);
    if (cached !== undefined) return cached;
    if (!projectIds.has(folder.projectId)) throw new Error('Le projet de ce dossier est introuvable.');
    if (visiting.has(folder.id)) throw new Error('Un dossier ne peut pas contenir son propre parent.');
    visiting.add(folder.id);
    if (visiting.size > MAX_DOCUMENT_FOLDER_DEPTH) throw new Error(`Les dossiers sont limités à ${MAX_DOCUMENT_FOLDER_DEPTH} niveaux.`);
    let result = 1;
    if (folder.parentId) {
      const parent = byId.get(folder.parentId);
      if (!parent) throw new Error('Le dossier parent est introuvable.');
      if (parent.projectId !== folder.projectId) throw new Error('Le dossier parent doit appartenir au même projet.');
      result += depth(parent);
    }
    visiting.delete(folder.id);
    if (result > MAX_DOCUMENT_FOLDER_DEPTH) throw new Error(`Les dossiers sont limités à ${MAX_DOCUMENT_FOLDER_DEPTH} niveaux.`);
    depthById.set(folder.id, result);
    return result;
  }
  for (const folder of folders) depth(folder);
  for (const document of documents) {
    if (!document.folderId) continue;
    const folder = byId.get(document.folderId);
    if (!folder || folder.projectId !== document.projectId) throw new Error('Le dossier du document doit appartenir au même projet.');
  }
}
