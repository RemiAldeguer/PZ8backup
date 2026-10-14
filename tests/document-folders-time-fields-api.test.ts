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
import { TABLES, type CompatibleWorkspaceSnapshot, type StoreLike, type WorkspaceSnapshot } from '../server/contracts.ts';
import { MemoryStore } from '../server/memory-store.ts';
import { seed } from '../server/seed.ts';
import { ApiError, ApiService } from '../server/service.ts';
import { Store } from '../server/store.ts';
import { MAX_DOCUMENT_FOLDER_DEPTH } from '../server/document-folder-validation.ts';
import type { CustomFieldDefinition } from '../shared/customization.ts';
import { evaluateCustomFormula } from '../shared/custom-field-values.ts';
import type { AppData, DocumentFolder, Project, ProjectDocument, TimeEntry } from '../shared/types.ts';

const admin = { username: 'admin', password: 'Folders-and-time-local-tests-2026!', name: 'Administrateur' };
const actor = { id: 'resource-claire', name: admin.name, role: 'Administrateur' as const };
const folderPayload = { projectId: 'project-nova', name: 'Documentation' };
const linkPayload = { projectId: 'project-nova', name: 'Lien existant', kind: 'link', url: 'https://example.test/specifications' };
const timePayload = { taskId: 'task-ateliers', resourceId: 'resource-claire', date: '2026-10-12', hours: 2.25, note: 'Temps actuel' };
const snapshot = (store: StoreLike) => Object.fromEntries(TABLES.map(table => [table, store.all(table)])) as WorkspaceSnapshot;
const rejection = (status: number, action: () => unknown) => assert.throws(action, error => error instanceof ApiError && error.status === status);
const raster = `data:image/png;base64,${Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, ...new Uint8Array(60_000)]).toString('base64')}`;
const fieldPayload = (type: CustomFieldDefinition['type'], overrides: Record<string, unknown> = {}) => ({ name: type, scope: 'time-entry', type, options: [], ...overrides });

for (const backend of ['sqlite', 'memory'] as const) {
  const fixture = () => {
    const store = backend === 'sqlite' ? new Store(':memory:') : new MemoryStore(); seed(store);
    return { store, api: new ApiService(store, actor), close: () => { if (store instanceof Store) store.close(); } };
  };
  test(`${backend}: nested folders and document moves preserve file metadata, legacy root documents and server authors`, () => {
    const { store, api, close } = fixture();
    try {
      const before = snapshot(store);
      const root = api.mutate('document-folders', 'POST', { ...folderPayload, name: '  Documentation  ' }).value as DocumentFolder;
      assert.equal(root.name, 'Documentation'); assert.equal(root.parentId, null); assert.equal(root.authorId, actor.id);
      assert.equal(root.authorName, actor.name); assert.equal(root.createdAt, root.updatedAt);
      const child = api.mutate('document-folders', 'POST', { ...folderPayload, name: 'Contrats', parentId: root.id }).value as DocumentFolder;
      const document = api.mutate('project-documents', 'POST', linkPayload).value as ProjectDocument;
      assert.equal(document.folderId, undefined, 'Legacy and unsorted documents remain at root.');
      const moved = api.mutate('project-documents', 'PATCH', { folderId: child.id }, document.id).value as ProjectDocument;
      assert.equal(moved.folderId, child.id); assert.equal(moved.url, document.url); assert.equal(moved.authorId, document.authorId); assert.equal(moved.createdAt, document.createdAt);
      const renamed = api.mutate('document-folders', 'PATCH', { name: 'Contrats validés', parentId: null }, child.id).value as DocumentFolder;
      assert.equal(renamed.parentId, null); assert.equal(renamed.authorId, child.authorId); assert.equal(renamed.createdAt, child.createdAt);
      api.mutate('document-folders', 'DELETE', undefined, root.id);
      rejection(409, () => api.mutate('document-folders', 'DELETE', undefined, child.id));
      api.mutate('project-documents', 'PATCH', { folderId: null }, document.id); api.mutate('document-folders', 'DELETE', undefined, child.id);
      api.mutate('project-documents', 'DELETE', undefined, document.id);
      assert.deepEqual(snapshot(store), before);
    } finally { close(); }
  });
  test(`${backend}: folders reject cross-project references, cycles, excessive descendant depth and forged metadata atomically`, () => {
    const { store, api, close } = fixture();
    try {
      const root = api.mutate('document-folders', 'POST', folderPayload).value as DocumentFolder;
      const child = api.mutate('document-folders', 'POST', { ...folderPayload, parentId: root.id }).value as DocumentFolder;
      const foreign = api.mutate('document-folders', 'POST', { ...folderPayload, projectId: 'project-mobile' }).value as DocumentFolder;
      const document = api.mutate('project-documents', 'POST', linkPayload).value as ProjectDocument;
      const before = snapshot(store);
      const invalidFolderPayloads: Record<string, unknown>[] = [{ ...folderPayload, parentId: foreign.id }, { ...folderPayload, projectId: 'missing' }, { ...folderPayload, parentId: 'missing' }, { ...folderPayload, name: ' ' },
        ...['id', 'authorId', 'authorName', 'createdAt', 'updatedAt'].map(key => ({ ...folderPayload, [key]: 'forged' }))];
      for (const payload of invalidFolderPayloads) {
        rejection((payload.projectId === 'missing' || payload.parentId === 'missing') ? 404 : 400, () => api.mutate('document-folders', 'POST', payload));
      }
      for (const key of ['id', 'projectId', 'authorId', 'authorName', 'createdAt', 'updatedAt']) rejection(400, () => api.mutate('document-folders', 'PATCH', { [key]: 'forged' }, root.id));
      rejection(400, () => api.mutate('document-folders', 'PATCH', {}, root.id));
      rejection(409, () => api.mutate('document-folders', 'PATCH', { parentId: root.id }, root.id));
      rejection(409, () => api.mutate('document-folders', 'PATCH', { parentId: child.id }, root.id));
      rejection(400, () => api.mutate('document-folders', 'PATCH', { parentId: foreign.id }, child.id));
      rejection(400, () => api.mutate('project-documents', 'PATCH', { folderId: foreign.id }, document.id));
      rejection(404, () => api.mutate('project-documents', 'POST', { ...linkPayload, folderId: 'missing' }));
      rejection(409, () => api.mutate('document-folders', 'DELETE', undefined, root.id));
      assert.deepEqual(snapshot(store), before);
      let parent = child;
      for (let depth = 3; depth <= MAX_DOCUMENT_FOLDER_DEPTH; depth++) parent = api.mutate('document-folders', 'POST', { ...folderPayload, parentId: parent.id }).value as DocumentFolder;
      const atLimit = snapshot(store);
      rejection(409, () => api.mutate('document-folders', 'POST', { ...folderPayload, parentId: parent.id }));
      const extraRoot = api.mutate('document-folders', 'POST', folderPayload).value as DocumentFolder;
      rejection(409, () => api.mutate('document-folders', 'PATCH', { parentId: extraRoot.id }, root.id));
      api.mutate('document-folders', 'DELETE', undefined, extraRoot.id); assert.deepEqual(snapshot(store), atLimit);
    } finally { close(); }
  });
  test(`${backend}: folder ownership, project locks and deletion guards conserve all project history`, () => {
    const { store, api, close } = fixture();
    try {
      const project = api.mutate('projects', 'POST', { name: 'Dossiers seuls', zoneId: 'zone-transformation', startDate: '2026-10-12', endDate: '2026-10-31' }).value as Project;
      const owner = new ApiService(store, { ...actor, role: 'Usager' });
      const stranger = new ApiService(store, { ...actor, id: 'resource-lucas', role: 'Usager' });
      const folder = owner.mutate('document-folders', 'POST', { ...folderPayload, projectId: project.id }).value as DocumentFolder;
      rejection(403, () => stranger.mutate('document-folders', 'PATCH', { name: 'Autre' }, folder.id)); rejection(403, () => stranger.mutate('document-folders', 'DELETE', undefined, folder.id));
      owner.mutate('document-folders', 'PATCH', { name: 'Propre dossier' }, folder.id); rejection(409, () => api.mutate('projects', 'DELETE', undefined, project.id));
      for (const status of ['paused', 'closed']) {
        api.mutate('projects', 'PATCH', { status }, project.id); const locked = snapshot(store);
        rejection(409, () => api.mutate('document-folders', 'POST', { ...folderPayload, projectId: project.id }));
        rejection(409, () => api.mutate('document-folders', 'PATCH', { name: 'Interdit' }, folder.id)); rejection(409, () => api.mutate('document-folders', 'DELETE', undefined, folder.id));
        assert.deepEqual(snapshot(store), locked);
      }
      api.mutate('projects', 'PATCH', { status: 'open' }, project.id); api.mutate('document-folders', 'DELETE', undefined, folder.id); api.mutate('projects', 'DELETE', undefined, project.id);
    } finally { close(); }
  });
  test(`${backend}: time-entry fields support all types, dynamic hours formulas and preserved historical cost snapshots`, () => {
    const { store, api, close } = fixture();
    try {
      const create = (type: CustomFieldDefinition['type'], overrides: Record<string, unknown> = {}) => api.mutate('custom-field-definitions', 'POST', fieldPayload(type, overrides)).value as CustomFieldDefinition;
      const simple = create('text'), rich = create('rich_text'), multi = create('multi_select', { options: ['Client', 'Interne'] });
      const choice = create('select', { options: ['Oui', 'Non'] }), number = create('number'), date = create('date'), image = create('image'), url = create('url');
      const formula = create('formula', { formula: `{hours} * {${number.id}}` });
      const values = { [simple.id]: 'Référence', [rich.id]: ' **Notes**\n- Point\n', [multi.id]: '["Client","Interne"]', [choice.id]: 'Oui', [number.id]: ' 2.5 ', [date.id]: ' 2026-10-12 ', [image.id]: raster, [url.id]: ' https://example.test/time ' };
      const entry = api.mutate('time-entries', 'POST', { ...timePayload, customValues: values }).value as TimeEntry;
      const expected = { ...values, [number.id]: '2.5', [date.id]: '2026-10-12', [url.id]: 'https://example.test/time' };
      assert.deepEqual(entry.customValues, expected); assert.equal(evaluateCustomFormula(formula, api.readState().customFieldDefinitions!, expected, { hours: entry.hours }).value, 5.625);
      store.put('timeEntries', { ...entry, customValues: { ...expected, opaqueLegacy: 'Historique' } });
      const legacy = store.get('timeEntries', entry.id)!;
      const resource = store.get('resources', entry.resourceId)!; const profile = store.get('profiles', resource.profileId!)!;
      api.mutate('profiles', 'PATCH', { dailyRate: profile.dailyRate + 100 }, profile.id);
      const edited = api.mutate('time-entries', 'PATCH', { hours: 3, customValues: { ...legacy.customValues, [simple.id]: 'Corrigé' } }, entry.id).value as TimeEntry;
      assert.equal(edited.rateSnapshot, legacy.rateSnapshot); assert.equal(edited.eqjtSnapshot, legacy.eqjtSnapshot); assert.equal(edited.taskId, entry.taskId); assert.equal(edited.resourceId, entry.resourceId); assert.equal(edited.date, entry.date);
      assert.equal(edited.customValues?.opaqueLegacy, 'Historique'); assert.equal(evaluateCustomFormula(formula, api.readState().customFieldDefinitions!, edited.customValues!, { hours: edited.hours }).value, 7.5);
      const saved = snapshot(store); assert.deepEqual(new MemoryStore(saved).snapshot(), saved);
    } finally { close(); }
  });
  test(`${backend}: time-entry values, definition references and validation withdrawal are enforced atomically`, () => {
    const { store, api, close } = fixture();
    try {
      const field = api.mutate('custom-field-definitions', 'POST', fieldPayload('multi_select', { options: ['A', 'B'] })).value as CustomFieldDefinition;
      const foreign = api.mutate('custom-field-definitions', 'POST', { ...fieldPayload('text'), scope: 'task' }).value as CustomFieldDefinition;
      const calculated = api.mutate('custom-field-definitions', 'POST', fieldPayload('formula', { formula: '{hours} * 2' })).value as CustomFieldDefinition;
      const entry = api.mutate('time-entries', 'POST', { ...timePayload, customValues: { [field.id]: '["A","B"]' } }).value as TimeEntry;
      const before = snapshot(store);
      for (const customValues of [{ missing: 'Unknown' }, { [foreign.id]: 'Bad scope' }, { [field.id]: '["A","A"]' }, { [field.id]: '["Missing"]' }, { [calculated.id]: '42' }]) rejection(customValues.missing ? 404 : 400, () => api.mutate('time-entries', 'PATCH', { customValues }, entry.id));
      rejection(409, () => api.mutate('custom-field-definitions', 'DELETE', undefined, field.id));
      rejection(409, () => api.mutate('custom-field-definitions', 'PATCH', { options: ['A'] }, field.id));
      rejection(409, () => api.mutate('custom-field-definitions', 'PATCH', { scope: 'project' }, field.id));
      rejection(400, () => api.mutate('custom-field-definitions', 'POST', fieldPayload('formula', { formula: '{budget}' })));
      rejection(400, () => api.mutate('time-entries', 'PATCH', { rateSnapshot: 999 }, entry.id));
      assert.deepEqual(snapshot(store), before);
      api.mutate('time-entries', 'PATCH', { validated: true }, entry.id); const validated = snapshot(store);
      for (const patch of [{ customValues: {} }, { validated: false, customValues: {} }, { hours: 5 }]) rejection(409, () => api.mutate('time-entries', 'PATCH', patch, entry.id));
      rejection(409, () => api.mutate('time-entries', 'DELETE', undefined, entry.id)); assert.deepEqual(snapshot(store), validated);
      api.mutate('time-entries', 'PATCH', { validated: false }, entry.id); api.mutate('time-entries', 'PATCH', { customValues: {} }, entry.id);
      api.mutate('custom-field-definitions', 'DELETE', undefined, field.id);
      api.mutate('projects', 'PATCH', { status: 'closed' }, 'project-nova'); const closed = snapshot(store);
      rejection(409, () => api.mutate('time-entries', 'POST', timePayload)); rejection(409, () => api.mutate('time-entries', 'PATCH', { customValues: {} }, entry.id)); assert.deepEqual(snapshot(store), closed);
    } finally { close(); }
  });
}

test('legacy memory snapshots default only absent folders, retain root documents and reject malformed trees without rewriting data', () => {
  const store = new MemoryStore(); seed(store); const api = new ApiService(store, actor);
  const document = api.mutate('project-documents', 'POST', linkPayload).value as ProjectDocument;
  const { documentFolders: _folders, ...legacy } = store.snapshot(); const original = structuredClone(legacy);
  assert.deepEqual(new MemoryStore(legacy).snapshot(), { ...legacy, documentFolders: [] }); assert.deepEqual(legacy, original); assert.equal(document.folderId, undefined);
  for (const invalid of [undefined, null, {}, [null], [{}]]) assert.throws(() => new MemoryStore({ ...legacy, documentFolders: invalid } as unknown as CompatibleWorkspaceSnapshot));
  const root = api.mutate('document-folders', 'POST', folderPayload).value as DocumentFolder;
  for (const patch of [{ parentId: root.id }, { parentId: 'missing' }, { projectId: 'missing' }, { authorId: undefined }]) assert.throws(() => new MemoryStore({ ...legacy, documentFolders: [{ ...root, ...patch }] } as unknown as CompatibleWorkspaceSnapshot));
  assert.throws(() => new MemoryStore({ ...legacy, documentFolders: [root], projectDocuments: [{ ...document, folderId: 'missing' }] }));
  assert.throws(() => new MemoryStore({ ...legacy, timeEntries: [{ ...legacy.timeEntries[0], customValues: { malformed: 1 } }] } as unknown as CompatibleWorkspaceSnapshot));
});

test('SQLite adds folder and document references without rewriting eighteen collections and persists time fields after restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'planzone8-folders-sql-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'workspace.sqlite'); let store = new Store(path); seed(store);
  const api = new ApiService(store, actor); const document = api.mutate('project-documents', 'POST', linkPayload).value as ProjectDocument;
  const before = snapshot(store); const rawDocument = store.db.prepare('SELECT data FROM projectDocuments WHERE id = ?').get(document.id);
  store.db.exec('DROP TABLE projectDocuments; DROP TABLE documentFolders; CREATE TABLE projectDocuments (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)), projectId TEXT GENERATED ALWAYS AS (json_extract(data, \'$.projectId\')) STORED REFERENCES projects(id));');
  store.put('projectDocuments', document); store.close(); store = new Store(path);
  try {
    assert.deepEqual(snapshot(store), before); assert.deepEqual(store.db.prepare('SELECT data FROM projectDocuments WHERE id = ?').get(document.id), rawDocument);
    const reopened = new ApiService(store, actor); const folder = reopened.mutate('document-folders', 'POST', folderPayload).value as DocumentFolder;
    assert.throws(() => store.put('documentFolders', { ...folder, id: 'orphan', projectId: 'missing' }), /FOREIGN KEY/);
    assert.throws(() => store.put('documentFolders', { ...folder, id: 'orphan', parentId: 'missing' }), /FOREIGN KEY/);
    assert.throws(() => store.put('projectDocuments', { ...document, folderId: 'missing' }), /FOREIGN KEY/);
    reopened.mutate('project-documents', 'PATCH', { folderId: folder.id }, document.id);
    const field = reopened.mutate('custom-field-definitions', 'POST', fieldPayload('rich_text')).value as CustomFieldDefinition;
    reopened.mutate('time-entries', 'POST', { ...timePayload, customValues: { [field.id]: '**Conservé**\n- Note' } });
    const saved = reopened.readState('2026-10-12'); store.close(); store = new Store(path); assert.deepEqual(new ApiService(store, actor).readState('2026-10-12'), saved);
    for (const table of TABLES.filter(table => !['documentFolders', 'projectDocuments', 'customFieldDefinitions', 'timeEntries'].includes(table))) assert.deepEqual(snapshot(store)[table], before[table]);
  } finally { store.close(); }
});

type Request = (method: string, path: string, body?: unknown, cookie?: string, extraHeaders?: Record<string, string>) => Promise<{ status: number; headers: { get(name: string): string | null }; json(): Promise<unknown>; text(): Promise<string> }>;
async function boundedTimeImages(request: Request, cookie: string) {
  const ids: string[] = [];
  for (const name of ['Illustration temps', 'Justificatif temps']) { const response = await request('POST', '/api/custom-field-definitions', fieldPayload('image', { name }), cookie); assert.equal(response.status, 201); ids.push((await response.json() as { id: string }).id); }
  const response = await request('POST', '/api/time-entries', { ...timePayload, customValues: { [ids[0]]: raster, [ids[1]]: raster } }, cookie);
  assert.equal(response.status, 201, await response.text()); const state = await (await request('GET', '/api/state', undefined, cookie)).json() as AppData;
  const entry = state.timeEntries.at(-1)!; assert.deepEqual(entry.customValues, { [ids[0]]: raster, [ids[1]]: raster });
  assert.equal((await request('PATCH', `/api/time-entries/${entry.id}`, { customValues: { [ids[0]]: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' } }, cookie)).status, 400);
  assert.equal((await request('PATCH', `/api/time-entries/${entry.id}`, { customValues: { [ids[0]]: 'x'.repeat(600 * 1024) } }, cookie)).status, 413);
  assert.equal((await request('PATCH', `/api/time-entries/${entry.id}`, { note: 'x'.repeat(110000) }, cookie)).status, 413);
  assert.deepEqual(await (await request('GET', '/api/state', undefined, cookie)).json(), state);
  return state;
}

test('SQLite HTTP protects folder writes and accepts bounded multi-image time-entry fields above the normal body limit', async t => {
  const instance = createApp({ dbPath: ':memory:', today: '2026-10-12', admin }); await instance.ready;
  const server = instance.app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); instance.close(); });
  const address = server.address(); assert.ok(address && typeof address !== 'string'); const origin = `http://127.0.0.1:${address.port}`;
  const request: Request = (method, path, body, cookie, extraHeaders) => fetch(`${origin}${path}`, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  for (const method of ['POST', 'PATCH', 'DELETE']) assert.equal((await request(method, `/api/document-folders${method === 'POST' ? '' : '/missing'}`, method === 'POST' ? folderPayload : method === 'PATCH' ? { name: 'Other' } : undefined)).status, 401);
  const login = await request('POST', '/api/auth/login', { username: admin.username, password: admin.password }); assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie')!.split(';', 1)[0];
  assert.equal((await request('POST', '/api/document-folders', folderPayload, cookie, { Origin: 'https://other.test' })).status, 403);
  assert.equal((await request('POST', '/api/document-folders', folderPayload, cookie)).status, 201); await boundedTimeImages(request, cookie);
});

test('actual Worker/D1 reads legacy absent folders without revision changes and persists folder/time edits with atomic rejections after restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'planzone8-folders-d1-'));
  const bundled = await build({ entryPoints: [resolve('cloudflare/worker.ts')], write: false, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent' });
  const databaseId = randomUUID(), workspaceId = randomUUID();
  const runtime = () => new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-10-06', host: '127.0.0.1', port: 0, cf: false, log: new Log(LogLevel.ERROR), resourcePersistencePath: directory, d1Databases: { DB: databaseId }, bindings: { DEMO_TODAY: '2026-10-12' }, serviceBindings: { ASSETS: () => new MiniflareResponse('Folders fixture') } }));
  let instance = runtime(); await instance.ready; t.after(async () => { await instance.dispose(); await rm(directory, { recursive: true, force: true }); });
  const db = () => instance.getD1Database('DB'); await new AuthManager(new D1AuthDatabase(await db() as unknown as D1Database)).createAdmin({ ...admin, workspaceId });
  const request: Request = (method, path, body, cookie, extraHeaders) => instance.dispatchFetch(`https://planzone8.test${path}`, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal((await request('POST', '/api/document-folders', folderPayload)).status, 401);
  const login = await request('POST', '/api/auth/login', { username: admin.username, password: admin.password }); assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie')!.split(';', 1)[0]; await request('GET', '/api/state', undefined, cookie);
  const initial = new MemoryStore(); seed(initial); new ApiService(initial, actor).mutate('project-documents', 'POST', linkPayload);
  const { documentFolders: _folders, ...legacy } = initial.snapshot(); legacy.projects[0].description = 'Donnée préexistante conservée';
  await (await db()).prepare('UPDATE demo_workspaces SET data = ? WHERE id = ?').bind(JSON.stringify(legacy), workspaceId).run();
  const row = async () => { const result = await (await db()).prepare('SELECT data, revision FROM demo_workspaces WHERE id = ?').bind(workspaceId).first<{ data: string; revision: number }>(); assert.ok(result); return result; };
  const before = await row(); const state = await (await request('GET', '/api/state', undefined, cookie)).json() as AppData; assert.deepEqual(state.documentFolders, []); assert.deepEqual(await row(), before);
  assert.equal((await request('POST', '/api/document-folders', { ...folderPayload, authorId: 'forged' }, cookie)).status, 400); assert.equal((await request('POST', '/api/document-folders', folderPayload, cookie, { Origin: 'https://other.test' })).status, 403); assert.deepEqual(await row(), before);
  const created = await request('POST', '/api/document-folders', folderPayload, cookie); assert.equal(created.status, 201); const folder = await created.json() as DocumentFolder;
  const first = await row(); assert.equal(first.revision, before.revision + 1); const firstSnapshot = JSON.parse(first.data) as WorkspaceSnapshot;
  for (const table of TABLES.filter(table => table !== 'documentFolders')) assert.deepEqual(firstSnapshot[table], legacy[table]);
  assert.equal((await request('PATCH', `/api/document-folders/${folder.id}`, { parentId: folder.id }, cookie)).status, 409); assert.deepEqual(await row(), first);
  assert.equal((await request('PATCH', `/api/project-documents/${state.projectDocuments![0].id}`, { folderId: folder.id }, cookie)).status, 200);
  const nonempty = await row(); assert.equal((await request('DELETE', `/api/document-folders/${folder.id}`, undefined, cookie)).status, 409); assert.deepEqual(await row(), nonempty);
  const persisted = await boundedTimeImages(request, cookie); const savedRow = await row();
  await instance.dispose(); instance = runtime(); await instance.ready; assert.deepEqual(await (await request('GET', '/api/state', undefined, cookie)).json(), persisted); assert.deepEqual(await row(), savedRow);
  assert.equal((await request('POST', '/api/auth/logout', {}, cookie)).status, 204); assert.equal((await request('PATCH', `/api/document-folders/${folder.id}`, { name: 'Interdit' }, cookie)).status, 401);
});
