// HTTPS is terminated by the local nginx virtual host; only this server reads the CAS secret.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleOidc, type OidcEnv } from '../cloudflare/oidc.ts';

const origin = 'https://planzone8.codex.f10web.com';
const dist = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
  '.json': 'application/json', '.ico': 'image/x-icon', '.png': 'image/png', '.woff2': 'font/woff2',
};
const environment: OidcEnv = {
  OIDC_CLIENT_ID: process.env.OIDC_CLIENT_ID ?? '',
  OIDC_CLIENT_SECRET: process.env.OIDC_CLIENT_SECRET ?? '',
  OIDC_COOKIE_KEY: process.env.OIDC_COOKIE_KEY ?? '',
  ASSETS: {
    async fetch(request: Request): Promise<Response> {
      let pathname: string;
      try { pathname = decodeURIComponent(new URL(request.url).pathname); }
      catch { return new Response('Adresse invalide.', { status: 400 }); }
      if (pathname === '/') pathname = '/index.html';
      const path = resolve(dist, `.${pathname}`);
      if (!path.startsWith(dist + sep) || pathname.split('/').some(part => part.startsWith('.')) || /\.(sqlite|sqlite3|db|wal|shm)$/i.test(path)) {
        return new Response('Fichier introuvable.', { status: 404 });
      }
      const extension = path.slice(path.lastIndexOf('.'));
      if (!types[extension]) return new Response('Fichier introuvable.', { status: 404 });
      try {
        const bytes = await readFile(path);
        return new Response(request.method === 'HEAD' ? null : bytes, { headers: { 'Content-Type': types[extension] } });
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return new Response('Fichier introuvable.', { status: 404 });
        throw error;
      }
    },
  },
};
const port = Number(process.env.PORT ?? '3002');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT invalide');

createServer(async (incoming, outgoing) => {
  try {
    const path = incoming.url ?? '/';
    if (!path.startsWith('/') || path.startsWith('//') || path.length > 8192) {
      outgoing.writeHead(400).end(); return;
    }
    const request = new Request(origin + path, { method: incoming.method, headers: incoming.headers as HeadersInit });
    const response = await handleOidc(request, environment);
    const headers = Object.fromEntries(response.headers.entries());
    delete headers['set-cookie'];
    outgoing.writeHead(response.status, { ...headers, 'Set-Cookie': response.headers.getSetCookie() });
    if (incoming.method === 'HEAD' || !response.body) { outgoing.end(); return; }
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error('Échec du relais OIDC :', error instanceof Error ? error.name : 'UnknownError');
    outgoing.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end('Erreur de connexion.');
  }
}).listen(port, '127.0.0.1', () => console.log(`Passerelle OIDC en écoute sur 127.0.0.1:${port}`));
