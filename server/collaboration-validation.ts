import { z } from 'zod';

export const MAX_DOCUMENT_BYTES = 512 * 1024;
export const MAX_DOCUMENT_BODY_BYTES = 768 * 1024;
export const MAX_CUSTOM_FIELDS_BODY_BYTES = 512 * 1024;
export const MAX_WORKSPACE_BYTES = 1_800_000;
export const MAX_CORE_WORKSPACE_BYTES = 1_000_000;
const identifier = z.string().min(1).max(100);
const label = z.string().trim().min(1).max(200);
const mentions = z.array(identifier).max(100).refine(values => new Set(values).size === values.length, 'Chaque mention doit être unique.');

export const commentInput = z.object({
  taskId: identifier.nullable().default(null), projectId: identifier.optional(),
  body: z.string().trim().min(1).max(10000), mentionResourceIds: mentions.default([]),
}).strict().refine(value => Boolean(value.taskId || value.projectId), 'Sélectionnez un projet ou une tâche.');
export const commentPatch = z.object({ body: z.string().trim().min(1).max(10000).optional(), mentionResourceIds: mentions.optional() }).strict();
export const commentRecord = z.object({
  id: identifier, taskId: identifier.nullable(), projectId: identifier.optional(), authorId: identifier.optional(),
  authorName: label, body: z.string().min(1).max(10000), createdAt: z.string().datetime(), updatedAt: z.string().datetime().optional(),
  mentionResourceIds: mentions.optional(),
}).passthrough().refine(value => Boolean(value.taskId || value.projectId), 'Discussion sans contexte.');

const webUrl = z.string().trim().max(2000).refine(value => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}, 'Indiquez un lien HTTP ou HTTPS valide, sans identifiant ni mot de passe.');
const fileName = z.string().trim().min(1).max(200).refine(value => !/[\\/\u0000-\u001f\u007f]/.test(value), 'Le nom du fichier est invalide.');
const mimeType = z.enum([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);
export const DOCUMENT_MIME_EXTENSIONS: Record<z.infer<typeof mimeType>, string[]> = {
  'image/png': ['png'], 'image/jpeg': ['jpg', 'jpeg'], 'image/gif': ['gif'], 'image/webp': ['webp'],
  'application/pdf': ['pdf'], 'text/plain': ['txt'], 'text/csv': ['csv'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
};
const content = z.string().min(1).max(Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4);
const documentBase = z.object({
  projectId: identifier, name: label, description: z.string().max(10000).default(''), kind: z.enum(['file', 'link']),
  folderId: identifier.nullable().optional(),
  url: webUrl.nullable().default(null), fileName: fileName.nullable().default(null),
  mimeType: mimeType.nullable().default(null), contentBase64: content.nullable().default(null),
}).strict();

/** Canonical base64 and content signatures keep active HTML/SVG and renamed executables out of uploads. */
export function documentFileSize(value: { fileName: string | null; mimeType: string | null; contentBase64: string | null }): number {
  if (!value.fileName || !value.mimeType || !value.contentBase64) throw new Error('Sélectionnez un fichier et son format.');
  if (!mimeType.safeParse(value.mimeType).success) throw new Error('Ce format de fichier n’est pas autorisé.');
  const extensions = DOCUMENT_MIME_EXTENSIONS[value.mimeType as z.infer<typeof mimeType>];
  const extension = value.fileName.split('.').at(-1)?.toLocaleLowerCase();
  if (!extension || !extensions.includes(extension)) throw new Error('L’extension du fichier ne correspond pas à son format.');
  const encoded = value.contentBase64;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('Le contenu du fichier est invalide.');
  const estimated = encoded.length / 4 * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
  if (estimated < 1 || estimated > MAX_DOCUMENT_BYTES) throw new Error('Chaque fichier doit faire au maximum 512 Ko.');
  let binary: string;
  try { binary = atob(encoded); } catch { throw new Error('Le contenu du fichier est invalide.'); }
  if (btoa(binary) !== encoded) throw new Error('Le contenu du fichier est invalide.');
  const starts = (...bytes: number[]) => bytes.every((byte, index) => binary.charCodeAt(index) === byte);
  const type = value.mimeType;
  let valid = false;
  if (type === 'image/png') valid = starts(137, 80, 78, 71, 13, 10, 26, 10);
  else if (type === 'image/jpeg') valid = starts(255, 216, 255);
  else if (type === 'image/gif') valid = ['GIF87a', 'GIF89a'].includes(binary.slice(0, 6));
  else if (type === 'image/webp') valid = binary.startsWith('RIFF') && binary.slice(8, 12) === 'WEBP';
  else if (type === 'application/pdf') valid = binary.startsWith('%PDF-');
  else if (type === 'text/plain' || type === 'text/csv') {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, byte => byte.charCodeAt(0)));
      valid = !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text);
    } catch { valid = false; }
  } else valid = starts(80, 75, 3, 4) && !/vbaProject\.bin/i.test(binary);
  if (!valid) throw new Error('Le contenu du fichier ne correspond pas à son format.');
  return binary.length;
}

function validateDocument(value: z.infer<typeof documentBase>, context: z.RefinementCtx): void {
  if (value.kind === 'link') {
    if (!value.url || value.fileName !== null || value.mimeType !== null || value.contentBase64 !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Un lien doit contenir une adresse web, sans fichier.' });
    }
  } else {
    if (value.url !== null) context.addIssue({ code: z.ZodIssueCode.custom, path: ['url'], message: 'Un fichier ne peut pas contenir une adresse web.' });
    try { documentFileSize(value); }
    catch (error) { context.addIssue({ code: z.ZodIssueCode.custom, path: ['contentBase64'], message: error instanceof Error ? error.message : 'Fichier invalide.' }); }
  }
}
export const projectDocumentInput = documentBase.superRefine(validateDocument);
export const projectDocumentPatch = z.object({ name: label.optional(), description: z.string().max(10000).optional(), url: webUrl.optional(), folderId: identifier.nullable().optional() }).strict();
export const projectDocumentRecord = documentBase.extend({
  description: documentBase.shape.description.removeDefault(), url: documentBase.shape.url.removeDefault(),
  fileName: documentBase.shape.fileName.removeDefault(), mimeType: documentBase.shape.mimeType.removeDefault(), contentBase64: documentBase.shape.contentBase64.removeDefault(),
  id: identifier, authorId: identifier, authorName: label, createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  sizeBytes: z.number().int().positive().max(MAX_DOCUMENT_BYTES).nullable(),
}).superRefine((value, context) => {
  validateDocument(value, context);
  if ((value.kind === 'link' && value.sizeBytes !== null) || (value.kind === 'file' && value.contentBase64 && value.sizeBytes !== (value.contentBase64.length / 4 * 3 - (value.contentBase64.endsWith('==') ? 2 : value.contentBase64.endsWith('=') ? 1 : 0)))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['sizeBytes'], message: 'La taille du fichier est invalide.' });
  }
});

export function workspaceStorageUsage(snapshot: Record<string, unknown>): { total: number; core: number } {
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  return { total: bytes(snapshot), core: bytes({ ...snapshot, projectDocuments: [] }) };
}
/** Existing oversized workspaces remain readable and may be reduced without rewriting their other records. */
export function storageGrowthExceedsLimit(before: { total: number; core: number }, after: { total: number; core: number }): boolean {
  return (after.total > MAX_WORKSPACE_BYTES && after.total > before.total)
    || (after.core > MAX_CORE_WORKSPACE_BYTES && after.core > before.core);
}
