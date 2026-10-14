import { z } from 'zod';
import { GLOBAL_ROLES } from '../shared/types.ts';
import { COLLABORATOR_ACTIONS, DEFAULT_PERMISSION_POLICY } from '../shared/permissions.ts';
const roleList = z.array(z.enum(GLOBAL_ROLES)).max(4).refine(values => new Set(values).size === values.length, 'Chaque rôle doit être unique.');
const collaborator = z.object(Object.fromEntries(COLLABORATOR_ACTIONS.map(action => [action, z.boolean()])) as Record<typeof COLLABORATOR_ACTIONS[number], z.ZodBoolean>).strict();
export const permissionPolicyInput = z.object({
  collaborator: collaborator.default(DEFAULT_PERMISSION_POLICY.collaborator), resourcesRead: roleList.default([]),
  customizationManage: roleList.refine(values => !values.includes('visitor'), 'Les visiteurs ne peuvent pas administrer la personnalisation.').default([]),
  personalTimeEdit: z.boolean().default(true), personalTimeValidate: z.boolean().default(true),
}).strict();
export const permissionPolicyPatch = permissionPolicyInput.partial().extend({ collaborator: collaborator.partial().optional() });
export const permissionPolicyRecord = permissionPolicyInput.extend({ id: z.string().min(1).max(100) });
