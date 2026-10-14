import { z } from 'zod';
const id = z.string().min(1).max(100), name = z.string().trim().min(1).max(200), reason = z.string().trim().max(2000).default('');
export const capacityMonth = z.string().regex(/^(19|20|21|22)\d{2}-(0[1-9]|1[0-2])$/);
const days = z.number().finite().min(0).max(10000);
const ids = z.array(id).max(500).refine(values => new Set(values).size === values.length, 'Un élément ne peut être sélectionné deux fois.');
export const capacityDomainInput = z.object({ id: id.optional(), name, teamIds: ids.default([]), resourceIds: ids.default([]), managerIds: ids.default([]) }).strict();
export const capacitySettingsInput = z.object({ warningThreshold: z.number().min(1).max(100), underloadThreshold: z.number().min(0).max(100), allowOverload: z.boolean(), includeProposed: z.boolean(), suggestionMonths: z.number().int().min(1).max(12), carryDay: z.number().int().min(1).max(28), pmoIds: ids }).strict().refine(value => value.underloadThreshold < value.warningThreshold, 'Le seuil de sous-charge doit être inférieur au seuil de tension.');
const demand = z.object({ id: id.optional(), projectId: id, skillId: id, month: capacityMonth, days: days.refine(value => value > 0), status: z.enum(['proposed', 'go']).default('proposed') }).strict();
export const capacityCommand = z.discriminatedUnion('action', [
  z.object({ action: z.literal('domain'), value: capacityDomainInput }).strict(),
  z.object({ action: z.literal('settings'), value: capacitySettingsInput }).strict(),
  z.object({ action: z.literal('skill-request'), domainId: id, name, reason }).strict(),
  z.object({ action: z.literal('skill-status'), id, status: z.enum(['approved', 'created', 'rejected']), reason }).strict(),
  z.object({ action: z.literal('membership'), resourceId: id, skillId: id, share: z.number().min(0).max(100).nullable().default(null), remove: z.boolean().default(false), confirm: z.boolean().default(false) }).strict(),
  z.object({ action: z.literal('contract'), resourceId: id, monthlyDays: days, startMonth: capacityMonth, endMonth: capacityMonth }).strict(),
  z.object({ action: z.literal('overhead'), resourceId: id, month: capacityMonth, runDays: days, otherDays: days, source: z.enum(['manual', 'carried', 'suggested']).default('manual') }).strict(),
  z.object({ action: z.literal('carry'), resourceId: id, month: capacityMonth }).strict(),
  z.object({ action: z.literal('demand'), value: demand }).strict(),
  z.object({ action: z.literal('demand-delete'), id }).strict(),
  z.object({ action: z.literal('allocation'), demandId: id, resourceId: id, days, reason }).strict(),
  z.object({ action: z.literal('allocation-delete'), id, reason }).strict(),
  z.object({ action: z.literal('replace'), allocationId: id, resourceId: id, reason: name }).strict(),
  z.object({ action: z.literal('go'), projectId: id }).strict(),
]);
const timestamp = z.string().datetime();
const savedDemand = demand.extend({ id, createdAt: timestamp, updatedAt: timestamp });
export const capacityPlanRecord = z.object({
  id: z.literal('capacity-plan'), domains: z.array(capacityDomainInput.extend({ id })).max(100),
  skills: z.array(z.object({ id, domainId: id, name, status: z.enum(['requested', 'approved', 'created', 'rejected']), reason }).strict()).max(500),
  memberships: z.array(z.object({ id, resourceId: id, skillId: id, share: z.number().min(0).max(100).nullable() }).strict()).max(2000),
  contracts: z.array(z.object({ id, resourceId: id, monthlyDays: days, startMonth: capacityMonth, endMonth: capacityMonth }).strict()).max(2000),
  overheads: z.array(z.object({ id, resourceId: id, month: capacityMonth, runDays: days, otherDays: days, source: z.enum(['manual', 'carried', 'suggested']) }).strict()).max(5000),
  demands: z.array(savedDemand).max(5000), allocations: z.array(z.object({ id, demandId: id, resourceId: id, days }).strict()).max(10000),
  baselines: z.array(z.object({ id, projectId: id, at: timestamp, demands: z.array(savedDemand) }).strict()).max(500),
  audit: z.array(z.object({ id, at: timestamp, actorId: id, actorName: name, action: name, targetId: id, before: z.string().max(100000), after: z.string().max(100000), reason }).strict()).max(10000),
  settings: capacitySettingsInput,
}).strict();
