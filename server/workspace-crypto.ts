// Server-only: never import this module from the browser application.
import { z } from 'zod';

const FORMAT = 'planzone8-aes-gcm';
const MAX_STORED_BYTES = 2_000_000; // D1's per-value limit; quotas still measure plaintext.
const MAX_DECODED_BYTES = 8_000_000;
const encoder = new TextEncoder();
const keyId = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const keyringSchema = z.object({ current: keyId, keys: z.record(keyId, z.string().regex(/^[A-Za-z0-9+/]{43}=$/)) }).strict();
const envelopeSchema = z.object({
  format: z.literal(FORMAT), version: z.literal(1), keyId, encoding: z.literal('gzip'),
  iv: z.string().regex(/^[A-Za-z0-9+/]{16}$/), ciphertext: z.string().min(24).max(MAX_STORED_BYTES).regex(/^[A-Za-z0-9+/]+={0,2}$/),
}).strict();
export type WorkspaceKeys = z.infer<typeof keyringSchema>;

export class WorkspaceEncryptionError extends Error {
  constructor() { super('Workspace encryption unavailable or invalid'); this.name = 'WorkspaceEncryptionError'; }
}
export class WorkspaceStorageLimitError extends Error {
  constructor() { super('Encrypted workspace exceeds storage limit'); this.name = 'WorkspaceStorageLimitError'; }
}
function base64(bytes: Uint8Array): string {
  let result = ''; for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(result);
}
function bytes(value: string): Uint8Array<ArrayBuffer> {
  const decoded = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  if (base64(decoded) !== value) throw new WorkspaceEncryptionError();
  return decoded;
}
export function parseWorkspaceKeys(value: string | undefined): WorkspaceKeys {
  try {
    const keys = keyringSchema.parse(JSON.parse(value ?? ''));
    if (!Object.hasOwn(keys.keys, keys.current) || Object.keys(keys.keys).length > 10) throw new WorkspaceEncryptionError();
    for (const encoded of Object.values(keys.keys)) if (bytes(encoded).length !== 32) throw new WorkspaceEncryptionError();
    return keys;
  } catch { throw new WorkspaceEncryptionError(); }
}
async function key(keys: WorkspaceKeys, id: string): Promise<CryptoKey> {
  if (!Object.hasOwn(keys.keys, id)) throw new WorkspaceEncryptionError();
  return crypto.subtle.importKey('raw', bytes(keys.keys[id]), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
function context(workspaceId: string, id: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(JSON.stringify([FORMAT, 1, 'gzip', workspaceId, id]));
}
async function transform(input: Uint8Array<ArrayBuffer>, decompress: boolean): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([input]).stream().pipeThrough(decompress ? new DecompressionStream('gzip') : new CompressionStream('gzip'));
  const reader = stream.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > MAX_DECODED_BYTES) { await reader.cancel(); throw new WorkspaceEncryptionError(); }
    chunks.push(value);
  }
  const output = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}
export async function encryptWorkspace(plaintext: string, workspaceId: string, keys: WorkspaceKeys): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const compressed = await transform(encoder.encode(plaintext), false);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: context(workspaceId, keys.current), tagLength: 128 }, await key(keys, keys.current), compressed);
  const stored = JSON.stringify({ format: FORMAT, version: 1, keyId: keys.current, encoding: 'gzip', iv: base64(iv), ciphertext: base64(new Uint8Array(ciphertext)) });
  if (encoder.encode(stored).byteLength > MAX_STORED_BYTES) throw new WorkspaceStorageLimitError();
  return stored;
}
export async function decryptWorkspace(stored: string, workspaceId: string, keys: WorkspaceKeys): Promise<string> {
  try {
    const envelope = envelopeSchema.parse(JSON.parse(stored));
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(envelope.iv), additionalData: context(workspaceId, envelope.keyId), tagLength: 128 }, await key(keys, envelope.keyId), bytes(envelope.ciphertext));
    return new TextDecoder('utf-8', { fatal: true }).decode(await transform(new Uint8Array(decrypted), true));
  } catch { throw new WorkspaceEncryptionError(); }
}
export function isEncryptedWorkspace(stored: string): boolean {
  try { return JSON.parse(stored)?.format === FORMAT; } catch { return false; }
}
