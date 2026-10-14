import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Bold, ImagePlus, Italic, List, Trash2 } from 'lucide-react';
import type { CustomFieldDefinition, CustomFieldScope } from '../shared/customization';
import { CUSTOM_IMAGE_MAX_BYTES, customFieldImageSource, evaluateCustomFormula, parseMultipleChoices, safeCustomFieldUrl } from '../shared/custom-field-values';
import './custom-field-inputs.css';

function inlineMarkdown(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const matches = text.matchAll(/\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`/g);
  let position = 0;
  for (const match of matches) {
    const index = match.index!;
    parts.push(text.slice(position, index));
    parts.push(match[1] ? <strong key={index}>{match[1]}</strong> : match[2] ? <em key={index}>{match[2]}</em> : <code key={index}>{match[3]}</code>);
    position = index + match[0].length;
  }
  parts.push(text.slice(position));
  return parts;
}

/** Formatting is deliberately rendered as React nodes, never innerHTML. */
export function CustomRichTextPreview({ value }: { value: string }) {
  const lines = value.split('\n');
  const content: ReactNode[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (/^\s*[-*]\s/.test(lines[index])) {
      const items: ReactNode[] = [];
      const start = index;
      while (index < lines.length && /^\s*[-*]\s/.test(lines[index])) {
        items.push(<li key={index}>{inlineMarkdown(lines[index].replace(/^\s*[-*]\s/, ''))}</li>);
        index++;
      }
      index--; content.push(<ul key={start}>{items}</ul>);
    } else content.push(<p key={index}>{inlineMarkdown(lines[index])}{!lines[index] && <br />}</p>);
  }
  return <div className="ci-rich-preview">{content}</div>;
}

export function RichTextInput({ id, label, value, onChange, onFormat, readOnly = false }: { id: string; label: string; value: string; onChange: (value: string) => void; onFormat?: () => void; readOnly?: boolean }) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  function format(kind: 'bold' | 'italic' | 'list') {
    const element = textarea.current;
    if (!element || readOnly) return;
    const start = element.selectionStart; const end = element.selectionEnd;
    const selected = value.slice(start, end);
    const marker = kind === 'bold' ? '**' : '*';
    const replacement = kind === 'list' ? (selected || 'Élément').split('\n').map(line => `- ${line}`).join('\n') : `${marker}${selected || 'Texte'}${marker}`;
    const next = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
    if (next.length > 10000) return;
    onChange(next);
    onFormat?.();
    requestAnimationFrame(() => { element.focus(); element.setSelectionRange(start, start + replacement.length); });
  }
  return <div className="ci-rich-editor"><div className="ci-rich-toolbar" aria-label={`Mise en forme : ${label}`}>
    <button type="button" disabled={readOnly} aria-label={`Gras : ${label}`} title="Gras" onClick={() => format('bold')}><Bold size={15} /></button>
    <button type="button" disabled={readOnly} aria-label={`Italique : ${label}`} title="Italique" onClick={() => format('italic')}><Italic size={15} /></button>
    <button type="button" disabled={readOnly} aria-label={`Liste : ${label}`} title="Liste" onClick={() => format('list')}><List size={16} /></button>
  </div><textarea className="form-input ci-input" ref={textarea} id={id} rows={5} maxLength={10000} readOnly={readOnly} value={value} onChange={event => onChange(event.target.value)} />
    <small className="ci-note">Gras, italique et listes · Mise en forme avec **texte**, *texte* et - élément.</small>
    {value && <details className="ci-preview-details"><summary>Aperçu de {label}</summary><CustomRichTextPreview value={value} /></details>}
  </div>;
}

export function ReadOnlyCustomField({ field, label, value, definitions, values, builtinValues }: {
  field: CustomFieldDefinition; label: string; value: string; definitions: CustomFieldDefinition[];
  values: Record<string, string>; builtinValues: Record<string, number>;
}) {
  const [imageUnavailable, setImageUnavailable] = useState(false);
  useEffect(() => { setImageUnavailable(false); }, [value]);
  const formula = field.type === 'formula' ? evaluateCustomFormula(field, definitions, values, builtinValues) : null;
  const choices = field.type === 'multi_select' ? parseMultipleChoices(value) : null;
  const image = field.type === 'image' ? customFieldImageSource(value) : null;
  const url = field.type === 'url' ? safeCustomFieldUrl(value) : null;
  let content: ReactNode = value || 'Non renseigné';
  if (field.type === 'rich_text' && value) content = <CustomRichTextPreview value={value} />;
  else if (field.type === 'multi_select' && value && choices) content = choices.length ? <ul className="ci-read-choices">{choices.map(choice => <li key={choice}>{choice}</li>)}</ul> : 'Non renseigné';
  else if (field.type === 'image' && value) content = image && !imageUnavailable ? <img className="ci-image-preview" src={image} alt={label} loading="lazy" referrerPolicy="no-referrer" onError={() => setImageUnavailable(true)} /> : 'L’image n’est pas accessible.';
  else if (field.type === 'url' && value && url) content = <a href={url} target="_blank" rel="noopener noreferrer">{value}</a>;
  else if (field.type === 'formula') content = formula?.value === null ? '—' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 8 }).format(formula?.value ?? 0);
  return <div className={`ci-field ci-read-field ${['rich_text', 'image'].includes(field.type) ? 'ci-field-wide' : ''}`}><h4>{label}</h4><div className="ci-read-value">{content}</div>{formula?.error && <small className="ci-note">{formula.error}</small>}</div>;
}

function ImageInput({ id, label, value, onChange, onPendingChange }: { id: string; label: string; value: string; onChange: (value: string) => void; onPendingChange: (id: string, pending: boolean) => void }) {
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const source = customFieldImageSource(value);
  const embedded = value.startsWith('data:');
  useEffect(() => { setUnavailable(false); }, [value]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; onPendingChange(id, false); }; }, [id, onPendingChange]);
  async function choose(file: File | undefined) {
    if (busyRef.current) return;
    setError('');
    if (!file) return;
    if (file.size > CUSTOM_IMAGE_MAX_BYTES) { setError('L’image doit peser au maximum 64 Ko.'); return; }
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) { setError('Choisissez une image PNG, JPEG, GIF ou WebP.'); return; }
    busyRef.current = true; setBusy(true); onPendingChange(id, true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Lecture impossible.'));
        reader.onerror = () => reject(new Error('Impossible de lire cette image.'));
        reader.readAsDataURL(file);
      });
      if (!customFieldImageSource(dataUrl)) throw new Error('Le contenu du fichier ne correspond pas à une image autorisée.');
      if (mounted.current) onChange(dataUrl);
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : 'Impossible de lire cette image.'); }
    finally { busyRef.current = false; if (mounted.current) { setBusy(false); onPendingChange(id, false); } }
  }
  return <div className="ci-image-editor"><input className="form-input ci-input" id={id} type="url" maxLength={2000} disabled={busy} value={embedded ? '' : value} placeholder={embedded ? 'Image enregistrée · remplacer par un lien' : 'https://…'} onChange={event => { setError(''); onChange(event.target.value); }} />
    <label className="ci-image-file" htmlFor={`${id}-file`}><ImagePlus size={16} />Choisir une image<input id={`${id}-file`} aria-label={`Choisir une image pour ${label}`} type="file" accept="image/png,image/jpeg,image/gif,image/webp" disabled={busy} onChange={event => { void choose(event.target.files?.[0]); event.target.value = ''; }} /></label>
    <small className="ci-note">PNG, JPEG, GIF ou WebP · 64 Ko maximum · ou lien HTTP/HTTPS.</small>
    {busy && <small className="ci-note" role="status">Lecture de l’image…</small>}
    {source && !unavailable && <img className="ci-image-preview" src={source} alt={`${label} – aperçu`} loading="lazy" referrerPolicy="no-referrer" onError={() => setUnavailable(true)} />}
    {unavailable && <small className="ci-note">L’image n’est pas accessible. Vérifiez son lien.</small>}
    {value && <button type="button" className="ci-clear-image" disabled={busy} onClick={() => { setError(''); onChange(''); }}><Trash2 size={14} />Retirer l’image</button>}
    {error && <p className="ci-error" role="alert">{error}</p>}
  </div>;
}

export function CustomFieldInputs({ definitions, scope, values, onChange, heading = 'Champs personnalisés', builtinValues = {}, readOnly = false, onPendingChange }: {
  definitions: CustomFieldDefinition[];
  scope: CustomFieldScope;
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  heading?: string;
  builtinValues?: Record<string, number>;
  readOnly?: boolean;
  onPendingChange?: (pending: boolean) => void;
}) {
  const prefix = useId();
  const currentValues = useRef(values);
  currentValues.current = values;
  const pendingImages = useRef(new Set<string>());
  const pendingCallback = useRef(onPendingChange);
  pendingCallback.current = onPendingChange;
  const imagePending = useCallback((id: string, pending: boolean) => {
    if (pending) pendingImages.current.add(id); else pendingImages.current.delete(id);
    pendingCallback.current?.(pendingImages.current.size > 0);
  }, []);
  const fields = definitions.filter(field => field.scope === scope);
  const update = (id: string, value: string) => {
    const next = { ...currentValues.current };
    if (value === '') delete next[id]; else next[id] = value;
    currentValues.current = next;
    onChange(next);
  };
  if (!fields.length) return null;
  return <section className="ci-section" aria-label={heading}>
    <h3 className="ci-heading">{heading}</h3>
    <div className="ci-fields">{fields.map(field => {
      const id = `${prefix}-${field.id}`;
      const value = values[field.id] ?? '';
      const label = field.translations.fr || field.name;
      if (readOnly) return <ReadOnlyCustomField key={field.id} field={field} label={label} value={value} definitions={definitions} values={values} builtinValues={builtinValues} />;
      if (field.type === 'multi_select') {
        const selected = parseMultipleChoices(value);
        const choices = [...new Set([...field.options, ...(selected ?? [])])];
        return <fieldset className="ci-field ci-multiple" key={field.id}><legend>{label}</legend><div className="ci-multiple-choices">{choices.map(option => <label key={option}><input type="checkbox" checked={!!selected?.includes(option)} onChange={event => { const next = event.target.checked ? [...(selected ?? []), option] : (selected ?? []).filter(choice => choice !== option); update(field.id, next.length ? JSON.stringify(next) : ''); }} /><span>{option}{!field.options.includes(option) && ' (ancienne option)'}</span></label>)}</div>{selected === null && <p className="ci-error">L’ancienne valeur ne correspond pas à une liste. Sélectionnez les choix souhaités pour la remplacer.</p>}</fieldset>;
      }
      const formula = field.type === 'formula' ? evaluateCustomFormula(field, definitions, values, builtinValues) : null;
      return <div className={`ci-field ${['rich_text', 'image'].includes(field.type) ? 'ci-field-wide' : ''}`} key={field.id}>
        <label htmlFor={id}>{label}</label>
        {field.type === 'rich_text' ? <RichTextInput id={id} label={label} value={value} onChange={next => update(field.id, next)} />
          : field.type === 'image' ? <ImageInput id={id} label={label} value={value} onChange={next => update(field.id, next)} onPendingChange={imagePending} />
          : field.type === 'formula' ? <><input className="form-input ci-input ci-formula-result" id={id} readOnly value={formula?.value === null ? '—' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 8 }).format(formula?.value ?? 0)} aria-describedby={`${id}-note`} /><small className={`ci-note ${formula?.error ? 'ci-error' : ''}`} id={`${id}-note`}>{formula?.error ?? `Calcul automatique : ${field.formula}`}</small></>
          : field.type === 'select' ? <select className="form-input ci-input" id={id} value={value} onChange={event => update(field.id, event.target.value)}>
            <option value="">Non renseigné</option>
            {value && !field.options.includes(value) && <option value={value}>{value} (ancienne valeur)</option>}
            {field.options.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
          : <input className="form-input ci-input" id={id} type={field.type} step={field.type === 'number' ? 'any' : undefined}
            maxLength={field.type === 'url' ? 2000 : 10000} value={value}
            placeholder={field.type === 'url' ? 'https://…' : undefined}
            onChange={event => update(field.id, event.target.value)} />}
      </div>;
    })}</div>
  </section>;
}
