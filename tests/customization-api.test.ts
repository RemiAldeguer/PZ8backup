import { TEST_DATA_KEYS, TEST_KEYS, plaintextRow } from './storage-fixture.ts';
import { encryptWorkspace } from '../server/workspace-crypto.ts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { convertV4MiniflareOptions, Log, LogLevel, Miniflare, Response as MiniflareResponse } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { D1AuthDatabase } from '../cloudflare/auth-d1.ts';
import { createApp } from '../server/app.ts';
import { AuthManager } from '../server/auth.ts';
import { CUSTOMIZATION_TABLES, TABLES, type CompatibleWorkspaceSnapshot, type StoreLike, type WorkspaceSnapshot } from '../server/contracts.ts';
import { MemoryStore } from '../server/memory-store.ts';
import { seed } from '../server/seed.ts';
import { ApiError, ApiService } from '../server/service.ts';
import { Store } from '../server/store.ts';
import { strategicScore } from '../shared/customization.ts';
import type { CustomFieldDefinition, ProjectStatusDefinition, ProjectTemplate, StrategicAxis, TemplateTask } from '../shared/customization.ts';
import type { AppData, Entity, Project } from '../shared/types.ts';

const admin = { username: 'admin', password: 'Customization-test-administrator-2026!', name: 'Administrateur' };
const task = (key: string, overrides: Partial<TemplateTask> = {}): TemplateTask => ({
  key, title: `Tâche ${key}`, description: '', phase: 'Cadrage', kind: 'task', allocatedHours: 8, tags: ['test'],
  startOffsetDays: 0, endOffsetDays: 3, dependsOnKey: null, ...overrides,
});
const templateInput = { name: 'Modèle de lancement', description: 'Projet réutilisable', budget: 1234.56, color: '#6366F1',
  tasks: [task('second', { startOffsetDays: 5, endOffsetDays: 8, dependsOnKey: 'first' }), task('first', { startOffsetDays: -2, endOffsetDays: 1 }),
    task('milestone', { kind: 'milestone', allocatedHours: 0, startOffsetDays: null, endOffsetDays: 9, dependsOnKey: 'second' })] };
const projectInput = { name: 'Projet cloné', zoneId: 'zone-transformation', startDate: '2026-12-30', endDate: '2027-02-01' };
const fieldInput = { name: 'Date de livraison', scope: 'project', type: 'date', translations: { fr: 'Date de livraison', en: 'Delivery date' }, options: [] };
const reportInput = { name: 'Compte rendu hebdomadaire', titlePattern: 'Compte rendu du {date}', indicators: [{ id: 'quality', label: 'Qualité' }],
  fields: [{ id: 'highlights', label: 'Faits marquants', type: 'text' }] };
const statusInput = { name: 'En attente', description: 'En attente de validation', color: '#D97706', baseStatus: 'paused' };
const axisInput = { code: 'INNOVATION', name: 'Innovation', color: '#6366F1', weight: 3,
  scale: ['Fortement incohérent', 'Peu cohérent', 'Neutre', 'Cohérent', 'Renforce la mission'] };
const entries = [
  ['project-templates', 'projectTemplates', templateInput], ['custom-field-definitions', 'customFieldDefinitions', fieldInput],
  ['report-templates', 'reportTemplates', reportInput], ['project-status-definitions', 'projectStatusDefinitions', statusInput], ['strategic-axes', 'strategicAxes', axisInput],
] as const;
const reject = (status: number, fn: () => unknown) => assert.throws(fn, error => error instanceof ApiError && error.status === status);
const originalTables = TABLES.filter(table => !(CUSTOMIZATION_TABLES as readonly string[]).includes(table));
const previousState = (store: StoreLike) => Object.fromEntries(originalTables.map(table => [table, store.all(table)]));

for (const backend of ['sqlite', 'memory'] as const) {
  const fixture = () => {
    const store = backend === 'sqlite' ? new Store(':memory:') : new MemoryStore(); seed(store);
    return { store, api: new ApiService(store), close: () => { if (store instanceof Store) store.close(); } };
  };
  test(`${backend}: customization CRUD persists five independent configurations without changing business records`, () => {
    const { store, api, close } = fixture();
    try {
      const before = previousState(store);
      for (const [entity, table, payload] of entries) {
        const created = api.mutate(entity, 'POST', payload);
        assert.equal(created.status, 201);
        const id = created.value!.id;
        const name = `${payload.name} modifié`;
        assert.equal(api.mutate(entity, 'PATCH', { name }, id).status, 200);
        assert.equal((api.readState()[table]![0] as { name: string }).name, name);
        if (store instanceof MemoryStore) assert.deepEqual(new MemoryStore(store.snapshot()).snapshot(), store.snapshot());
        assert.equal(api.mutate(entity, 'DELETE', undefined, id).status, 204);
        assert.deepEqual(api.readState()[table], []);
      }
      assert.deepEqual(previousState(store), before);
    } finally { close(); }
  });
  test(`${backend}: invalid templates reject cycles, missing keys, duplicate keys, charge on milestones and reversed offsets atomically`, () => {
    const { store, api, close } = fixture();
    try {
      const before = api.readState();
      for (const tasks of [
        [task('a', { dependsOnKey: 'b' }), task('b', { dependsOnKey: 'a' })],
        [task('a', { dependsOnKey: 'missing' })], [task('a'), task('a')], [task('a', { kind: 'milestone' })],
        [task('a', { startOffsetDays: 10, endOffsetDays: 9 })], [task('a', { endOffsetDays: 36501 })],
        [task('a', { startOffsetDays: 1.2 })], Array.from({ length: 201 }, (_, i) => task(String(i))),
      ]) reject(400, () => api.mutate('project-templates', 'POST', { ...templateInput, tasks }));
      assert.deepEqual(api.readState(), before);
      const template = api.mutate('project-templates', 'POST', templateInput).value as ProjectTemplate;
      reject(400, () => api.mutate('project-templates', 'PATCH', { tasks: [task('self', { dependsOnKey: 'self' })] }, template.id));
      assert.deepEqual(store.get('projectTemplates', template.id), template);
    } finally { close(); }
  });
  test(`${backend}: template cloning remaps dependencies and dates, resets execution, and rolls back every record on failure`, () => {
    const { store, api, close } = fixture();
    try {
      const template = api.mutate('project-templates', 'POST', templateInput).value as ProjectTemplate;
      const before = api.readState();
      const project = api.mutate('projects', 'POST', { ...projectInput, templateId: template.id }).value as Project;
      assert.equal(project.description, template.description); assert.equal(project.budget, template.budget); assert.equal(project.color, template.color);
      assert.equal(Object.hasOwn(project, 'templateId'), false);
      const cloned = store.all('tasks').filter(value => value.projectId === project.id);
      assert.equal(cloned.length, 3);
      const first = cloned.find(value => value.title === 'Tâche first')!;
      const second = cloned.find(value => value.title === 'Tâche second')!;
      const milestone = cloned.find(value => value.kind === 'milestone')!;
      assert.deepEqual([first.startDate, first.endDate, second.startDate, second.endDate, milestone.startDate, milestone.endDate],
        ['2026-12-28', '2026-12-31', '2027-01-04', '2027-01-07', null, '2027-01-08']);
      assert.equal(second.dependsOnId, first.id); assert.equal(milestone.dependsOnId, second.id);
      for (const value of cloned) {
        assert.equal(value.status, 'todo'); assert.equal(value.progress, 0); assert.equal(value.assigneeId, null);
        assert.equal(template.tasks.some(source => source.key === value.id), false);
      }
      for (const table of ['timeEntries', 'comments', 'expenses', 'revenues', 'calendarEvents', 'unavailabilities'] as const) {
        assert.deepEqual(store.all(table), before[table]);
      }
      assert.deepEqual(store.get('projectTemplates', template.id), template);
      const original = api.readState();
      reject(404, () => api.mutate('projects', 'POST', { ...projectInput, templateId: 'missing' }));
      reject(409, () => api.mutate('projects', 'POST', { ...projectInput, templateId: template.id, status: 'closed' }));
      reject(400, () => api.mutate('projects', 'POST', { ...projectInput, templateId: template.id, startDate: '9999-12-30', endDate: '9999-12-31' }));
      reject(400, () => api.mutate('projects', 'PATCH', { templateId: template.id }, project.id));
      assert.deepEqual(api.readState(), original);
      const validPut = store.put.bind(store);
      let inserted = 0;
      store.put = ((table, value) => {
        if (table === 'tasks' && ++inserted === 2) throw new Error('Injected write failure');
        validPut(table, value);
      }) as StoreLike['put'];
      assert.throws(() => api.mutate('projects', 'POST', { ...projectInput, templateId: template.id }), /Injected write failure/);
      store.put = validPut;
      assert.deepEqual(api.readState(), original, 'No partial project or first task survives a transaction failure.');
    } finally { close(); }
  });
  test(`${backend}: typed custom values validate scope, options and legacy extras while reference changes cannot lose data`, () => {
    const { store, api, close } = fixture();
    try {
      const definitions = [
        api.mutate('custom-field-definitions', 'POST', fieldInput).value as CustomFieldDefinition,
        api.mutate('custom-field-definitions', 'POST', { ...fieldInput, name: 'Montant', type: 'number' }).value as CustomFieldDefinition,
        api.mutate('custom-field-definitions', 'POST', { ...fieldInput, name: 'Lien', type: 'url', scope: 'task' }).value as CustomFieldDefinition,
        api.mutate('custom-field-definitions', 'POST', { ...fieldInput, name: 'Classification', type: 'select', scope: 'resource', options: ['A', 'B'] }).value as CustomFieldDefinition,
      ];
      const [dateField, numberField, urlField, selectField] = definitions;
      const project = store.get('projects', 'project-nova')!;
      const resource = store.all('resources')[0]; const existingFields = resource.customFields;
      const existingTask = store.all('tasks').find(value => value.projectId === project.id && value.status === 'todo')!;
      store.put('projects', { ...project, customValues: { legacy: 'opaque' }, strategicRatings: { legacy: 1 } });
      api.mutate('projects', 'PATCH', { customValues: { legacy: 'opaque', [dateField.id]: '2028-02-29', [numberField.id]: '12.5' }, strategicRatings: { legacy: 1 } }, project.id);
      for (const value of ['2026-02-29', '12/10/2026']) reject(400, () => api.mutate('projects', 'PATCH', { customValues: { [dateField.id]: value } }, project.id));
      for (const value of ['Infinity', 'NaN', '0xFF']) reject(400, () => api.mutate('projects', 'PATCH', { customValues: { [numberField.id]: value } }, project.id));
      reject(404, () => api.mutate('projects', 'PATCH', { customValues: { unknown: 'new' } }, project.id));
      reject(404, () => api.mutate('projects', 'PATCH', { customValues: { legacy: 'changed' } }, project.id));
      reject(400, () => api.mutate('projects', 'PATCH', { customValues: { [urlField.id]: 'https://example.com' } }, project.id));
      reject(400, () => api.mutate('tasks', 'PATCH', { customValues: { [urlField.id]: 'javascript:alert(1)' } }, existingTask.id));
      api.mutate('tasks', 'PATCH', { customValues: { [urlField.id]: 'https://example.com/path' } }, existingTask.id);
      reject(400, () => api.mutate('resources', 'PATCH', { customValues: { [selectField.id]: 'C' } }, resource.id));
      api.mutate('resources', 'PATCH', { customValues: { [selectField.id]: 'B' } }, resource.id);
      assert.deepEqual(store.get('resources', resource.id)!.customFields, existingFields ?? []);
      for (const definition of definitions) reject(409, () => api.mutate('custom-field-definitions', 'DELETE', undefined, definition.id));
      reject(409, () => api.mutate('custom-field-definitions', 'PATCH', { scope: 'task' }, dateField.id));
      reject(409, () => api.mutate('custom-field-definitions', 'PATCH', { type: 'number' }, dateField.id));
      reject(409, () => api.mutate('custom-field-definitions', 'PATCH', { options: ['A'] }, selectField.id));
      api.mutate('custom-field-definitions', 'PATCH', { options: ['A', 'B', 'C'], name: 'Classification actualisée' }, selectField.id);
      api.mutate('custom-field-definitions', 'PATCH', { type: 'text' }, numberField.id);
      api.mutate('projects', 'PATCH', { status: 'closed' }, project.id);
      reject(409, () => api.mutate('tasks', 'PATCH', { customValues: {} }, existingTask.id));
      api.mutate('projects', 'PATCH', { customValues: {} }, project.id);
      api.mutate('custom-field-definitions', 'DELETE', undefined, dateField.id);
      api.mutate('custom-field-definitions', 'DELETE', undefined, numberField.id);
      api.mutate('resources', 'PATCH', { customValues: {} }, resource.id);
      api.mutate('custom-field-definitions', 'DELETE', undefined, selectField.id);
    } finally { close(); }
  });
  test(`${backend}: custom statuses control writable state and strategic axes retain evaluations and weighted scores`, () => {
    const { api, store, close } = fixture();
    try {
      const status = api.mutate('project-status-definitions', 'POST', statusInput).value as ProjectStatusDefinition;
      const axis = api.mutate('strategic-axes', 'POST', axisInput).value as StrategicAxis;
      reject(400, () => api.mutate('projects', 'POST', { ...projectInput, customStatusId: status.id, status: 'open' }));
      const project = api.mutate('projects', 'POST', { ...projectInput, customStatusId: status.id, strategicRatings: { [axis.id]: 2 } }).value as Project;
      assert.equal(project.status, 'paused'); assert.equal(strategicScore(project, [axis]), 6);
      reject(409, () => api.mutate('tasks', 'POST', { projectId: project.id, title: 'Projet verrouillé' }));
      reject(409, () => api.mutate('project-status-definitions', 'PATCH', { baseStatus: 'open' }, status.id));
      reject(409, () => api.mutate('project-status-definitions', 'DELETE', undefined, status.id));
      api.mutate('project-status-definitions', 'PATCH', { name: 'Attente client', color: '#FF8000', description: 'Mis à jour' }, status.id);
      reject(409, () => api.mutate('strategic-axes', 'DELETE', undefined, axis.id));
      for (const value of [-3, 3, 1.5, '1']) reject(400, () => api.mutate('projects', 'PATCH', { strategicRatings: { [axis.id]: value } }, project.id));
      reject(404, () => api.mutate('projects', 'PATCH', { strategicRatings: { absent: 1 } }, project.id));
      api.mutate('strategic-axes', 'PATCH', { weight: 5 }, axis.id);
      assert.equal(strategicScore(store.get('projects', project.id)!, store.all('strategicAxes')), 10);
      api.mutate('projects', 'PATCH', { status: 'open', strategicRatings: {} }, project.id);
      assert.equal(store.get('projects', project.id)!.customStatusId, undefined);
      api.mutate('tasks', 'POST', { projectId: project.id, title: 'Projet rouvert' });
      api.mutate('project-status-definitions', 'DELETE', undefined, status.id);
      api.mutate('strategic-axes', 'DELETE', undefined, axis.id);
      const legacy = { ...store.get('projects', 'project-nova')!, customStatusId: 'old-opaque-status' };
      store.put('projects', legacy);
      const { id: _id, ...legacyForm } = legacy;
      assert.deepEqual(api.mutate('projects', 'PATCH', { ...legacyForm, description: 'Ancien statut conservé' }, legacy.id).value,
        { ...legacy, description: 'Ancien statut conservé' });
      reject(404, () => api.mutate('projects', 'PATCH', { customStatusId: legacy.customStatusId, status: 'closed' }, legacy.id));
      reject(404, () => api.mutate('projects', 'PATCH', { customStatusId: 'new-opaque-status' }, legacy.id));
      api.mutate('projects', 'PATCH', { customStatusId: null, status: 'closed' }, legacy.id);
      assert.equal(store.get('projects', legacy.id)!.customStatusId, null);
    } finally { close(); }
  });
  test(`${backend}: strict configurations reject forged fields, excessive report items, invalid options and weights`, () => {
    const { api, close } = fixture();
    try {
      const before = api.readState();
      for (const [entity, , input] of entries) {
        reject(400, () => api.mutate(entity, 'POST', { ...input, id: 'forged' }));
        reject(400, () => api.mutate(entity, 'POST', { ...input, unknown: true }));
        const created = api.mutate(entity, 'POST', input).value!;
        reject(400, () => api.mutate(entity, 'PATCH', {}, created.id));
        reject(400, () => api.mutate(entity, 'PATCH', { unknown: true }, created.id));
        reject(404, () => api.mutate(entity, 'PATCH', { name: 'Absent' }, 'missing'));
        api.mutate(entity, 'DELETE', undefined, created.id);
      }
      reject(400, () => api.mutate('report-templates', 'POST', { ...reportInput, indicators: Array.from({ length: 6 }, (_, i) => ({ id: String(i), label: 'Indicateur' })) }));
      reject(400, () => api.mutate('report-templates', 'POST', { ...reportInput, fields: [reportInput.fields[0], reportInput.fields[0]] }));
      reject(400, () => api.mutate('report-templates', 'POST', { ...reportInput, fields: Array.from({ length: 26 }, (_, i) => ({ id: String(i), label: 'Champ', type: 'text' })) }));
      reject(400, () => api.mutate('custom-field-definitions', 'POST', { ...fieldInput, type: 'select', options: [] }));
      reject(400, () => api.mutate('custom-field-definitions', 'POST', { ...fieldInput, type: 'select', options: ['A', 'A'] }));
      reject(400, () => api.mutate('custom-field-definitions', 'POST', { ...fieldInput, options: ['A'] }));
      for (const weight of [-1, 1001, 2.5, '2']) reject(400, () => api.mutate('strategic-axes', 'POST', { ...axisInput, weight }));
      reject(400, () => api.mutate('strategic-axes', 'POST', { ...axisInput, scale: ['Neutre'] }));
      assert.deepEqual(api.readState(), before);
    } finally { close(); }
  });
}

test('MemoryStore reads absent customization collections without mutating legacy input and rejects malformed provided records', () => {
  const initial = new MemoryStore(); seed(initial);
  const source = initial.snapshot() as CompatibleWorkspaceSnapshot;
  for (const table of CUSTOMIZATION_TABLES) delete source[table];
  const before = structuredClone(source);
  assert.deepEqual(new MemoryStore(source).snapshot(), { ...before, ...Object.fromEntries(CUSTOMIZATION_TABLES.map(table => [table, []])) });
  assert.deepEqual(source, before);
  for (const table of CUSTOMIZATION_TABLES) for (const value of [null, undefined, {}, [null], [{}]]) {
    assert.throws(() => new MemoryStore({ ...source, [table]: value } as unknown as CompatibleWorkspaceSnapshot));
  }
  assert.throws(() => new MemoryStore({ ...source, projectTemplates: [{ ...templateInput, id: 'model', tasks: [task('a', { dependsOnKey: 'a' })] }] }));
});

test('SQLite customization upgrade adds five tables, persists after restart and preserves all eleven previous collections', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'planzone8-customization-sql-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'workspace.sqlite');
  let store = new Store(path); seed(store);
  const before = previousState(store);
  for (const table of CUSTOMIZATION_TABLES) store.db.exec(`DROP TABLE ${table}`);
  store.close(); store = new Store(path);
  try {
    const api = new ApiService(store);
    for (const [entity, , input] of entries) api.mutate(entity, 'POST', input);
    const snapshot = api.readState('2026-10-12');
    store.close(); store = new Store(path);
    assert.deepEqual(new ApiService(store).readState('2026-10-12'), snapshot);
    assert.deepEqual(previousState(store), before);
  } finally { store.close(); }
});

test('customization HTTP endpoints require sessions and same origin and survive server restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'planzone8-customization-http-'));
  const path = join(directory, 'workspace.sqlite');
  let instance = createApp({ dbPath: path, today: '2026-10-12', admin }); await instance.ready;
  let server = instance.app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = () => { const address = server.address(); assert.ok(address && typeof address !== 'string'); return `http://127.0.0.1:${address.port}`; };
  const stop = async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); instance.close(); };
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  const request = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => fetch(`${origin()}${path}`, {
    method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  for (const [entity, , input] of entries) assert.equal((await request('POST', `/api/${entity}`, input)).status, 401);
  const login = await request('POST', '/api/auth/login', { username: admin.username, password: admin.password }); assert.equal(login.status, 200);
  const headers = { Cookie: login.headers.get('set-cookie')!.split(';', 1)[0]! };
  const ids: { entity: Entity; id: string }[] = [];
  for (const [entity, , input] of entries) {
    for (const [method, suffix, payload] of [['POST', '', input], ['PATCH', '/missing', { name: 'Changed' }], ['DELETE', '/missing', undefined]] as const) {
      assert.equal((await request(method, `/api/${entity}${suffix}`, payload, { ...headers, Origin: 'https://untrusted.example' })).status, 403);
    }
    const created = await request('POST', `/api/${entity}`, input, { ...headers, Origin: origin() }); assert.equal(created.status, 201);
    ids.push({ entity, id: (await created.json() as { id: string }).id });
  }
  const before = await (await request('GET', '/api/state', undefined, headers)).json();
  await stop(); instance = createApp({ dbPath: path, today: '2026-10-12' }); await instance.ready;
  server = instance.app.listen(0, '127.0.0.1'); await once(server, 'listening');
  assert.deepEqual(await (await request('GET', '/api/state', undefined, headers)).json(), before);
  for (const { entity, id } of ids) {
    assert.equal((await request('PATCH', `/api/${entity}/${id}`, { name: 'Configuration conservée' }, headers)).status, 200);
    assert.equal((await request('DELETE', `/api/${entity}/${id}`, undefined, headers)).status, 204);
  }
  assert.equal((await request('POST', '/api/auth/logout', {}, headers)).status, 204);
  for (const [entity, , input] of entries) assert.equal((await request('POST', `/api/${entity}`, input, headers)).status, 401);
});

test('actual Worker/D1 reads legacy customization without rewriting and persists all five collections and cloned tasks across restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'planzone8-customization-d1-'));
  const bundled = await build({ entryPoints: [resolve('cloudflare/worker.ts')], write: false, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent' });
  const databaseId = randomUUID(), workspaceId = randomUUID();
  const runtime = () => new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-10-06', host: '127.0.0.1', port: 0, cf: false,
    log: new Log(LogLevel.ERROR), resourcePersistencePath: directory, d1Databases: { DB: databaseId }, bindings: { DEMO_TODAY: '2026-10-12', PLANZONE_DATA_KEYS: TEST_DATA_KEYS },
    serviceBindings: { ASSETS: () => new MiniflareResponse('Customization fixture') },
  }));
  let instance = runtime();
  t.after(async () => { await instance.dispose(); await rm(directory, { recursive: true, force: true }); }); await instance.ready;
  const db = () => instance.getD1Database('DB');
  await new AuthManager(new D1AuthDatabase(await db() as unknown as D1Database)).createAdmin({ ...admin, workspaceId });
  const request = (method: string, path: string, body?: unknown, cookie?: string, headers: Record<string, string> = {}) => instance.dispatchFetch(`https://planzone8.test${path}`, {
    method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  for (const [entity, , input] of entries) assert.equal((await request('POST', `/api/${entity}`, input)).status, 401);
  const login = await request('POST', '/api/auth/login', { username: admin.username, password: admin.password }); assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';', 1)[0]!;
  assert.equal((await request('GET', '/api/state', undefined, cookie)).status, 200);
  const row = async () => {
    const result = await (await db()).prepare('SELECT data, revision FROM demo_workspaces WHERE id = ?').bind(workspaceId).first<{ data: string; revision: number }>();
    assert.ok(result); return plaintextRow(result, workspaceId);
  };
  const legacy = JSON.parse((await row()).data) as CompatibleWorkspaceSnapshot;
  for (const table of CUSTOMIZATION_TABLES) delete legacy[table];
  legacy.projects[0].description = 'Existing customized project'; legacy.tasks[0].description = 'Existing customized task';
  await (await db()).prepare('UPDATE demo_workspaces SET data = ? WHERE id = ?').bind(await encryptWorkspace(JSON.stringify(legacy), workspaceId, TEST_KEYS), workspaceId).run();
  const savedLegacy = await row();
  const displayed = await request('GET', '/api/state', undefined, cookie); assert.equal(displayed.status, 200);
  const before = await displayed.json() as AppData;
  for (const table of CUSTOMIZATION_TABLES) assert.deepEqual(before[table], []);
  assert.deepEqual(await row(), savedLegacy, 'Read may not write defaults or revision.');
  const ids: { entity: Entity; id: string }[] = [];
  for (const [entity, , payload] of entries) {
    assert.equal((await request('POST', `/api/${entity}`, payload, cookie, { Origin: 'https://untrusted.example' })).status, 403);
    assert.equal((await request('POST', `/api/${entity}`, { ...payload, forged: true }, cookie)).status, 400);
    const created = await request('POST', `/api/${entity}`, payload, cookie); assert.equal(created.status, 201, await created.clone().text());
    ids.push({ entity, id: (await created.json() as { id: string }).id });
    assert.equal((await request('PATCH', `/api/${entity}/${ids.at(-1)!.id}`, { name: 'Actualisé' }, cookie)).status, 200);
  }
  const configured = await row(); const snapshot = JSON.parse(configured.data) as WorkspaceSnapshot;
  for (const table of originalTables) assert.deepEqual(snapshot[table], legacy[table], `${table} must remain unchanged.`);
  const templateId = ids.find(record => record.entity === 'project-templates')!.id;
  const createdProject = await request('POST', '/api/projects', { ...projectInput, templateId }, cookie); assert.equal(createdProject.status, 201);
  const clonedProject = await createdProject.json() as Project;
  const state = await (await request('GET', '/api/state', undefined, cookie)).json() as AppData;
  assert.equal(state.tasks.filter(task => task.projectId === clonedProject.id).length, 3);
  const saved = await row();
  await instance.dispose(); instance = runtime(); await instance.ready;
  assert.deepEqual(await (await request('GET', '/api/state', undefined, cookie)).json(), state);
  assert.deepEqual(await row(), saved);
  for (const { entity, id } of ids) assert.equal((await request('DELETE', `/api/${entity}/${id}`, undefined, cookie)).status, 204);
  const deleted = await row(); assert.equal(deleted.revision, saved.revision + 5);
  assert.equal((await request('POST', '/api/auth/logout', {}, cookie)).status, 204);
  assert.equal((await request('GET', '/api/state', undefined, cookie)).status, 401);
});
