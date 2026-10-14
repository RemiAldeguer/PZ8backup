import { readFile, readdir, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { hash } = require('blake3-wasm');

// An isolated frontend release: upload public assets and preserve every live backend module.
// No database queries, schema changes, provisioning or secret values are involved.
const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
const expectedBackendHash = process.env.PLANZONE_EXPECTED_BACKEND_HASH;
const directory = path.resolve(process.argv[2] ?? '');
if (!account || !token || !/^[a-f0-9]{64}$/.test(expectedBackendHash ?? '') || !process.argv[2]) throw new Error('Provide an asset directory, Cloudflare environment credentials and PLANZONE_EXPECTED_BACKEND_HASH.');
const worker = 'planzone8-demo';
const base = `/accounts/${account}/workers/scripts/${worker}`;
const apiOrigin = 'https://api.cloudflare.com/client/v4';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function request(endpoint, options = {}, jwt = token, attempt = 0) {
 const response = await fetch(apiOrigin + endpoint, { ...options, headers: { Authorization: `Bearer ${jwt}`, ...options.headers }, signal: AbortSignal.timeout(30000) });
 if (!response.ok) {
  const codes = (await response.clone().json().catch(() => ({}))).errors?.map(error => error.code) ?? [];
  if (jwt === token && attempt < 3 && [400,401].includes(response.status) && codes.some(code => [9106,10000].includes(code))) { await new Promise(resolve => setTimeout(resolve,250)); return request(endpoint, options, jwt, attempt + 1); }
  throw new Error(`Cloudflare HTTP ${response.status} (${codes.join(',')}) for ${endpoint.replace(account, '[account]')}.`);
 }
 return response;
}
async function api(endpoint, options, jwt) { const result = await (await request(endpoint,options,jwt)).json(); if (!result.success) throw new Error('Cloudflare did not confirm the operation.'); return result.result; }
async function backend() {
 const form = await (await request(base + '/content/v2')).formData();
 const files = []; for (const [name,file] of form) { if (typeof file === 'string') throw new Error('Unexpected live module format.'); files.push({name,type:file.type,bytes:Buffer.from(await file.arrayBuffer())}); }
 files.sort((a,b) => a.name.localeCompare(b.name));
 return {files, hash:sha(Buffer.concat(files.flatMap(file => [Buffer.from(file.name + '\0'),file.bytes])))};
}
const live = await backend();
if (live.hash !== expectedBackendHash) throw new Error('The live backend has changed; release cancelled before uploads.');
const settings = await api(base + '/settings');
const bindings = settings.bindings ?? [];
if (bindings.some(item => !['assets','d1','plain_text','json','secret_text','secret_key'].includes(item.type)) || !bindings.some(item => item.name === 'DB' && item.type === 'd1') || !bindings.some(item => item.name === 'ASSETS' && item.type === 'assets')) throw new Error('Unexpected live bindings; no deployment performed.');
const deployments = await api(base + '/deployments');
const manifest = {}; const files = new Map();
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.xml':'application/xml; charset=utf-8','.txt':'text/plain; charset=utf-8','.json':'application/json; charset=utf-8','.ico':'image/x-icon','.woff2':'font/woff2'};
async function visit(relative = '') {
 for (const entry of await readdir(path.join(directory,relative),{withFileTypes:true})) {
  const filename=path.join(relative,entry.name);
  if(entry.isSymbolicLink()) throw new Error('Public assets must not include symbolic links.');
  if(entry.isDirectory()){await visit(filename);continue;}
  if(!entry.isFile() || !types[path.extname(filename)] || /(?:^|\/)(?:\.env|_worker\.js)|\.map$/.test(filename)) throw new Error('Unexpected public asset type.');
  const bytes=await readFile(path.join(directory,filename));
  const digest=hash(bytes.toString('base64')+path.extname(filename).slice(1)).toString('hex').slice(0,32);
  const url='/'+filename.split(path.sep).join('/'); manifest[url]={hash:digest,size:bytes.length}; files.set(digest,{url,bytes,type:types[path.extname(filename)]});
 }
}
await visit();
if(!manifest['/index.html']) throw new Error('Missing application entry point.');
console.log(`Preparing ${Object.keys(manifest).length} public assets; live backend modules preserved.`);
const session=await api(base+'/assets-upload-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({manifest})});
const single=JSON.parse(Buffer.from(session.jwt.split('.')[1],'base64url').toString()).wrangler_single_asset_uploads===true;
let jwt=session.buckets.flat().length ? null : session.jwt;
for(const bucket of session.buckets){
 if(single){for(const digest of bucket){const file=files.get(digest);if(!file)throw new Error('Unknown requested asset.');const result=await api(`/accounts/${account}/workers/assets/upload/${digest}`,{method:'POST',headers:{'Content-Type':file.type},body:file.bytes},session.jwt);jwt=result.jwt??jwt;}}
 else {const payload=new FormData();for(const digest of bucket){const file=files.get(digest);if(!file)throw new Error('Unknown requested asset.');payload.append(digest,new Blob([file.bytes.toString('base64')],{type:file.type}),digest);}const result=await api(`/accounts/${account}/workers/assets/upload?base64=true`,{method:'POST',body:payload},session.jwt);jwt=result.jwt??jwt;}
}
if(!jwt)throw new Error('Asset upload was not completed.');
const latest=await api(base+'/deployments');
if(JSON.stringify(latest)!==JSON.stringify(deployments) || (await backend()).hash!==live.hash) throw new Error('Concurrent deployment detected; release cancelled before deployment.');
const metadata={main_module:'worker.js',bindings:bindings.filter(item=>!['secret_text','secret_key'].includes(item.type)),keep_bindings:['secret_text','secret_key'],compatibility_date:settings.compatibility_date,compatibility_flags:settings.compatibility_flags,tags:settings.tags,logpush:settings.logpush,placement:settings.placement,tail_consumers:settings.tail_consumers,annotations:settings.annotations,assets:{jwt,config:{not_found_handling:'single-page-application',run_worker_first:['/api','/api/*']}}};
if(!live.files.some(file=>file.name===metadata.main_module))throw new Error('Unexpected main module.');
const payload=new FormData();payload.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));for(const file of live.files)payload.set(file.name,new Blob([file.bytes],{type:file.type}),file.name);
const receipt={workerName:worker,backendHash:live.hash,assetHash:sha(JSON.stringify(manifest)),previousDeployments:deployments,deployedAt:new Date().toISOString(),verified:false};
await mkdir('.cloudflare',{recursive:true});await writeFile('.cloudflare/frontend-deployment.pending.json',JSON.stringify(receipt,null,2),{mode:0o600});
await api(base,{method:'PUT',body:payload});
const active=await api(base+'/deployments');receipt.versionId=active.deployments?.[0]?.versions?.[0]?.version_id;
if(!receipt.versionId)throw new Error('Missing active version after publication.');
if((await backend()).hash!==live.hash)throw new Error('Backend preservation check failed.');
const after=await api(base+'/settings');
const bindingIdentity=value=>JSON.stringify(value.map(item=>({...item})).sort((a,b)=>a.name.localeCompare(b.name)));
if(bindingIdentity(after.bindings)!==bindingIdentity(bindings))throw new Error('Live bindings verification failed.');
const subdomain=await api(`/accounts/${account}/workers/subdomain`);const url=`https://${worker}.${subdomain.subdomain}.workers.dev`;
for(let attempt=0;attempt<12;attempt++){
 const index=await fetch(url+'/?release='+receipt.assetHash,{cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(index.ok && sha(Buffer.from(await index.arrayBuffer()))===sha(files.get(manifest['/index.html'].hash).bytes)){receipt.verified=true;break;}
 await new Promise(resolve=>setTimeout(resolve,1500));
}
if(!receipt.verified)throw new Error('Public frontend has not confirmed the release.');
for(const [asset, info] of Object.entries(manifest).filter(([name])=>name.startsWith('/assets/')||name==='/planzone-logo.png')){const result=await fetch(url+asset,{signal:AbortSignal.timeout(15000)});if(!result.ok||sha(Buffer.from(await result.arrayBuffer()))!==sha(files.get(info.hash).bytes))throw new Error('Public asset verification failed.');}
if((await fetch(url+'/api/state')).status!==401)throw new Error('Anonymous API access check failed.');
receipt.url=url;await writeFile('.cloudflare/frontend-deployment.pending.json',JSON.stringify(receipt,null,2),{mode:0o600});await rename('.cloudflare/frontend-deployment.pending.json','.cloudflare/frontend-deployment.json');console.log(JSON.stringify({url,verified:true,backendUnchanged:true,bindingsPreserved:true,versionId:receipt.versionId,assets:Object.keys(manifest).length}));
