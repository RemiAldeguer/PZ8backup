import { MemoryStore } from '../server/memory-store.ts';
import type { CompatibleWorkspaceSnapshot } from '../server/contracts.ts';
import { decryptWorkspace, encryptWorkspace, isEncryptedWorkspace, type WorkspaceKeys } from '../server/workspace-crypto.ts';

export interface MigrationRow { id: string; data: string; revision: number; updated_at: string; }
export interface MigrationDatabase {
  rows(sql: string, params?: unknown[]): Promise<MigrationRow[]>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
}
/** Install after the compatible Worker is live, before the final migration sweep.
 * Old in-flight Workers cannot reintroduce plaintext after migration or cutover.
 */
export async function sealPlaintextWrites(db: MigrationDatabase): Promise<void> {
  for (const [name, event] of [['insert', 'INSERT'], ['update', 'UPDATE OF data']] as const) {
    await db.run(`CREATE TRIGGER IF NOT EXISTS demo_workspaces_encrypted_${name}
      BEFORE ${event} ON demo_workspaces
      WHEN json_extract(NEW.data, '$.format') IS NOT 'planzone8-aes-gcm'
        OR json_extract(NEW.data, '$.version') IS NOT 1
      BEGIN SELECT RAISE(ABORT, 'Encrypted workspace writes required'); END`);
  }
}
async function encoded(row: MigrationRow, keys: WorkspaceKeys): Promise<string> {
  try {
    const plain = isEncryptedWorkspace(row.data) ? await decryptWorkspace(row.data, row.id, keys) : row.data;
    const parsed = JSON.parse(plain) as CompatibleWorkspaceSnapshot;
    if (Object.hasOwn(parsed, 'format')) throw new Error('Format de stockage inconnu.');
    new MemoryStore(parsed);
    const encrypted = isEncryptedWorkspace(row.data) ? row.data : await encryptWorkspace(plain, row.id, keys);
    if (await decryptWorkspace(encrypted, row.id, keys) !== plain) throw new Error('Vérification du chiffrement impossible.');
    return encrypted;
  } catch {
    // JSON/schema exceptions may contain record values; operational logs must not.
    throw new Error('Un espace ne peut pas être vérifié ou chiffré. Vérifiez le format, la clé privée et la limite de stockage ; aucune réinitialisation n’a été effectuée.');
  }
}
async function* rows(db: MigrationDatabase) {
  let after = '';
  while (true) {
    const page = await db.rows('SELECT id, data, revision, updated_at FROM demo_workspaces WHERE id > ? ORDER BY id LIMIT 25', [after]);
    for (const row of page) { yield row; after = row.id; }
    if (page.length < 25) break;
  }
}
/** Read-only preflight: all rows decrypt/validate and have encrypted recovery copies before deployment. */
export async function preflightWorkspaceEncryption(db: MigrationDatabase, keys: WorkspaceKeys, backup: (row: MigrationRow) => Promise<void>): Promise<{ total: number; plaintext: number }> {
  let total = 0, plaintext = 0;
  for await (const row of rows(db)) {
    const data = await encoded(row, keys); total++;
    if (!isEncryptedWorkspace(row.data)) plaintext++;
    await backup({ ...row, data });
  }
  return { total, plaintext };
}
/** Compare-and-swap preserves concurrent edits; never replace rows from an earlier backup. */
export async function migrateWorkspaceEncryption(db: MigrationDatabase, keys: WorkspaceKeys, backup: (row: MigrationRow) => Promise<void>): Promise<number> {
  let migrated = 0;
  for (let pass = 0; pass < 20; pass++) {
    let conflicts = 0;
    for await (const row of rows(db)) {
      const data = await encoded(row, keys);
      if (isEncryptedWorkspace(row.data)) continue;
      await backup({ ...row, data });
      const result = await db.run('UPDATE demo_workspaces SET data = ?, revision = revision + 1 WHERE id = ? AND revision = ?', [data, row.id, row.revision]);
      if (result.changes === 1) migrated++; else conflicts++;
    }
    if (!conflicts) {
      // A complete second pass catches workspaces created during pagination.
      let remaining = false;
      for await (const row of rows(db)) { await encoded(row, keys); if (!isEncryptedWorkspace(row.data)) remaining = true; }
      if (!remaining) return migrated;
    }
  }
  throw new Error('Des modifications concurrentes empêchent de terminer le chiffrement. Relancez le déploiement ; la transition reste compatible et aucun espace n’a été remplacé.');
}
