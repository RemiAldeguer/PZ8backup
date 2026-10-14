// Cloudflare Assets are private until the CAS OIDC authorization-code flow completes.
const ISSUER = 'https://login.codex.f10web.com/cas/oidc';
const AUTHORIZE = `${ISSUER}/oidcAuthorize`;
const TOKEN = `${ISSUER}/oidcAccessToken`;
const PROFILE = `${ISSUER}/oidcProfile`;
const JWKS = `${ISSUER}/jwks`;
const ORIGIN = 'https://planzone8.codex.f10web.com';
const FLOW_COOKIE = '__Host-planzone8-oidc-flow';
const SESSION_COOKIE = '__Host-planzone8-oidc-session';
const encoder = new TextEncoder();

export interface OidcEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  OIDC_CLIENT_ID: string;
  OIDC_CLIENT_SECRET: string;
  OIDC_COOKIE_KEY: string; // 64 hexadecimal characters, provisioned as a Wrangler secret
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error('Invalid base64url');
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function random(): string { return base64url(crypto.getRandomValues(new Uint8Array(32))); }

async function cookieKey(env: OidcEnv): Promise<CryptoKey> {
  if (!/^[a-f0-9]{64}$/i.test(env.OIDC_COOKIE_KEY ?? '')) throw new Error('OIDC_COOKIE_KEY must be 32 random bytes in hexadecimal');
  const bytes = Uint8Array.from(env.OIDC_COOKIE_KEY.match(/../g)!, pair => parseInt(pair, 16));
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function seal(key: CryptoKey, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(value)));
  return `${base64url(iv)}.${base64url(new Uint8Array(ciphertext))}`;
}

async function unseal(key: CryptoKey, value: string | undefined): Promise<unknown> {
  if (!value || value.length > 8192) return null;
  try {
    const parts = value.split('.');
    if (parts.length !== 2) return null;
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(parts[0]) }, key, decode(parts[1]));
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch { return null; }
}

function readCookie(request: Request, name: string): string | undefined {
  const found = (request.headers.get('Cookie') ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  return found.length === 1 ? found[0].slice(name.length + 1) : undefined;
}

function cookie(name: string, value: string, age: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  for (const item of cookies) headers.append('Set-Cookie', item);
  return new Response(null, { status: 302, headers });
}

function failure(message: string, status = 400): Response {
  return new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

async function validateIdToken(jwt: string, clientId: string, nonce: string, accessToken: string): Promise<string> {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('Invalid ID token');
  const header: unknown = JSON.parse(new TextDecoder().decode(decode(parts[0])));
  const claims: unknown = JSON.parse(new TextDecoder().decode(decode(parts[1])));
  if (!record(header) || header.alg !== 'RS256' || typeof header.kid !== 'string' || !record(claims)) throw new Error('Unsupported ID token');
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== ISSUER || !claims.sub || typeof claims.sub !== 'string' ||
    !(claims.aud === clientId || (Array.isArray(claims.aud) && claims.aud.includes(clientId) && (claims.aud.length === 1 || claims.azp === clientId))) ||
    claims.nonce !== nonce || typeof claims.exp !== 'number' || claims.exp <= now ||
    typeof claims.iat !== 'number' || claims.iat > now + 60 ||
    (claims.at_hash !== undefined && claims.at_hash !== base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(accessToken))).slice(0, 16)))) throw new Error('Invalid ID token claims');
  const response = await fetch(JWKS);
  if (!response.ok) throw new Error('JWKS unavailable');
  const keys: unknown = await response.json();
  if (!record(keys) || !Array.isArray(keys.keys)) throw new Error('Invalid JWKS');
  const jwk = keys.keys.find((item: unknown) => record(item) && item.kid === header.kid && item.kty === 'RSA' && (!item.use || item.use === 'sig')) as JsonWebKey | undefined;
  if (!jwk) throw new Error('Unknown signing key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`))) throw new Error('Invalid ID token signature');
  return claims.sub;
}

export async function handleOidc(request: Request, env: OidcEnv): Promise<Response> {
  const url = new URL(request.url);
  // Never trust an arbitrary Host header to construct an OAuth redirect URI.
  if (url.origin !== ORIGIN) return failure('Origine non autorisée.', 403);
  if (!env.OIDC_CLIENT_ID || !env.OIDC_CLIENT_SECRET) return failure('La connexion OIDC n’est pas configurée.', 503);
  const key = await cookieKey(env);
  const callback = `${ORIGIN}/auth/callback`;
  const now = Math.floor(Date.now() / 1000);
  if (url.pathname === '/auth/callback') {
    if (request.method !== 'GET') return failure('Méthode non autorisée.', 405);
    const cleared = cookie(FLOW_COOKIE, '', 0);
    const flow = await unseal(key, readCookie(request, FLOW_COOKIE));
    if (!record(flow) || typeof flow.state !== 'string' || typeof flow.verifier !== 'string' || typeof flow.nonce !== 'string' ||
      typeof flow.exp !== 'number' || flow.exp <= now || !url.searchParams.get('state') || flow.state !== url.searchParams.get('state') ||
      !url.searchParams.get('code') || url.searchParams.has('error')) return failure('Réponse de connexion invalide ou expirée. Réessayez depuis Planzone.');
    const credentials = btoa(`${env.OIDC_CLIENT_ID}:${env.OIDC_CLIENT_SECRET}`);
    const response = await fetch(TOKEN, { method: 'POST', headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: url.searchParams.get('code')!, redirect_uri: callback, code_verifier: flow.verifier }), redirect: 'error' });
    if (!response.ok) return failure('Échec de l’échange du code de connexion.', 401);
    const tokens: unknown = await response.json();
    if (!record(tokens) || typeof tokens.access_token !== 'string' || typeof tokens.id_token !== 'string' || typeof tokens.expires_in !== 'number' || tokens.expires_in <= 0) return failure('Réponse OIDC incomplète.', 401);
    try {
      const sub = await validateIdToken(tokens.id_token, env.OIDC_CLIENT_ID, flow.nonce, tokens.access_token);
      const profile = await fetch(PROFILE, { headers: { Authorization: `Bearer ${tokens.access_token}` }, redirect: 'error' });
      if (!profile.ok || (await profile.json() as { sub?: string }).sub !== sub) throw new Error('Userinfo mismatch');
      const age = Math.min(Math.floor(tokens.expires_in), 3600);
      const session = await seal(key, { accessToken: tokens.access_token, sub, exp: now + age });
      return redirect(ORIGIN + '/', [cleared, cookie(SESSION_COOKIE, session, age)]);
    } catch { return failure('Le jeton de connexion n’a pas pu être vérifié.', 401); }
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return failure('Méthode non autorisée.', 405);
  const session = await unseal(key, readCookie(request, SESSION_COOKIE));
  if (record(session) && typeof session.accessToken === 'string' && typeof session.sub === 'string' && typeof session.exp === 'number' && session.exp > now) {
    if (url.pathname === '/auth/login') return redirect(ORIGIN + '/');
    if (url.pathname === '/api/planzones/current') {
      if (request.method !== 'GET') return failure('Méthode non autorisée.', 405);
      try {
        const upstream = await fetch('https://core.codex.f10web.com/api/planzones/current', {
          headers: { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/json' },
          redirect: 'error', signal: AbortSignal.timeout(8000),
        });
        if (upstream.status === 401 || upstream.status === 403) return failure('La session ne permet pas de consulter la Planzone courante.', 401);
        if (!upstream.ok) return failure('La Planzone courante est indisponible.', 502);
        const current: unknown = await upstream.json();
        if (!record(current) || typeof current.name !== 'string' || typeof current.uuid !== 'string') return failure('Réponse de la Planzone courante invalide.', 502);
        return new Response(JSON.stringify({ name: current.name, uuid: current.uuid }), {
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
        });
      } catch { return failure('La Planzone courante est indisponible.', 502); }
    }
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'private, no-store');
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    headers.set('Referrer-Policy', 'same-origin');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  // Asset subrequests should never be replaced with HTML from the identity provider.
  if (url.pathname !== '/' && url.pathname !== '/auth/login') return failure('Connexion requise.', 401);
  const state = random();
  const nonce = random();
  const verifier = random();
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))));
  const flow = await seal(key, { state, nonce, verifier, exp: now + 300 });
  const authorize = new URL(AUTHORIZE);
  for (const [name, value] of Object.entries({ response_type: 'code', client_id: env.OIDC_CLIENT_ID, redirect_uri: callback, scope: 'openid profile email', state, nonce, code_challenge: challenge, code_challenge_method: 'S256' })) authorize.searchParams.set(name, value);
  return redirect(authorize.toString(), [cookie(FLOW_COOKIE, flow, 300), cookie(SESSION_COOKIE, '', 0)]);
}

export default { fetch: handleOidc };
