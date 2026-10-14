import { z } from 'zod';

export const taskConstraintInput = z.object({
  mode: z.enum(['exact', 'not_before', 'not_after']),
  offset: z.number().int().min(0).max(36500),
  unit: z.enum(['days', 'weeks']), direction: z.enum(['after', 'before']), automatic: z.boolean(),
}).strict();
