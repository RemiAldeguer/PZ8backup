import assert from 'node:assert/strict';
import test from 'node:test';
import type { CustomFieldDefinition } from '../shared/customization.ts';
import { evaluateCustomFormula } from '../shared/custom-field-values.ts';
import { MemoryStore } from '../server/memory-store.ts';
import { ApiError, ApiService } from '../server/service.ts';
import { seed } from '../server/seed.ts';
import { Store } from '../server/store.ts';
import { TABLES, type WorkspaceSnapshot } from '../server/contracts.ts';

const reject = (status: number, action: () => unknown) => assert.throws(action, error => error instanceof ApiError && error.status === status);
const newField = (type: CustomFieldDefinition['type'], overrides: Record<string, unknown> = {}) => ({ name: type, scope: 'project', type, translations: { fr: '', en: '' }, options: [], ...overrides });
const raster = `data:image/png;base64,${Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, ...new Uint8Array(60_000)]).toString('base64')}`;

for (const backend of ['sqlite', 'memory'] as const) {
  test(`${backend}: formula type changes clear obsolete expressions while dependent formulas preserve numeric contracts`, () => {
    const store = backend === 'sqlite' ? new Store(':memory:') : new MemoryStore(); seed(store); const api = new ApiService(store);
    try {
      const calculated = api.mutate('custom-field-definitions', 'POST', newField('formula', { formula: '{budget} / 2' })).value as CustomFieldDefinition;
      const text = api.mutate('custom-field-definitions', 'PATCH', { type: 'text', formula: '' }, calculated.id).value as CustomFieldDefinition;
      assert.equal(text.type, 'text'); assert.equal(text.formula, '');
      const numeric = api.mutate('custom-field-definitions', 'PATCH', { type: 'formula', formula: '{budget} / 2' }, calculated.id).value as CustomFieldDefinition;
      const dependent = api.mutate('custom-field-definitions', 'POST', newField('formula', { formula: `{${calculated.id}} * 2` })).value as CustomFieldDefinition;
      const before = api.readState();
      reject(400, () => api.mutate('custom-field-definitions', 'PATCH', { type: 'text', formula: '' }, calculated.id));
      assert.deepEqual(api.readState(), before);
      assert.equal(evaluateCustomFormula(dependent, before.customFieldDefinitions!, {}, { budget: 100 }).value, 100);
      assert.deepEqual(store.get('customFieldDefinitions', calculated.id), numeric);
      api.mutate('custom-field-definitions', 'DELETE', undefined, dependent.id);
      assert.equal((api.mutate('custom-field-definitions', 'PATCH', { type: 'text', formula: '' }, calculated.id).value as CustomFieldDefinition).type, 'text');
    } finally { if (store instanceof Store) store.close(); }
  });

  test(`${backend}: extended field types persist typed values, raster uploads and untouched legacy values`, () => {
    const store = backend === 'sqlite' ? new Store(':memory:') : new MemoryStore();
    seed(store); const api = new ApiService(store);
    try {
      const project = store.get('projects', 'project-nova')!;
      store.put('projects', { ...project, customValues: { opaqueLegacy: 'kept' } });
      const created = (type: CustomFieldDefinition['type'], overrides: Record<string, unknown> = {}) => api.mutate('custom-field-definitions', 'POST', newField(type, overrides)).value as CustomFieldDefinition;
      const simple = created('text'); const rich = created('rich_text'); const multiple = created('multi_select', { options: ['Client', 'Interne'] });
      const single = created('select', { options: ['Faible', 'Élevé'] }); const image = created('image'); const link = created('url'); const amount = created('number');
      const calculated = created('formula', { formula: `{budget} - {${amount.id}}` });
      const richText = '  **À traiter**\n- Premier point\n<script>alert(1)</script>\n  ';
      const customValues = { opaqueLegacy: 'kept', [simple.id]: 'Une ligne', [rich.id]: richText, [multiple.id]: '["Client","Interne"]',
        [single.id]: 'Élevé', [image.id]: raster, [link.id]: 'https://example.com', [amount.id]: '125.75' };
      api.mutate('projects', 'PATCH', { customValues }, project.id);
      assert.deepEqual(store.get('projects', project.id)!.customValues, customValues);
      assert.equal(evaluateCustomFormula(calculated, api.readState().customFieldDefinitions!, customValues, { budget: project.budget }).value, project.budget - 125.75);
      for (const badValue of ['["Client","Client"]', '["Unknown"]', '[1]', 'Client']) reject(400, () => api.mutate('projects', 'PATCH', { customValues: { ...customValues, [multiple.id]: badValue } }, project.id));
      for (const badValue of ['javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', raster.replace('image/png', 'image/jpeg')]) reject(400, () => api.mutate('projects', 'PATCH', { customValues: { ...customValues, [image.id]: badValue } }, project.id));
      reject(400, () => api.mutate('projects', 'PATCH', { customValues: { ...customValues, [calculated.id]: '100' } }, project.id));
      reject(400, () => api.mutate('projects', 'PATCH', { customValues: { ...customValues, [rich.id]: 'A'.repeat(10001) } }, project.id));
      reject(409, () => api.mutate('custom-field-definitions', 'PATCH', { options: ['Client'] }, multiple.id));
      const snapshot = store instanceof MemoryStore ? store.snapshot() : Object.fromEntries(TABLES.map(table => [table, store.all(table)])) as WorkspaceSnapshot;
      const restored = new MemoryStore(snapshot);
      assert.deepEqual(restored.get('projects', project.id)!.customValues, customValues);
      assert.deepEqual(restored.all('customFieldDefinitions'), store.all('customFieldDefinitions'));
      assert.equal(store.all('comments').length, restored.all('comments').length);
    } finally { if (store instanceof Store) store.close(); }
  });

  test(`${backend}: formula edits reject missing dependencies, cycles, incompatible scopes and deletion atomically`, () => {
    const store = backend === 'sqlite' ? new Store(':memory:') : new MemoryStore(); seed(store); const api = new ApiService(store);
    try {
      const amount = api.mutate('custom-field-definitions', 'POST', newField('number')).value as CustomFieldDefinition;
      const first = api.mutate('custom-field-definitions', 'POST', newField('formula', { formula: `{${amount.id}} * 2` })).value as CustomFieldDefinition;
      const second = api.mutate('custom-field-definitions', 'POST', newField('formula', { formula: `{${first.id}} + {budget}` })).value as CustomFieldDefinition;
      const before = api.readState();
      for (const payload of [newField('formula'), newField('formula', { formula: 'Math.random()' }), newField('formula', { formula: '{missing}' }),
        newField('formula', { formula: '{progress}' }), newField('formula', { scope: 'task', formula: `{${amount.id}}` }),
        newField('text', { formula: '1 + 2' }), newField('multi_select')]) reject(400, () => api.mutate('custom-field-definitions', 'POST', payload));
      reject(400, () => api.mutate('custom-field-definitions', 'PATCH', { formula: `{${second.id}}` }, first.id));
      reject(400, () => api.mutate('custom-field-definitions', 'PATCH', { type: 'text' }, amount.id));
      reject(409, () => api.mutate('custom-field-definitions', 'DELETE', undefined, amount.id));
      reject(409, () => api.mutate('custom-field-definitions', 'DELETE', undefined, first.id));
      reject(400, () => api.mutate('report-templates', 'POST', { name: 'Invalid expanded report', fields: [{ id: 'field', label: 'Formula', type: 'formula' }] }));
      assert.deepEqual(api.readState(), before);
      api.mutate('custom-field-definitions', 'DELETE', undefined, second.id);
      api.mutate('custom-field-definitions', 'DELETE', undefined, first.id);
      api.mutate('custom-field-definitions', 'DELETE', undefined, amount.id);
      assert.deepEqual(api.readState().customFieldDefinitions, []);
    } finally { if (store instanceof Store) store.close(); }
  });
}
