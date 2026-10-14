import type { AuthUser } from '../shared/auth.ts';

export interface AuthDatabase {
  first<T>(sql: string, params?: unknown[]): Promise<T | null>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
}

export interface AuthPrincipal extends AuthUser {
  workspaceId: string;
  resourceId: string;
}

interface UserRow {
  id: string;
  username: string;
  name: string;
  password_hash: string;
  workspace_id: string;
  legacy_adopted: number;
  auth_version: number;
  resource_id: string;
}

export class AuthError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export const AUTH_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS auth_users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    legacy_adopted INTEGER NOT NULL DEFAULT 0 CHECK (legacy_adopted IN (0, 1)),
    auth_version INTEGER NOT NULL DEFAULT 1,
    resource_id TEXT NOT NULL DEFAULT 'resource-claire'
  )`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    auth_version INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id)',
  'CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at)',
  `CREATE TABLE IF NOT EXISTS auth_attempts (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    window_start INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS auth_attempts_window ON auth_attempts(window_start)',
];

const HASH_ITERATIONS = 100_000; // Maximum supported by the Cloudflare Workers Web Crypto API.
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const ATTEMPT_WINDOW = 15 * 60 * 1000;
const ATTEMPT_LIMIT = 10;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const INVALID_CREDENTIALS = 'Identifiant ou mot de passe incorrect.';
const DUMMY_HASH = `pbkdf2-sha256$${HASH_ITERATIONS}$${'0'.repeat(32)}$${'0'.repeat(64)}`;
const encoder = new TextEncoder();

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

function unhex(value: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index++) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

async function digest(value: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

function validPassword(password: string): void {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    throw new AuthError(400, 'Le mot de passe doit contenir entre 12 et 128 caractères.');
  }
}

function normalizeUsername(username: string): string {
  return typeof username === 'string' ? username.trim().toLowerCase() : '';
}

async function derivePassword(password: string, salt: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: HASH_ITERATIONS }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  validPassword(password);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await derivePassword(password, salt);
  return `pbkdf2-sha256$${HASH_ITERATIONS}$${hex(salt)}$${hex(derived)}`;
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const match = /^pbkdf2-sha256\$100000\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(storedHash);
  const validInput = typeof password === 'string' && password.length <= 128;
  const fallback = DUMMY_HASH.split('$');
  const actual = await derivePassword(validInput ? password : '', unhex(match?.[1] ?? fallback[2]));
  const expected = unhex(match?.[2] ?? fallback[3]);
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= actual[index] ^ expected[index];
  return !!match && validInput && difference === 0;
}

function principal(row: UserRow): AuthPrincipal {
  return { id: row.id, username: row.username, name: row.name, role: 'administrator', workspaceId: row.workspace_id, resourceId: row.resource_id ?? 'resource-claire' };
}

export function publicAuthUser(value: AuthPrincipal, role = value.role): AuthUser {
  return { id: value.id, username: value.username, name: value.name, role };
}

function cookieName(secure: boolean): string {
  return secure ? '__Host-planzone8-session' : 'planzone8-session-local';
}

export function sessionCookie(token: string, secure: boolean): string {
  if (!TOKEN_PATTERN.test(token)) throw new TypeError('Invalid session token');
  return `${cookieName(secure)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `${cookieName(secure)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function readSessionToken(cookieHeader: string | null | undefined, secure: boolean): string | undefined {
  const name = cookieName(secure);
  const tokens = (cookieHeader ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
  if (tokens.length !== 1) return undefined;
  const token = tokens[0].slice(name.length + 1);
  return TOKEN_PATTERN.test(token) ? token : undefined;
}

export class AuthManager {
  private schemaReady?: Promise<void>;
  private readonly now: () => number;

  constructor(private readonly database: AuthDatabase, options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
        for (const statement of AUTH_SCHEMA) await this.database.run(statement);
        const column = () => this.database.first("SELECT name FROM pragma_table_info('auth_users') WHERE name = 'resource_id'");
        if (!await column()) {
          try { await this.database.run("ALTER TABLE auth_users ADD COLUMN resource_id TEXT NOT NULL DEFAULT 'resource-claire'"); }
          catch (error) { if (!await column()) throw error; }
        }
        await this.database.run('CREATE UNIQUE INDEX IF NOT EXISTS auth_users_resource ON auth_users(workspace_id, resource_id)');
      })().catch(error => { this.schemaReady = undefined; throw error; });
    }
    return this.schemaReady;
  }

  async createAdmin(input: { username: string; password: string; name?: string; workspaceId?: string }): Promise<boolean> {
    await this.ensureSchema();
    const username = normalizeUsername(input.username);
    if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(username)) throw new AuthError(400, 'Identifiant administrateur invalide.');
    if (await this.database.first('SELECT id FROM auth_users WHERE username = ?', [username])) return false;
    const name = input.name?.trim() || 'Administrateur';
    if (name.length > 120) throw new AuthError(400, 'Nom administrateur trop long.');
    if (input.workspaceId && !UUID_PATTERN.test(input.workspaceId)) throw new AuthError(400, 'Espace de travail invalide.');
    const passwordHash = await hashPassword(input.password);
    const result = await this.database.run(
      'INSERT OR IGNORE INTO auth_users (id, username, name, password_hash, workspace_id) VALUES (?, ?, ?, ?, ?)',
      [crypto.randomUUID(), username, name, passwordHash, input.workspaceId ?? crypto.randomUUID()],
    );
    return result.changes === 1;
  }

  async members(workspaceId: string): Promise<{ resourceId: string; username: string }[]> {
    await this.ensureSchema();
    // The adapter intentionally exposes only first/run; a single JSON aggregate works on SQLite and D1.
    const row = await this.database.first<{ members: string }>("SELECT json_group_array(json_object('resourceId', resource_id, 'username', username)) AS members FROM auth_users WHERE workspace_id = ?", [workspaceId]);
    return JSON.parse(row?.members ?? '[]');
  }

  async createMember(input: { username: string; password: string; name: string; resourceId: string; workspaceId: string }): Promise<void> {
    await this.ensureSchema();
    const username = normalizeUsername(input.username);
    if (!/^[a-z0-9][a-z0-9._@+-]{2,79}$/.test(username)) throw new AuthError(400, 'L’identifiant doit contenir 3 à 80 caractères : lettres, chiffres, point, tiret ou @.');
    if (!input.resourceId || input.resourceId === 'resource-claire' || !UUID_PATTERN.test(input.workspaceId)) throw new AuthError(400, 'Membre ou espace de travail invalide.');
    if (await this.database.first('SELECT id FROM auth_users WHERE username = ? OR (workspace_id = ? AND resource_id = ?)', [username, input.workspaceId, input.resourceId])) throw new AuthError(409, 'Cet identifiant ou ce membre possède déjà un accès de connexion.');
    const passwordHash = await hashPassword(input.password);
    const result = await this.database.run('INSERT OR IGNORE INTO auth_users (id, username, name, password_hash, workspace_id, resource_id, legacy_adopted) VALUES (?, ?, ?, ?, ?, ?, 1)',
      [crypto.randomUUID(), username, input.name.trim().slice(0, 120), passwordHash, input.workspaceId, input.resourceId]);
    if (result.changes !== 1) throw new AuthError(409, 'Cet identifiant ou ce membre possède déjà un accès de connexion.');
  }

  private async consumeAttempt(username: string, clientKey: string): Promise<string> {
    const now = this.now();
    const key = await digest(`${clientKey}\u0000${username.slice(0, 80)}`);
    await this.database.run('DELETE FROM auth_attempts WHERE window_start <= ?', [now - ATTEMPT_WINDOW]);
    await this.database.run(`INSERT INTO auth_attempts (key, count, window_start) VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET
        count = CASE WHEN auth_attempts.window_start <= ? THEN 1 ELSE auth_attempts.count + 1 END,
        window_start = CASE WHEN auth_attempts.window_start <= ? THEN excluded.window_start ELSE auth_attempts.window_start END`,
    [key, now, now - ATTEMPT_WINDOW, now - ATTEMPT_WINDOW]);
    const row = await this.database.first<{ count: number }>('SELECT count FROM auth_attempts WHERE key = ?', [key]);
    if (!row || row.count > ATTEMPT_LIMIT) throw new AuthError(429, 'Trop de tentatives. Réessayez dans 15 minutes.');
    return key;
  }

  private async issueSession(row: UserRow): Promise<{ principal: AuthPrincipal; token: string }> {
    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    const expiresAt = this.now() + SESSION_SECONDS * 1000;
    const result = await this.database.run(`INSERT INTO auth_sessions (token_hash, user_id, auth_version, expires_at)
      SELECT ?, id, auth_version, ? FROM auth_users WHERE id = ? AND auth_version = ?`,
    [await digest(token), expiresAt, row.id, row.auth_version]);
    if (result.changes !== 1) throw new AuthError(401, INVALID_CREDENTIALS);
    return { principal: principal(row), token };
  }

  async login(usernameInput: string, password: string, clientKey: string): Promise<{ principal: AuthPrincipal; token: string }> {
    await this.ensureSchema();
    const username = normalizeUsername(usernameInput);
    const attemptKey = await this.consumeAttempt(username, clientKey);
    const row = username.length <= 80
      ? await this.database.first<UserRow>('SELECT * FROM auth_users WHERE username = ?', [username]) : null;
    const passwordMatches = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
    if (!row || !passwordMatches) throw new AuthError(401, INVALID_CREDENTIALS);
    const unchanged = await this.database.first<UserRow>('SELECT * FROM auth_users WHERE id = ? AND auth_version = ? AND password_hash = ?',
      [row.id, row.auth_version, row.password_hash]);
    if (!unchanged) throw new AuthError(401, INVALID_CREDENTIALS);
    await this.database.run('DELETE FROM auth_sessions WHERE expires_at <= ?', [this.now()]);
    const session = await this.issueSession(unchanged);
    await this.database.run('DELETE FROM auth_attempts WHERE key = ?', [attemptKey]);
    return session;
  }

  private async sessionUser(token?: string): Promise<UserRow | null> {
    await this.ensureSchema();
    if (!token || !TOKEN_PATTERN.test(token)) return null;
    return this.database.first<UserRow>(`SELECT users.* FROM auth_sessions AS sessions
      JOIN auth_users AS users ON users.id = sessions.user_id AND users.auth_version = sessions.auth_version
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?`, [await digest(token), this.now()]);
  }

  async authenticate(token?: string): Promise<AuthPrincipal | null> {
    const row = await this.sessionUser(token);
    return row ? principal(row) : null;
  }

  async logout(token?: string): Promise<void> {
    await this.ensureSchema();
    if (token && TOKEN_PATTERN.test(token)) await this.database.run('DELETE FROM auth_sessions WHERE token_hash = ?', [await digest(token)]);
  }

  async changePassword(token: string, currentPassword: string, newPassword: string): Promise<{ principal: AuthPrincipal; token: string }> {
    const row = await this.sessionUser(token);
    if (!row) throw new AuthError(401, 'Connexion requise.');
    if (!await verifyPassword(currentPassword, row.password_hash)) throw new AuthError(400, 'Le mot de passe actuel est incorrect.');
    validPassword(newPassword);
    const newHash = await hashPassword(newPassword);
    const result = await this.database.run(`UPDATE auth_users SET password_hash = ?, auth_version = auth_version + 1
      WHERE id = ? AND auth_version = ? AND password_hash = ?`, [newHash, row.id, row.auth_version, row.password_hash]);
    if (result.changes !== 1) throw new AuthError(409, 'Le mot de passe a changé. Reconnectez-vous.');
    await this.database.run('DELETE FROM auth_sessions WHERE user_id = ? AND auth_version <= ?', [row.id, row.auth_version]);
    const updated = await this.database.first<UserRow>(
      'SELECT * FROM auth_users WHERE id = ? AND auth_version = ? AND password_hash = ?',
      [row.id, row.auth_version + 1, newHash],
    );
    if (!updated) throw new AuthError(409, 'Le mot de passe a changé. Reconnectez-vous.');
    return this.issueSession(updated);
  }

  async adoptLegacyWorkspace(value: AuthPrincipal, legacyId: string): Promise<AuthPrincipal> {
    await this.ensureSchema();
    if (value.resourceId !== 'resource-claire') return value;
    if (!UUID_PATTERN.test(legacyId)) return value;
    const table = await this.database.first<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'demo_workspaces'");
    if (table) await this.database.run(`UPDATE auth_users SET workspace_id = ?, legacy_adopted = 1
      WHERE id = ? AND legacy_adopted = 0
        AND EXISTS (SELECT 1 FROM demo_workspaces WHERE id = ?)
        AND NOT EXISTS (SELECT 1 FROM demo_workspaces WHERE id = auth_users.workspace_id AND revision > 0)`,
    [legacyId, value.id, legacyId]);
    const row = await this.database.first<UserRow>('SELECT * FROM auth_users WHERE id = ?', [value.id]);
    return row ? principal(row) : value;
  }
}
