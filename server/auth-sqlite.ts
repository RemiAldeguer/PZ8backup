import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { AuthDatabase } from './auth.ts';

export class SQLiteAuthDatabase implements AuthDatabase {
  constructor(private readonly database: DatabaseSync) {}

  async first<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    return (this.database.prepare(sql).get(...params as SQLInputValue[]) as T | undefined) ?? null;
  }

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    const result = this.database.prepare(sql).run(...params as SQLInputValue[]);
    return { changes: Number(result.changes) };
  }
}
