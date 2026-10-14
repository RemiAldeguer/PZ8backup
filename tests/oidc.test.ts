import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import test from 'node:test';
import { handleOidc, type OidcEnv } from '../cloudflare/oidc.ts';

const origin = 'https://planzone8.codex.f10web.com';
const issuer = 'https://login.codex.f10web.com/cas/oidc';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwtPart = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const key = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig' };

function env(): OidcEnv {
  return { OIDC_CLIENT_ID: 'planzone8', OIDC_CLIENT_SECRET: 'test-secret', OIDC_COOKIE_KEY: randomBytes(32).toString('hex'),
    ASSETS: { async fetch() { return new Response('private asset', { headers: { 'Content-Type': 'text/html' } }); } } };
}

function request(path: string, cookies = '') { return new Request(origin + path, { headers: cookies ? { Cookie: cookies } : undefined }); }
function cookies(response: Response) { return response.headers.getSetCookie().map(item => item.split(';')[0]).join('; '); }

// Fake only the identity provider: never make network calls from tests.
test('unauthenticated arrival redirects to CAS; callback exchanges code and returns to the site; an existing session does not contact CAS', async t => {
  const configuration = env();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    const target = String(input);
    if (target.endsWith('/oidcAccessToken')) {
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get('grant_type'), 'authorization_code');
      assert.equal(body.get('redirect_uri'), `${origin}/auth/callback`);
      assert.ok(body.get('code_verifier'));
      assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization, `Basic ${btoa('planzone8:test-secret')}`);
      const now = Math.floor(Date.now() / 1000);
      const header = jwtPart({ alg: 'RS256', kid: 'test-key' });
      const claims = jwtPart({ iss: issuer, sub: 'user-1', aud: 'planzone8', nonce, exp: now + 3600, iat: now });
      const unsigned = `${header}.${claims}`;
      const idToken = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')}`;
      return Response.json({ access_token: 'access-token', id_token: idToken, expires_in: 3600 });
    }
    if (target.endsWith('/jwks')) return Response.json({ keys: [key] });
    if (target.endsWith('/oidcProfile')) return Response.json({ sub: 'user-1' });
    if (target.endsWith('/api/planzones/current')) {
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer access-token');
      return Response.json({ uuid: 'planzone-1', name: 'Mon espace', confidential: 'non exposé' });
    }
    throw new Error(`Unexpected fetch: ${target}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const first = await handleOidc(request('/'), configuration);
  assert.equal(first.status, 302);
  const authorization = new URL(first.headers.get('Location')!);
  assert.equal(authorization.origin, 'https://login.codex.f10web.com');
  assert.equal(authorization.pathname, '/cas/oidc/oidcAuthorize');
  assert.equal(authorization.searchParams.get('scope'), 'openid profile email');
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorization.searchParams.get('redirect_uri'), `${origin}/auth/callback`);
  assert.equal(calls, 0);
  const nonce = await (async () => {
    // The nonce is opaque to the browser; a test-only key import decrypts the sealed flow cookie.
    const value = first.headers.getSetCookie()[0].split(';')[0].split('=')[1];
    const [iv, ciphertext] = value.split('.');
    const secret = await crypto.subtle.importKey('raw', Buffer.from(configuration.OIDC_COOKIE_KEY, 'hex'), 'AES-GCM', false, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(iv, 'base64url') }, secret, Buffer.from(ciphertext, 'base64url'));
    return (JSON.parse(new TextDecoder().decode(plaintext)) as { nonce: string }).nonce;
  })();
  const result = await handleOidc(request(`/auth/callback?code=authorization-code&state=${authorization.searchParams.get('state')}`, cookies(first)), configuration);
  assert.equal(result.status, 302);
  assert.equal(result.headers.get('Location'), `${origin}/`);
  assert.equal(calls, 3);
  assert.ok(result.headers.getSetCookie().some(item => item.startsWith('__Host-planzone8-oidc-session=') && item.includes('HttpOnly') && item.includes('Secure')));
  const existing = await handleOidc(request('/', cookies(result)), configuration);
  assert.equal(existing.status, 200);
  assert.equal(await existing.text(), 'private asset');
  assert.equal(existing.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
  assert.equal(calls, 3);
  const again = await handleOidc(request('/auth/login', cookies(result)), configuration);
  assert.equal(again.headers.get('Location'), `${origin}/`);
  assert.equal(calls, 3);
  const current = await handleOidc(request('/api/planzones/current', cookies(result)), configuration);
  assert.equal(current.status, 200);
  assert.deepEqual(await current.json(), { name: 'Mon espace', uuid: 'planzone-1' });
  assert.equal(current.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(calls, 4);
});

test('invalid state, missing configuration, foreign origin and unauthenticated assets cannot bypass the gate', async () => {
  const configuration = env();
  assert.equal((await handleOidc(new Request('https://elsewhere.example/'), configuration)).status, 403);
  assert.equal((await handleOidc(request('/assets/index.js'), configuration)).status, 401);
  assert.equal((await handleOidc(request('/api/planzones/current'), configuration)).status, 401);
  assert.equal((await handleOidc(request('/auth/callback?code=fake&state=fake'), configuration)).status, 400);
  assert.equal((await handleOidc(request('/'), { ...configuration, OIDC_CLIENT_ID: '' })).status, 503);
});
