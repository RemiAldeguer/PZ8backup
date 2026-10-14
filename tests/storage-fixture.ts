import { decryptWorkspace, isEncryptedWorkspace, parseWorkspaceKeys } from '../server/workspace-crypto.ts';
export const TEST_DATA_KEYS = JSON.stringify({ current: 'test', keys: { test: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64') } });
export const TEST_KEYS = parseWorkspaceKeys(TEST_DATA_KEYS);
export async function plaintextRow<T extends { data: string }>(row: T, workspaceId: string): Promise<T> {
  return { ...row, data: isEncryptedWorkspace(row.data) ? await decryptWorkspace(row.data, workspaceId, TEST_KEYS) : row.data };
}
