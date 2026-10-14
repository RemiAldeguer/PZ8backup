import type { AppData, Entity } from '../shared/types.ts';

type Method = 'hasDatabase' | 'readState' | 'mutate' | 'importDatabase' | 'exportDatabase';
type Reply = { id: number; result?: unknown; error?: string };
const worker = new Worker(new URL('./browser-db.worker.ts', import.meta.url), { type: 'module' });
let sequence = 0;
let workerError: Error | undefined;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>();
worker.addEventListener('message', (event: MessageEvent<Reply>) => {
  const reply = event.data;
  const operation = pending.get(reply.id);
  if (!operation) return;
  pending.delete(reply.id);
  if (reply.error) operation.reject(new Error(reply.error));
  else operation.resolve(reply.result);
});
worker.addEventListener('error', event => {
  workerError = new Error(`Impossible de démarrer SQLite local : ${event.message}`);
  for (const operation of pending.values()) operation.reject(workerError);
  pending.clear();
});
function request<T>(method: Method, payload?: unknown, transfers?: Transferable[]): Promise<T> {
  if (workerError) return Promise.reject(workerError);
  const id = ++sequence;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    try { worker.postMessage({ id, method, payload }, { transfer: transfers ?? [] }); }
    catch (error) { pending.delete(id); reject(error); }
  });
}

export const browserApi = {
  hasDatabase: () => request<{ available: boolean; recoveryWarning?: string }>('hasDatabase'),
  readState: () => request<AppData>('readState'),
  mutate: (entity: Entity, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown, id?: string) =>
    request<void>('mutate', { entity, method, body, id }),
  importDatabase: (bytes: ArrayBuffer) => request<void>('importDatabase', bytes, [bytes]),
  exportDatabase: () => request<Uint8Array>('exportDatabase'),
};
