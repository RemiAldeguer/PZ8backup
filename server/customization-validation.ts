import { z } from 'zod';
import type { CustomFieldDefinition, ProjectTemplate } from '../shared/customization.ts';
import { customFieldImageSource, parseMultipleChoices, safeCustomFieldUrl } from '../shared/custom-field-values.ts';

const name = z.string().trim().min(1).max(200);
const identifier = z.string().min(1).max(100).refine(value => !['__proto__', 'constructor', 'prototype'].includes(value));
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const unique = <T extends { id: string }>(values: T[]) => new Set(values.map(value => value.id)).size === values.length;
const templateTaskInput = z.object({
  key: identifier, title: name, description: z.string().max(10000).default(''), phase: z.string().trim().max(200).default('Sans phase'),
  kind: z.enum(['task', 'milestone']).default('task'), allocatedHours: z.number().finite().min(0).max(100000).default(0),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  startOffsetDays: z.number().int().min(-36500).max(36500).nullable().default(null),
  endOffsetDays: z.number().int().min(-36500).max(36500).nullable().default(null), dependsOnKey: identifier.nullable().default(null),
  listKey: identifier.nullable().optional(),
  position: z.number().int().min(0).max(1_000_000_000).optional(),
}).strict();
const templateTaskListInput = z.object({ key: identifier, name, parentKey: identifier.nullable(), position: z.number().int().min(0).max(1_000_000_000).optional() }).strict();
export const projectTemplateInput = z.object({
  descriptionFormat: z.enum(['plain', 'markdown']).optional(),
  name, description: z.string().max(10000).default(''), budget: z.number().finite().min(0).max(1e12).default(0), color: color.default('#6366F1'),
  tasks: z.array(templateTaskInput).max(200).default([]),
  taskLists: z.array(templateTaskListInput).max(200).optional(),
}).strict();
export const customFieldDefinitionInput = z.object({
  name, scope: z.enum(['project', 'task', 'resource', 'report', 'time-entry']), type: z.enum(['text', 'rich_text', 'multi_select', 'select', 'formula', 'image', 'url', 'number', 'date']),
  translations: z.object({ fr: z.string().trim().max(200), en: z.string().trim().max(200) }).strict().default({ fr: '', en: '' }),
  options: z.array(z.string().trim().min(1).max(200)).max(50).refine(values => new Set(values).size === values.length, 'Chaque option doit être unique.').default([]),
  formula: z.string().trim().max(1000).optional(),
}).strict();
export const reportTemplateInput = z.object({
  name, titlePattern: z.string().trim().min(1).max(500).default('Compte rendu'),
  indicators: z.array(z.object({ id: identifier, label: name }).strict()).max(5).refine(unique, 'Chaque indicateur doit avoir un identifiant unique.').default([]),
  fields: z.array(z.object({ id: identifier, label: name, type: z.enum(['text', 'number', 'date', 'url']) }).strict()).max(25)
    .refine(unique, 'Chaque champ doit avoir un identifiant unique.').default([]),
}).strict();
export const projectStatusDefinitionInput = z.object({
  name, description: z.string().max(10000).default(''), color: color.default('#0F766E'), baseStatus: z.enum(['requested', 'open', 'paused', 'closed']).default('open'),
}).strict();
export const strategicAxisInput = z.object({
  code: z.string().trim().min(1).max(100), name, color: color.default('#6366F1'), weight: z.number().int().min(0).max(1000),
  scale: z.tuple([name, name, name, name, name]),
}).strict();
export const customValuesInput = z.record(identifier, z.string().max(90000))
  .refine(values => Object.keys(values).length <= 100, 'Cent champs au maximum.');
export const strategicRatingsInput = z.record(identifier, z.number().int().min(-2).max(2))
  .refine(values => Object.keys(values).length <= 100, 'Cent axes au maximum.');
export const customizationCreateSchemas = {
  'project-templates': projectTemplateInput, 'custom-field-definitions': customFieldDefinitionInput,
  'report-templates': reportTemplateInput, 'project-status-definitions': projectStatusDefinitionInput, 'strategic-axes': strategicAxisInput,
};
export const customizationPatchSchemas = {
  'project-templates': projectTemplateInput.partial(), 'custom-field-definitions': customFieldDefinitionInput.partial(),
  'report-templates': reportTemplateInput.partial(), 'project-status-definitions': projectStatusDefinitionInput.partial(), 'strategic-axes': strategicAxisInput.partial(),
};
export const customizationRecordSchemas = {
  projectTemplates: projectTemplateInput.extend({ id: identifier }), customFieldDefinitions: customFieldDefinitionInput.extend({ id: identifier }),
  reportTemplates: reportTemplateInput.extend({ id: identifier }), projectStatusDefinitions: projectStatusDefinitionInput.extend({ id: identifier }),
  strategicAxes: strategicAxisInput.extend({ id: identifier }),
};

/** Returns lists before their children, validating references and a maximum of twenty levels. */
export function orderedTemplateLists(template: ProjectTemplate): NonNullable<ProjectTemplate['taskLists']> {
  const lists = template.taskLists ?? [];
  const byKey = new Map(lists.map(list => [list.key, list]));
  if (byKey.size !== lists.length) throw new Error('Chaque liste du modèle doit avoir une clé unique.');
  const ordered: NonNullable<ProjectTemplate['taskLists']> = [];
  const visiting = new Set<string>();
  const depths = new Map<string, number>();
  const visit = (key: string): number => {
    const knownDepth = depths.get(key);
    if (knownDepth !== undefined) return knownDepth;
    if (visiting.has(key)) throw new Error('Les listes du modèle créent un cycle.');
    const list = byKey.get(key);
    if (!list) throw new Error('Une liste parente du modèle est introuvable.');
    visiting.add(key);
    const depth = list.parentKey ? visit(list.parentKey) + 1 : 1;
    if (depth > 20) throw new Error('Les listes du modèle acceptent vingt niveaux au maximum.');
    visiting.delete(key); depths.set(key, depth); ordered.push(list);
    return depth;
  };
  for (const list of lists) visit(list.key);
  return ordered;
}

/** Returns tasks in dependency order so both SQL foreign keys and snapshots clone safely. */
export function orderedTemplateTasks(template: ProjectTemplate): ProjectTemplate['tasks'] {
  const listKeys = new Set(orderedTemplateLists(template).map(list => list.key));
  const byKey = new Map(template.tasks.map(task => [task.key, task]));
  if (byKey.size !== template.tasks.length) throw new Error('Chaque tâche du modèle doit avoir une clé unique.');
  const ordered: ProjectTemplate['tasks'] = [];
  const visiting = new Set<string>();
  const complete = new Set<string>();
  const visit = (key: string) => {
    if (complete.has(key)) return;
    if (visiting.has(key)) throw new Error('Les dépendances du modèle créent un cycle.');
    const task = byKey.get(key);
    if (!task) throw new Error('Une dépendance du modèle est introuvable.');
    if (task.listKey && !listKeys.has(task.listKey)) throw new Error('La liste d’une tâche du modèle est introuvable.');
    if (task.kind === 'milestone' && task.allocatedHours !== 0) throw new Error('Un jalon ne porte aucune charge allouée.');
    if (task.startOffsetDays !== null && task.endOffsetDays !== null && task.startOffsetDays > task.endOffsetDays) {
      throw new Error('La fin d’une tâche doit suivre son début.');
    }
    visiting.add(key);
    if (task.dependsOnKey) visit(task.dependsOnKey);
    visiting.delete(key); complete.add(key); ordered.push(task);
  };
  for (const task of template.tasks) visit(task.key);
  return ordered;
}

export function validDefinitionOptions(definition: CustomFieldDefinition): boolean {
  return ['select', 'multi_select'].includes(definition.type) ? definition.options.length > 0 : definition.options.length === 0;
}

export function validCustomValue(definition: CustomFieldDefinition, value: string): boolean {
  if (value.length > (definition.type === 'image' ? 90000 : 10000)) return false;
  if (value === '') return true;
  if (definition.type === 'formula') return false;
  if (definition.type === 'number') return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) && Number.isFinite(Number(value));
  if (definition.type === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }
  if (definition.type === 'url') return safeCustomFieldUrl(value) !== null;
  if (definition.type === 'image') return customFieldImageSource(value) !== null;
  if (definition.type === 'select') return definition.options.includes(value);
  if (definition.type === 'multi_select') {
    const choices = parseMultipleChoices(value);
    return choices !== null && choices.every(choice => definition.options.includes(choice));
  }
  return true;
}
