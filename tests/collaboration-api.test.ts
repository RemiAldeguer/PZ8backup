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
import { MAX_DOCUMENT_BYTES, MAX_WORKSPACE_BYTES, workspaceStorageUsage } from '../server/collaboration-validation.ts';
import { TABLES, type CompatibleWorkspaceSnapshot, type StoreLike, type WorkspaceSnapshot } from '../server/contracts.ts';
import { MemoryStore } from '../server/memory-store.ts';
import { seed } from '../server/seed.ts';
import { ApiError, ApiService } from '../server/service.ts';
import { Store } from '../server/store.ts';
import type { AppData, Comment, Project, ProjectDocument } from '../shared/types.ts';

const admin = { username: 'admin', password: 'Collaboration-test-administrator-2026!', name: 'Administrateur projet' };
const actor = { id: 'resource-claire', name: admin.name, role: 'Administrateur' as const };
const link = { projectId: 'project-nova', name: 'Cahier des charges', kind: 'link', url: 'https://example.test/specifications' };
const pdf = (bytes = 100) => ({ projectId: 'project-nova', name: 'Documentation PDF', kind: 'file', fileName: 'documentation.pdf', mimeType: 'application/pdf', contentBase64: Buffer.from('%PDF-1.7\n' + 'x'.repeat(bytes - 9)).toString('base64') });
const snapshot = (store: StoreLike) => Object.fromEntries(TABLES.map(table => [table, store.all(table)])) as WorkspaceSnapshot;
const rejection = (status: number, action: () => unknown) => assert.throws(action, error => error instanceof ApiError && error.status === status);

for (const backend of ['sqlite', 'memory'] as const) {
  const fixture = () => {
    const store = backend === 'sqlite' ? new Store(':memory:') : new MemoryStore(); seed(store);
    return { store, api: new ApiService(store, actor), close: () => { if (store instanceof Store) store.close(); } };
  };
  test(`${backend}: project and task discussions store explicit mentions and immutable server authors`, () => {
    const { store, api, close } = fixture();
    try {
      const original = snapshot(store);
      const projectComment = api.mutate('comments', 'POST', { projectId: 'project-nova', taskId: null, body: '  Décision projet  ', mentionResourceIds: ['resource-lucas', 'resource-claire'] }).value as Comment;
      assert.equal(projectComment.body, 'Décision projet'); assert.equal(projectComment.taskId, null); assert.equal(projectComment.projectId, 'project-nova');
      assert.equal(projectComment.authorId, actor.id); assert.equal(projectComment.authorName, actor.name); assert.equal(projectComment.createdAt, projectComment.updatedAt);
      const taskComment = api.mutate('comments', 'POST', { taskId: 'task-ateliers', body: 'Commentaire tâche' }).value as Comment;
      assert.equal(taskComment.projectId, 'project-nova'); assert.deepEqual(taskComment.mentionResourceIds, []);
      const edited = new ApiService(store, { ...actor, id: 'resource-lucas', name: 'Autre admin' }).mutate('comments', 'PATCH', { body: 'Relecture', mentionResourceIds: ['resource-ines'] }, projectComment.id).value as Comment;
      assert.equal(edited.authorId, actor.id); assert.equal(edited.authorName, actor.name); assert.equal(edited.createdAt, projectComment.createdAt); assert.ok(edited.updatedAt! >= edited.createdAt);
      api.mutate('comments', 'DELETE', undefined, projectComment.id); api.mutate('comments', 'DELETE', undefined, taskComment.id);
      assert.deepEqual(snapshot(store), original);
    } finally { close(); }
  });
  test(`${backend}: discussions reject forged metadata, cross-project tasks and unknown or duplicate mentions atomically`, () => {
    const { store, api, close } = fixture();
    try {
      const before = snapshot(store);
      for (const body of [
        { body: 'Sans contexte' }, { projectId: 'missing', body: 'Absent' }, { taskId: 'missing', body: 'Absent' },
        { projectId: 'project-mobile', taskId: 'task-ateliers', body: 'Mauvais projet' },
        { projectId: 'project-nova', body: 'Mention', mentionResourceIds: ['missing'] },
        { projectId: 'project-nova', body: 'Mention', mentionResourceIds: [actor.id, actor.id] },
        { projectId: 'project-nova', body: ' ' }, { projectId: 'project-nova', body: 'x'.repeat(10001) },
        ...['id', 'authorId', 'authorName', 'createdAt', 'updatedAt'].map(field => ({ projectId: 'project-nova', body: 'Forgé', [field]: 'forged' })),
      ]) rejection((body.projectId === 'missing' || body.taskId === 'missing' || body.mentionResourceIds?.includes('missing')) ? 404 : 400, () => api.mutate('comments', 'POST', body));
      assert.deepEqual(snapshot(store), before);
      const comment = api.mutate('comments', 'POST', { projectId: 'project-nova', body: 'Initial' }).value as Comment;
      for (const field of ['id', 'projectId', 'taskId', 'authorId', 'authorName', 'createdAt', 'updatedAt']) rejection(400, () => api.mutate('comments', 'PATCH', { [field]: 'forged' }, comment.id));
      rejection(400, () => api.mutate('comments', 'PATCH', {}, comment.id));
      assert.deepEqual(store.get('comments', comment.id), comment);
    } finally { close(); }
  });
  test(`${backend}: authors and administrators may edit collaboration; exact legacy authors remain compatible`, () => {
    const { store, api, close } = fixture();
    try {
      const own = new ApiService(store, { ...actor, role: 'Usager' });
      const stranger = new ApiService(store, { id: 'resource-lucas', name: actor.name, role: 'Usager' });
      const comment = own.mutate('comments', 'POST', { projectId: 'project-nova', body: 'Original' }).value as Comment;
      const document = own.mutate('project-documents', 'POST', pdf(128)).value as ProjectDocument;
      for (const [entity, id, patch] of [['comments', comment.id, { body: 'Autre' }], ['project-documents', document.id, { name: 'Autre' }]] as const) {
        rejection(403, () => stranger.mutate(entity, 'PATCH', patch, id)); rejection(403, () => stranger.mutate(entity, 'DELETE', undefined, id));
        own.mutate(entity, 'PATCH', patch, id); api.mutate(entity, 'DELETE', undefined, id);
      }
      const currentResource = store.get('resources', actor.id)!; store.put('resources', { ...currentResource, role: 'visitor' });
      const otherComment = stranger.mutate('comments', 'POST', { projectId: 'project-nova', body: 'Autre auteur' }).value as Comment;
      const otherDocument = stranger.mutate('project-documents', 'POST', pdf(128)).value as ProjectDocument;
      assert.equal(api.readState().currentUser.role, 'Administrateur', 'Editable resource role must never revoke authenticated administrator rights.');
      api.mutate('comments', 'PATCH', { body: 'Admin authentifié' }, otherComment.id);
      api.mutate('project-documents', 'PATCH', { name: 'Admin authentifié' }, otherDocument.id);
      assert.equal(store.get('comments', otherComment.id)?.authorId, 'resource-lucas');
      const legacy = store.get('comments', 'comment-ateliers-1')!;
      store.put('resources', { ...store.get('resources', actor.id)!, id: 'legacy-author', name: legacy.authorName, role: 'user', projectIds: ['project-nova'] });
      new ApiService(store, { id: 'legacy-author', name: legacy.authorName, role: 'Usager' }).mutate('comments', 'PATCH', { body: 'Auteur historique exact' }, legacy.id);
      rejection(403, () => new ApiService(store, { id: 'legacy-author', name: `${legacy.authorName} autre`, role: 'Usager' }).mutate('comments', 'DELETE', undefined, legacy.id));
    } finally { close(); }
  });
  test(`${backend}: document links and actual file bytes persist with server-owned metadata and immutable content`, () => {
    const { store, api, close } = fixture();
    try {
      const before = snapshot(store);
      const document = api.mutate('project-documents', 'POST', { ...link, description: 'Lien partagé' }).value as ProjectDocument;
      assert.equal(document.url, link.url); assert.equal(document.contentBase64, null); assert.equal(document.fileName, null); assert.equal(document.sizeBytes, null);
      assert.equal(document.authorId, actor.id); assert.equal(document.authorName, actor.name); assert.equal(document.createdAt, document.updatedAt);
      const uploaded = api.mutate('project-documents', 'POST', pdf(130000)).value as ProjectDocument;
      assert.equal(uploaded.sizeBytes, 130000); assert.equal(uploaded.url, null); assert.equal(uploaded.contentBase64, null);
      assert.equal(Buffer.from(api.readDocument(uploaded.id).contentBase64!, 'base64').length, uploaded.sizeBytes);
      assert.equal(api.readState().projectDocuments!.find(item => item.id === uploaded.id)!.contentBase64, null);
      const updated = api.mutate('project-documents', 'PATCH', { name: 'Version corrigée', url: 'https://example.test/version-2' }, document.id).value as ProjectDocument;
      assert.equal(updated.createdAt, document.createdAt); assert.equal(updated.authorId, actor.id);
      const fileUpdated = api.mutate('project-documents', 'PATCH', { description: 'Pièce jointe conservée' }, uploaded.id).value as ProjectDocument;
      assert.equal(fileUpdated.contentBase64, uploaded.contentBase64); assert.equal(fileUpdated.sizeBytes, uploaded.sizeBytes);
      for (const field of ['id', 'projectId', 'kind', 'authorId', 'authorName', 'createdAt', 'updatedAt', 'mimeType', 'fileName', 'contentBase64', 'sizeBytes']) {
        rejection(400, () => api.mutate('project-documents', 'PATCH', { [field]: 'forged' }, uploaded.id));
      }
      rejection(400, () => api.mutate('project-documents', 'PATCH', { url: link.url }, uploaded.id));
      for (const table of TABLES.filter(table => table !== 'projectDocuments')) assert.deepEqual(snapshot(store)[table], before[table]);
      api.mutate('project-documents', 'DELETE', undefined, document.id); api.mutate('project-documents', 'DELETE', undefined, uploaded.id);
      assert.deepEqual(snapshot(store), before);
    } finally { close(); }
  });
  test(`${backend}: uploads reject active formats, MIME mismatch, malformed base64, excessive size and forged size`, () => {
    const { store, api, close } = fixture();
    try {
      const before = snapshot(store);
      const binary = (text: string) => Buffer.from(text).toString('base64');
      for (const value of [
        { ...link, url: 'javascript:alert(1)' }, { ...link, url: 'data:text/html,evil' }, { ...link, url: 'https://user:password@example.test' },
        { ...link, contentBase64: binary('confusion') }, { ...link, projectId: 'missing' },
        { ...pdf(), mimeType: 'text/html', fileName: 'evil.html' }, { ...pdf(), mimeType: 'image/svg+xml', fileName: 'evil.svg' },
        { ...pdf(), mimeType: 'image/png', fileName: 'document.png' }, { ...pdf(), fileName: '../document.pdf' },
        { ...pdf(), fileName: 'document.exe' }, { ...pdf(), contentBase64: binary('<script>evil</script>') },
        { ...pdf(), contentBase64: 'invalid%%%=' }, { ...pdf(), contentBase64: 'AB==' }, { ...pdf(), contentBase64: '' },
        { ...pdf(MAX_DOCUMENT_BYTES + 1) }, { ...pdf(), sizeBytes: 5 },
        { ...pdf(), mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileName: 'macro.docx', contentBase64: binary('PK\u0003\u0004word/vbaProject.bin') },
        ...['id', 'authorId', 'authorName', 'createdAt', 'updatedAt'].map(field => ({ ...link, [field]: 'forged' })),
      ]) rejection(value.projectId === 'missing' ? 404 : 400, () => api.mutate('project-documents', 'POST', value));
      const samples = [
        ['image/png', 'png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0])],
        ['image/jpeg', 'jpg', Buffer.from([255, 216, 255, 224])],
        ['image/gif', 'gif', Buffer.from('GIF89a\0\0')],
        ['image/webp', 'webp', Buffer.from('RIFF1234WEBP')],
        ['text/plain', 'txt', Buffer.from('Texte français\n')], ['text/csv', 'csv', Buffer.from('nom;valeur\nÉquipe;1\n')],
      ] as const;
      for (const [mimeType, extension, bytes] of samples) {
        const doc = api.mutate('project-documents', 'POST', { ...pdf(), fileName: `valid.${extension}`, mimeType, contentBase64: bytes.toString('base64') }).value as ProjectDocument;
        assert.equal(doc.sizeBytes, bytes.length); api.mutate('project-documents', 'DELETE', undefined, doc.id);
      }
      assert.deepEqual(snapshot(store), before);
    } finally { close(); }
  });
  test(`${backend}: closed projects lock discussion and document writes and their history prevents project deletion`, () => {
    const { store, api, close } = fixture();
    try {
      const project = api.mutate('projects', 'POST', { name: 'Collaboration isolée', zoneId: 'zone-transformation', startDate: '2026-10-12', endDate: '2026-10-31' }).value as Project;
      const comment = api.mutate('comments', 'POST', { projectId: project.id, body: 'Historique' }).value as Comment;
      const doc = api.mutate('project-documents', 'POST', { ...link, projectId: project.id }).value as ProjectDocument;
      rejection(409, () => api.mutate('projects', 'DELETE', undefined, project.id));
      for (const status of ['paused', 'closed'] as const) {
        api.mutate('projects', 'PATCH', { status }, project.id); const locked = snapshot(store);
        for (const [entity, id, create, patch] of [
          ['comments', comment.id, { projectId: project.id, body: 'Interdit' }, { body: 'Interdit' }],
          ['project-documents', doc.id, { ...link, projectId: project.id }, { name: 'Interdit' }],
        ] as const) {
          rejection(409, () => api.mutate(entity, 'POST', create)); rejection(409, () => api.mutate(entity, 'PATCH', patch, id)); rejection(409, () => api.mutate(entity, 'DELETE', undefined, id));
        }
        assert.deepEqual(snapshot(store), locked);
      }
      api.mutate('projects', 'PATCH', { status: 'open' }, project.id);
      api.mutate('comments', 'DELETE', undefined, comment.id); rejection(409, () => api.mutate('projects', 'DELETE', undefined, project.id));
      api.mutate('project-documents', 'DELETE', undefined, doc.id); api.mutate('projects', 'DELETE', undefined, project.id);
    } finally { close(); }
  });
  test(`${backend}: storage quotas reject atomically across document and later business writes while permitting reduction`, () => {
    const { store, api, close } = fixture();
    try {
      const first = api.mutate('project-documents', 'POST', pdf(MAX_DOCUMENT_BYTES)).value as ProjectDocument;
      api.mutate('project-documents', 'POST', pdf(MAX_DOCUMENT_BYTES));
      assert.ok(workspaceStorageUsage(snapshot(store)).total < MAX_WORKSPACE_BYTES);
      const before = snapshot(store); rejection(413, () => api.mutate('project-documents', 'POST', pdf(MAX_DOCUMENT_BYTES))); assert.deepEqual(snapshot(store), before);
      // Existing oversized snapshots stay readable; all subsequent mutations apply the cap atomically.
      for (let index = 0; workspaceStorageUsage(snapshot(store)).core < 1_001_000; index++) store.put('comments', {
        id: `quota-${index}`, taskId: 'task-ateliers', body: 'x'.repeat(10000), authorName: actor.name, createdAt: '2026-10-12T00:00:00.000Z',
      });
      const oversized = snapshot(store); assert.ok(api.readState().comments.length > 90);
      rejection(413, () => api.mutate('projects', 'PATCH', { description: 'y'.repeat(10000) }, 'project-nova')); assert.deepEqual(snapshot(store), oversized);
      api.mutate('comments', 'DELETE', undefined, 'quota-0'); api.mutate('project-documents', 'DELETE', undefined, first.id);
      assert.ok(workspaceStorageUsage(snapshot(store)).total < workspaceStorageUsage(oversized).total);
    } finally { close(); }
  });
}

test('legacy memory snapshots default only absent documents, retain comments byte for byte and reject malformed saved documents', () => {
  const store = new MemoryStore(); seed(store); const { projectDocuments: _docs, ...legacy } = store.snapshot();
  const before = structuredClone(legacy); assert.deepEqual(new MemoryStore(legacy).snapshot(), { ...before, projectDocuments: [] }); assert.deepEqual(legacy, before);
  for (const value of [undefined, null, {}, [null], [{}]]) assert.throws(() => new MemoryStore({ ...legacy, projectDocuments: value } as unknown as CompatibleWorkspaceSnapshot));
  const doc = new ApiService(store, actor).mutate('project-documents', 'POST', pdf()).value as ProjectDocument;
  for (const patch of [{ sizeBytes: 1 }, { mimeType: 'text/html' }, { url: 'javascript:evil' }, { authorId: undefined }, { updatedAt: 'bad' }]) {
    assert.throws(() => new MemoryStore({ ...legacy, projectDocuments: [{ ...doc, ...patch }] } as unknown as CompatibleWorkspaceSnapshot));
  }
});

test('SQLite adds document foreign keys without rewriting seventeen existing collections and persists discussions/uploads after restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'planzone8-collaboration-sql-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'workspace.sqlite'); let store = new Store(path); seed(store);
  const before = snapshot(store); store.db.exec('DROP TABLE projectDocuments'); store.close(); store = new Store(path);
  try {
    assert.deepEqual(snapshot(store), before);
    const api = new ApiService(store, actor); const doc = api.mutate('project-documents', 'POST', pdf()).value as ProjectDocument;
    assert.throws(() => store.put('projectDocuments', { ...doc, id: 'orphan', projectId: 'missing' }), /FOREIGN KEY/);
    for (const table of TABLES.filter(table => table !== 'projectDocuments')) assert.deepEqual(snapshot(store)[table], before[table]);
    api.mutate('comments', 'POST', { projectId: 'project-nova', body: 'Discussion projet', mentionResourceIds: ['resource-lucas'] });
    const saved = api.readState('2026-10-12'); store.close(); store = new Store(path);
    assert.deepEqual(new ApiService(store, actor).readState('2026-10-12'), saved);
  } finally { store.close(); }
});

test('SQLite HTTP authenticates collaboration, applies origins and accepts bounded actual file bodies above the normal body limit', async t => {
  const instance = createApp({ dbPath: ':memory:', today: '2026-10-12', admin }); await instance.ready;
  const server = instance.app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); instance.close(); });
  const address = server.address(); assert.ok(address && typeof address !== 'string'); const origin = `http://127.0.0.1:${address.port}`;
  const request = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => fetch(`${origin}${path}`, {
    method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const routes = [['POST', '/api/project-documents', link], ['PATCH', '/api/project-documents/missing', { name: 'Autre' }], ['DELETE', '/api/project-documents/missing', undefined], ['POST', '/api/comments', { projectId: 'project-nova', body: 'Projet' }]] as const;
  for (const [method, path, body] of routes) assert.equal((await request(method, path, body)).status, 401);
  const login = await request('POST', '/api/auth/login', { username: admin.username, password: admin.password }); assert.equal(login.status, 200);
  const headers = { Cookie: login.headers.get('set-cookie')!.split(';', 1)[0]! };
  for (const [method, path, body] of routes) assert.equal((await request(method, path, body, { ...headers, Origin: 'https://other.test' })).status, 403);
  const uploaded = await request('POST', '/api/project-documents', pdf(MAX_DOCUMENT_BYTES), headers); assert.equal(uploaded.status, 201, await uploaded.clone().text());
  const doc = await uploaded.json() as ProjectDocument; assert.equal(doc.sizeBytes, MAX_DOCUMENT_BYTES); assert.equal(doc.authorName, admin.name);
  assert.equal((await request('POST', '/api/comments', { projectId: 'project-nova', body: 'x'.repeat(110000) }, headers)).status, 413);
  assert.equal((await request('POST', '/api/project-documents', { ...pdf(), contentBase64: 'a'.repeat(790000) }, headers)).status, 413);
  const commentResponse = await request('POST', '/api/comments', { projectId: 'project-nova', body: 'Projet', mentionResourceIds: ['resource-lucas'] }, headers);
  assert.equal(commentResponse.status, 201); const comment = await commentResponse.json() as Comment; assert.equal(comment.authorId, actor.id); assert.equal(comment.authorName, admin.name);
  assert.equal((await request('POST', '/api/auth/logout', {}, headers)).status, 204); assert.equal((await request('DELETE', `/api/project-documents/${doc.id}`, undefined, headers)).status, 401);
});

test('actual Worker/D1 upgrades absent documents on first write only, enforces quotas atomically and preserves collaboration after restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'planzone8-collaboration-d1-'));
  const bundled = await build({ entryPoints: [resolve('cloudflare/worker.ts')], write: false, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent' });
  const databaseId = randomUUID(), workspaceId = randomUUID();
  const runtime = () => new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-10-06', host: '127.0.0.1', port: 0, cf: false,
    log: new Log(LogLevel.ERROR), resourcePersistencePath: directory, d1Databases: { DB: databaseId }, bindings: { DEMO_TODAY: '2026-10-12', PLANZONE_DATA_KEYS: TEST_DATA_KEYS },
    serviceBindings: { ASSETS: () => new MiniflareResponse('Collaboration fixture') },
  }));
  let instance = runtime(); t.after(async () => { await instance.dispose(); await rm(directory, { recursive: true, force: true }); }); await instance.ready;
  const db = () => instance.getD1Database('DB'); await new AuthManager(new D1AuthDatabase(await db() as unknown as D1Database)).createAdmin({ ...admin, workspaceId });
  const request = (method: string, path: string, body?: unknown, cookie?: string, headers: Record<string, string> = {}) => instance.dispatchFetch(`https://planzone8.test${path}`, {
    method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal((await request('POST', '/api/project-documents', link)).status, 401);
  const login = await request('POST', '/api/auth/login', { username: admin.username, password: admin.password }); assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';', 1)[0]!; await request('GET', '/api/state', undefined, cookie);
  const initial = new MemoryStore(); seed(initial); const { projectDocuments: _docs, ...legacy } = initial.snapshot();
  legacy.projects[0].description = 'Valeur préexistante conservée'; await (await db()).prepare('UPDATE demo_workspaces SET data = ? WHERE id = ?').bind(await encryptWorkspace(JSON.stringify(legacy), workspaceId, TEST_KEYS), workspaceId).run();
  const row = async () => { const result = await (await db()).prepare('SELECT data, revision FROM demo_workspaces WHERE id = ?').bind(workspaceId).first<{ data: string; revision: number }>(); assert.ok(result); return plaintextRow(result, workspaceId); };
  const before = await row(); const oldState = await (await request('GET', '/api/state', undefined, cookie)).json() as AppData;
  assert.deepEqual(oldState.projectDocuments, []); assert.deepEqual(await row(), before);
  assert.equal((await request('POST', '/api/project-documents', link, cookie, { Origin: 'https://other.test' })).status, 403);
  assert.equal((await request('POST', '/api/comments', { projectId: 'project-nova', body: 'Forgé', authorId: 'resource-lucas' }, cookie)).status, 400);
  assert.deepEqual(await row(), before);
  const uploadResponse = await request('POST', '/api/project-documents', pdf(MAX_DOCUMENT_BYTES), cookie); assert.equal(uploadResponse.status, 201, await uploadResponse.clone().text());
  const uploaded = await uploadResponse.json() as ProjectDocument; assert.equal(uploaded.authorId, actor.id); assert.equal(uploaded.authorName, admin.name);
  const firstRow = await row(); assert.equal(firstRow.revision, before.revision + 1);
  const savedSnapshot = JSON.parse(firstRow.data) as WorkspaceSnapshot;
  for (const table of TABLES.filter(table => table !== 'projectDocuments')) assert.deepEqual(savedSnapshot[table], legacy[table]);
  assert.equal((await request('POST', '/api/project-documents', pdf(MAX_DOCUMENT_BYTES), cookie)).status, 201);
  const quotaRow = await row(); assert.equal((await request('POST', '/api/project-documents', pdf(MAX_DOCUMENT_BYTES), cookie)).status, 413); assert.deepEqual(await row(), quotaRow);
  assert.equal((await request('PATCH', '/api/project-documents/' + uploaded.id, { projectId: 'project-mobile' }, cookie)).status, 400); assert.deepEqual(await row(), quotaRow);
  assert.equal((await request('POST', '/api/comments', { projectId: 'project-nova', taskId: 'task-ateliers', body: 'Décision partagée', mentionResourceIds: ['resource-lucas'] }, cookie)).status, 201);
  const persisted = await (await request('GET', '/api/state', undefined, cookie)).json() as AppData; const persistedRow = await row();
  await instance.dispose(); instance = runtime(); await instance.ready;
  assert.deepEqual(await (await request('GET', '/api/state', undefined, cookie)).json(), persisted); assert.deepEqual(await row(), persistedRow);
  assert.equal((await request('PATCH', '/api/projects/project-nova', { status: 'closed' }, cookie)).status, 200); const locked = await row();
  assert.equal((await request('DELETE', `/api/project-documents/${uploaded.id}`, undefined, cookie)).status, 409); assert.deepEqual(await row(), locked);
  assert.equal((await request('POST', '/api/auth/logout', {}, cookie)).status, 204); assert.equal((await request('POST', '/api/comments', { projectId: 'project-nova', body: 'Interdit' }, cookie)).status, 401);
});
