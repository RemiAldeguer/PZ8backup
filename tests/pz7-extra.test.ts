import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { Records, Table } from '../server/contracts.ts';
import { PZ7_EXTRA_TABLES, putPz7Extra, readPz7Extra, removePz7Extra, type ExtraReferences, type Pz7ExtraTable } from '../server/pz7-extra.ts';

const runtime = resolve('data/pz7-runtime.sqlite');
function fixture(fn: (db: DatabaseSync, refs: ExtraReferences, run: <K extends Pz7ExtraTable>(entity: K, value: Records[K]) => string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'pz7-extra-'));
  const copy = join(directory, 'runtime.sqlite');
  try {
    copyFileSync(runtime, copy);
    const db = new DatabaseSync(copy);
    db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS pz8_unit_memberships (
        unit_uuid TEXT NOT NULL REFERENCES pz_organizational_unit(uuid) ON DELETE CASCADE,
        resource_uuid TEXT NOT NULL REFERENCES pz_resource(uuid) ON DELETE RESTRICT,
        position INTEGER NOT NULL, PRIMARY KEY(unit_uuid,resource_uuid));`);
    const refs: ExtraReferences = {
      workspace: () => (db.prepare('SELECT uuid FROM pz_planzone LIMIT 1').get() as {uuid: string}).uuid,
      uuid: (entity, id) => {
        const found = db.prepare('SELECT uuid FROM pz8_identity WHERE entity=? AND id=?').get(entity, id) as {uuid: string} | undefined;
        if (!found) throw new Error(`Unknown ${entity}/${id}`);
        return found.uuid;
      },
      id: (entity, uuid) => {
        const found = db.prepare('SELECT id FROM pz8_identity WHERE entity=? AND uuid=?').get(entity, uuid) as {id: string} | undefined;
        if (!found) throw new Error(`Unmapped ${entity}/${uuid}`);
        return found.id;
      },
    };
    const run = <K extends Pz7ExtraTable>(entity: K, value: Records[K]): string => {
      const uuid = randomUUID();
      db.exec('BEGIN IMMEDIATE');
      try {
        putPz7Extra(db, entity, value, uuid, refs);
        db.prepare('INSERT INTO pz8_identity(entity,id,uuid,data,position) VALUES (?,?,?,?,?)')
          .run(entity, value.id, uuid, JSON.stringify(value), 1);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return uuid;
    };
    try { fn(db, refs, run); } finally { db.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
function projectId(db: DatabaseSync) {
  return (db.prepare("SELECT id FROM pz8_identity WHERE entity='projects' LIMIT 1").get() as {id:string}).id;
}
function resourceId(db: DatabaseSync) {
  return (db.prepare("SELECT id FROM pz8_identity WHERE entity='resources' LIMIT 1").get() as {id:string}).id;
}

test('all extra targets are intentionally declared', () => {
  assert.deepEqual([...PZ7_EXTRA_TABLES], ['projectStatusDefinitions', 'strategicAxes', 'organizationUnits',
    'projectReports', 'calendarEvents', 'unavailabilities']);
});

test('status, axis, and unit values are stored natively and reflect direct SQL', { skip: !existsSync(runtime) }, () => fixture((db, refs, run) => {
  const status = { id: 'status-extra', name: 'Pilot', description: 'desc', color: '#abc', baseStatus: 'open' } as const;
  const axis = { id: 'axis-extra', code: 'A', name: 'Axis', color: '#123', weight: 2,
    scale: ['0', '1', '2', '3', '4'] as [string, string, string, string, string] };
  const statusUuid = run('projectStatusDefinitions', status);
  const axisUuid = run('strategicAxes', axis);
  const unitUuid = run('organizationUnits', { id: 'unit-extra', name: 'Unit', parentId: null, resourceIds: [resourceId(db)] });
  const read = <K extends Pz7ExtraTable>(entity: K, id: string): Records[K] => {
    const identity = db.prepare('SELECT id,uuid,data FROM pz8_identity WHERE entity=? AND id=?').get(entity, id) as {id:string;uuid:string;data:string};
    return readPz7Extra(db, entity, identity, refs);
  };
  db.prepare('UPDATE pz_project_status SET label=? WHERE uuid=?').run('SQL status', statusUuid);
  db.prepare('UPDATE pz_strategic_axes SET weight=? WHERE uuid=?').run(5, axisUuid);
  db.prepare('UPDATE pz_organizational_unit SET name=? WHERE uuid=?').run('SQL unit', unitUuid);
  assert.equal(read('projectStatusDefinitions', status.id).name, 'SQL status');
  assert.equal(read('strategicAxes', axis.id).weight, 5);
  assert.equal(read('organizationUnits', 'unit-extra').name, 'SQL unit');
  assert.deepEqual(read('organizationUnits', 'unit-extra').resourceIds, [resourceId(db)]);
  const another = run('organizationUnits', { id: 'unit-other', name: 'Other', parentId: null, resourceIds: [resourceId(db)] });
  assert.deepEqual(read('organizationUnits', 'unit-other').resourceIds, [resourceId(db)]);
  assert.equal((db.prepare('SELECT count(*) AS n FROM pz8_unit_memberships WHERE resource_uuid=?').get(refs.uuid('resources', resourceId(db))) as {n:number}).n, 2);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  removePz7Extra(db, 'organizationUnits', unitUuid);
  assert.equal((db.prepare('SELECT organizational_unit_uuid FROM pz_resource WHERE uuid=?').get(refs.uuid('resources', resourceId(db))) as {organizational_unit_uuid:string}).organizational_unit_uuid, another);
  removePz7Extra(db, 'organizationUnits', another);
  removePz7Extra(db, 'strategicAxes', axisUuid);
  removePz7Extra(db, 'projectStatusDefinitions', statusUuid);
  assert.equal(db.prepare('SELECT uuid FROM pz_project_status WHERE uuid=?').get(statusUuid), undefined);
}));

test('events, absences, and simple reports use native tables; unsupported shapes fail closed', { skip: !existsSync(runtime) }, () => fixture((db, refs, run) => {
  const project = projectId(db);
  const resource = resourceId(db);
  const name = (db.prepare('SELECT name FROM pz_resource WHERE uuid=?').get(refs.uuid('resources', resource)) as {name:string}).name;
  const event = { id: 'event-extra', title: 'Workshop', description: 'Meet', projectId: project,
    resourceIds: [resource], startDate: '2026-11-02', endDate: '2026-11-02', allDay: false,
    startTime: '09:30', endTime: '11:30' };
  const absence = { id: 'absence-extra', title: 'Away', resourceId: resource, reason: 'leave' as const,
    allDay: false, startDate: '2026-11-03', endDate: '2026-11-03', startTime: '10:00', endTime: '14:00' };
  const report = { id: 'report-extra', projectId: project, templateId: null, templateName: '', title: 'Weekly',
    reportDate: '2026-11-03', authorName: name, createdAt: '2026-11-03T12:00:00Z', updatedAt: '2026-11-03T12:00:00Z',
    fields: [], indicators: [] };
  const eventUuid = run('calendarEvents', event);
  const absenceUuid = run('unavailabilities', absence);
  const reportUuid = run('projectReports', report);
  for (const [entity, value, uuid] of [['calendarEvents', event, eventUuid], ['unavailabilities', absence, absenceUuid], ['projectReports', report, reportUuid]] as const) {
    const projected = readPz7Extra(db, entity, { id: value.id, uuid, data: JSON.stringify(value) }, refs);
    assert.deepEqual(projected, value);
  }
  const global = { ...event, id: 'no-project', projectId: null };
  const globalUuid = run('calendarEvents', global);
  assert.equal(db.prepare('SELECT 1 FROM pz_event WHERE uuid=?').get(globalUuid), undefined);
  assert.deepEqual(readPz7Extra(db, 'calendarEvents', { id: global.id, uuid: globalUuid, data: JSON.stringify(global) }, refs), global);
  const complex = { ...report, id: 'with-field', fields: [{id:'x',label:'X',type:'text' as const,value:'v'}] };
  const complexUuid = run('projectReports', complex);
  assert.deepEqual(readPz7Extra(db, 'projectReports', { id: complex.id, uuid: complexUuid, data: JSON.stringify(complex) }, refs), complex);
  db.prepare('UPDATE pz_event SET name=? WHERE uuid=?').run('Renamed', eventUuid);
  assert.equal(readPz7Extra(db, 'calendarEvents', { id: event.id, uuid: eventUuid, data: JSON.stringify(event) }, refs).title, 'Renamed');
  removePz7Extra(db, 'calendarEvents', eventUuid);
  removePz7Extra(db, 'unavailabilities', absenceUuid);
  removePz7Extra(db, 'projectReports', reportUuid);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
}));
