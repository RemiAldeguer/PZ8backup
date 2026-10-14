import assert from 'node:assert/strict';
import test from 'node:test';
import { templateFromProject, type ProjectTemplate, type TemplateTaskList } from '../shared/customization.ts';
import type { Project, ProjectTaskList, Task } from '../shared/types.ts';
import { orderedTemplateLists, orderedTemplateTasks, projectTemplateInput } from '../server/customization-validation.ts';

const project: Project = { id: 'source', name: 'Déploiement', description: 'Modèle de préparation', zoneId: 'zone',
  startDate: '2026-10-12', endDate: '2026-12-31', status: 'open', weather: 5, budget: 1234.5, color: '#123456' };
const task = (id: string, overrides: Partial<Task> = {}): Task => ({ id, projectId: project.id, title: id, description: '',
  phase: 'Phase historique', kind: 'task', allocatedHours: 8, tags: ['Pilote'], startDate: null, endDate: null,
  dependsOnId: null, assigneeId: 'resource', status: 'done', progress: 100, ...overrides });
const list = (id: string, parentId: string | null = null, overrides: Partial<ProjectTaskList> = {}): ProjectTaskList =>
  ({ id, projectId: project.id, name: id, parentId, ...overrides });
const template = (taskLists?: TemplateTaskList[]): ProjectTemplate => ({ id: 'template',
  ...templateFromProject(project, [task('work')]), ...(taskLists ? { taskLists } : {}) });

test('les modèles historiques restent sans catalogue ni référence de liste facultatifs', () => {
  const imported = templateFromProject(project, [task('work', { listId: 'unavailable-without-catalogue' })]);
  assert.equal(Object.hasOwn(imported, 'taskLists'), false);
  assert.equal(Object.hasOwn(imported.tasks[0], 'listKey'), false);
  const parsed = projectTemplateInput.parse(imported);
  assert.deepEqual(parsed, imported);
  assert.deepEqual(orderedTemplateLists({ id: 'legacy', ...parsed }), []);
  assert.deepEqual(orderedTemplateTasks({ id: 'legacy', ...parsed }), imported.tasks);
});

test('l’import conserve les listes vides et sous-listes du projet sans références étrangères ni données d’exécution', () => {
  const sourceTasks = [task('inside', { listId: 'child', startDate: '2026-10-13', endDate: '2026-10-14' }),
    task('root', { listId: null }), task('legacy'), task('foreign-list', { listId: 'outside' }),
    task('outside-task', { projectId: 'other', listId: 'outside' })];
  const sourceLists = [list('child', 'parent'), list('parent'), list('empty', 'parent'),
    list('repaired-root', 'outside'), list('outside', null, { projectId: 'other' })];
  const before = structuredClone({ sourceTasks, sourceLists });
  const imported = templateFromProject(project, sourceTasks, sourceLists);
  assert.deepEqual(imported.taskLists, [
    { key: 'child', name: 'child', parentKey: 'parent' }, { key: 'parent', name: 'parent', parentKey: null },
    { key: 'empty', name: 'empty', parentKey: 'parent' }, { key: 'repaired-root', name: 'repaired-root', parentKey: null },
  ]);
  assert.equal(imported.tasks.length, 4);
  assert.equal(imported.tasks[0].listKey, 'child');
  assert.deepEqual([imported.tasks[0].startOffsetDays, imported.tasks[0].endOffsetDays], [1, 2]);
  assert.equal(imported.tasks[1].listKey, null);
  assert.equal(Object.hasOwn(imported.tasks[2], 'listKey'), false);
  assert.equal(imported.tasks[3].listKey, null);
  assert.ok(imported.tasks.every(item => !Object.hasOwn(item, 'assigneeId') && !Object.hasOwn(item, 'status') && !Object.hasOwn(item, 'progress')));
  imported.taskLists![0].name = 'Modèle seulement';
  imported.tasks[0].tags.push('Copie');
  assert.deepEqual({ sourceTasks, sourceLists }, before);
});

test('les parents du modèle précèdent leurs enfants même en ordre inversé et vingt niveaux restent autorisés', () => {
  const levels = Array.from({ length: 20 }, (_, index) => ({ key: `list-${index + 1}`, name: `Niveau ${index + 1}`,
    parentKey: index === 0 ? null : `list-${index}` }));
  const source = template([...levels].reverse());
  const before = structuredClone(source);
  assert.deepEqual(orderedTemplateLists(source), levels);
  assert.deepEqual(source, before);
  assert.equal(orderedTemplateTasks(source).length, 1);
});

test('les catalogues incomplets, cycliques, trop profonds ou ambigus empêchent de cloner un modèle', () => {
  for (const taskLists of [
    [{ key: 'same', name: 'A', parentKey: null }, { key: 'same', name: 'B', parentKey: null }],
    [{ key: 'orphan', name: 'A', parentKey: 'missing' }],
    [{ key: 'self', name: 'A', parentKey: 'self' }],
    [{ key: 'a', name: 'A', parentKey: 'b' }, { key: 'b', name: 'B', parentKey: 'a' }],
    Array.from({ length: 21 }, (_, index) => ({ key: `level-${index}`, name: 'A', parentKey: index ? `level-${index - 1}` : null })),
  ]) {
    const source = template(taskLists); const before = structuredClone(source);
    assert.throws(() => orderedTemplateLists(source));
    assert.throws(() => orderedTemplateTasks(source));
    assert.deepEqual(source, before);
  }
  const linked = template([{ key: 'inside', name: 'A', parentKey: null }]);
  linked.tasks[0].listKey = 'missing';
  assert.throws(() => orderedTemplateTasks(linked), /liste.*introuvable/);
  const noCatalogue = template();
  noCatalogue.tasks[0].listKey = 'missing';
  assert.throws(() => orderedTemplateTasks(noCatalogue), /liste.*introuvable/);
});

test('le schéma des modèles borne les listes et leurs identifiants sans ajouter les champs absents', () => {
  const valid = template([{ key: 'list', name: ' Préparation ', parentKey: null }]);
  valid.tasks[0].listKey = null;
  const { id: _id, ...input } = valid;
  assert.equal(projectTemplateInput.parse(input).taskLists![0].name, 'Préparation');
  for (const taskLists of [
    [{ key: 'list', name: 'A' }], [{ key: 'list', name: '  ', parentKey: null }],
    [{ key: 'constructor', name: 'A', parentKey: null }], [{ key: 'a'.repeat(101), name: 'A', parentKey: null }],
    [{ key: 'list', name: 'A', parentKey: null, projectId: 'forged-project' }],
    Array.from({ length: 201 }, (_, index) => ({ key: String(index), name: 'A', parentKey: null })),
  ]) assert.equal(projectTemplateInput.safeParse({ ...input, taskLists }).success, false);
  assert.equal(projectTemplateInput.safeParse({ ...input, tasks: [{ ...input.tasks[0], listKey: 'a'.repeat(101) }] }).success, false);
});
