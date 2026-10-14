import { test } from 'node:test';
import assert from 'node:assert/strict';
import { associatedResourceProjectIds, canValidateResourceTime, normalizeResource } from '../shared/resources.ts';
import type { Resource, Task } from '../shared/types.ts';

const resource: Resource = {
  id: 'r1', name: 'Ressource', jobTitle: '', type: 'human', classification: 'internal',
  initials: 'R', color: '#123456', dailyHours: 8, mondayHours: 4, profileId: null, active: true,
};
const task: Task = {
  id: 't1', projectId: 'p2', title: 'Tâche', description: '', phase: '', status: 'todo', progress: 0,
  assigneeId: resource.id, startDate: null, endDate: null, allocatedHours: 0, kind: 'task', tags: [], dependsOnId: null,
};

test('les fiches historiques reçoivent des valeurs compatibles sans modifier leur capacité', () => {
  const normalized = normalizeResource(resource);
  assert.equal(normalized.email, '');
  assert.equal(normalized.description, '');
  assert.equal(normalized.role, 'user');
  assert.deepEqual(normalized.weeklyCapacityHours, [4, 8, 8, 8, 8, 0, 0]);
  assert.equal(normalized.capacityUnit, 'hours');
  assert.equal(normalized.hoursPerDay, 8);
  assert.equal(normalized.holidayCalendarId, 'none');
  for (const values of [normalized.tags, normalized.validatesTimeForIds, normalized.projectIds, normalized.customFields]) {
    assert.deepEqual(values, []);
  }
  assert.equal(normalizeResource({ ...resource, id: 'resource-claire' }).role, 'administrator');
  assert.equal(normalizeResource({ ...resource, id: 'resource-claire', role: 'visitor' }).role, 'visitor');
  assert.equal(resource.weeklyCapacityHours, undefined);
});

test('la normalisation conserve les informations de la fiche et ne partage pas les tableaux modifiables', () => {
  const complete: Resource = {
    ...resource, email: 'ressource@example.test', description: 'Une description', role: 'administrator',
    tags: [{ label: 'MOE', color: '#123456' }], validatesTimeForIds: ['r2', 'r2'],
    weeklyCapacityHours: [8, 0, 4, 6, 8, 2, 0], capacityUnit: 'days', hoursPerDay: 7,
    holidayCalendarId: 'fr', projectIds: ['p1', 'p1'],
    customFields: [{ id: 'field-1', label: 'Lien', type: 'url', value: 'https://example.test' }],
  };
  const normalized = normalizeResource(complete);
  assert.equal(normalized.email, complete.email);
  assert.equal(normalized.description, complete.description);
  assert.equal(normalized.capacityUnit, 'days');
  assert.equal(normalized.hoursPerDay, 7);
  assert.equal(normalized.holidayCalendarId, 'fr');
  assert.deepEqual(normalized.validatesTimeForIds, ['r2']);
  assert.deepEqual(normalized.projectIds, ['p1']);
  normalized.weeklyCapacityHours[0] = 0;
  normalized.tags[0].label = 'Modifié';
  normalized.customFields[0].value = 'https://modified.test';
  assert.equal(complete.weeklyCapacityHours![0], 8);
  assert.equal(complete.tags![0].label, 'MOE');
  assert.equal(complete.customFields![0].value, 'https://example.test');
});

test('la validation des temps respecte le rôle, les délégations et l’activation de la ressource', () => {
  const administrator = { ...resource, role: 'administrator' as const };
  assert.equal(canValidateResourceTime(administrator, 'any-resource'), true);
  assert.equal(canValidateResourceTime({ ...administrator, active: false }, 'any-resource'), false);
  const user = { ...resource, role: 'user' as const, validatesTimeForIds: ['r2'] };
  assert.equal(canValidateResourceTime(user, 'r2'), true);
  assert.equal(canValidateResourceTime(user, 'r3'), false);
  assert.equal(canValidateResourceTime(user, resource.id), false);
  assert.equal(canValidateResourceTime({ ...user, validatesTimeForIds: [resource.id] }, resource.id), true);
  assert.equal(canValidateResourceTime({ ...user, role: 'visitor' }, 'r2'), false);
  assert.equal(canValidateResourceTime({ ...user, active: false }, 'r2'), false);
  assert.equal(canValidateResourceTime(undefined, 'r2'), false);
  assert.equal(canValidateResourceTime({ ...resource, id: 'resource-claire' }, 'r2'), true);
});

test('les projets associés combinent les adhésions explicites et les affectations sans doublons', () => {
  const resources = { ...resource, projectIds: ['p1', 'p2'] };
  const tasks = [task, { ...task, id: 't2', projectId: 'p3' }, { ...task, id: 't3', projectId: 'p4', assigneeId: 'another' }];
  assert.deepEqual(associatedResourceProjectIds(resources, tasks), ['p1', 'p2', 'p3']);
  assert.deepEqual(associatedResourceProjectIds({ ...resources, projectIds: [] }, tasks), ['p2', 'p3']);
  assert.deepEqual(associatedResourceProjectIds(resource, []), []);
  assert.deepEqual(resources.projectIds, ['p1', 'p2']);
});
