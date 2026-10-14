import type { D1Database } from '@cloudflare/workers-types';
import type { AuthDatabase } from '../server/auth.ts';

export class D1AuthDatabase implements AuthDatabase {
  constructor(private readonly database: D1Database) {}

  async first<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    return this.database.prepare(sql).bind(...params).first<T>();
  }

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    const result = await this.database.prepare(sql).bind(...params).run();
    return { changes: result.meta.changes };
  }
}
