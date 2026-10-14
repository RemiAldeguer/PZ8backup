import express, { type ErrorRequestHandler } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Entity } from '../shared/types.ts';
import { Store } from './store.ts';
import { seed } from './seed.ts';
import { ApiError, ApiService } from './service.ts';
import { AuthError, AuthManager, clearSessionCookie, publicAuthUser, readSessionToken, sessionCookie, type AuthPrincipal } from './auth.ts';
import { accountActor, accountPublicUser, accountRole, memberAccountInput } from './account-access.ts';
import { SQLiteAuthDatabase } from './auth-sqlite.ts';
import { MAX_CUSTOM_FIELDS_BODY_BYTES, MAX_DOCUMENT_BODY_BYTES } from './collaboration-validation.ts';

export interface AppOptions {
  dbPath?: string; today?: string; seed?: boolean; distPath?: string; allowedOrigins?: string[];
  admin?: { username: string; password: string; name?: string };
}

const loginSchema = z.object({ username: z.string().min(1).max(128), password: z.string().min(1).max(256) }).strict();
const passwordSchema = z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(1).max(256) }).strict();

export function createApp(options: AppOptions = {}) {
  const store = new Store(options.dbPath ?? resolve('data/planzone.sqlite'));
  if (options.seed !== false) seed(store);
  const auth = new AuthManager(new SQLiteAuthDatabase(store.db));
  const ready = (async () => {
    await auth.ensureSchema();
    return options.admin ? auth.createAdmin(options.admin) : false;
  })();
  const app = express();
  app.disable('x-powered-by');
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use('/api', (_request, response, next) => { response.setHeader('Cache-Control', 'no-store'); next(); });
  app.use('/api', (request, _response, next) => {
    if (!['POST', 'PATCH', 'DELETE'].includes(request.method)) { next(); return; }
    if (request.get('sec-fetch-site') === 'cross-site') { next(new ApiError(403, 'Cette origine ne peut pas modifier les données.')); return; }
    const origin = request.get('origin');
    const allowed = new Set(['http://127.0.0.1:5173', 'http://localhost:5173', ...(options.allowedOrigins ?? [])]);
    // The Host header alone must not authorize an arbitrary browser origin (DNS rebinding).
    try {
      const ownOrigin = new URL(`${request.protocol}://${request.get('host')}`);
      if (['127.0.0.1', 'localhost', '[::1]'].includes(ownOrigin.hostname)) allowed.add(ownOrigin.origin);
    } catch { /* Invalid host never authorizes an origin. */ }
    if (origin && !allowed.has(origin)) { next(new ApiError(403, 'Cette origine ne peut pas modifier les données.')); return; }
    if (request.method !== 'DELETE' && !request.is('application/json')) {
      next(new ApiError(415, 'Le corps de la requête doit être au format JSON.')); return;
    }
    next();
  });
  const standardJson = express.json({ limit: '100kb' });
  const documentJson = express.json({ limit: MAX_DOCUMENT_BODY_BYTES });
  const customFieldsJson = express.json({ limit: MAX_CUSTOM_FIELDS_BODY_BYTES, verify: (_request, response, buffer) => { (response as express.Response).locals.customBodyBytes = buffer.byteLength; } });
  app.use((request, response, next) => {
    if (request.method === 'POST' && request.path === '/api/project-documents') { documentJson(request, response, next); return; }
    if (['POST', 'PATCH'].includes(request.method) && /^\/api\/(projects|tasks|resources|time-entries)(?:\/[^/]+)?$/.test(request.path)) {
      customFieldsJson(request, response, error => {
        if (error) { next(error); return; }
        if (response.locals.customBodyBytes > 100 * 1024 && (!request.body || typeof request.body !== 'object' || !Object.hasOwn(request.body, 'customValues'))) {
          next(new ApiError(413, 'Les données transmises sont trop volumineuses.')); return;
        }
        next();
      }); return;
    }
    standardJson(request, response, next);
  });
  app.use('/api', async (_request, _response, next) => { await ready; next(); });

  app.get('/api/health', (_request, response) => { response.json({ status: 'ok', storage: 'sqlite', mode: 'local-demo', authentication: true }); });
  app.get('/api/auth/session', async (request, response) => {
    const token = readSessionToken(request.get('cookie'), request.secure);
    const principal = token ? await auth.authenticate(token) : null;
    if (principal) response.json({ authenticated: true, user: accountPublicUser(principal, store) });
    else {
      if (token) response.setHeader('Set-Cookie', clearSessionCookie(request.secure));
      response.json({ authenticated: false });
    }
  });
  app.post('/api/auth/login', async (request, response) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, 'Renseignez votre identifiant et votre mot de passe.');
    const result = await auth.login(parsed.data.username, parsed.data.password, request.ip ?? 'local');
    response.setHeader('Set-Cookie', sessionCookie(result.token, request.secure));
    response.json({ authenticated: true, user: accountPublicUser(result.principal, store) });
  });
  app.post('/api/auth/logout', async (request, response) => {
    const token = readSessionToken(request.get('cookie'), request.secure);
    if (token) await auth.logout(token);
    response.setHeader('Set-Cookie', clearSessionCookie(request.secure));
    response.status(204).end();
  });
  app.use('/api', async (request, response, next) => {
    const token = readSessionToken(request.get('cookie'), request.secure);
    const principal = token ? await auth.authenticate(token) : null;
    if (!principal) {
      if (token) response.setHeader('Set-Cookie', clearSessionCookie(request.secure));
      throw new AuthError(401, 'Connectez-vous pour accéder à Planzone 8.');
    }
    response.locals.principal = principal;
    response.locals.sessionToken = token;
    next();
  });
  app.post('/api/auth/password', async (request, response) => {
    const parsed = passwordSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, 'Renseignez le mot de passe actuel et le nouveau mot de passe.');
    const result = await auth.changePassword(response.locals.sessionToken as string, parsed.data.currentPassword, parsed.data.newPassword);
    response.setHeader('Set-Cookie', sessionCookie(result.token, request.secure));
    response.json({ authenticated: true, user: accountPublicUser(result.principal, store) });
  });
  function serviceFor(principal: AuthPrincipal) {
    return new ApiService(store, accountActor(principal, store));
  }
  app.get('/api/state', async (_request, response) => { const principal = response.locals.principal as AuthPrincipal; const data = serviceFor(principal).readState(options.today); if (accountRole(principal, store) === 'administrator') data.userAccounts = await auth.members(principal.workspaceId); response.json(data); });
  app.get('/api/project-documents/:id/content', (request, response) => {
    response.json(serviceFor(response.locals.principal as AuthPrincipal).readDocument(request.params.id as string));
  });
  app.post('/api/auth/members', async (request, response) => {
    const principal = response.locals.principal as AuthPrincipal;
    if (accountRole(principal, store) !== 'administrator') throw new ApiError(403, 'Seul un administrateur peut créer un accès de connexion.');
    const parsed = memberAccountInput.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, 'Renseignez le membre, un identifiant et un mot de passe de 12 à 128 caractères.');
    const resource = store.get('resources', parsed.data.resourceId);
    if (!resource || !resource.active || resource.type !== 'human') throw new ApiError(400, 'Choisissez un membre humain actif.');
    await auth.createMember({ ...parsed.data, workspaceId: principal.workspaceId, name: resource.name });
    response.status(201).json({ resourceId: resource.id, username: parsed.data.username.toLowerCase().trim() });
  });
  const entities: Entity[] = ['zones', 'projects', 'tasks', 'resources', 'profiles', 'time-entries', 'comments', 'expenses', 'revenues', 'calendar-events', 'unavailabilities', 'project-templates', 'custom-field-definitions', 'report-templates', 'project-status-definitions', 'strategic-axes', 'project-reports', 'project-documents', 'document-folders', 'task-lists', 'project-item-moves', 'time-integrations', 'permission-policies', 'organization-units'];
  for (const entity of entities) {
    app.post(`/api/${entity}`, (request, response) => {
      const result = serviceFor(response.locals.principal as AuthPrincipal).mutate(entity, 'POST', request.body);
      response.status(result.status).json(result.value);
    });
    app.patch(`/api/${entity}/:id`, (request, response) => {
      const result = serviceFor(response.locals.principal as AuthPrincipal).mutate(entity, 'PATCH', request.body, request.params.id as string);
      response.status(result.status).json(result.value);
    });
    app.delete(`/api/${entity}/:id`, (request, response) => {
      serviceFor(response.locals.principal as AuthPrincipal).mutate(entity, 'DELETE', undefined, request.params.id as string);
      response.status(204).end();
    });
  }
  app.use('/api', (_request, _response, next) => { next(new ApiError(404, 'Cette route API est introuvable.')); });
  const distPath = options.distPath ?? resolve('dist');
  if (existsSync(resolve(distPath, 'index.html'))) {
    app.use(express.static(distPath));
    app.get('/{*path}', (_request, response) => { response.sendFile(resolve(distPath, 'index.html')); });
  }
  const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (error instanceof ApiError || error instanceof AuthError) { response.status(error.status).json({ error: error.message }); return; }
    if (error instanceof SyntaxError && 'body' in error) { response.status(400).json({ error: 'Le JSON transmis est invalide.' }); return; }
    if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large') {
      response.status(413).json({ error: 'Les données transmises sont trop volumineuses.' }); return;
    }
    // Never return stack traces, database paths or arbitrary SQLite errors to the browser.
    console.error('Erreur interne de l’API Planzone :', error instanceof Error ? error.name : 'UnknownError');
    response.status(500).json({ error: 'Une erreur interne a empêché cette opération.' });
  };
  app.use(errorHandler);
  return { app, ready, close: () => store.close() };
}
