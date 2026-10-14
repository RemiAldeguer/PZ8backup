import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Pz7StoreCore } from './pz7-store-core.ts';

/** Node-only opener for a prepared PZ7 runtime; the projection lives in Pz7StoreCore. */
export class Pz7Store extends Pz7StoreCore {
  declare readonly db: DatabaseSync;

  constructor(path: string) {
    // An absent path must never create a new legacy-looking empty database.
    if (!existsSync(path) || path === ':memory:') throw new Error('A prepared PZ7 runtime file is required');
    super(new DatabaseSync(path));
  }
}
