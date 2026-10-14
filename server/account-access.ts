import { GLOBAL_ROLES, RESOURCE_ROLE_LABELS, type ResourceRole } from '../shared/types.ts';
import { normalizeResource } from '../shared/resources.ts';
import { AuthError, publicAuthUser, type AuthPrincipal } from './auth.ts';
import type { StoreLike } from './contracts.ts';
import type { ServiceActor } from './service.ts';
import { z } from 'zod';

export const memberAccountInput = z.object({ resourceId: z.string().min(1).max(100), username: z.string().min(3).max(80), password: z.string().min(12).max(128) }).strict();
export function accountRole(principal: AuthPrincipal, store: StoreLike): ResourceRole {
  // The original administrator is retained during the migration and cannot be demoted through a resource form.
  if (principal.resourceId === 'resource-claire') return 'administrator';
  const resource = store.get('resources', principal.resourceId);
  if (!resource || !resource.active || resource.type !== 'human') throw new AuthError(401, 'Ce membre ne possède plus un accès actif à la Planzone.');
  const role = normalizeResource(resource).role;
  if (!GLOBAL_ROLES.includes(role)) throw new AuthError(403, 'Le rôle de ce membre est invalide.');
  return role;
}
export function accountActor(principal: AuthPrincipal, store: StoreLike): ServiceActor {
  return { id: principal.resourceId, name: principal.resourceId === 'resource-claire' ? principal.name : (store.get('resources', principal.resourceId)?.name ?? principal.name).slice(0, 120), role: RESOURCE_ROLE_LABELS[accountRole(principal, store)] };
}
export function accountPublicUser(principal: AuthPrincipal, store: StoreLike) {
  return { ...publicAuthUser(principal, accountRole(principal, store)), name: accountActor(principal, store).name };
}
