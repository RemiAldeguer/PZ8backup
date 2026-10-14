import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIST_COLUMNS, listColumnStorageKey, moveListColumn, normalizeListColumns, readListColumns, visibleListColumns } from '../shared/list-columns.ts';

test('les préférences conservées réconcilient les colonnes supprimées, dupliquées et nouvellement introduites', () => {
  const preferences = normalizeListColumns({ version: 1, order: ['allocated', 'removed', 'status', 'allocated', 'task'], hidden: ['task', 'dates', 'removed', 'dates'] });
  assert.deepEqual(preferences.order, ['allocated', 'status', 'task', 'tags', 'assignee', 'dates']);
  assert.deepEqual(preferences.hidden, ['dates']);
  assert.deepEqual(visibleListColumns(preferences), ['allocated', 'status', 'task', 'tags', 'assignee']);
});

test('déplacer les colonnes conserve les masques et ne modifie pas les préférences originales', () => {
  const preferences = normalizeListColumns({ order: ['task', 'allocated'], hidden: ['tags'] });
  const before = structuredClone(preferences);
  const moved = moveListColumn(preferences, 'allocated', -1);
  assert.deepEqual(moved.order.slice(0, 2), ['allocated', 'task']);
  assert.deepEqual(moved.hidden, ['tags']);
  assert.deepEqual(preferences, before);
  assert.deepEqual(moveListColumn(moved, 'allocated', -1), moved);
  const last = moved.order.at(-1)!;
  assert.deepEqual(moveListColumn(moved, last, 1), moved);
});

test('les données locales invalides reviennent à la configuration complète sans masquer la tâche', () => {
  const defaults = LIST_COLUMNS.map(column => column.id);
  for (const raw of [null, 'not json', 'null', '[]', '{"version":99,"order":["allocated"],"hidden":["status"]}']) {
    assert.deepEqual(readListColumns(raw), { version: 1, order: defaults, hidden: [] });
  }
  assert.deepEqual(readListColumns('{"hidden":["task","status",17]}').hidden, ['status']);
});

test('les préférences sont distinctes pour chaque utilisateur et projet y compris les identifiants contenant des séparateurs', () => {
  assert.notEqual(listColumnStorageKey('user-a', 'project-a'), listColumnStorageKey('user-b', 'project-a'));
  assert.notEqual(listColumnStorageKey('user-a', 'project-a'), listColumnStorageKey('user-a', 'project-b'));
  assert.notEqual(listColumnStorageKey('user:a', 'project'), listColumnStorageKey('user', 'a:project'));
});
