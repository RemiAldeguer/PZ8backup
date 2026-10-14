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
import type { AppData, Project, ProjectReport } from '../shared/types.ts';
import type { ProjectStatusDefinition, ReportTemplate } from '../shared/customization.ts';

const admin = { username: 'admin', password: 'Project-report-test-administrator-2026!', name: 'Administrateur projet' };
const actor = { id: 'resource-claire', name: admin.name, role: 'Administrateur' as const };
const input = {
  projectId: 'project-nova', templateId: null, templateName: '', title: 'Compte rendu du lancement', reportDate: '2026-10-12',
  indicators: [{ id: 'quality', label: 'Qualité', rating: 4 }],
  fields: [
    { id: 'highlights', label: 'Faits marquants', type: 'text', value: 'Livraison achevée.\nProchaine étape : recette.' },
    { id: 'amount', label: 'Montant', type: 'number', value: '1250.75' },
    { id: 'date', label: 'Livraison', type: 'date', value: '2026-10-11' },
    { id: 'link', label: 'Documents', type: 'url', value: 'https://example.test/recette?version=2' },
    { id: 'empty', label: 'À préciser', type: 'number', value: '' },
  ],
};
const templateInput = {
  name: 'Réunion projet', titlePattern: 'Compte rendu du {date}',
  indicators: [{ id: 'quality', label: 'Qualité' }], fields: [{ id: 'highlights', label: 'Faits marquants', type: 'text' }],
};
const previousTables = TABLES.filter(table => table !== 'projectReports');
const previousSnapshot = (store: StoreLike) => Object.fromEntries(previousTables.map(table => [table, store.all(table)]));
function rejectsStatus(status: number, operation: () => unknown) {
  assert.throws(operation, error => error instanceof ApiError && error.status === status);
}

for (const backend of ['sqlite', 'memory'] as const) {
  const fixture = () => {
    const store = backend === 'sqlite' ? new Store(':memory:') : new MemoryStore(); seed(store);
    return { store, api: new ApiService(store, actor), close: () => { if (store instanceof Store) store.close(); } };
  };
  test(`${backend}: project reports preserve typed values, project scope and server-owned author history`, () => {
    const { store, api, close } = fixture();
    try {
      const before = api.readState('2026-10-12');
      const created = api.mutate('project-reports', 'POST', { ...input, title: ` ${input.title} ` });
      assert.equal(created.status, 201);
      const report = created.value as ProjectReport;
      assert.equal(report.title, input.title); assert.equal(report.authorName, admin.name);
      assert.deepEqual(report.fields, input.fields); assert.equal(report.createdAt, report.updatedAt);
      assert.match(report.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      const revised = new ApiService(store, { ...actor, name: 'Autre administrateur' }).mutate('project-reports', 'PATCH', {
        title: 'Compte rendu corrigé', indicators: [{ id: 'quality', label: 'Qualité', rating: 5 }],
        fields: [{ id: 'amount', label: 'Montant', type: 'number', value: '-1.5e2' }],
      }, report.id).value as ProjectReport;
      assert.equal(revised.authorName, admin.name); assert.equal(revised.createdAt, report.createdAt);
      assert.ok(revised.updatedAt >= revised.createdAt); assert.equal(revised.fields[0].value, '-1.5e2');
      const other = api.mutate('project-reports', 'POST', { ...input, projectId: 'project-mobile', title: 'Autre projet' }).value as ProjectReport;
      assert.deepEqual(api.readState('2026-10-12'), { ...before, projectReports: [revised, other] });
      if (store instanceof MemoryStore) assert.deepEqual(new ApiService(new MemoryStore(store.snapshot()), actor).readState('2026-10-12'), api.readState('2026-10-12'));
      assert.equal(api.mutate('project-reports', 'DELETE', undefined, report.id).status, 204);
      assert.deepEqual(api.readState('2026-10-12').projectReports, [other]);
      api.mutate('project-reports', 'DELETE', undefined, other.id);
      assert.deepEqual(api.readState('2026-10-12'), before);
    } finally { close(); }
  });
  test(`${backend}: strict report payloads reject metadata forgery, malformed values, duplicate IDs and excessive records atomically`, () => {
    const { api, close } = fixture();
    try {
      const before = api.readState('2026-10-12');
      const badFields = [
        { type: 'date', value: '2026-02-29' }, { type: 'number', value: 'Infinity' },
        { type: 'number', value: '1,5' }, { type: 'number', value: '0x10' }, { type: 'number', value: '1e999' },
        { type: 'url', value: 'javascript:alert(1)' }, { type: 'url', value: 'data:text/html,x' }, { type: 'url', value: 'not-a-link' },
        { type: 'unknown', value: 'anything' }, { type: 'text', value: 'a'.repeat(20001) }, { type: 'text', value: 15 },
      ];
      for (const bad of badFields) rejectsStatus(400, () => api.mutate('project-reports', 'POST', { ...input, fields: [{ id: 'field', label: 'Champ', ...bad }] }));
      for (const patch of [
        { title: ' ' }, { title: 'a'.repeat(501) }, { reportDate: '2026-13-01' }, { reportDate: '12/10/2026' },
        { id: 'forged' }, { authorName: 'Faux auteur' }, { createdAt: '2020-01-01T00:00:00.000Z' }, { updatedAt: '2020-01-01T00:00:00.000Z' },
        { unknown: true }, { templateName: 'a'.repeat(201) }, { templateId: '' },
        { indicators: [{ id: 'quality', label: 'Qualité', rating: 0 }] }, { indicators: [{ id: 'quality', label: 'Qualité', rating: 6 }] },
        { indicators: [{ id: 'quality', label: 'Qualité', rating: 2.5 }] }, { indicators: [{ id: 'quality', label: 'Qualité', rating: '3' }] },
        { indicators: Array.from({ length: 6 }, (_, i) => ({ id: String(i), label: 'Indicateur', rating: 3 })) },
        { indicators: [input.indicators[0], input.indicators[0]] }, { fields: [input.fields[0], input.fields[0]] },
        { fields: Array.from({ length: 26 }, (_, i) => ({ id: String(i), label: 'Champ', type: 'text', value: '' })) },
        { fields: [{ id: 'a'.repeat(101), label: 'Champ', type: 'text', value: '' }] },
      ]) rejectsStatus(400, () => api.mutate('project-reports', 'POST', { ...input, ...patch }));
      rejectsStatus(404, () => api.mutate('project-reports', 'POST', { ...input, projectId: 'missing' }));
      rejectsStatus(404, () => api.mutate('project-reports', 'POST', { ...input, templateId: 'missing' }));
      assert.deepEqual(api.readState('2026-10-12'), before);
      const report = api.mutate('project-reports', 'POST', input).value as ProjectReport;
      for (const patch of [{}, { projectId: 'project-mobile' }, { authorName: 'Faux auteur' }, { createdAt: report.createdAt }, { updatedAt: report.updatedAt }, { id: report.id }, { templateId: 'missing' }]) {
        rejectsStatus(Object.hasOwn(patch, 'templateId') ? 404 : 400, () => api.mutate('project-reports', 'PATCH', patch, report.id));
      }
      rejectsStatus(404, () => api.mutate('project-reports', 'PATCH', { title: 'Absent' }, 'missing'));
      rejectsStatus(404, () => api.mutate('project-reports', 'DELETE', undefined, 'missing'));
      assert.deepEqual(api.readState('2026-10-12'), { ...before, projectReports: [report] });
    } finally { close(); }
  });
  test(`${backend}: report writes canonicalize typed whitespace while preserving text formatting and blank fields`, () => {
    const { store, api, close } = fixture();
    try {
      const text = '  Faits marquants\nDeuxième ligne.  \n';
      const fields = [
        { id: 'text', label: '  Faits marquants  ', type: 'text', value: text },
        { id: 'date', label: 'Date', type: 'date', value: '  2026-10-12 \n' },
        { id: 'number', label: 'Montant', type: 'number', value: ' 1250.75 ' },
        { id: 'url', label: 'Lien', type: 'url', value: '  https://example.test/report \n' },
        { id: 'empty-date', label: 'Date à préciser', type: 'date', value: '   \n' },
        { id: 'empty-number', label: 'Montant à préciser', type: 'number', value: '   ' },
        { id: 'empty-url', label: 'Lien à préciser', type: 'url', value: '\n\t' },
      ];
      const report = api.mutate('project-reports', 'POST', { ...input, fields }).value as ProjectReport;
      const expected = fields.map(field => ({ ...field, label: field.label.trim(), value: field.type === 'text' ? field.value : field.value.trim() }));
      assert.deepEqual(report.fields, expected);
      assert.deepEqual(store.get('projectReports', report.id)?.fields, expected, 'Canonical values must be persisted, not only returned.');
      const updated = api.mutate('project-reports', 'PATCH', { fields: [
        { id: 'text', label: 'Texte', type: 'text', value: text },
        { id: 'date', label: 'Date', type: 'date', value: ' 2026-10-13 ' },
        { id: 'empty', label: 'Vide', type: 'date', value: '   ' },
      ] }, report.id).value as ProjectReport;
      assert.equal(updated.fields[0].value, text); assert.equal(updated.fields[1].value, '2026-10-13'); assert.equal(updated.fields[2].value, '');
      assert.deepEqual(store.get('projectReports', report.id), updated);
      if (store instanceof MemoryStore) assert.deepEqual(new MemoryStore(store.snapshot()).get('projectReports', report.id), updated);
      rejectsStatus(400, () => api.mutate('project-reports', 'PATCH', { fields: [{ id: 'date', label: '  ', type: 'date', value: '2026-10-13' }] }, report.id));
      rejectsStatus(400, () => api.mutate('project-reports', 'PATCH', { fields: [{ id: 'date', label: 'Date', type: 'date', value: ' 2026-02-30 ' }] }, report.id));
      assert.deepEqual(store.get('projectReports', report.id), updated);
    } finally { close(); }
  });
  test(`${backend}: saved report snapshots survive template editing and deletion but new references must exist`, () => {
    const { api, close } = fixture();
    try {
      const template = api.mutate('report-templates', 'POST', templateInput).value as ReportTemplate;
      const report = api.mutate('project-reports', 'POST', { ...input, templateId: template.id, templateName: template.name }).value as ProjectReport;
      api.mutate('report-templates', 'PATCH', { name: 'Nouveau nom', indicators: [], fields: [] }, template.id);
      assert.deepEqual(api.readState().projectReports, [report]);
      api.mutate('report-templates', 'DELETE', undefined, template.id);
      assert.deepEqual(api.readState().projectReports, [report]);
      const updated = api.mutate('project-reports', 'PATCH', { title: 'Corrigé après suppression', templateId: template.id }, report.id).value as ProjectReport;
      assert.equal(updated.templateName, template.name); assert.deepEqual(updated.fields, report.fields);
      rejectsStatus(404, () => api.mutate('project-reports', 'POST', { ...input, templateId: template.id }));
      api.mutate('project-reports', 'PATCH', { templateId: null }, report.id);
      rejectsStatus(404, () => api.mutate('project-reports', 'PATCH', { templateId: template.id }, report.id));
    } finally { close(); }
  });
  test(`${backend}: paused, closed and custom closed workflows lock reports; report history prevents deleting a project`, () => {
    const { api, close } = fixture();
    try {
      const project = api.mutate('projects', 'POST', { name: 'Projet suivi', zoneId: 'zone-transformation', startDate: '2026-10-12', endDate: '2026-10-31' }).value as Project;
      const report = api.mutate('project-reports', 'POST', { ...input, projectId: project.id }).value as ProjectReport;
      rejectsStatus(409, () => api.mutate('projects', 'DELETE', undefined, project.id));
      for (const status of ['paused', 'closed'] as const) {
        api.mutate('projects', 'PATCH', { status }, project.id);
        const before = api.readState('2026-10-12');
        rejectsStatus(409, () => api.mutate('project-reports', 'POST', { ...input, projectId: project.id }));
        rejectsStatus(409, () => api.mutate('project-reports', 'PATCH', { title: 'Verrouillé' }, report.id));
        rejectsStatus(409, () => api.mutate('project-reports', 'DELETE', undefined, report.id));
        assert.deepEqual(api.readState('2026-10-12'), before);
        assert.equal((api.mutate('projects', 'PATCH', { budget: 1234.56 }, project.id).value as Project).budget, 1234.56, 'Project settings remain editable.');
      }
      const custom = api.mutate('project-status-definitions', 'POST', { name: 'Archivé', color: '#333333', baseStatus: 'closed' }).value as ProjectStatusDefinition;
      api.mutate('projects', 'PATCH', { customStatusId: custom.id }, project.id);
      rejectsStatus(409, () => api.mutate('project-reports', 'PATCH', { title: 'Verrouillé' }, report.id));
      api.mutate('projects', 'PATCH', { status: 'open' }, project.id);
      api.mutate('project-reports', 'DELETE', undefined, report.id);
      assert.equal(api.mutate('projects', 'DELETE', undefined, project.id).status, 204);
    } finally { close(); }
  });
}

test('MemoryStore defaults only absent report history and rejects malformed saved records', () => {
  const initial = new MemoryStore(); seed(initial);
  const { projectReports: _reports, ...legacy } = initial.snapshot();
  const before = structuredClone(legacy);
  assert.deepEqual(new MemoryStore(legacy).snapshot(), { ...before, projectReports: [] });
  assert.deepEqual(legacy, before);
  for (const value of [null, undefined, {}, [null], [{}], [{ ...input, id: 'report' }]]) {
    assert.throws(() => new MemoryStore({ ...legacy, projectReports: value } as unknown as CompatibleWorkspaceSnapshot));
  }
  const report = new ApiService(initial, actor).mutate('project-reports', 'POST', input).value as ProjectReport;
  const legacyReport = { ...report, fields: [
    { id: 'date', label: 'Date', type: 'date' as const, value: ' 2026-10-12 ' },
    { id: 'empty-date', label: 'Date vide', type: 'date' as const, value: '   ' },
  ] };
  const legacyWithReport = { ...legacy, projectReports: [legacyReport] };
  assert.deepEqual(new MemoryStore(legacyWithReport).snapshot(), legacyWithReport, 'Reading legacy report values must not normalize or rewrite stored history.');
  for (const patch of [{ fields: undefined }, { indicators: undefined }, { reportDate: '2026-02-30' }, { authorName: null }, { createdAt: 'yesterday' }, { fields: [{ id: 'url', label: 'URL', type: 'url', value: 'file:///etc/passwd' }] }]) {
    assert.throws(() => new MemoryStore({ ...legacy, projectReports: [{ ...report, ...patch }] } as unknown as CompatibleWorkspaceSnapshot));
  }
});

test('SQLite adds report storage with a project foreign key, persists after restart and preserves all sixteen previous collections', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'planzone8-project-reports-sql-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'workspace.sqlite');
  let store = new Store(path); seed(store); const before = previousSnapshot(store);
  store.db.exec('DROP TABLE projectReports'); store.close(); store = new Store(path);
  try {
    const api = new ApiService(store, actor);
    const report = api.mutate('project-reports', 'POST', { ...input, fields: input.fields.map(field => ({ ...field, value: field.type === 'text' ? field.value : ` ${field.value} ` })) }).value as ProjectReport;
    assert.deepEqual(report.fields, input.fields, 'SQLite must persist canonical typed values.');
    assert.throws(() => store.put('projectReports', { ...report, id: 'orphan', projectId: 'missing' }), /FOREIGN KEY/);
    assert.throws(() => store.remove('projects', report.projectId), /FOREIGN KEY/);
    const saved = api.readState('2026-10-12'); store.close(); store = new Store(path);
    assert.deepEqual(new ApiService(store, actor).readState('2026-10-12'), saved);
    assert.deepEqual(previousSnapshot(store), before);
  } finally { store.close(); }
});

test('project report HTTP endpoints require sessions, enforce same origin and preserve author metadata after restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'planzone8-project-reports-http-')); const path = join(directory, 'workspace.sqlite');
  let instance = createApp({ dbPath: path, today: '2026-10-12', admin }); await instance.ready;
  let server = instance.app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = () => { const address = server.address(); assert.ok(address && typeof address !== 'string'); return `http://127.0.0.1:${address.port}`; };
  const stop = async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); instance.close(); };
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  const request = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => fetch(`${origin()}${path}`, {
    method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const mutations = [['POST', '/api/project-reports', input], ['PATCH', '/api/project-reports/missing', { title: 'Changed' }], ['DELETE', '/api/project-reports/missing', undefined]] as const;
  for (const [method, path, body] of mutations) {
    assert.equal((await request(method, path, body)).status, 401);
    assert.equal((await request(method, path, body, { Cookie: 'planzone8-session-local=forged' })).status, 401);
  }
  const login = await request('POST', '/api/auth/login', { username: admin.username, password: admin.password }); assert.equal(login.status, 200);
  const headers = { Cookie: login.headers.get('set-cookie')!.split(';', 1)[0]! };
  const before = await (await request('GET', '/api/state', undefined, headers)).json() as AppData;
  for (const [method, path, body] of mutations) {
    assert.equal((await request(method, path, body, { ...headers, Origin: 'https://untrusted.example' })).status, 403);
    assert.equal((await request(method, path, body, { ...headers, 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  }
  for (const metadata of ['authorName', 'createdAt', 'updatedAt']) assert.equal((await request('POST', '/api/project-reports', { ...input, [metadata]: 'forged' }, headers)).status, 400);
  assert.deepEqual(await (await request('GET', '/api/state', undefined, headers)).json(), before);
  const created = await request('POST', '/api/project-reports', input, { ...headers, Origin: origin() }); assert.equal(created.status, 201);
  const report = await created.json() as ProjectReport; assert.equal(report.authorName, admin.name);
  assert.equal((await request('PATCH', `/api/project-reports/${report.id}`, { projectId: 'project-mobile' }, headers)).status, 400);
  const updatedResponse = await request('PATCH', `/api/project-reports/${report.id}`, { title: 'Après relecture' }, headers); assert.equal(updatedResponse.status, 200);
  const updated = await updatedResponse.json() as ProjectReport;
  await stop(); instance = createApp({ dbPath: path, today: '2026-10-12' }); await instance.ready;
  server = instance.app.listen(0, '127.0.0.1'); await once(server, 'listening');
  assert.deepEqual(await (await request('GET', '/api/state', undefined, headers)).json(), { ...before, projectReports: [updated] });
  assert.equal((await request('DELETE', `/api/project-reports/${report.id}`, undefined, headers)).status, 204);
  assert.equal((await request('POST', '/api/auth/logout', {}, headers)).status, 204);
  assert.equal((await request('POST', '/api/project-reports', input, headers)).status, 401);
});

test('actual Worker/D1 upgrades absent report history only on write, preserves template snapshots and every original collection after restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'planzone8-project-reports-d1-'));
  const bundled = await build({ entryPoints: [resolve('cloudflare/worker.ts')], write: false, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent' });
  const databaseId = randomUUID(), workspaceId = randomUUID();
  const runtime = () => new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-10-06', host: '127.0.0.1', port: 0, cf: false,
    log: new Log(LogLevel.ERROR), resourcePersistencePath: directory, d1Databases: { DB: databaseId }, bindings: { DEMO_TODAY: '2026-10-12' },
    serviceBindings: { ASSETS: () => new MiniflareResponse('Project report fixture') },
  }));
  let instance = runtime(); t.after(async () => { await instance.dispose(); await rm(directory, { recursive: true, force: true }); }); await instance.ready;
  const db = () => instance.getD1Database('DB');
  await new AuthManager(new D1AuthDatabase(await db() as unknown as D1Database)).createAdmin({ ...admin, workspaceId });
  const request = (method: string, path: string, body?: unknown, cookie?: string, headers: Record<string, string> = {}) => instance.dispatchFetch(`https://planzone8.test${path}`, {
    method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal((await request('POST', '/api/project-reports', input)).status, 401);
  const login = await request('POST', '/api/auth/login', { username: admin.username, password: admin.password }); assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';', 1)[0]!;
  assert.equal((await request('GET', '/api/state', undefined, cookie)).status, 200);
  const row = async () => {
    const result = await (await db()).prepare('SELECT data, revision FROM demo_workspaces WHERE id = ?').bind(workspaceId).first<{ data: string; revision: number }>();
    assert.ok(result); return result;
  };
  const initial = new MemoryStore(); seed(initial); const setup = new ApiService(initial, actor);
  const template = setup.mutate('report-templates', 'POST', templateInput).value as ReportTemplate;
  setup.mutate('project-templates', 'POST', { name: 'Modèle préexistant' });
  setup.mutate('custom-field-definitions', 'POST', { name: 'Champ préexistant', scope: 'project', type: 'text' });
  setup.mutate('project-status-definitions', 'POST', { name: 'Statut préexistant' });
  setup.mutate('strategic-axes', 'POST', { code: 'AXE', name: 'Axe préexistant', weight: 2, scale: ['-2', '-1', '0', '1', '2'] });
  setup.mutate('revenues', 'POST', { projectId: input.projectId, label: 'Recette préexistante', amount: 125.75, plannedDate: input.reportDate });
  setup.mutate('calendar-events', 'POST', { title: 'Événement préexistant', projectId: input.projectId, startDate: input.reportDate, endDate: input.reportDate });
  setup.mutate('unavailabilities', 'POST', { title: 'Absence préexistante', resourceId: 'resource-claire', startDate: input.reportDate, endDate: input.reportDate });
  const { projectReports: _reports, ...legacy } = initial.snapshot();
  legacy.projects[0].description = 'Description préexistante personnalisée'; legacy.tasks[0].description = 'Tâche préexistante personnalisée';
  await (await db()).prepare('UPDATE demo_workspaces SET data = ? WHERE id = ?').bind(JSON.stringify(legacy), workspaceId).run();
  const savedLegacy = await row();
  const before = await (await request('GET', '/api/state', undefined, cookie)).json() as AppData;
  assert.deepEqual(before.projectReports, []); assert.deepEqual(await row(), savedLegacy, 'Read must not write defaults or increment revision.');
  for (const [method, path, body] of [['POST', '/api/project-reports', input], ['PATCH', '/api/project-reports/missing', { title: 'Changed' }], ['DELETE', '/api/project-reports/missing', undefined]] as const) {
    assert.equal((await request(method, path, body, cookie, { Origin: 'https://untrusted.example' })).status, 403);
    assert.equal((await request(method, path, body, cookie, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  }
  assert.equal((await request('POST', '/api/project-reports', { ...input, authorName: 'Forged' }, cookie)).status, 400);
  assert.deepEqual(await row(), savedLegacy);
  const created = await request('POST', '/api/project-reports', { ...input, templateId: template.id, templateName: template.name,
    fields: input.fields.map(field => ({ ...field, value: field.type === 'text' ? field.value : ` ${field.value} ` })),
  }, cookie); assert.equal(created.status, 201, await created.clone().text());
  const report = await created.json() as ProjectReport; assert.equal(report.authorName, admin.name);
  assert.deepEqual(report.fields, input.fields, 'D1 must persist canonical typed values.');
  const createdRow = await row(); assert.equal(createdRow.revision, savedLegacy.revision + 1);
  const createdSnapshot = JSON.parse(createdRow.data) as WorkspaceSnapshot;
  for (const table of previousTables) assert.deepEqual(createdSnapshot[table], legacy[table], `${table} must remain unchanged.`);
  assert.deepEqual(createdSnapshot.projectReports, [report]);
  assert.equal((await request('PATCH', `/api/project-reports/${report.id}`, { projectId: 'project-mobile' }, cookie)).status, 400);
  assert.deepEqual(await row(), createdRow);
  assert.equal((await request('PATCH', `/api/projects/${report.projectId}`, { status: 'closed' }, cookie)).status, 200);
  const locked = await row();
  for (const [method, path, body] of [['POST', '/api/project-reports', input], ['PATCH', `/api/project-reports/${report.id}`, { title: 'Changed' }], ['DELETE', `/api/project-reports/${report.id}`, undefined]] as const) {
    assert.equal((await request(method, path, body, cookie)).status, 409);
  }
  assert.deepEqual(await row(), locked);
  assert.equal((await request('PATCH', `/api/projects/${report.projectId}`, { status: 'open' }, cookie)).status, 200);
  assert.equal((await request('PATCH', `/api/report-templates/${template.id}`, { name: 'Modèle modifié', fields: [] }, cookie)).status, 200);
  assert.deepEqual((await (await request('GET', '/api/state', undefined, cookie)).json() as AppData).projectReports, [report]);
  assert.equal((await request('DELETE', `/api/report-templates/${template.id}`, undefined, cookie)).status, 204);
  const updatedResponse = await request('PATCH', `/api/project-reports/${report.id}`, { title: 'Rapport corrigé', templateId: template.id }, cookie); assert.equal(updatedResponse.status, 200);
  const updated = await updatedResponse.json() as ProjectReport;
  assert.equal(updated.templateName, template.name); assert.deepEqual(updated.fields, input.fields); assert.equal(updated.createdAt, report.createdAt);
  const saved = await row(); const state = await (await request('GET', '/api/state', undefined, cookie)).json();
  await instance.dispose(); instance = runtime(); await instance.ready;
  assert.deepEqual(await (await request('GET', '/api/state', undefined, cookie)).json(), state); assert.deepEqual(await row(), saved);
  assert.equal((await request('POST', '/api/project-reports', { ...input, templateId: template.id }, cookie)).status, 404);
  assert.equal((await request('DELETE', `/api/project-reports/${report.id}`, undefined, cookie)).status, 204);
  assert.equal((await request('POST', '/api/auth/logout', {}, cookie)).status, 204);
  assert.equal((await request('GET', '/api/state', undefined, cookie)).status, 401);
});
