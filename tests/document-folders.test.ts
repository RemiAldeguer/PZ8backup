import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentFolderDescendantIds, documentFolderPath, documentFoldersByPath } from '../shared/document-folders.ts';
import type { DocumentFolder } from '../shared/types.ts';

function folder(id: string, name: string, parentId: string | null = null): DocumentFolder {
  return { id, name, parentId, projectId: 'project', authorId: 'author', authorName: 'Auteur', createdAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z' };
}

test('les chemins et destinations de déplacement conservent toute la hiérarchie sans modifier les dossiers', () => {
  const folders = [folder('child', 'Contrats', 'root'), folder('other', 'Images'), folder('root', 'Administration'), folder('nested', 'Signés', 'child')];
  assert.deepEqual(documentFolderPath(folders, 'nested').map(item => item.id), ['root', 'child', 'nested']);
  assert.deepEqual([...documentFolderDescendantIds(folders, 'root')], ['root', 'child', 'nested']);
  assert.deepEqual(documentFoldersByPath(folders).map(item => item.id), ['root', 'child', 'nested', 'other']);
  assert.deepEqual(folders.map(item => item.id), ['child', 'other', 'root', 'nested']);
  assert.deepEqual(documentFolderPath(folders, null), []);
});

test('une ancienne hiérarchie incomplète ou cyclique ne bloque pas les chemins ni la sélection des parents', () => {
  const folders = [folder('a', 'A', 'b'), folder('b', 'B', 'a'), folder('child', 'Enfant', 'b'), folder('orphan', 'Ancien dossier', 'missing')];
  assert.equal(documentFolderPath(folders, 'a').length, 2);
  assert.deepEqual([...documentFolderDescendantIds(folders, 'a')], ['a', 'b', 'child']);
  assert.deepEqual(documentFolderPath(folders, 'orphan').map(item => item.id), ['orphan']);
  assert.deepEqual(documentFolderPath(folders, 'missing'), []);
  assert.equal(documentFoldersByPath(folders).length, folders.length);
});
