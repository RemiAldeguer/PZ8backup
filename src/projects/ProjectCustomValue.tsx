import type { CustomFieldDefinition } from '../../shared/customization';
import type { Project } from '../../shared/types';
import { CustomRichTextPreview } from '../CustomFieldInputs';
import { customFieldImageSource, evaluateCustomFormula, parseMultipleChoices, safeCustomFieldUrl } from '../../shared/custom-field-values';

export function ProjectCustomValue({ field, project, definitions }: { field: CustomFieldDefinition; project: Project; definitions: CustomFieldDefinition[] }) {
  const value = project.customValues?.[field.id] ?? '';
  if (field.type === 'formula') { const result = evaluateCustomFormula(field, definitions, project.customValues ?? {}, { budget: project.budget }); return <span title={result.error ?? field.formula}>{result.value === null ? '—' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 8 }).format(result.value)}</span>; }
  if (!value) return <span className="zp-no-value">—</span>;
  if (field.type === 'url') { const url = safeCustomFieldUrl(value); return url ? <a href={url} target="_blank" rel="noopener noreferrer">{value}</a> : <span>{value}</span>; }
  if (field.type === 'image') { const src = customFieldImageSource(value); return src ? <img src={src} alt={field.name} style={{ maxWidth: '100%', maxHeight: 60 }} loading="lazy" referrerPolicy="no-referrer" /> : <span>Image indisponible</span>; }
  if (field.type === 'rich_text') return <CustomRichTextPreview value={value} />;
  if (field.type === 'multi_select') return <span>{parseMultipleChoices(value)?.join(', ') ?? value}</span>;
  if (field.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return <span>{value.split('-').reverse().join('/')}</span>;
  if (field.type === 'number' && Number.isFinite(Number(value))) return <span>{new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 8 }).format(Number(value))}</span>;
  return <span>{value}</span>;
}
