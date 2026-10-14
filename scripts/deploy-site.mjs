import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Publishes only generated public website assets. No application, database or secret binding.
const root = fileURLToPath(new URL('../', import.meta.url));
const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
const workerName = 'planzone8-site';
const applicationName = 'planzone8-demo';
if (!account || !/^[a-f0-9]{32}$/i.test(account) || !token) throw new Error('Configurez CLOUDFLARE_ACCOUNT_ID et CLOUDFLARE_API_TOKEN dans l’environnement.');
if (workerName === applicationName) throw new Error('La cible du site doit être distincte de l’application.');
const target = `/accounts/${account}/workers/scripts/${workerName}`;

async function api(endpoint, options = {}, attempt = 0) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${endpoint}`, {
    ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers },
  });
  const result = await response.json();
  if (response.status === 404 && options.method === undefined) return null;
  if (!response.ok || !result.success) {
    const codes = result.errors?.map(error => error.code) ?? [];
    if (attempt < 3 && [400, 401].includes(response.status) && codes.some(code => code === 9106 || code === 10000)) {
      await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
      return api(endpoint, options, attempt + 1);
    }
    throw new Error(`Cloudflare a refusé l’opération (HTTP ${response.status}, codes ${codes.join(',')}).`);
  }
  return result.result;
}

const previous = await api(`${target}/settings`);
if (previous && (previous.bindings?.length || !previous.tags?.includes('planzone8-vitrine'))) {
  throw new Error('Un service différent occupe déjà ce nom. Aucun remplacement n’a été effectué.');
}
const subdomain = await api(`/accounts/${account}/workers/subdomain`);
if (!subdomain?.subdomain || !/^[a-z0-9-]+$/i.test(subdomain.subdomain)) throw new Error('Le sous-domaine workers.dev de ce compte est indisponible.');
const beforeApplication = await api(`/accounts/${account}/workers/scripts/${applicationName}/deployments`);
const files = [
  ['/', 'public/site/index.html', 'text/html; charset=utf-8'],
  ['/site/site.css', 'public/site/site.css', 'text/css; charset=utf-8'],
  ['/site/site.js', 'public/site/site.js', 'application/javascript; charset=utf-8'],
  ['/planzone-logo.png', 'public/planzone-logo.png', 'image/png'],
  ['/sitemap.xml', 'public/site/sitemap.xml', 'application/xml; charset=utf-8'],
  ['/robots.txt', 'public/site/robots.txt', 'text/plain; charset=utf-8'],
];
const routes = JSON.parse(await readFile(path.join(root, 'public/site/routes.json'), 'utf8'));
for (const route of routes.filter(item => item.path !== '/')) {
  if (!/^\/site\/(?:[a-z0-9-]+\/)+$/.test(route.path) || !/^public\/site\/(?:[a-z0-9-]+\/)+index\.html$/.test(route.file)
    || route.file !== 'public' + route.path + 'index.html') throw new Error('La liste des pages publiques est invalide.');
  files.push([route.path, route.file, 'text/html; charset=utf-8']);
}
const assets = {};
for (const [url, filename, type] of files) {
  const bytes = await readFile(path.join(root, filename));
  assets[url] = { data: bytes.toString('base64'), type, etag: `"${createHash('sha256').update(bytes).digest('hex')}"` };
}
const sourceHash = createHash('sha256').update(JSON.stringify(assets)).digest('hex');
const source = `const assets=${JSON.stringify(assets)};
export default { fetch(request) {
  const headers=new Headers({'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; connect-src 'none'"});
  if(!['GET','HEAD'].includes(request.method)){headers.set('Allow','GET, HEAD');return new Response('Méthode non autorisée.',{status:405,headers});}
  let pathname=new URL(request.url).pathname;
  if(['/index.html','/site','/site/','/site/index.html'].includes(pathname))pathname='/';
  else if(pathname.endsWith('/index.html'))pathname=pathname.slice(0,-10);
  else if(!Object.hasOwn(assets,pathname)&&Object.hasOwn(assets,pathname+'/'))pathname+='/';
  const asset=Object.hasOwn(assets,pathname)?assets[pathname]:null;
  if(!asset){headers.set('Content-Type','text/plain; charset=utf-8');return new Response(request.method==='HEAD'?null:'Page introuvable.',{status:404,headers});}
  headers.set('Content-Type',asset.type);headers.set('ETag',asset.etag);headers.set('Cache-Control',pathname==='/'?'no-cache':'public, max-age=3600, must-revalidate');
  if(request.headers.get('If-None-Match')===asset.etag)return new Response(null,{status:304,headers});
  return new Response(request.method==='HEAD'?null:Uint8Array.from(atob(asset.data),c=>c.charCodeAt(0)),{headers});
}};`;
const metadata = { main_module: 'site-worker.mjs', compatibility_date: '2026-10-06', bindings: [], tags: ['planzone8-vitrine'] };
const form = new FormData();
form.set('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
form.set('site-worker.mjs', new Blob([source], { type: 'application/javascript+module' }), 'site-worker.mjs');
console.log('Publication du site vitrine statique, sur un service distinct de l’application.');
const deployed = await api(target, { method: 'PUT', body: form });
await api(`${target}/subdomain`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true, previews_enabled: false }) });
const url = `https://${workerName}.${subdomain.subdomain}.workers.dev`;
await mkdir(path.join(root, '.cloudflare'), { recursive: true });
const receipt = { workerName, url, sourceHash, versionId: deployed.deployment_id ?? deployed.id, deployedAt: new Date().toISOString(), verified: false };
await writeFile(path.join(root, '.cloudflare/site-deployment.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 });
let verified = false;
for (let attempt = 0; attempt < 15 && !verified; attempt++) {
  try {
    const results = await Promise.all(files.map(async ([urlPath]) => {
      const response = await fetch(url + urlPath, { cache: 'no-store' });
      const body = new Uint8Array(await response.arrayBuffer());
      // Cloudflare can weaken an ETag when compressing text; verify the decoded bytes too.
      return response.status === 200 && response.headers.get('etag')?.replace(/^W\//, '') === assets[urlPath].etag
        && createHash('sha256').update(body).digest('hex') === assets[urlPath].etag.slice(1, -1);
    }));
    verified = results.every(Boolean);
  } catch { /* The new hostname can take a few seconds to propagate. */ }
  if (!verified) await new Promise(resolve => setTimeout(resolve, 2000));
}
if (!verified) throw new Error(`Le site a été publié, mais ses fichiers ne sont pas encore vérifiés : ${url}`);
const afterApplication = await api(`/accounts/${account}/workers/scripts/${applicationName}/deployments`);
if (JSON.stringify(beforeApplication) !== JSON.stringify(afterApplication)) throw new Error('La version de l’application a changé pendant cette publication. Vérifiez son déploiement séparément.');
receipt.verified = true;
receipt.verifiedAt = new Date().toISOString();
await writeFile(path.join(root, '.cloudflare/site-deployment.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ url, verified: true, sourceHash, applicationDeploymentUnchanged: true }));
