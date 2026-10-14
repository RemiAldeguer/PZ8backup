import { z } from 'zod';
const id = z.string().min(1).max(100);
export const organizationUnitInput = z.object({ name: z.string().trim().min(1).max(200), parentId: id.nullable().default(null),
  resourceIds: z.array(id).max(500).refine(ids => new Set(ids).size === ids.length, 'Chaque ressource doit être sélectionnée une seule fois.').default([]) }).strict();
export const organizationUnitPatch = organizationUnitInput.partial();
export const organizationUnitRecord = organizationUnitInput.extend({ id, parentId: id.nullable(), resourceIds: organizationUnitInput.shape.resourceIds.removeDefault() });
