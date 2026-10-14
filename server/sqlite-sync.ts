/** Minimal synchronous SQLite contract shared by Node's DatabaseSync and browser WASM adapters.
 * SQL parameters are positional; rows must be plain objects keyed by column name.
 * exec must support multiple SQL statements and synchronous transaction/savepoint commands.
 */
export type SqliteValue = string | number | bigint | null | Uint8Array;

export interface SqliteStatementSync {
  get(...params: SqliteValue[]): Record<string, unknown> | undefined;
  all(...params: SqliteValue[]): Record<string, unknown>[];
  run(...params: SqliteValue[]): unknown;
}

export interface SqliteSync {
  prepare(sql: string): SqliteStatementSync;
  exec(sql: string): void;
  close(): void;
}
