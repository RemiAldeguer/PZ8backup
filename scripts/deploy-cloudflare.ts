import { spawn } from 'node:child_process';
import { access, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthManager, type AuthDatabase } from '../server/auth.ts';
import { parseWorkspaceKeys, type WorkspaceKeys } from '../server/workspace-crypto.ts';
import { migrateWorkspaceEncryption, preflightWorkspaceEncryption, sealPlaintextWrites, type MigrationDatabase, type MigrationRow } from './workspace-encryption.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const deploymentDirectory = path.join(root, '.cloudflare');
const receiptPath = path.join(deploymentDirectory, 'deployment.json');
const pendingPath = path.join(deploymentDirectory, 'deployment.pending.json');
const resolvedConfigPath = path.join(deploymentDirectory, 'wrangler.deploy.json');
const adminCredentialsPath = path.join(deploymentDirectory, 'admin-credentials.json');
const workerSecretsPath = path.join(deploymentDirectory, 'worker-secrets.json');
const apiBase = 'https://api.cloudflare.com/client/v4';

interface CloudflareEnvelope<T> {
  success: boolean;
  result: T;
  errors?: { code?: number; message?: string }[];
  result_info?: { page?: number; total_pages?: number; total_count?: number };
}

interface Database { uuid: string; name: string; }
interface Config {
  name: string;
  main: string;
  assets: { directory: string; [key: string]: unknown };
  d1_databases: { binding: string; database_name: string; database_id: string; migrations_dir?: string; [key: string]: unknown }[];
  [key: string]: unknown;
}
interface Receipt {
  accountId: string;
  workerName: string;
  databaseId: string;
  url: string;
  deployedAt: string;
  verified: boolean;
  deploymentMarker?: string;
}

interface QueryResult { success?: boolean; results?: Record<string, unknown>[]; meta?: { changes?: number }; }

/** The Cloudflare token stays in the environment; D1 only receives salted password hashes. */
class RemoteAuthDatabase implements AuthDatabase, MigrationDatabase {
  constructor(private endpoint: string) {}
  private async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
    const envelope = await api<QueryResult[]>('Configuration du compte administrateur', this.endpoint, 'POST', { sql, params });
    if (!envelope.result?.length || envelope.result.some(result => result.success !== true)) {
      throw new Error('D1 n’a pas confirmé la configuration du compte administrateur.');
    }
    return envelope.result[0];
  }
  async first<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    return (await this.query(sql, params)).results?.[0] as T ?? null;
  }
  async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    return { changes: (await this.query(sql, params)).meta?.changes ?? 0 };
  }
  async rows(sql: string, params: unknown[] = []): Promise<MigrationRow[]> {
    return (await this.query(sql, params)).results as unknown as MigrationRow[] ?? [];
  }
}

async function encryptionKeys(receipt: Receipt, db: RemoteAuthDatabase, workerExists: boolean): Promise<WorkspaceKeys> {
  const filePath = path.join(deploymentDirectory, 'data-encryption-keys.json');
  try {
    const saved = JSON.parse(await readFile(filePath, 'utf8'));
    if (saved.accountId !== receipt.accountId || saved.databaseId !== receipt.databaseId || saved.workerName !== receipt.workerName) throw new Error('La clé privée de chiffrement appartient à une autre cible.');
    return parseWorkspaceKeys(JSON.stringify(saved.keyring));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('La copie privée de la clé de chiffrement est invalide ou appartient à une autre cible. Aucun remplacement de clé n’a été effectué.');
  }
  const encrypted = await db.first('SELECT id FROM demo_workspaces WHERE json_extract(data, \'$.format\') = ? LIMIT 1', ['planzone8-aes-gcm']);
  const secrets = workerExists ? await api<{ name: string }[]>('Vérification de la clé de chiffrement existante', `/accounts/${receipt.accountId}/workers/scripts/${encodeURIComponent(receipt.workerName)}/secrets`).catch(error => {
    if (error instanceof CloudflareError && error.status === 404) return { success: true, result: [] };
    throw error;
  }) : { success: true, result: [] };
  if (encrypted || secrets.result.some(secret => secret.name === 'PLANZONE_DATA_KEYS')) throw new Error('La copie privée de la clé de chiffrement est manquante. Restaurez .cloudflare/data-encryption-keys.json ; aucune nouvelle clé n’a été créée.');
  const keyring = { current: 'v1', keys: { v1: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64') } };
  await writeFile(filePath, JSON.stringify({ accountId: receipt.accountId, databaseId: receipt.databaseId, workerName: receipt.workerName, keyring }), { mode: 0o600, flag: 'wx' });
  return parseWorkspaceKeys(JSON.stringify(keyring));
}

async function provisionAdmin(endpoint: string, receipt: Receipt): Promise<void> {
  const db = new RemoteAuthDatabase(endpoint);
  const manager = new AuthManager(db);
  await manager.ensureSchema();
  if (await db.first('SELECT id FROM auth_users WHERE username = ?', ['admin'])) {
    console.log('Compte admin existant conservé, sans modifier son mot de passe.');
    return;
  }
  let credentials: { username: string; password: string; accountId: string; databaseId: string; createdAt: string };
  try {
    credentials = JSON.parse(await readFile(adminCredentialsPath, 'utf8'));
    if (credentials.username !== 'admin' || credentials.accountId !== receipt.accountId || credentials.databaseId !== receipt.databaseId || typeof credentials.password !== 'string') {
      throw new Error('Le fichier privé du compte admin appartient à une autre cible. Aucun compte n’a été remplacé.');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    credentials = {
      username: 'admin', password: `Pz8-${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString('base64url')}`,
      accountId: receipt.accountId, databaseId: receipt.databaseId, createdAt: new Date().toISOString(),
    };
    await writeFile(adminCredentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  }
  const created = await manager.createAdmin({ username: credentials.username, password: credentials.password, name: 'Administrateur' });
  console.log(created ? 'Compte admin créé. Identifiants conservés dans le fichier privé .cloudflare/admin-credentials.json.' : 'Compte admin existant conservé.');
}

class CloudflareError extends Error {
  constructor(readonly operation: string, readonly status: number, readonly codes: number[]) {
    super(`${operation} : réponse Cloudflare HTTP ${status}${codes.length ? ` (codes ${codes.join(', ')})` : ''}. Vérifiez le compte, les permissions du jeton et l'accès réseau à api.cloudflare.com.`);
  }
}

let apiToken = '';

function safeMessage(value: string): string {
  return apiToken ? value.split(apiToken).join('[jeton masqué]') : value;
}

async function api<T>(operation: string, endpoint: string, method = 'GET', body?: unknown, attempt = 0): Promise<CloudflareEnvelope<T>> {
  let response: Response;
  try {
    response = await fetch(`${apiBase}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
        'Cloudflare-Workers-Script-Api-Date': '2025-08-01',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error(`${operation} : l'API Cloudflare est inaccessible. Conservez le proxy et les certificats de l'environnement ; vérifiez que api.cloudflare.com est autorisé.`);
  }
  let envelope: CloudflareEnvelope<T>;
  try { envelope = await response.json() as CloudflareEnvelope<T>; }
  catch { throw new CloudflareError(operation, response.status, []); }
  if (!response.ok || envelope.success !== true) {
    const codes = (envelope.errors ?? []).flatMap(error => typeof error.code === 'number' ? [error.code] : []);
    // Explicit upstream authentication rejections perform no database/script write.
    // Retry explicit auth rejections only, plus transient D1 failures in these
    // idempotent schema/reads and revision-guarded migration queries.
    const authRejected = [400, 401].includes(response.status) && codes.some(code => code === 9106 || code === 10000);
    const transientD1 = response.status === 500 && codes.includes(7500) && endpoint.endsWith('/query');
    if (attempt < 4 && (authRejected || transientD1)) {
      await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
      return api<T>(operation, endpoint, method, body, attempt + 1);
    }
    throw new CloudflareError(operation, response.status, codes);
  }
  return envelope;
}

async function readReceipt(filePath = receiptPath): Promise<Receipt | undefined> {
  try {
    const receipt = JSON.parse(await readFile(filePath, 'utf8')) as Receipt;
    if (typeof receipt.accountId !== 'string' || typeof receipt.workerName !== 'string' || typeof receipt.databaseId !== 'string') {
      throw new Error('invalid receipt');
    }
    return receipt;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error('Le reçu local .cloudflare/deployment.json est invalide. Vérifiez ce fichier avant tout redéploiement.');
  }
}

async function saveReceipt(receipt: Receipt, filePath = receiptPath): Promise<void> {
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, filePath);
}

async function workerMatches(accountPath: string, workerName: string, pending: Receipt): Promise<boolean> {
  if (!pending.deploymentMarker) return false;
  const settings = await api<{ bindings?: { name: string; type: string; text?: string; id?: string }[] }>(
    'Vérification d’une publication partielle', `${accountPath}/workers/scripts/${encodeURIComponent(workerName)}/settings`,
  );
  return Boolean(settings.result.bindings?.some(binding => binding.name === 'PLANZONE_DEPLOYMENT_MARKER' && binding.text === pending.deploymentMarker) &&
    settings.result.bindings?.some(binding => binding.name === 'DB' && binding.type === 'd1' && binding.id === pending.databaseId));
}

async function listDatabases(accountPath: string): Promise<Database[]> {
  const databases: Database[] = [];
  for (let page = 1; page <= 1_000; page++) {
    const envelope = await api<Database[]>('Lecture des bases D1', `${accountPath}/d1/database?page=${page}&per_page=100`);
    if (!Array.isArray(envelope.result)) throw new Error('La liste des bases D1 retournée par Cloudflare est invalide.');
    databases.push(...envelope.result);
    const pages = envelope.result_info?.total_pages;
    if (typeof pages === 'number' ? page >= pages : envelope.result.length < 100) return databases;
  }
  throw new Error('La liste des bases D1 est trop longue pour être vérifiée intégralement. Aucun déploiement n’a été effectué.');
}

async function deployWithWrangler(): Promise<void> {
  const wrangler = path.join(root, 'node_modules/wrangler/bin/wrangler.js');
  await access(wrangler);
  const configHome = process.env.XDG_CONFIG_HOME ?? '/tmp/planzone8-wrangler-config';
  const logPath = process.env.WRANGLER_LOG_PATH ?? '/tmp/planzone8-wrangler-logs';
  await mkdir(configHome, { recursive: true });
  await mkdir(logPath.endsWith('.log') ? path.dirname(logPath) : logPath, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [wrangler, 'deploy', '--config', resolvedConfigPath, '--secrets-file', workerSecretsPath], {
      cwd: root,
      env: {
        ...process.env,
        XDG_CONFIG_HOME: configHome,
        WRANGLER_LOG_PATH: logPath,
        WRANGLER_WRITE_LOGS: 'false',
        WRANGLER_SEND_METRICS: 'false',
        CI: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [child.stdout, child.stderr]) {
      let pending = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        pending += chunk;
        let end: number;
        while ((end = pending.indexOf('\n')) !== -1) {
          console.log(safeMessage(pending.slice(0, end)));
          pending = pending.slice(end + 1);
        }
      });
      stream.on('end', () => { if (pending) console.log(safeMessage(pending)); });
    }
    child.on('error', () => reject(new Error('Wrangler n’a pas pu démarrer. Installez les dépendances avec npm ci.')));
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`Wrangler a interrompu le déploiement (code ${code ?? 'inconnu'}). La base D1 existante est conservée.`)));
  });
}

async function verifyPublicUrl(url: string): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const [page, health] = await Promise.all([
        fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'error' }),
        fetch(`${url}/api/health`, { signal: AbortSignal.timeout(10_000), redirect: 'error' }),
      ]);
      const html = await page.text();
      const status = await health.json() as { status?: string; storage?: string; mode?: string };
      if (!page.ok || !/text\/html/i.test(page.headers.get('Content-Type') ?? '') || !html.includes('id="root"') ||
        !health.ok || status.status !== 'ok' || status.storage !== 'd1' || status.mode !== 'cloud-demo') throw new Error('Page ou API en attente.');
      const assets = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+\.(?:js|css))"/g)].map(match => new URL(match[1], url));
      if (!assets.length || assets.some(asset => asset.origin !== new URL(url).origin)) throw new Error('Assets invalides.');
      const responses = await Promise.all(assets.map(asset => fetch(asset, { signal: AbortSignal.timeout(10_000), redirect: 'error' })));
      if (responses.some((response, index) => !response.ok || !new RegExp(assets[index].pathname.endsWith('.css') ? 'text/css' : '(?:javascript|ecmascript)', 'i').test(response.headers.get('Content-Type') ?? ''))) throw new Error('Assets en attente.');
      const state = await fetch(`${url}/api/state`, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
      const body = await state.json() as { error?: string; projects?: unknown[] };
      if (state.status !== 401 || state.headers.has('Set-Cookie') || !body.error || body.projects) throw new Error('Protection de l’espace en attente.');
      const session = await fetch(`${url}/api/auth/session`, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
      const auth = await session.json() as { authenticated?: boolean };
      if (session.ok && auth.authenticated === false) return;
    } catch { /* La propagation DNS ou du Worker peut prendre quelques secondes. */ }
    if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 2_000));
  }
  throw new Error(`Le Worker a été publié, mais la vérification de ${url} et de son API a échoué. Le reçu local est conservé ; vérifiez les journaux Cloudflare et l’accès réseau avant de redéployer.`);
}

async function main(): Promise<void> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim() ?? '';
  if (!accountId || !apiToken) {
    throw new Error('Renseignez CLOUDFLARE_ACCOUNT_ID et CLOUDFLARE_API_TOKEN dans les secrets/variables de l’environnement. Le jeton doit autoriser Account Settings Read, Workers Scripts Edit et D1 Edit sur le compte choisi. Aucun déploiement n’a été effectué.');
  }
  if (!/^[a-f\d]{32}$/i.test(accountId)) throw new Error('CLOUDFLARE_ACCOUNT_ID doit contenir l’identifiant Cloudflare du compte (32 caractères hexadécimaux).');
  const config = JSON.parse(await readFile(path.join(root, 'wrangler.jsonc'), 'utf8')) as Config;
  if (!/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(config.name) || !config.main || !config.assets?.directory) {
    throw new Error('La configuration wrangler.jsonc ne contient pas un nom de Worker, un module et un dossier d’assets valides.');
  }
  const databaseBinding = config.d1_databases?.find(binding => binding.binding === 'DB');
  if (!databaseBinding?.database_name) throw new Error('La configuration doit définir la base D1 liée à DB.');
  const migrationDirectory = path.join(root, 'cloudflare/migrations');
  const migrationNames = (await readdir(migrationDirectory)).filter(name => /^\d+_.*\.sql$/.test(name)).sort();
  const migrations = await Promise.all(migrationNames.map(name => readFile(path.join(migrationDirectory, name), 'utf8')));
  await Promise.all([access(path.resolve(root, config.main)), access(path.resolve(root, config.assets.directory, 'index.html'))]);
  let receipt = await readReceipt();
  const pending = await readReceipt(pendingPath);
  const previousTarget = receipt ?? pending;
  if (previousTarget && (previousTarget.accountId !== accountId || previousTarget.workerName !== config.name)) {
    throw new Error('Le reçu local appartient à un autre compte ou Worker. Vérifiez .cloudflare/deployment.json et la cible Cloudflare avant de poursuivre.');
  }
  const accountPath = `/accounts/${encodeURIComponent(accountId)}`;
  console.log('Vérification du compte Cloudflare et de la cible…');
  await api<{ id: string }>('Vérification du compte', accountPath);
  let subdomain: string;
  try {
    const envelope = await api<{ subdomain?: string }>('Lecture du sous-domaine workers.dev', `${accountPath}/workers/subdomain`);
    subdomain = envelope.result?.subdomain ?? '';
  } catch (error) {
    if (error instanceof CloudflareError && error.codes.includes(10007)) {
      throw new Error('Ce compte n’a pas encore de sous-domaine workers.dev. Créez-le dans le tableau de bord Cloudflare « Workers & Pages », puis relancez. Aucun sous-domaine ni accord de service n’a été créé automatiquement.');
    }
    throw error;
  }
  if (!/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(subdomain)) {
    throw new Error('Le compte n’a pas de sous-domaine workers.dev valide. Configurez-le dans Cloudflare « Workers & Pages » avant de déployer.');
  }
  const [scripts, databases] = await Promise.all([
    api<{ id: string }[]>('Lecture des Workers existants', `${accountPath}/workers/scripts`),
    listDatabases(accountPath),
  ]);
  if (!Array.isArray(scripts.result)) throw new Error('La liste des Workers retournée par Cloudflare est invalide.');
  if (scripts.result.some(script => script.id === config.name) && !receipt) {
    if (pending && await workerMatches(accountPath, config.name, pending)) {
      receipt = { ...pending, verified: false };
      await saveReceipt(receipt);
      console.log('Publication partielle précédente reconnue ; reprise sur cette cible…');
    } else throw new Error(`Le Worker « ${config.name} » existe déjà, sans reçu local attestant ce déploiement. Aucun Worker n’a été remplacé. Examinez ce projet dans Cloudflare ou choisissez un nom de Worker disponible dans wrangler.jsonc.`);
  }
  const matches = databases.filter(database => database.name === databaseBinding.database_name);
  if (matches.length > 1) throw new Error('Plusieurs bases D1 portent le nom demandé. Sélectionnez une cible sans ambiguïté avant de déployer.');
  let database = matches[0];
  if (previousTarget && (!database || previousTarget.databaseId !== database.uuid)) {
    throw new Error('La base D1 ne correspond plus au reçu du précédent déploiement. Aucun changement n’a été effectué ; vérifiez la base et son identifiant avant de poursuivre.');
  }
  if (database && !previousTarget) {
    throw new Error(`La base D1 « ${databaseBinding.database_name} » existe déjà, sans reçu local de cette démonstration. Aucun schéma n’a été modifié. Examinez cette base ou choisissez un autre database_name dans wrangler.jsonc.`);
  }
  if (!database) {
    console.log('Création de la base D1 de démonstration…');
    database = (await api<Database>('Création D1', `${accountPath}/d1/database`, 'POST', { name: databaseBinding.database_name })).result;
  } else console.log('Réutilisation de la base D1 existante…');
  if (!database?.uuid) throw new Error('Cloudflare n’a pas retourné l’identifiant de la base D1.');
  await mkdir(deploymentDirectory, { recursive: true });
  const url = `https://${config.name}.${subdomain}.workers.dev`;
  const nextReceipt: Receipt = { accountId, workerName: config.name, databaseId: database.uuid, url, deployedAt: new Date().toISOString(), verified: false, deploymentMarker: crypto.randomUUID() };
  await saveReceipt(nextReceipt, pendingPath);
  console.log('Application du schéma D1 sans réinitialisation des espaces…');
  const queryEndpoint = `${accountPath}/d1/database/${encodeURIComponent(database.uuid)}/query`;
  for (const migration of migrations) {
    const query = await api<QueryResult[]>('Initialisation du schéma D1', queryEndpoint, 'POST', { sql: migration, params: [] });
    if (!Array.isArray(query.result) || query.result.length === 0 || query.result.some(result => result.success !== true)) {
      throw new Error('D1 n’a pas confirmé l’application du schéma. Le Worker n’a pas été déployé.');
    }
  }
  await provisionAdmin(queryEndpoint, nextReceipt);
  const remoteDb = new RemoteAuthDatabase(queryEndpoint);
  const dataKeys = await encryptionKeys(nextReceipt, remoteDb, scripts.result.some(script => script.id === config.name));
  const backupDirectory = path.join(deploymentDirectory, 'encrypted-backups', nextReceipt.deployedAt.replaceAll(':', '-'));
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  const backup = async (row: MigrationRow) => {
    await writeFile(path.join(backupDirectory, `${encodeURIComponent(row.id)}-${row.revision}.json`), JSON.stringify(row), { mode: 0o600 });
  };
  const preflight = await preflightWorkspaceEncryption(remoteDb, dataKeys, backup);
  console.log(`Stockage vérifié : ${preflight.total} espaces, ${preflight.plaintext} à chiffrer. Copies de récupération chiffrées conservées dans .cloudflare.`);
  // Wrangler installs this as a secret binding atomically with the new Worker version.
  await writeFile(workerSecretsPath, JSON.stringify({ PLANZONE_DATA_KEYS: JSON.stringify(dataKeys) }), { mode: 0o600 });
  const resolvedConfig: Config = {
    ...config,
    account_id: accountId,
    vars: { ...(config.vars as Record<string, unknown> | undefined), PLANZONE_DEPLOYMENT_MARKER: nextReceipt.deploymentMarker, PLANZONE_MIGRATE_PLAINTEXT: 'true' },
    main: path.resolve(root, config.main),
    assets: { ...config.assets, directory: path.resolve(root, config.assets.directory) },
    d1_databases: config.d1_databases.map(binding => ({
      ...binding,
      ...(binding.binding === 'DB' ? { database_id: database.uuid } : {}),
      ...(binding.migrations_dir ? { migrations_dir: path.resolve(root, binding.migrations_dir) } : {}),
    })),
  };
  delete resolvedConfig.$schema;
  await writeFile(resolvedConfigPath, `${JSON.stringify(resolvedConfig, null, 2)}\n`, { mode: 0o600 });
  console.log('Publication du Worker et des fichiers de l’application…');
  try { await deployWithWrangler(); }
  catch (error) {
    try {
      if (await workerMatches(accountPath, config.name, nextReceipt)) await saveReceipt(nextReceipt);
    } catch { /* Le reçu de préparation permet une vérification lors de la reprise. */ }
    throw error;
  }
  await saveReceipt(nextReceipt);
  {
    console.log('Migration des espaces existants avec conservation des modifications concurrentes…');
    await sealPlaintextWrites(remoteDb);
    const migrated = await migrateWorkspaceEncryption(remoteDb, dataKeys, backup);
    console.log(`${migrated} espaces migrés ; désactivation de la lecture des anciennes données en clair…`);
    (resolvedConfig.vars as Record<string, unknown>).PLANZONE_MIGRATE_PLAINTEXT = 'false';
    await writeFile(resolvedConfigPath, `${JSON.stringify(resolvedConfig, null, 2)}\n`, { mode: 0o600 });
    await deployWithWrangler();
  }
  console.log('Activation et vérification de l’adresse workers.dev…');
  const subdomainPath = `${accountPath}/workers/scripts/${encodeURIComponent(config.name)}/subdomain`;
  await api('Activation workers.dev', subdomainPath, 'POST', { enabled: true, previews_enabled: false });
  const enabled = await api<{ enabled?: boolean }>('Vérification workers.dev', subdomainPath);
  if (enabled.result.enabled !== true) throw new Error('Cloudflare n’a pas confirmé l’activation de workers.dev. Le reçu du Worker publié est conservé.');
  await verifyPublicUrl(url);
  await saveReceipt({ ...nextReceipt, verified: true });
  console.log(`Planzone 8 est disponible : ${url}`);
  console.log('Accès protégé : connexion administrateur requise pour consulter et modifier les données.');
}

main().catch(error => {
  console.error(safeMessage(error instanceof Error ? error.message : 'Le déploiement Cloudflare a échoué.'));
  process.exitCode = 1;
});
