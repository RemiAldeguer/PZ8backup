import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, ApiService } from '../server/service.ts';
import { MemoryStore } from '../server/memory-store.ts';
import { Store } from '../server/store.ts';
import { seed } from '../server/seed.ts';
import { RESOURCE_ROLE_LABELS, type Resource, type Zone } from '../shared/types.ts';

for (const backend of ['sqlite', 'memory'] as const) test(`${backend}: zone order is persisted, complete, admin-only and leaves projects untouched`, () => {
  const store = backend === 'sqlite' ? new Store(':memory:') : new MemoryStore(); seed(store);
  const api = new ApiService(store);
  try {
    const before = api.readState('2026-10-14');
    const ids = before.zones.map(zone => zone.id).reverse();
    const unchanged = () => assert.deepEqual(api.readState('2026-10-14'), before);
    for (const body of [{ zoneIds: ids.slice(1) }, { zoneIds: [...ids, 'foreign-zone'] }, { zoneIds: [ids[0], ids[0]] }]) {
      assert.throws(() => api.mutate('zone-order', 'POST', body), error => error instanceof ApiError && [400, 409].includes(error.status)); unchanged();
    }
    const resource = store.all('resources').find(item => item.role !== 'administrator') as Resource;
    const member = new ApiService(store, { id: resource.id, name: resource.name, role: RESOURCE_ROLE_LABELS.user });
    assert.throws(() => member.mutate('zone-order', 'POST', { zoneIds: ids }), error => error instanceof ApiError && error.status === 403); unchanged();
    assert.equal(api.mutate('zone-order', 'POST', { zoneIds: ids }).status, 204);
    const after = api.readState('2026-10-14');
    assert.deepEqual(after, { ...before, zones: ids.map((id, position) => ({ ...before.zones.find(zone => zone.id === id), position })) });
    if (store instanceof MemoryStore) assert.deepEqual(new ApiService(new MemoryStore(store.snapshot())).readState('2026-10-14'), after);
    const newZone = api.mutate('zones', 'POST', { name: 'Nouvelle zone en fin de liste' }).value as Zone;
    assert.equal(api.readState().zones.at(-1)?.id, newZone.id);
    assert.throws(() => api.mutate('zone-order', 'POST', { zoneIds: ids }), error => error instanceof ApiError && error.status === 409);
    assert.deepEqual(api.readState().zones.map(zone => zone.id), [...ids, newZone.id]);
  } finally { if (store instanceof Store) store.close(); }
});
