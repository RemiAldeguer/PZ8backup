import { z } from 'zod';
import { GLOBAL_ROLES } from '../shared/types.ts';
import { WORKSPACE_VIEWS } from '../shared/view-access.ts';

const roles = z.array(z.enum(GLOBAL_ROLES)).max(GLOBAL_ROLES.length).refine(values => new Set(values).size === values.length, 'Chaque rôle doit être unique.');
const viewRoles = z.object(Object.fromEntries(WORKSPACE_VIEWS.map(view => [view.id, roles])) as Record<typeof WORKSPACE_VIEWS[number]['id'], typeof roles>).partial().strict();

const fields = {
  automaticTimeIntegration: z.boolean(), allocationInDays: z.boolean(), blockIntegratedDates: z.boolean(),
  showTimeSheetProgress: z.boolean(), extendAcrossNonWorkingDays: z.boolean(), allowSelfAssignment: z.boolean(),
  linkAllocationToDuration: z.boolean(), warnDuringUnavailability: z.boolean(),
  criticalDailySpanHours: z.number().finite().min(0).max(24), criticalDailyWorkHours: z.number().finite().min(0).max(24),
  minimumRestHours: z.number().finite().min(0).max(24),
  viewRoles: viewRoles.optional(),
};
export const planzonePreferencesInput = z.object({ expectedVersion: z.number().int().min(0), ...fields }).strict();
export const planzonePreferencesRecord = z.object({ id: z.literal('planzone-preferences'), version: z.number().int().positive(), ...fields }).strict();
