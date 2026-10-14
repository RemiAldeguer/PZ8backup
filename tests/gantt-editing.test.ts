import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ganttDatePatch, ganttDurationDays, type GanttDateRecord } from '../shared/gantt-dates.ts';
import { availableGanttColumns, ganttColumnStorageKey, normalizeGanttColumns } from '../shared/gantt-columns.ts';
import type { CustomFieldDefinition } from '../shared/customization.ts';

const task: GanttDateRecord = { id: 'a', kind: 'task', startDate: '2028-02-28', endDate: '2028-03-03' };
test('graphical resize uses inclusive calendar days across leap days and DST, with a one-day minimum', () => {
  assert.deepEqual(ganttDatePatch(task, 'start', 1), { startDate: '2028-02-29', endDate: '2028-03-03' });
  assert.deepEqual(ganttDatePatch(task, 'end', -3), { startDate: '2028-02-28', endDate: '2028-02-29' });
  assert.deepEqual(ganttDatePatch(task, 'start', 50), { startDate: '2028-03-03', endDate: '2028-03-03' });
  assert.equal(ganttDurationDays(ganttDatePatch(task, 'end', -50)!), 1);
  const moved = ganttDatePatch({ ...task, startDate: '2026-10-24', endDate: '2026-10-26' }, 'move', 1)!;
  assert.deepEqual(moved, { startDate: '2026-10-25', endDate: '2026-10-27' });
  assert.equal(ganttDurationDays(moved), 3);
  assert.deepEqual(ganttDatePatch(task, 'move', 1.6), { startDate: '2028-03-01', endDate: '2028-03-05' });
});
test('moving nullable task dates and milestones preserves their semantics; resize defines both ends', () => {
  assert.deepEqual(ganttDatePatch({ ...task, startDate: null }, 'move', -1), { startDate: null, endDate: '2028-03-02' });
  assert.deepEqual(ganttDatePatch({ ...task, startDate: null }, 'start', -1), { startDate: '2028-03-02', endDate: '2028-03-03' });
  assert.deepEqual(ganttDatePatch({ ...task, endDate: null }, 'end', 1), { startDate: '2028-02-28', endDate: '2028-02-29' });
  assert.deepEqual(ganttDatePatch({ ...task, kind: 'milestone', startDate: null }, 'move', 2), { startDate: null, endDate: '2028-03-05' });
  assert.equal(ganttDatePatch({ ...task, startDate: null, endDate: null }, 'move', 1), null);
  assert.equal(ganttDurationDays({ startDate: null, endDate: null }), null);
  assert.equal(ganttDatePatch(task, 'end', Infinity), null);
});
test('moving at supported date boundaries clamps the whole interval without changing duration', () => {
  assert.deepEqual(ganttDatePatch({ ...task, startDate: '0001-01-02', endDate: '0001-01-04' }, 'move', -20), { startDate: '0001-01-01', endDate: '0001-01-03' });
  assert.deepEqual(ganttDatePatch({ ...task, startDate: '9999-12-28', endDate: '9999-12-30' }, 'move', 20), { startDate: '9999-12-29', endDate: '9999-12-31' });
  assert.equal(ganttDatePatch(task, 'start', -1e9)?.startDate, '0001-01-01');
  assert.equal(ganttDatePatch(task, 'end', 1e9)?.endDate, '9999-12-31');
});
test('personal column choices reconcile removed/new fields without losing order or exposing new columns', () => {
  const field = (id: string, scope: CustomFieldDefinition['scope']): CustomFieldDefinition => ({ id, scope, type: 'text', name: id, translations: { fr: id, en: '' }, options: [] });
  const columns = availableGanttColumns([field('old', 'task'), field('private-time', 'time-entry'), field('project-field', 'project')]);
  assert.ok(!columns.some(column => column.id === 'custom:private-time'));
  assert.equal(columns.find(column => column.id === 'custom:project-field')?.label, 'project-field (projet)');
  const saved = normalizeGanttColumns(null, columns);
  saved.order = ['spent', 'custom:old', ...saved.order.filter(id => id !== 'spent' && id !== 'custom:old')];
  saved.hidden = saved.hidden.filter(id => id !== 'custom:old');
  const next = normalizeGanttColumns(saved, availableGanttColumns([field('new', 'task')]));
  assert.equal(next.order[0], 'spent'); assert.ok(!next.order.includes('custom:old'));
  assert.ok(next.hidden.includes('custom:new')); assert.ok(!next.hidden.includes('spent'));
  const corrupted = normalizeGanttColumns({ version: 1, order: ['tags', 'tags', 7, 'deleted'], hidden: ['allocated', 'allocated', null] }, columns);
  assert.equal(corrupted.order[0], 'tags'); assert.equal(new Set(corrupted.order).size, corrupted.order.length);
  assert.notEqual(ganttColumnStorageKey('u', 'p'), ganttColumnStorageKey('v', 'p'));
  assert.notEqual(ganttColumnStorageKey('u', 'p'), ganttColumnStorageKey('u', 'q'));
});
