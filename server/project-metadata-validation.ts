import { z } from 'zod';
import { PROJECT_VIEW_IDS, PROJECT_ROLES } from '../shared/types.ts';

const labels = (maxLength: number) => z.array(z.string().trim().min(1).max(maxLength)).max(20)
  .refine(values => new Set(values.map(value => value.toLocaleLowerCase('fr'))).size === values.length, 'Chaque libellé doit être unique.');
export const projectMetadataInput = z.object({
  projectRoles: z.record(z.string().min(1).max(100), z.enum(PROJECT_ROLES)).refine(values => Object.keys(values).length <= 200, '200 membres maximum par projet.').optional(),
  tags: labels(50).optional(), portfolioNames: labels(100).optional(),
  enabledViews: z.array(z.enum(PROJECT_VIEW_IDS)).min(1).max(PROJECT_VIEW_IDS.length)
    .refine(values => new Set(values).size === values.length, 'Chaque vue doit être unique.').optional(),
  descriptionFormat: z.enum(['plain', 'markdown']).optional(),
});
