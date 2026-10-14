import { z } from 'zod';

const identifier = z.string().min(1).max(100);
const name = z.string().trim().min(1).max(200);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Cette date n’existe pas.');
const uniqueIds = <T extends { id: string }>(items: T[]) => new Set(items.map(item => item.id)).size === items.length;
const field = z.object({
  id: identifier, label: name, type: z.enum(['text', 'number', 'date', 'url']), value: z.string().max(20000),
}).strict().superRefine((item, context) => {
  // Empty typed fields are permitted; text keeps its line breaks and whitespace.
  const value = item.value.trim();
  if (!value || item.type === 'text') return;
  if (item.type === 'date' && !date.safeParse(value).success) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'Cette date n’existe pas.' });
  }
  if (item.type === 'number' && (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value)))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'Indiquez un nombre valide.' });
  }
  if (item.type === 'url') {
    try {
      if (!['http:', 'https:'].includes(new URL(value).protocol)) throw new Error('Unsupported protocol');
    } catch {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'Indiquez un lien HTTP ou HTTPS valide.' });
    }
  }
}).transform(item => ({ ...item, value: item.type === 'text' ? item.value : item.value.trim() }));

/** Saved reports contain a template snapshot so template edits cannot rewrite history. */
export const projectReportInput = z.object({
  projectId: identifier, templateId: identifier.nullable().default(null), templateName: z.string().trim().max(200).default(''),
  title: z.string().trim().min(1).max(500), reportDate: date,
  indicators: z.array(z.object({ id: identifier, label: name, rating: z.number().int().min(1).max(5) }).strict())
    .max(5).refine(uniqueIds, 'Chaque indicateur doit avoir un identifiant unique.').default([]),
  fields: z.array(field).max(25).refine(uniqueIds, 'Chaque champ doit avoir un identifiant unique.').default([]),
}).strict();
export const projectReportPatch = projectReportInput.omit({ projectId: true }).partial();
export const projectReportRecord = projectReportInput.extend({
  templateId: identifier.nullable(), templateName: z.string().trim().max(200),
  indicators: projectReportInput.shape.indicators.removeDefault(), fields: projectReportInput.shape.fields.removeDefault(),
  id: identifier, authorName: name,
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();
