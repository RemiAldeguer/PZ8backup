import { z } from 'zod';
import type { ProjectTaskList, Task } from '../shared/types.ts';

export const MAX_TASK_LIST_DEPTH = 20;
const identifier = z.string().min(1).max(100);
const name = z.string().trim().min(1).max(200);
export const projectItemPosition = z.number().int().min(0).max(1_000_000_000);
const legacyPhase = name.refine(value => value !== 'Sans phase', 'La racine ne peut pas être convertie en liste.');
export const taskListInput = z.object({
  projectId: identifier, name, parentId: identifier.nullable().default(null),
  sourcePhase: legacyPhase.optional(), parentPhase: legacyPhase.optional(),
  position: projectItemPosition.optional(),
}).strict().superRefine((value, context) => {
  if (value.parentPhase && value.parentId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['parentPhase'], message: 'Choisissez une liste parent ou une phase parent.' });
  if (value.sourcePhase && value.parentPhase && value.sourcePhase === value.parentPhase) context.addIssue({ code: z.ZodIssueCode.custom, path: ['sourcePhase'], message: 'Une phase ne peut pas être sa propre liste parent.' });
});
export const taskListPatch = z.object({ name: name.optional(), parentId: identifier.nullable().optional(), position: projectItemPosition.optional() }).strict();
export const taskListRecord = z.object({ id: identifier, projectId: identifier, name, parentId: identifier.nullable(), position: projectItemPosition.optional() }).strict();
const itemReference = z.discriminatedUnion('type', [
  z.object({ type: z.literal('task'), id: identifier }).strict(),
  z.object({ type: z.literal('list'), id: identifier }).strict(),
  z.object({ type: z.literal('phase'), phase: legacyPhase }).strict(),
]);
export const projectItemMoveInput = z.object({ projectId: identifier, source: itemReference,
  target: z.union([itemReference, z.object({ type: z.literal('root') }).strict()]),
  placement: z.enum(['before', 'inside', 'after']),
}).strict();

export function validateTaskListTree(lists: ProjectTaskList[], projectIds: ReadonlySet<string>, tasks: Task[] = []): void {
  const byId = new Map(lists.map(list => [list.id, list]));
  if (byId.size !== lists.length) throw new Error('Chaque liste doit avoir un identifiant unique.');
  const depths = new Map<string, number>();
  const visiting = new Set<string>();
  function depth(list: ProjectTaskList): number {
    const cached = depths.get(list.id);
    if (cached !== undefined) return cached;
    if (!projectIds.has(list.projectId)) throw new Error('Le projet de cette liste est introuvable.');
    if (visiting.has(list.id)) throw new Error('Une liste ne peut pas contenir son propre parent.');
    visiting.add(list.id);
    if (visiting.size > MAX_TASK_LIST_DEPTH) throw new Error(`Les listes sont limitées à ${MAX_TASK_LIST_DEPTH} niveaux.`);
    let result = 1;
    if (list.parentId) {
      const parent = byId.get(list.parentId);
      if (!parent) throw new Error('La liste parent est introuvable.');
      if (parent.projectId !== list.projectId) throw new Error('La liste parent doit appartenir au même projet.');
      result += depth(parent);
    }
    visiting.delete(list.id);
    if (result > MAX_TASK_LIST_DEPTH) throw new Error(`Les listes sont limitées à ${MAX_TASK_LIST_DEPTH} niveaux.`);
    depths.set(list.id, result);
    return result;
  }
  for (const list of lists) depth(list);
  for (const task of tasks) {
    if (task.position !== undefined && !projectItemPosition.safeParse(task.position).success) throw new Error('L’ordre de la tâche est invalide.');
    if (task.listId === undefined || task.listId === null) continue;
    if (typeof task.listId !== 'string' || !task.listId) throw new Error('Le rattachement de la tâche à une liste est invalide.');
    const list = byId.get(task.listId);
    if (!list || list.projectId !== task.projectId) throw new Error('La liste de la tâche doit appartenir au même projet.');
  }
}
