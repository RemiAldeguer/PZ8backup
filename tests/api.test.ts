import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createApp } from '../server/app.ts';
import type { AppData, Task, TimeEntry } from '../shared/types.ts';

type JsonRecord = Record<string, unknown>;
const testAdmin = { username: 'admin', password: 'Planzone8-Test-Admin!2026', name: 'Administrateur' };

async function fixture(t: TestContext, provisionAdmin = true) {
  const directory = await mkdtemp(join(tmpdir(), 'planzone8-api-'));
  const dbPath = join(directory, 'test.sqlite');
  let instance = createApp({ dbPath, today: '2026-10-06', ...(provisionAdmin ? { admin: testAdmin } : {}) });
  let server: Server;
  let baseUrl: string;
  let cookie = '';

  async function listen() {
    await instance.ready;
    server = instance.app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    baseUrl = `http://127.0.0.1:${address.port}`;
  }

  async function stop() {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    instance.close();
  }

  await listen();
  t.after(async () => {
    await stop();
    await rm(directory, { recursive: true, force: true });
  });

  async function request(method: string, path: string, body?: JsonRecord, headers?: Record<string, string>) {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }

  async function rawRequest(method: string, path: string, body?: JsonRecord, headers?: Record<string, string>) {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }

  async function login(password = testAdmin.password) {
    const response = await rawRequest('POST', '/api/auth/login', { username: testAdmin.username, password });
    assert.equal(response.status, 200, await response.text());
    cookie = response.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
    assert.ok(cookie);
    return cookie;
  }

  if (provisionAdmin) await login();

  async function state(): Promise<AppData> {
    const response = await request('GET', '/api/state');
    assert.equal(response.status, 200);
    return response.json() as Promise<AppData>;
  }

  async function succeeds(method: string, path: string, body?: JsonRecord) {
    const response = await request(method, path, body);
    assert.ok(response.ok, `${method} ${path}: ${response.status} ${await response.text()}`);
  }

  async function project(name = 'Projet de test') {
    const zoneId = (await state()).zones[0]!.id;
    await succeeds('POST', '/api/projects', {
      name, zoneId, description: '', startDate: '2026-10-01', endDate: '2026-12-31',
      status: 'open', weather: 4, budget: 10000, color: '#2563eb',
    });
    const result = (await state()).projects.find(item => item.name === name);
    assert.ok(result);
    return result;
  }

  async function task(title = 'Tâche de test', attributes: JsonRecord = {}): Promise<Task> {
    await succeeds('POST', '/api/tasks', { projectId: 'project-nova', title, ...attributes });
    const result = (await state()).tasks.find(item => item.title === title);
    assert.ok(result);
    return result;
  }

  async function entry(taskId: string, attributes: JsonRecord = {}): Promise<TimeEntry> {
    const before = new Set((await state()).timeEntries.map(item => item.id));
    await succeeds('POST', '/api/time-entries', {
      taskId, resourceId: 'resource-claire', date: '2026-10-06', hours: 2, ...attributes,
    });
    const result = (await state()).timeEntries.find(item => !before.has(item.id));
    assert.ok(result);
    return result;
  }

  async function restart() {
    await stop();
    instance = createApp({ dbPath, today: '2026-10-06' });
    await listen();
  }

  return { request, rawRequest, login, state, succeeds, project, task, entry, restart, get cookie() { return cookie; } };
}

test('the API exposes the seeded workspace and health endpoint', async t => {
  const api = await fixture(t);
  const health = await api.request('GET', '/api/health');
  assert.equal(health.status, 200);
  const data = await api.state();
  assert.equal(data.today, '2026-10-06');
  assert.ok(data.projects.some(item => item.id === 'project-nova'));
  assert.ok(data.resources.some(item => item.id === 'resource-claire'));
  assert.ok(data.profiles.some(item => item.id === 'profile-pilot'));
  assert.equal(data.tasks.find(item => item.id === 'task-cadrage')?.status, 'done');
  assert.equal(data.tasks.find(item => item.id === 'task-ateliers')?.status, 'in_progress');
  assert.equal(data.tasks.find(item => item.id === 'task-portail')?.status, 'todo');
  assert.equal(data.currentUser.role, 'Administrateur');
});

test('project, resource and task mutations survive an API restart without reseeding', async t => {
  const api = await fixture(t);
  const project = await api.project('Projet persistant');
  await api.succeeds('POST', '/api/resources', { name: 'Ressource persistante' });
  const resource = (await api.state()).resources.find(item => item.name === 'Ressource persistante')!;
  assert.ok(resource.id);
  await api.succeeds('PATCH', `/api/resources/${resource.id}`, { jobTitle: 'Designer' });
  const task = await api.task('Tâche persistante', { projectId: project.id, assigneeId: resource.id });
  await api.succeeds('PATCH', `/api/tasks/${task.id}`, { description: 'Conservée dans SQLite' });
  const before = await api.state();
  await api.restart();
  const after = await api.state();
  assert.deepEqual(after.projects, before.projects);
  assert.deepEqual(after.resources, before.resources);
  assert.deepEqual(after.tasks, before.tasks);
});

test('task defaults, completion and milestone allocation preserve domain invariants', async t => {
  const api = await fixture(t);
  const task = await api.task();
  assert.equal(task.status, 'todo');
  assert.equal(task.progress, 0);
  assert.equal(task.allocatedHours, 0);
  await api.succeeds('PATCH', `/api/tasks/${task.id}`, { status: 'done' });
  assert.equal((await api.state()).tasks.find(item => item.id === task.id)?.progress, 100);

  const invalid = await api.request('POST', '/api/tasks', {
    projectId: 'project-nova', title: 'Jalon chargé', kind: 'milestone', allocatedHours: 8,
  });
  assert.equal(invalid.status, 400);
  const milestone = await api.task('Jalon valide', { kind: 'milestone', allocatedHours: 0 });
  assert.equal(milestone.kind, 'milestone');
  assert.equal((await api.request('PATCH', `/api/tasks/${milestone.id}`, { allocatedHours: 1 })).status, 400);
});

test('invalid dates, reversed periods and out-of-range progress do not mutate tasks', async t => {
  const api = await fixture(t);
  const task = await api.task('Validation des données');
  for (const payload of [
    { startDate: '2026-02-30' }, { endDate: '2026-13-01' }, { startDate: '06/10/2026' },
    { startDate: '2026-11-01', endDate: '2026-10-01' }, { progress: -1 }, { progress: 101 },
    { allocatedHours: -2 },
  ]) {
    const response = await api.request('PATCH', `/api/tasks/${task.id}`, payload);
    assert.equal(response.status, 400, JSON.stringify(payload));
  }
  assert.deepEqual((await api.state()).tasks.find(item => item.id === task.id), task);
  assert.equal((await api.request('POST', '/api/time-entries', {
    taskId: task.id, resourceId: 'resource-claire', date: '2026-02-30', hours: 1,
  })).status, 400);
});

test('unknown foreign keys are rejected instead of creating orphan records', async t => {
  const api = await fixture(t);
  for (const [path, payload] of [
    ['/api/tasks', { projectId: 'missing-project', title: 'Orpheline' }],
    ['/api/tasks', { projectId: 'project-nova', title: 'Inconnue', assigneeId: 'missing-resource' }],
    ['/api/time-entries', { taskId: 'missing-task', resourceId: 'resource-claire', date: '2026-10-06', hours: 1 }],
    ['/api/comments', { taskId: 'missing-task', body: 'Orphelin' }],
  ] as const) {
    const response = await api.request('POST', path, payload);
    assert.ok([400, 404].includes(response.status), `${path}: ${response.status}`);
  }
  assert.ok(!(await api.state()).tasks.some(item => item.title === 'Orpheline'));
});

test('dependencies reject cycles and block starting until the predecessor is complete', async t => {
  const api = await fixture(t);
  const predecessor = await api.task('Prédécesseur');
  const successor = await api.task('Successeur', { dependsOnId: predecessor.id });
  assert.equal((await api.request('PATCH', `/api/tasks/${predecessor.id}`, { dependsOnId: successor.id })).status, 409);
  assert.equal((await api.request('PATCH', `/api/tasks/${successor.id}`, { dependsOnId: successor.id })).status, 409);
  assert.equal((await api.request('PATCH', `/api/tasks/${successor.id}`, { status: 'in_progress' })).status, 409);
  await api.succeeds('PATCH', `/api/tasks/${predecessor.id}`, { status: 'done' });
  await api.succeeds('PATCH', `/api/tasks/${successor.id}`, { status: 'in_progress' });
  assert.equal((await api.state()).tasks.find(item => item.id === successor.id)?.status, 'in_progress');
  for (const status of ['ready', 'todo'] as const) {
    assert.equal((await api.request('PATCH', `/api/tasks/${predecessor.id}`, { status, progress: 0 })).status, 409);
  }
  assert.equal((await api.state()).tasks.find(item => item.id === predecessor.id)?.status, 'done');
});

test('a completed predecessor can reopen while its ready successor has not started', async t => {
  const api = await fixture(t);
  const predecessor = await api.task('Prédécesseur à reprendre', { status: 'done' });
  const successor = await api.task('Successeur prêt', { dependsOnId: predecessor.id, status: 'ready', progress: 0 });
  await api.succeeds('PATCH', `/api/tasks/${predecessor.id}`, { status: 'ready', progress: 0 });
  const data = await api.state();
  assert.equal(data.tasks.find(item => item.id === predecessor.id)?.status, 'ready');
  assert.equal(data.tasks.find(item => item.id === predecessor.id)?.progress, 0);
  assert.equal(data.tasks.find(item => item.id === successor.id)?.status, 'ready');
  assert.equal((await api.request('PATCH', `/api/tasks/${successor.id}`, { status: 'in_progress' })).status, 409);
});

test('inactive resources retain history but cannot receive new assignments or time entries', async t => {
  const api = await fixture(t);
  await api.succeeds('POST', '/api/resources', { name: 'Ressource à désactiver' });
  const resource = (await api.state()).resources.find(item => item.name === 'Ressource à désactiver')!;
  const task = await api.task('Historique de ressource', { assigneeId: resource.id });
  const entry = await api.entry(task.id, { resourceId: resource.id });
  await api.succeeds('PATCH', `/api/resources/${resource.id}`, { active: false });
  assert.equal((await api.request('POST', '/api/tasks', {
    projectId: 'project-nova', title: 'Nouvelle affectation interdite', assigneeId: resource.id,
  })).status, 409);
  const unassigned = await api.task('Affectation ultérieure');
  assert.equal((await api.request('PATCH', `/api/tasks/${unassigned.id}`, { assigneeId: resource.id })).status, 409);
  assert.equal((await api.request('POST', '/api/time-entries', {
    taskId: task.id, resourceId: resource.id, date: '2026-10-07', hours: 1,
  })).status, 409);
  const data = await api.state();
  assert.equal(data.tasks.find(item => item.id === task.id)?.assigneeId, resource.id);
  assert.ok(data.timeEntries.some(item => item.id === entry.id));
});

test('time entries snapshot tariff units and keep them after a profile change or correction', async t => {
  const api = await fixture(t);
  await api.succeeds('POST', '/api/profiles', { name: 'Tarif historique', dailyRate: 640, eqjtHours: 8 });
  const profile = (await api.state()).profiles.find(item => item.name === 'Tarif historique')!;
  await api.succeeds('PATCH', '/api/resources/resource-claire', { profileId: profile.id });
  const task = await api.task('Historique tarifaire');
  const entry = await api.entry(task.id);
  assert.equal(entry.rateSnapshot, 640);
  assert.equal(entry.eqjtSnapshot, 8);
  assert.equal(entry.validated, false);
  assert.equal((await api.request('POST', '/api/time-entries', {
    taskId: task.id, resourceId: 'resource-claire', date: '2026-10-06', hours: 1,
    rateSnapshot: 1, eqjtSnapshot: 1,
  })).status, 400);
  assert.equal((await api.request('PATCH', `/api/time-entries/${entry.id}`, {
    rateSnapshot: 1, eqjtSnapshot: 1,
  })).status, 400);
  await api.succeeds('PATCH', `/api/profiles/${profile.id}`, { dailyRate: 800, eqjtHours: 7 });
  await api.succeeds('PATCH', `/api/time-entries/${entry.id}`, { hours: 3, note: 'Correction du temps' });
  const corrected = (await api.state()).timeEntries.find(item => item.id === entry.id)!;
  assert.equal(corrected.hours, 3);
  assert.equal(corrected.rateSnapshot, 640);
  assert.equal(corrected.eqjtSnapshot, 8);
  const next = await api.entry(task.id, { date: '2026-10-07' });
  assert.equal(next.rateSnapshot, 800);
  assert.equal(next.eqjtSnapshot, 7);
  await api.succeeds('DELETE', `/api/time-entries/${next.id}`);
  assert.ok(!(await api.state()).timeEntries.some(item => item.id === next.id));
});

test('missing cost profiles produce explicit null snapshots and profile validation rejects invalid units', async t => {
  const api = await fixture(t);
  await api.succeeds('PATCH', '/api/resources/resource-claire', { profileId: null });
  const task = await api.task('Sans profil tarifaire');
  const entry = await api.entry(task.id);
  assert.equal(entry.rateSnapshot, null);
  assert.equal(entry.eqjtSnapshot, null);
  assert.equal((await api.request('POST', '/api/profiles', { name: 'Taux négatif', dailyRate: -1 })).status, 400);
  assert.equal((await api.request('POST', '/api/profiles', { name: 'Unité nulle', dailyRate: 500, eqjtHours: 0 })).status, 400);
  await api.succeeds('POST', '/api/profiles', { name: 'Unité par défaut', dailyRate: 500 });
  assert.equal((await api.state()).profiles.find(item => item.name === 'Unité par défaut')?.eqjtHours, 8);
});

test('validated time requires a separate withdrawal before correction or deletion and keeps its tariff', async t => {
  const api = await fixture(t);
  const task = await api.task('Validation des heures');
  const entry = await api.entry(task.id);
  await api.succeeds('PATCH', `/api/time-entries/${entry.id}`, { validated: true });
  const validated = (await api.state()).timeEntries.find(item => item.id === entry.id)!;
  for (const payload of [
    { hours: 1 }, { date: '2026-10-07' }, { note: 'Correction' },
    { hours: 1, validated: false }, { date: '2026-10-07', note: 'Correction', validated: false },
  ]) {
    assert.equal((await api.request('PATCH', `/api/time-entries/${entry.id}`, payload)).status, 409, JSON.stringify(payload));
  }
  assert.equal((await api.request('DELETE', `/api/time-entries/${entry.id}`)).status, 409);
  assert.deepEqual((await api.state()).timeEntries.find(item => item.id === entry.id), validated);
  await api.succeeds('PATCH', `/api/time-entries/${entry.id}`, { validated: false });
  await api.succeeds('PATCH', `/api/profiles/profile-pilot`, { dailyRate: 900, eqjtHours: 7 });
  await api.succeeds('PATCH', `/api/time-entries/${entry.id}`, {
    hours: 3, date: '2026-10-07', note: 'Correction après retrait de validation',
  });
  const corrected = (await api.state()).timeEntries.find(item => item.id === entry.id)!;
  assert.equal(corrected.validated, false);
  assert.equal(corrected.hours, 3);
  assert.equal(corrected.rateSnapshot, entry.rateSnapshot);
  assert.equal(corrected.eqjtSnapshot, entry.eqjtSnapshot);
  await api.succeeds('PATCH', `/api/time-entries/${entry.id}`, { validated: true });
  assert.equal((await api.request('DELETE', `/api/time-entries/${entry.id}`)).status, 409);
  await api.succeeds('PATCH', `/api/time-entries/${entry.id}`, { validated: false });
  await api.succeeds('DELETE', `/api/time-entries/${entry.id}`);
  assert.ok(!(await api.state()).timeEntries.some(item => item.id === entry.id));
});

test('a task with recorded time cannot become a milestone', async t => {
  const api = await fixture(t);
  const task = await api.task('Tâche avec temps à conserver');
  const entry = await api.entry(task.id);
  const response = await api.request('PATCH', `/api/tasks/${task.id}`, { kind: 'milestone', allocatedHours: 0 });
  assert.equal(response.status, 409);
  const data = await api.state();
  assert.equal(data.tasks.find(item => item.id === task.id)?.kind, 'task');
  assert.ok(data.timeEntries.some(item => item.id === entry.id));
});

test('deletions reject referenced tasks, assigned profiles and resources, while unused objects can be removed', async t => {
  const api = await fixture(t);
  const task = await api.task('Temps lié');
  const entry = await api.entry(task.id);
  assert.equal((await api.request('DELETE', `/api/tasks/${task.id}`)).status, 409);
  assert.equal((await api.request('DELETE', '/api/resources/resource-claire')).status, 405);
  await api.succeeds('PATCH', '/api/resources/resource-claire', { profileId: 'profile-pilot' });
  assert.equal((await api.request('DELETE', '/api/profiles/profile-pilot')).status, 409);
  await api.succeeds('DELETE', `/api/time-entries/${entry.id}`);
  await api.succeeds('DELETE', `/api/tasks/${task.id}`);
  assert.ok(!(await api.state()).tasks.some(item => item.id === task.id));
  const project = await api.project('Projet vide à supprimer');
  await api.succeeds('DELETE', `/api/projects/${project.id}`);
  assert.ok(!(await api.state()).projects.some(item => item.id === project.id));
  assert.equal((await api.request('DELETE', '/api/projects/project-nova')).status, 409);
});

test('paused and closed projects block task, time, comment and expense changes', async t => {
  const api = await fixture(t);
  for (const status of ['paused', 'closed'] as const) {
    const project = await api.project(`Projet ${status}`);
    const task = await api.task(`Tâche ${status}`, { projectId: project.id });
    const entry = await api.entry(task.id);
    await api.succeeds('POST', '/api/comments', { taskId: task.id, body: `Commentaire ${status}` });
    await api.succeeds('POST', '/api/expenses', {
      projectId: project.id, label: `Dépense ${status}`, amount: 10, plannedDate: '2026-10-06',
      paidDate: null, category: 'other',
    });
    const before = await api.state();
    const comment = before.comments.find(item => item.taskId === task.id)!;
    const expense = before.expenses.find(item => item.projectId === project.id)!;
    await api.succeeds('PATCH', `/api/projects/${project.id}`, { status });
    for (const [method, path, body] of [
      ['POST', '/api/tasks', { projectId: project.id, title: 'Interdite' }],
      ['PATCH', `/api/tasks/${task.id}`, { title: 'Modification interdite' }],
      ['DELETE', `/api/tasks/${task.id}`, undefined],
      ['POST', '/api/time-entries', { taskId: task.id, resourceId: 'resource-claire', date: '2026-10-07', hours: 1 }],
      ['PATCH', `/api/time-entries/${entry.id}`, { hours: 9 }],
      ['DELETE', `/api/time-entries/${entry.id}`, undefined],
      ['POST', '/api/comments', { taskId: task.id, body: 'Interdit' }],
      ['PATCH', `/api/comments/${comment.id}`, { body: 'Interdit' }],
      ['DELETE', `/api/comments/${comment.id}`, undefined],
      ['POST', '/api/expenses', { projectId: project.id, label: 'Interdite', amount: 1, plannedDate: '2026-10-06', category: 'other' }],
      ['PATCH', `/api/expenses/${expense.id}`, { amount: 100 }],
      ['DELETE', `/api/expenses/${expense.id}`, undefined],
    ] as const) {
      const response = await api.request(method, path, body);
      assert.equal(response.status, 409, `${status}: ${method} ${path}`);
    }
    const after = await api.state();
    assert.deepEqual(after.tasks.find(item => item.id === task.id), task);
    assert.deepEqual(after.timeEntries.find(item => item.id === entry.id), entry);
    assert.deepEqual(after.comments.find(item => item.id === comment.id), comment);
    assert.deepEqual(after.expenses.find(item => item.id === expense.id), expense);
  }
});

test('comment and expense CRUD persists content and rejects impossible payment dates', async t => {
  const api = await fixture(t);
  const task = await api.task('Collaboration');
  assert.equal((await api.request('POST', '/api/comments', {
    taskId: task.id, authorName: 'Autre utilisateur', body: 'Attribution falsifiée',
  })).status, 400);
  await api.succeeds('POST', '/api/comments', { taskId: task.id, body: 'Décision documentée' });
  const comment = (await api.state()).comments.find(item => item.taskId === task.id)!;
  assert.equal(comment.body, 'Décision documentée');
  assert.equal(comment.authorName, (await api.state()).currentUser.name);
  assert.equal((await api.request('PATCH', `/api/comments/${comment.id}`, {
    authorName: 'Autre utilisateur',
  })).status, 400);
  await api.succeeds('PATCH', `/api/comments/${comment.id}`, { body: 'Décision corrigée' });
  assert.equal((await api.state()).comments.find(item => item.id === comment.id)?.body, 'Décision corrigée');
  await api.succeeds('DELETE', `/api/comments/${comment.id}`);
  assert.ok(!(await api.state()).comments.some(item => item.id === comment.id));

  await api.succeeds('POST', '/api/expenses', {
    projectId: 'project-nova', label: 'Atelier', amount: 240, plannedDate: '2026-10-06', category: 'training',
  });
  const expense = (await api.state()).expenses.find(item => item.label === 'Atelier')!;
  assert.equal(expense.paidDate, null);
  assert.equal((await api.request('PATCH', `/api/expenses/${expense.id}`, { paidDate: '2026-02-30' })).status, 400);
  await api.succeeds('PATCH', `/api/expenses/${expense.id}`, { paidDate: '2026-10-07', amount: 260 });
  assert.equal((await api.state()).expenses.find(item => item.id === expense.id)?.amount, 260);
  await api.succeeds('DELETE', `/api/expenses/${expense.id}`);
  assert.ok(!(await api.state()).expenses.some(item => item.id === expense.id));
});

test('mutations reject a foreign browser Origin and accept requests without an Origin', async t => {
  const api = await fixture(t);
  const rejected = await api.request('POST', '/api/tasks', {
    projectId: 'project-nova', title: 'Requête externe',
  }, { Origin: 'https://untrusted.example' });
  assert.equal(rejected.status, 403);
  assert.ok(!(await api.state()).tasks.some(item => item.title === 'Requête externe'));
  await api.task('Requête locale');
});

test('anonymous requests cannot read or change workspace data, including with the former demo cookie', async t => {
  const api = await fixture(t);
  assert.equal((await api.rawRequest('GET', '/api/health')).status, 200);
  assert.deepEqual(await (await api.rawRequest('GET', '/api/auth/session')).json(), { authenticated: false });
  for (const headers of [undefined, { Cookie: 'planzone8-demo-local=00000000-0000-4000-8000-000000000001' }, { Cookie: 'planzone8-session-local=forged' }]) {
    assert.equal((await api.rawRequest('GET', '/api/state', undefined, headers)).status, 401);
    assert.equal((await api.rawRequest('POST', '/api/tasks', { projectId: 'project-nova', title: 'Modification anonyme' }, headers)).status, 401);
    assert.equal((await api.rawRequest('PATCH', '/api/resources/resource-claire', { name: 'Modification anonyme' }, headers)).status, 401);
    assert.equal((await api.rawRequest('DELETE', '/api/projects/project-nova', undefined, headers)).status, 401);
  }
  assert.equal((await api.rawRequest('POST', '/api/auth/password', { currentPassword: testAdmin.password, newPassword: 'Nouveau-Test-Password!2026' })).status, 401);
  assert.ok(!(await api.state()).tasks.some(task => task.title === 'Modification anonyme'));
});

test('a server without a provisioned account remains closed to anonymous access and default passwords', async t => {
  const api = await fixture(t, false);
  assert.equal((await api.rawRequest('GET', '/api/health')).status, 200);
  assert.equal((await api.rawRequest('GET', '/api/state')).status, 401);
  const login = await api.rawRequest('POST', '/api/auth/login', { username: 'admin', password: testAdmin.password });
  assert.equal(login.status, 401);
  assert.deepEqual(await (await api.rawRequest('GET', '/api/auth/session')).json(), { authenticated: false });
});

test('login creates an HttpOnly session without exposing a token, and uses a generic credential error', async t => {
  const api = await fixture(t);
  const badPassword = await api.rawRequest('POST', '/api/auth/login', { username: 'admin', password: 'incorrect' });
  const unknownUser = await api.rawRequest('POST', '/api/auth/login', { username: 'inconnu', password: 'incorrect' });
  assert.equal(badPassword.status, 401);
  assert.equal(unknownUser.status, 401);
  assert.deepEqual(await badPassword.json(), await unknownUser.json());
  const response = await api.rawRequest('POST', '/api/auth/login', { username: testAdmin.username, password: testAdmin.password });
  assert.equal(response.status, 200);
  const body = await response.json() as { authenticated: boolean; user: Record<string, unknown> };
  assert.equal(body.authenticated, true);
  assert.equal(body.user.username, 'admin');
  assert.equal(body.user.role, 'administrator');
  assert.ok(!JSON.stringify(body).includes(testAdmin.password));
  assert.ok(!('token' in body));
  const cookie = response.headers.get('set-cookie') ?? '';
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, /Path=\//i);
});

test('a loopback HTTPS proxy produces a secure host-only session cookie', async t => {
  const api = await fixture(t);
  const login = await api.rawRequest('POST', '/api/auth/login', { username: testAdmin.username, password: testAdmin.password }, { 'X-Forwarded-Proto': 'https' });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie') ?? '';
  assert.match(cookie, /^__Host-planzone8-session=/);
  assert.match(cookie, /; Secure/);
  const session = await api.rawRequest('GET', '/api/auth/session', undefined, { Cookie: cookie.split(';', 1)[0]!, 'X-Forwarded-Proto': 'https' });
  assert.equal((await session.json() as { authenticated: boolean }).authenticated, true);
});

test('logout invalidates the server session, including when the old cookie is replayed after restart', async t => {
  const api = await fixture(t);
  const previousCookie = api.cookie;
  const logout = await api.request('POST', '/api/auth/logout', {});
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get('set-cookie') ?? '', /Max-Age=0/i);
  assert.equal((await api.request('GET', '/api/state')).status, 401);
  await api.restart();
  assert.equal((await api.rawRequest('GET', '/api/state', undefined, { Cookie: previousCookie })).status, 401);
  await api.login();
  assert.equal((await api.request('GET', '/api/state')).status, 200);
});

test('password changes verify the current password and revoke all previous sessions persistently', async t => {
  const api = await fixture(t);
  const firstCookie = api.cookie;
  const secondLogin = await api.rawRequest('POST', '/api/auth/login', { username: 'admin', password: testAdmin.password });
  const secondCookie = secondLogin.headers.get('set-cookie')!.split(';', 1)[0]!;
  const newPassword = 'Planzone8-New-Test-Password!2026';
  const rejected = await api.request('POST', '/api/auth/password', { currentPassword: 'incorrect', newPassword });
  assert.equal(rejected.status, 400);
  assert.equal((await api.request('GET', '/api/state')).status, 200);
  const changed = await api.request('POST', '/api/auth/password', { currentPassword: testAdmin.password, newPassword });
  assert.equal(changed.status, 200);
  const replacementCookie = changed.headers.get('set-cookie')!.split(';', 1)[0]!;
  assert.notEqual(replacementCookie, firstCookie);
  for (const oldCookie of [firstCookie, secondCookie]) {
    assert.equal((await api.rawRequest('GET', '/api/state', undefined, { Cookie: oldCookie })).status, 401);
  }
  assert.equal((await api.rawRequest('GET', '/api/state', undefined, { Cookie: replacementCookie })).status, 200);
  await api.restart();
  assert.equal((await api.rawRequest('GET', '/api/state', undefined, { Cookie: replacementCookie })).status, 200);
  assert.equal((await api.rawRequest('POST', '/api/auth/login', { username: 'admin', password: testAdmin.password })).status, 401);
  await api.login(newPassword);
  assert.equal((await api.state()).currentUser.name, 'Administrateur');
});

test('resource metadata cannot rename or downgrade the authenticated administrator account', async t => {
  const api = await fixture(t);
  assert.equal((await api.request('PATCH', '/api/resources/resource-claire', { role: 'visitor' })).status, 409);
  await api.succeeds('PATCH', '/api/resources/resource-claire', { name: 'Nom de ressource uniquement' });
  const data = await api.state();
  assert.equal(data.currentUser.name, 'Administrateur');
  assert.equal(data.currentUser.role, 'Administrateur');
  const task = await api.task('Validation administrative authentifiée');
  const entry = await api.entry(task.id);
  await api.succeeds('PATCH', `/api/time-entries/${entry.id}`, { validated: true });
  assert.equal((await api.state()).timeEntries.find(item => item.id === entry.id)?.validated, true);
});

test('login, logout and password changes reject cross-site mutation requests', async t => {
  const api = await fixture(t);
  for (const [path, body] of [
    ['/api/auth/login', { username: testAdmin.username, password: testAdmin.password }],
    ['/api/auth/logout', {}],
    ['/api/auth/password', { currentPassword: testAdmin.password, newPassword: 'Test-new-password!2026' }],
  ] as const) {
    assert.equal((await api.request('POST', path, body, { Origin: 'https://untrusted.example' })).status, 403);
    assert.equal((await api.request('POST', path, body, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  }
  assert.equal((await api.request('GET', '/api/state')).status, 200);
});
