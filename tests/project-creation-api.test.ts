import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, ApiService } from '../server/service.ts';
import { MemoryStore } from '../server/memory-store.ts';
import { Store } from '../server/store.ts';
import { TABLES, type WorkspaceSnapshot } from '../server/contracts.ts';
import { seed } from '../server/seed.ts';
import { PROJECT_VIEW_IDS, projectViewEnabled, type Project } from '../shared/types.ts';
import { projectTaskTags } from '../shared/zone-projects.ts';
import { templateFromProject, type ProjectTemplate } from '../shared/customization.ts';

for (const backend of ['sqlite', 'memory'] as const) {
  test(`${backend}: project creation preferences persist, survive unrelated edits and validate atomically`, () => {
    const store = backend === 'sqlite' ? new Store(':memory:') : new MemoryStore(); seed(store); const api = new ApiService(store);
    try {
      const before = store.all('projects'); const old = before[0];
      for (const view of PROJECT_VIEW_IDS) assert.equal(projectViewEnabled(old, view), true);
      const project = api.mutate('projects', 'POST', { name: 'Projet configurable', zoneId: old.zoneId, startDate: '2026-10-13', endDate: '2026-12-31',
        tags: ['Pilotage', 'Client'], portfolioNames: ['Transformation'], enabledViews: ['summary', 'list'], description: '**Objectif**\n- Livraison', descriptionFormat: 'markdown', budget: 2500 }).value as Project;
      api.mutate('time-integrations', 'POST', { scope: 'project', projectId: project.id, date: '2026-10-13' });
      const edited = api.mutate('projects', 'PATCH', { name: 'Projet renommé' }, project.id).value as Project;
      assert.deepEqual(edited.tags, ['Pilotage', 'Client']); assert.deepEqual(edited.portfolioNames, ['Transformation']);
      assert.deepEqual(edited.enabledViews, ['summary', 'list']); assert.equal(edited.descriptionFormat, 'markdown'); assert.equal(edited.timeIntegrationDate, '2026-10-13');
      assert.equal(projectViewEnabled(edited, 'budget'), false); assert.equal(projectViewEnabled(edited, 'team'), true);
      assert.deepEqual(projectTaskTags(api.readState(), edited.id), ['Client', 'Pilotage']);
      for (const patch of [{ enabledViews: [] }, { enabledViews: ['missing'] }, { enabledViews: ['list', 'list'] }, { tags: ['Client', 'client'] }, { portfolioNames: ['A', 'a'] }, { tags: ['x'.repeat(51)] }, { descriptionFormat: 'html' }]) {
        assert.throws(() => api.mutate('projects', 'PATCH', patch, edited.id), error => error instanceof ApiError && error.status === 400);
        assert.deepEqual(store.get('projects', edited.id), edited);
      }
      assert.deepEqual(store.all('projects').filter(item => item.id !== edited.id), before);
      const snapshot = Object.fromEntries(TABLES.map(table => [table, store.all(table)])) as WorkspaceSnapshot; const restored = new MemoryStore(snapshot); assert.deepEqual(restored.get('projects', edited.id), edited);
      snapshot.projects.find(item => item.id === edited.id)!.enabledViews = [];
      assert.throws(() => new MemoryStore(snapshot), /Invalid workspace table: projects/);
      const template = api.mutate('project-templates', 'POST', templateFromProject(edited, [])).value as ProjectTemplate;
      const clone = api.mutate('projects', 'POST', { name: 'Clone formaté', zoneId: edited.zoneId, startDate: '2026-11-01', endDate: '2026-11-30', templateId: template.id }).value as Project;
      assert.equal(clone.descriptionFormat, 'markdown'); assert.equal(clone.description, edited.description);
      assert.equal(projectViewEnabled(clone, 'budget'), true);
    } finally { if (store instanceof Store) store.close(); }
  });
}
