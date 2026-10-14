import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strategicScore, templateFromProject, type StrategicAxis } from '../shared/customization.ts';
import type { Project, Task } from '../shared/types.ts';

function project(startDate = '2026-03-28'): Project {
  return { id: 'source-project', name: 'Déploiement', description: 'Structure réutilisable', zoneId: 'source-zone', startDate,
    endDate: '2026-12-31', status: 'open', weather: 4, budget: 1250.75, color: '#123456' };
}
function task(id: string, overrides: Partial<Task> = {}): Task {
  return { id, projectId: 'source-project', title: id, description: '', phase: 'Préparation', kind: 'task',
    allocatedHours: 8, tags: ['Pilote'], startDate: null, endDate: null, dependsOnId: null,
    assigneeId: 'historical-resource', status: 'done', progress: 100, ...overrides };
}
function axis(id: string, weight: number): StrategicAxis {
  return { id, code: id, name: id, weight, color: '#123456', scale: ['Très défavorable', 'Défavorable', 'Neutre', 'Favorable', 'Très favorable'] };
}

test('le modèle reprend uniquement le projet choisi et conserve ses dépendances internes, jalons et dates absentes', () => {
  const source = project();
  const model = templateFromProject(source, [
    task('first', { startDate: '2026-03-27', endDate: '2026-03-28' }),
    task('dependent', { dependsOnId: 'first', startDate: '2026-03-30', endDate: null }),
    task('milestone', { kind: 'milestone', allocatedHours: 0, startDate: null, endDate: '2026-03-31', dependsOnId: 'dependent' }),
    task('legacy-cross-project-link', { dependsOnId: 'outside' }),
    task('outside', { projectId: 'another-project', title: 'Ne doit pas être copié', startDate: '2020-01-01' }),
  ]);
  assert.deepEqual({ name: model.name, description: model.description, budget: model.budget, color: model.color },
    { name: 'Déploiement', description: 'Structure réutilisable', budget: 1250.75, color: '#123456' });
  assert.deepEqual(model.tasks.map(item => ({ key: item.key, kind: item.kind, hours: item.allocatedHours,
    start: item.startOffsetDays, end: item.endOffsetDays, dependency: item.dependsOnKey })), [
    { key: 'first', kind: 'task', hours: 8, start: -1, end: 0, dependency: null },
    { key: 'dependent', kind: 'task', hours: 8, start: 2, end: null, dependency: 'first' },
    { key: 'milestone', kind: 'milestone', hours: 0, start: null, end: 3, dependency: 'dependent' },
    { key: 'legacy-cross-project-link', kind: 'task', hours: 8, start: null, end: null, dependency: null },
  ]);
  assert.ok(model.tasks.every(item => !Object.hasOwn(item, 'assigneeId') && !Object.hasOwn(item, 'status') && !Object.hasOwn(item, 'progress')));
});

test('les dates relatives restent des jours calendaires aux deux changements d’heure français', () => {
  for (const [origin, firstDate, secondDate] of [
    ['2026-03-28', '2026-03-29', '2026-03-30'],
    ['2026-10-24', '2026-10-25', '2026-10-26'],
  ]) {
    const model = templateFromProject(project(origin), [task('around-dst', { startDate: firstDate, endDate: secondDate })]);
    assert.equal(model.tasks[0].startOffsetDays, 1, origin);
    assert.equal(model.tasks[0].endOffsetDays, 2, origin);
  }
});

test('modifier les tags du modèle ne modifie pas les tâches du projet d’origine', () => {
  const sourceTask = task('tagged', { tags: ['Pilote', 'Client'] });
  const model = templateFromProject(project(), [sourceTask]);
  model.tasks[0].tags.splice(0, 1, 'Nouvelle structure');
  model.tasks[0].title = 'Titre du modèle';
  assert.deepEqual(sourceTask.tags, ['Pilote', 'Client']);
  assert.equal(sourceTask.title, 'tagged');
});

test('le score pondère les évaluations négatives et positives et ignore les axes non évalués ou hors catalogue', () => {
  const source = { ...project(), strategicRatings: { innovation: -2, client: 1, zeroWeight: 2, unknownLegacyAxis: 2 } };
  assert.equal(strategicScore(source, [axis('innovation', 3), axis('client', 4), axis('unrated', 1000), axis('zeroWeight', 0)]), -2);
  assert.equal(strategicScore({ ...source, strategicRatings: { innovation: -1 } }, [axis('innovation', 5)]), -5);
  assert.equal(strategicScore(project(), [axis('unrated', 1000)]), 0);
  assert.equal(strategicScore(source, []), 0);
});
