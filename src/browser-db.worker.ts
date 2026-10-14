import sqlite3InitModule, { type Database, type Sqlite3Static, type SqlValue } from '@sqlite.org/sqlite-wasm';
import wasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url';
import { ApiService } from '../server/service.ts';
import { Pz7StoreCore } from '../server/pz7-store-core.ts';
import type { SqliteSync, SqliteValue } from '../server/sqlite-sync.ts';
import type { Entity } from '../shared/types.ts';

/** Keep SQLite and the synchronous domain service off the React/main thread. */
class WasmSqliteSync implements SqliteSync {
  constructor(readonly db: Database) {}
  prepare(sql: string) {
    const execute = (mode: 'all' | 'get' | 'run', params: SqliteValue[]) => {
      const statement = this.db.prepare(sql);
      try {
        if (params.length) statement.bind(params as SqlValue[]);
        if (mode === 'run') {
          while (statement.step()) { /* Complete statement and enforce constraints. */ }
          return undefined;
        }
        const rows: Record<string, unknown>[] = [];
        while (statement.step()) {
          rows.push(statement.get({}) as Record<string, unknown>);
          if (mode === 'get') break;
        }
        return mode === 'get' ? rows[0] : rows;
      } finally { statement.finalize(); }
    };
    return {
      get: (...params: SqliteValue[]) => execute('get', params) as Record<string, unknown> | undefined,
      all: (...params: SqliteValue[]) => execute('all', params) as Record<string, unknown>[],
      run: (...params: SqliteValue[]) => execute('run', params),
    };
  }
  exec(sql: string): void { this.db.exec(sql); }
  close(): void { this.db.close(); }
}

const META_DB = 'planzone8-browser-storage';
const META_KEY = 'active-database';
function metadata(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(META_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('settings');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
async function activeFile(): Promise<string | undefined> {
  const db = await metadata();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('settings').objectStore('settings').get(META_KEY);
      request.onsuccess = () => resolve(request.result as string | undefined);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
async function selectActiveFile(filename: string): Promise<void> {
  const db = await metadata();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('settings', 'readwrite');
      transaction.objectStore('settings').put(filename, META_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

let sqlite: Sqlite3Static;
let store: Pz7StoreCore | undefined;
let currentFilename: string | undefined;
let recoveryWarning: string | undefined;
const startup = (async () => {
  if (!self.isSecureContext || !self.crossOriginIsolated || !navigator.storage?.getDirectory)
    throw new Error('SQLite local nécessite HTTPS, OPFS et les en-têtes COOP/COEP. Utilisez un navigateur compatible.');
  // The upstream JS initializer accepts locateFile even though its published d.ts omits that option.
  const initialize = sqlite3InitModule as unknown as (options: { locateFile: (name: string) => string }) => Promise<Sqlite3Static>;
  sqlite = await initialize({ locateFile: () => wasmUrl });
  if (!sqlite.oo1.OpfsDb) throw new Error('Le stockage SQLite OPFS n’est pas disponible dans ce navigateur.');
  currentFilename = await activeFile();
  if (currentFilename) {
    try { store = new Pz7StoreCore(new WasmSqliteSync(new sqlite.oo1.OpfsDb(currentFilename, 'w'))); }
    catch (error) {
      // A missing/corrupt OPFS file must not prevent recovery from a manual backup.
      // Keep the old pointer until a validated replacement atomically takes its place.
      recoveryWarning = 'La base locale précédente est inaccessible. Importez votre sauvegarde .sqlite ; ne supprimez pas les données de ce site.';
      console.warn(recoveryWarning, error);
    }
  }
})();

type Request = { id: number; method: 'hasDatabase' | 'readState' | 'mutate' | 'importDatabase' | 'exportDatabase';
  payload?: { entity: Entity; method: 'POST' | 'PATCH' | 'DELETE'; body?: unknown; id?: string } | ArrayBuffer };
function requiredStore(): Pz7StoreCore {
  if (!store) throw new Error('Importez d’abord une base SQLite PZ7 préparée.');
  return store;
}
function checkCandidate(candidate: Pz7StoreCore): void {
  const db = candidate.db;
  if (db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw new Error('Le fichier SQLite est corrompu.');
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('La base contient des références invalides.');
  const state = new ApiService(candidate).readState();
  if (!state.resources.some(resource => resource.id === state.currentUser.id))
    throw new Error('Le compte local de référence est absent de cette base.');
}
async function importDatabase(bytes: ArrayBuffer): Promise<void> {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 100 || bytes.byteLength > 250 * 1024 * 1024)
    throw new Error('Choisissez un fichier SQLite PZ7 valide de moins de 250 Mo.');
  const filename = `/planzone8-${crypto.randomUUID()}.sqlite`;
  let candidate: Pz7StoreCore | undefined;
  try {
    await sqlite.oo1.OpfsDb.importDb(filename, new Uint8Array(bytes));
    candidate = new Pz7StoreCore(new WasmSqliteSync(new sqlite.oo1.OpfsDb(filename, 'w')));
    checkCandidate(candidate);
    // Authentification serveur sans utilité dans le navigateur : ne pas conserver ses secrets.
    for (const table of ['auth_sessions', 'auth_attempts', 'auth_users'])
      candidate.db.exec(`DROP TABLE IF EXISTS ${table}`);
    candidate.db.exec('VACUUM');
    checkCandidate(candidate);
    if (candidate.db.prepare("SELECT 1 FROM sqlite_master WHERE name LIKE 'auth_%' LIMIT 1").get())
      throw new Error('Les comptes serveur n’ont pas pu être supprimés de la copie locale.');
    // Atomic metadata switch: the previous database stays selected if import/validation fails.
    await selectActiveFile(filename);
    const previous = store;
    const previousFilename = currentFilename;
    store = candidate;
    currentFilename = filename;
    recoveryWarning = undefined;
    candidate = undefined;
    if (previous && previousFilename && previousFilename !== filename) {
      try {
        previous.close();
        await (await navigator.storage.getDirectory()).removeEntry(previousFilename.slice(1));
      } catch (error) {
        // The new DB is already active: failed cleanup must not delete or roll it back.
        console.warn('Ancienne copie OPFS non supprimée après remplacement.', error);
      }
    }
  } catch (error) {
    try { candidate?.close(); } catch { /* Still remove the failed import if possible. */ }
    try { await (await navigator.storage.getDirectory()).removeEntry(filename.slice(1)); } catch { /* A failed candidate is never selected. */ }
    throw error;
  }
}
function exportDatabase(): Uint8Array<ArrayBuffer> {
  const pointer = (requiredStore().db as WasmSqliteSync).db.pointer;
  if (!pointer) throw new Error('La base SQLite locale est fermée.');
  return sqlite.capi.sqlite3_js_db_export(pointer);
}
async function handle(request: Request): Promise<unknown> {
  await startup;
  switch (request.method) {
    case 'hasDatabase': return { available: !!store, recoveryWarning };
    case 'readState': return new ApiService(requiredStore()).readState();
    case 'mutate': {
      const payload = request.payload as Exclude<Request['payload'], ArrayBuffer | undefined>;
      new ApiService(requiredStore()).mutate(payload.entity, payload.method, payload.body, payload.id);
      return null;
    }
    case 'importDatabase': await importDatabase(request.payload as ArrayBuffer); return null;
    case 'exportDatabase': return exportDatabase();
  }
}
let queue = Promise.resolve();
self.addEventListener('message', (event: MessageEvent<Request>) => {
  const request = event.data;
  queue = queue.then(async () => {
    try {
      const result = await handle(request);
      if (result instanceof Uint8Array) self.postMessage({ id: request.id, result }, { transfer: [result.buffer] });
      else self.postMessage({ id: request.id, result });
    } catch (error) {
      self.postMessage({ id: request.id, error: error instanceof Error ? error.message : 'Erreur SQLite locale.' });
    }
  });
});
