import type { D1Database } from '@cloudflare/workers-types';
import { ApiError, ApiService, type MutationMethod } from '../server/service.ts';
import { accountActor, accountPublicUser, accountRole, memberAccountInput } from '../server/account-access.ts';
import { MemoryStore } from '../server/memory-store.ts';
import { seed } from '../server/seed.ts';
import type { CompatibleWorkspaceSnapshot } from '../server/contracts.ts';
import type { Entity } from '../shared/types.ts';
import { z } from 'zod';
import {
  AuthError, AuthManager, clearSessionCookie, publicAuthUser, readSessionToken, sessionCookie,
  type AuthPrincipal,
} from '../server/auth.ts';
import { D1AuthDatabase } from './auth-d1.ts';
import { MAX_CUSTOM_FIELDS_BODY_BYTES, MAX_DOCUMENT_BODY_BYTES, storageGrowthExceedsLimit, workspaceStorageUsage } from '../server/collaboration-validation.ts';
import { decryptWorkspace, encryptWorkspace, isEncryptedWorkspace, parseWorkspaceKeys, WorkspaceStorageLimitError } from '../server/workspace-crypto.ts';

export interface Env {
  DB: D1Database;
  ASSETS: { fetch(request: Request): Promise<Response> };
  DEMO_TODAY?: string;
  PLANZONE_DATA_KEYS: string;
  PLANZONE_MIGRATE_PLAINTEXT?: string;
}

interface WorkspaceRow { data: string; revision: number; }
const MAX_BODY_BYTES = 100 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENTITIES = new Set<Entity>(['zones', 'projects', 'tasks', 'resources', 'profiles', 'time-entries', 'comments', 'expenses', 'revenues', 'calendar-events', 'unavailabilities', 'project-templates', 'custom-field-definitions', 'report-templates', 'project-status-definitions', 'strategic-axes', 'project-reports', 'project-documents', 'document-folders', 'task-lists', 'project-item-moves', 'time-integrations', 'permission-policies', 'organization-units', 'capacity-plan', 'planzone-preferences', 'task-self-assignment']);
const SCHEMA = `CREATE TABLE IF NOT EXISTS demo_workspaces (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL CHECK (json_valid(data)),
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
)`;
const schemaReady = new WeakMap<D1Database, Promise<unknown>>();
const authManagers = new WeakMap<D1Database, AuthManager>();

function authManager(db: D1Database): AuthManager {
  let manager = authManagers.get(db);
  if (!manager) {
    manager = new AuthManager(new D1AuthDatabase(db));
    authManagers.set(db, manager);
  }
  return manager;
}

function ensureSchema(db: D1Database): Promise<unknown> {
  let pending = schemaReady.get(db);
  if (!pending) {
    pending = db.prepare(SCHEMA).run().catch(error => { schemaReady.delete(db); throw error; });
    schemaReady.set(db, pending);
  }
  return pending;
}

function json(value: unknown, status = 200, cookie?: string): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Vary': 'Cookie',
  });
  if (cookie) headers.set('Set-Cookie', cookie);
  return new Response(status === 204 ? null : JSON.stringify(value), { status, headers });
}

function legacyWorkspaceId(request: Request): string | undefined {
  const secure = new URL(request.url).protocol === 'https:';
  const name = secure ? '__Host-planzone8-demo' : 'planzone8-demo-local';
  const existing = request.headers.get('Cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
  return existing && UUID.test(existing) ? existing : undefined;
}

const loginBody = z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(256) }).strict();
const passwordBody = z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(12).max(256) }).strict();
const logoutBody = z.object({}).strict();

function parseAuthBody<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, 'Les informations de connexion transmises sont invalides.');
  return parsed.data;
}

function assertSameOrigin(request: Request, url: URL): void {
  const origin = request.headers.get('Origin');
  if ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    throw new ApiError(403, 'Cette origine ne peut pas modifier les données.');
  }
}


async function readBody(request: Request, maxBytes = MAX_BODY_BYTES, customFields = false): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) {
    throw new ApiError(415, 'Le corps de la requête doit être au format JSON.');
  }
  const length = Number(request.headers.get('Content-Length'));
  if (length > maxBytes) throw new ApiError(413, 'Les données transmises sont trop volumineuses.');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'Le JSON transmis est invalide.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new ApiError(413, 'Les données transmises sont trop volumineuses.');
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new ApiError(400, 'Le JSON transmis est invalide.'); }
  if (customFields && size > MAX_BODY_BYTES && (!parsed || typeof parsed !== 'object' || !Object.hasOwn(parsed, 'customValues'))) {
    throw new ApiError(413, 'Les données transmises sont trop volumineuses.');
  }
  return parsed;
}

async function workspace(env: Env, id: string): Promise<WorkspaceRow> {
  const db = env.DB;
  const keys = parseWorkspaceKeys(env.PLANZONE_DATA_KEYS);
  await ensureSchema(db);
  let row = await db.prepare('SELECT data, revision FROM demo_workspaces WHERE id = ?').bind(id).first<WorkspaceRow>();
  if (!row) {
    const initial = new MemoryStore();
    seed(initial);
    await db.prepare('INSERT OR IGNORE INTO demo_workspaces (id, data, revision, updated_at) VALUES (?, ?, 0, ?)')
      .bind(id, await encryptWorkspace(JSON.stringify(initial.snapshot()), id, keys), new Date().toISOString()).run();
    row = await db.prepare('SELECT data, revision FROM demo_workspaces WHERE id = ?').bind(id).first<WorkspaceRow>();
  }
  if (!row) throw new Error('Workspace initialization failed');
  for (let attempt = 0; attempt < 5; attempt++) {
    if (isEncryptedWorkspace(row.data)) return { ...row, data: await decryptWorkspace(row.data, id, keys) };
    // Explicit, temporary deployment transition; normal operation rejects plaintext.
    if (env.PLANZONE_MIGRATE_PLAINTEXT !== 'true') throw new Error('Unmigrated workspace');
    const parsed = JSON.parse(row.data) as CompatibleWorkspaceSnapshot;
    if (Object.hasOwn(parsed, 'format')) throw new Error('Unknown storage format');
    new MemoryStore(parsed); // Validate legacy records without altering or filling the saved snapshot.
    const encrypted = await encryptWorkspace(row.data, id, keys);
    const saved = await db.prepare('UPDATE demo_workspaces SET data = ?, revision = revision + 1 WHERE id = ? AND revision = ?')
      .bind(encrypted, id, row.revision).run();
    if (saved.meta.changes === 1) return { data: row.data, revision: row.revision + 1 };
    const next = await db.prepare('SELECT data, revision FROM demo_workspaces WHERE id = ?').bind(id).first<WorkspaceRow>();
    if (!next) throw new Error('Workspace disappeared during migration');
    row = next;
  }
  throw new ApiError(409, 'Une autre modification est en cours. Réessayez cette opération.');
}

async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === 'GET' && path === '/api/health') {
    await env.DB.prepare('SELECT 1 AS ready').first();
    return json({ status: 'ok', storage: 'd1', mode: 'cloud-demo', authentication: true });
  }
  const secure = url.protocol === 'https:';
  const auth = authManager(env.DB);
  const token = readSessionToken(request.headers.get('Cookie'), secure);
  async function publicUser(principal: AuthPrincipal) { const row = await workspace(env, principal.workspaceId); return accountPublicUser(principal, new MemoryStore(JSON.parse(row.data) as CompatibleWorkspaceSnapshot)); }
  if (request.method === 'GET' && path === '/api/auth/session') {
    const principal = token ? await auth.authenticate(token) : null;
    return json(principal ? { authenticated: true, user: await publicUser(principal) } : { authenticated: false });
  }
  if (request.method === 'POST' && path === '/api/auth/login') {
    assertSameOrigin(request, url);
    const credentials = parseAuthBody(loginBody, await readBody(request));
    const loggedIn = await auth.login(credentials.username, credentials.password, request.headers.get('CF-Connecting-IP') ?? 'local');
    let principal = loggedIn.principal;
    const legacyId = legacyWorkspaceId(request);
    if (legacyId) {
      await ensureSchema(env.DB);
      principal = await auth.adoptLegacyWorkspace(principal, legacyId);
    }
    return json({ authenticated: true, user: await publicUser(principal) }, 200, sessionCookie(loggedIn.token, secure));
  }
  if (request.method === 'POST' && path === '/api/auth/logout') {
    assertSameOrigin(request, url);
    parseAuthBody(logoutBody, await readBody(request));
    if (token) await auth.logout(token);
    return json(null, 204, clearSessionCookie(secure));
  }
  if (request.method === 'POST' && path === '/api/auth/password') {
    assertSameOrigin(request, url);
    if (!token || !await auth.authenticate(token)) throw new AuthError(401, 'Connectez-vous pour accéder à Planzone.');
    const body = parseAuthBody(passwordBody, await readBody(request));
    const changed = await auth.changePassword(token, body.currentPassword, body.newPassword);
    return json({ authenticated: true, user: await publicUser(changed.principal) }, 200, sessionCookie(changed.token, secure));
  }
  const route = /^\/api\/([^/]+)(?:\/([^/]+))?$/.exec(path);
  const isState = request.method === 'GET' && path === '/api/state';
  const documentContent = request.method === 'GET' && /^\/api\/project-documents\/([^/]+)\/content$/.exec(path);
  const entity = route?.[1] as Entity;
  const method = request.method as MutationMethod;
  const mutation = route && ENTITIES.has(entity) && (
    (method === 'POST' && !route[2]) || (['PATCH', 'DELETE'].includes(method) && Boolean(route[2]))
  );
  const memberCreate = request.method === 'POST' && path === '/api/auth/members';
  if (!isState && !mutation && !memberCreate && !documentContent) throw new ApiError(404, 'Cette route API est introuvable.');
  const principal = token ? await auth.authenticate(token) : null;
  if (!principal) throw new AuthError(401, 'Connectez-vous pour accéder à Planzone.');
  let body: unknown;
  if (mutation || memberCreate) {
    assertSameOrigin(request, url);
    if (method !== 'DELETE') {
      const customFields = ['projects', 'tasks', 'resources', 'time-entries'].includes(entity);
      body = await readBody(request, entity === 'project-documents' && method === 'POST' ? MAX_DOCUMENT_BODY_BYTES : customFields ? MAX_CUSTOM_FIELDS_BODY_BYTES : MAX_BODY_BYTES, customFields);
    }
  }
  const id = principal.workspaceId;
  let row = await workspace(env, id);
  if (documentContent) {
    const store = new MemoryStore(JSON.parse(row.data) as CompatibleWorkspaceSnapshot);
    return json(new ApiService(store, accountActor(principal, store)).readDocument(decodeURIComponent(documentContent[1])));
  }
  if (memberCreate) {
    const store = new MemoryStore(JSON.parse(row.data) as CompatibleWorkspaceSnapshot);
    if (accountRole(principal, store) !== 'administrator') throw new ApiError(403, 'Seul un administrateur peut créer un accès de connexion.');
    const parsed = memberAccountInput.safeParse(body);
    if (!parsed.success) throw new ApiError(400, 'Renseignez le membre, un identifiant et un mot de passe de 12 à 128 caractères.');
    const resource = store.get('resources', parsed.data.resourceId);
    if (!resource || !resource.active || resource.type !== 'human') throw new ApiError(400, 'Choisissez un membre humain actif.');
    await auth.createMember({ ...parsed.data, workspaceId: principal.workspaceId, name: resource.name });
    return json({ resourceId: resource.id, username: parsed.data.username.toLowerCase().trim() }, 201);
  }
  if (isState) {
    const store = new MemoryStore(JSON.parse(row.data) as CompatibleWorkspaceSnapshot);
    const service = new ApiService(store, accountActor(principal, store));
    const data = service.readState(env.DEMO_TODAY);
    if (accountRole(principal, store) === 'administrator') data.userAccounts = await auth.members(principal.workspaceId);
    return json(data);
  }
  const recordId = route?.[2] ? decodeURIComponent(route[2]) : undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    const store = new MemoryStore(JSON.parse(row.data) as CompatibleWorkspaceSnapshot);
    const beforeUsage = workspaceStorageUsage(store.snapshot());
    const result = new ApiService(store, accountActor(principal, store)).mutate(entity, method, body, recordId);
    if (storageGrowthExceedsLimit(beforeUsage, workspaceStorageUsage(store.snapshot()))) {
      throw new ApiError(413, 'Cet espace de démonstration a atteint sa limite de stockage.');
    }
    const data = await encryptWorkspace(JSON.stringify(store.snapshot()), id, parseWorkspaceKeys(env.PLANZONE_DATA_KEYS));
    const saved = await env.DB.prepare(`UPDATE demo_workspaces SET data = ?, revision = revision + 1, updated_at = ?
      WHERE id = ? AND revision = ?
        AND EXISTS (SELECT 1 FROM auth_users WHERE id = ? AND workspace_id = demo_workspaces.id)`)
      .bind(data, new Date().toISOString(), id, row.revision, principal.id).run();
    if (saved.meta.changes === 1) return json(result.value, result.status);
    const currentPrincipal = await auth.authenticate(token);
    if (!currentPrincipal) throw new AuthError(401, 'Connectez-vous pour accéder à Planzone.');
    if (currentPrincipal.workspaceId !== id) {
      throw new ApiError(409, 'Votre espace de travail a changé. Actualisez la page avant de réessayer.');
    }
    row = await workspace(env, id);
  }
  throw new ApiError(409, 'Une autre modification est en cours. Réessayez cette opération.');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path !== '/api' && !path.startsWith('/api/')) return env.ASSETS.fetch(request);
    try { return await api(request, env); }
    catch (error) {
      if (error instanceof ApiError || error instanceof AuthError) return json({ error: error.message }, error.status);
      if (error instanceof URIError) return json({ error: 'Cette adresse est invalide.' }, 400);
      if (error instanceof WorkspaceStorageLimitError) return json({ error: 'Cet espace a atteint sa limite de stockage chiffré.' }, 413);
      console.error('Erreur interne de l’API Planzone :', error instanceof Error ? error.name : 'UnknownError');
      return json({ error: 'Une erreur interne a empêché cette opération.' }, 500);
    }
  },
};
