import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, CalendarDays, FileText, GripVertical, Link, Plus, Save, Smile, Trash2 } from 'lucide-react';
import type { AppData, Mutation } from '../shared/types';
import type { ReportDraft, ReportTemplate } from '../shared/customization';
import './report-templates.css';

type TemplateDraft = Omit<ReportTemplate, 'id'>;
const FIELD_TYPES = { text: 'Texte', number: 'Nombre', date: 'Date', url: 'Lien web' } as const;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'L’enregistrement a échoué. Réessayez.';
const dateLabel = (date: string) => date ? new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)) : '—';
const copyTemplate = (template: TemplateDraft): TemplateDraft => ({ name: template.name, titlePattern: template.titlePattern, indicators: template.indicators.map(item => ({ ...item })), fields: template.fields.map(item => ({ ...item })) });
const newDraft = (): TemplateDraft => ({ name: '', titlePattern: 'Compte rendu du {date}', indicators: [{ id: crypto.randomUUID(), label: 'Qualité' }], fields: [{ id: crypto.randomUUID(), label: 'Faits marquants', type: 'text' }] });

function FieldIcon({ type }: { type: ReportTemplate['fields'][number]['type'] }) {
  return type === 'date' ? <CalendarDays size={17} /> : type === 'url' ? <Link size={17} /> : <FileText size={17} />;
}

export function ReportTemplatesView({ data, mutate, notify, readOnly = false }: { readOnly?: boolean; data: AppData; mutate: Mutation; notify: (message: string) => void }) {
  const templates = data.reportTemplates ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(() => templates[0]?.id ?? null);
  const [draft, setDraft] = useState<TemplateDraft>(() => templates[0] ? copyTemplate(templates[0]) : newDraft());
  const [baseline, setBaseline] = useState(() => JSON.stringify(draft));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [customFieldId, setCustomFieldId] = useState('');
  const [draggedFieldId, setDraggedFieldId] = useState<string | null>(null);
  const inFlight = useRef(false);
  const pendingCreation = useRef<{ ids: Set<string>; signature: string } | null>(null);
  const dirty = JSON.stringify(draft) !== baseline;
  const reportFields = (data.customFieldDefinitions ?? []).filter(item => item.scope === 'report');
  const usableFields = reportFields.filter((item): item is typeof item & { type: ReportTemplate['fields'][number]['type'] } => ['text', 'number', 'date', 'url'].includes(item.type));

  useEffect(() => {
    const pending = pendingCreation.current;
    if (!pending) return;
    const created = templates.find(item => !pending.ids.has(item.id) && JSON.stringify(copyTemplate(item)) === pending.signature);
    if (created) { setSelectedId(created.id); setDraft(copyTemplate(created)); setBaseline(pending.signature); pendingCreation.current = null; }
  }, [data.reportTemplates]);

  function load(template: ReportTemplate | null) {
    if (busy || (dirty && !window.confirm('Quitter ce modèle sans enregistrer les modifications ?'))) return;
    const next = template ? copyTemplate(template) : newDraft();
    setSelectedId(template?.id ?? null); setDraft(next); setBaseline(JSON.stringify(next)); setError(''); setCustomFieldId('');
  }
  function update<K extends keyof TemplateDraft>(key: K, value: TemplateDraft[K]) { setDraft(current => ({ ...current, [key]: value })); setError(''); }
  function moveField(id: string, direction: -1 | 1) {
    const index = draft.fields.findIndex(item => item.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= draft.fields.length) return;
    const fields = [...draft.fields]; [fields[index], fields[target]] = [fields[target], fields[index]]; update('fields', fields);
  }
  function moveTo(id: string, targetId: string) {
    if (busy || id === targetId) return;
    const fields = [...draft.fields]; const source = fields.findIndex(item => item.id === id); const target = fields.findIndex(item => item.id === targetId);
    if (source < 0 || target < 0) return;
    const [moved] = fields.splice(source, 1); fields.splice(target, 0, moved); update('fields', fields);
  }
  function addCustomField() {
    const item = usableFields.find(field => field.id === customFieldId);
    if (!item || draft.fields.length >= 25) return;
    update('fields', [...draft.fields, { id: crypto.randomUUID(), label: item.name, type: item.type }]); setCustomFieldId('');
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (inFlight.current) return;
    const payload = { ...copyTemplate(draft), name: draft.name.trim(), titlePattern: draft.titlePattern.trim(), indicators: draft.indicators.map(item => ({ ...item, label: item.label.trim() })), fields: draft.fields.map(item => ({ ...item, label: item.label.trim() })) };
    if (!payload.name || !payload.titlePattern || payload.indicators.some(item => !item.label) || payload.fields.some(item => !item.label)) { setError('Renseignez le nom, le titre et tous les libellés du modèle.'); return; }
    inFlight.current = true; setBusy(true); setError('');
    if (!selectedId) pendingCreation.current = { ids: new Set(templates.map(item => item.id)), signature: JSON.stringify(payload) };
    try {
      await mutate('report-templates', selectedId ? 'PATCH' : 'POST', payload, selectedId ?? undefined);
      setDraft(payload); setBaseline(JSON.stringify(payload)); notify(selectedId ? 'Modèle de compte rendu mis à jour.' : 'Modèle de compte rendu créé.');
    } catch (failure) { pendingCreation.current = null; setError(errorMessage(failure)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function remove() {
    if (!selectedId || inFlight.current || !window.confirm(`Supprimer le modèle « ${draft.name} » ?`)) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      await mutate('report-templates', 'DELETE', undefined, selectedId);
      const nextTemplate = templates.find(item => item.id !== selectedId); const next = nextTemplate ? copyTemplate(nextTemplate) : newDraft();
      setSelectedId(nextTemplate?.id ?? null); setDraft(next); setBaseline(JSON.stringify(next)); notify('Modèle de compte rendu supprimé.');
    } catch (failure) { setError(errorMessage(failure)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <section className="rt-view" aria-label="Gestion des modèles de compte rendu">
    <div className="rt-heading"><h1>Modèle de compte rendu</h1><span>Composez vos indicateurs et vos champs, puis enregistrez le modèle.</span></div>
    <div className="rt-selector-row"><label><span className="sr-only">Modèle de compte rendu enregistré</span><select aria-label="Modèle de compte rendu enregistré" value={selectedId ?? ''} disabled={busy} onChange={event => load(templates.find(item => item.id === event.target.value) ?? null)}><option value="">Nouveau modèle</option>{templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="rt-add-model" aria-label="Nouveau modèle de compte rendu" disabled={busy || readOnly} onClick={() => load(null)}><Plus size={18} /><span>Nouveau modèle</span></button></div>
    {!templates.length && <p className="rt-note">Aucun modèle enregistré. Configurez le premier modèle ci-dessous.</p>}
    <form onSubmit={save}>
      <fieldset className="rt-form-fieldset" disabled={busy || readOnly}>
        <div className="rt-model-details"><label className="rt-field"><span>Nom du modèle</span><input required maxLength={200} value={draft.name} placeholder="Ex. Comité de pilotage" onChange={event => update('name', event.target.value)} /></label><label className="rt-field"><span>Titre du compte rendu</span><input required maxLength={500} value={draft.titlePattern} onChange={event => update('titlePattern', event.target.value)} /><small>Utilisez {'{date}'} pour insérer la date du compte rendu.</small></label></div>
        <article className="rt-builder" aria-label="Composition du modèle">
          <header className="rt-blue-header">COMPTE RENDU</header>
          <div className="rt-builder-body">
            <div className="rt-title-preview">Ex : {draft.titlePattern.replaceAll('{date}', dateLabel(data.today)) || 'Titre du compte rendu'}</div>
            <p className="rt-attribution">Fait le {dateLabel(data.today)} par {data.currentUser.name}</p>
            <h2>Indicateurs déclaratifs</h2>
            <div className="rt-indicators">{draft.indicators.map((item, index) => <div className="rt-indicator" key={item.id}><span className="rt-smile" aria-hidden="true"><Smile size={29} /></span><label><span className="sr-only">Libellé de l’indicateur {index + 1}</span><input required aria-label={`Libellé de l’indicateur ${index + 1}`} maxLength={200} value={item.label} onChange={event => update('indicators', draft.indicators.map(indicator => indicator.id === item.id ? { ...indicator, label: event.target.value } : indicator))} /></label><button type="button" className="rt-small-action" aria-label={`Supprimer l’indicateur ${item.label || index + 1}`} onClick={() => update('indicators', draft.indicators.filter(indicator => indicator.id !== item.id))}><Trash2 size={14} /></button></div>)}{draft.indicators.length < 5 && <button type="button" className="rt-add-indicator" aria-label="Ajouter un indicateur" onClick={() => update('indicators', [...draft.indicators, { id: crypto.randomUUID(), label: '' }])}><Plus size={23} /><span>Ajouter un indicateur</span></button>}</div>
            <div className="rt-section-heading"><h2>Champs</h2><span>{draft.fields.length} / 25</span></div>
            <div className="rt-field-list">{draft.fields.map((item, index) => <div className="rt-builder-field" key={item.id} draggable={!busy} onDragStart={event => { if ((event.target as HTMLElement).closest('input,select,button')) { event.preventDefault(); return; } setDraggedFieldId(item.id); event.dataTransfer.setData('text/plain', item.id); event.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => setDraggedFieldId(null)} onDragOver={event => { if (draggedFieldId && draggedFieldId !== item.id) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }} onDrop={event => { event.preventDefault(); if (draggedFieldId) moveTo(draggedFieldId, item.id); setDraggedFieldId(null); }}>
              <div className="rt-builder-field-header"><GripVertical size={17} className="rt-grip" aria-hidden="true" /><FieldIcon type={item.type} /><label className="rt-field-label"><span className="sr-only">Libellé du champ {index + 1}</span><input required aria-label={`Libellé du champ ${index + 1}`} maxLength={200} value={item.label} placeholder="Nom du champ" onChange={event => update('fields', draft.fields.map(field => field.id === item.id ? { ...field, label: event.target.value } : field))} /></label><select aria-label={`Type du champ ${index + 1}`} value={item.type} onChange={event => update('fields', draft.fields.map(field => field.id === item.id ? { ...field, type: event.target.value as ReportTemplate['fields'][number]['type'] } : field))}>{Object.entries(FIELD_TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><div className="rt-reorder-actions"><button type="button" className="rt-small-action" aria-label={`Monter le champ ${item.label || index + 1}`} disabled={index === 0} onClick={() => moveField(item.id, -1)}><ArrowUp size={16} /></button><button type="button" className="rt-small-action" aria-label={`Descendre le champ ${item.label || index + 1}`} disabled={index === draft.fields.length - 1} onClick={() => moveField(item.id, 1)}><ArrowDown size={16} /></button><button type="button" className="rt-small-action rt-danger" aria-label={`Supprimer le champ ${item.label || index + 1}`} onClick={() => update('fields', draft.fields.filter(field => field.id !== item.id))}><Trash2 size={16} /></button></div></div>
              <div className="rt-empty-field" aria-hidden="true">{FIELD_TYPES[item.type]} à renseigner lors de la rédaction du compte rendu</div>
            </div>)}</div>
            <div className="rt-drop-hint">Réordonnez les champs par glisser-déposer ou avec les flèches.</div>
            <button type="button" className="rt-button rt-button-secondary" disabled={draft.fields.length >= 25} onClick={() => update('fields', [...draft.fields, { id: crypto.randomUUID(), label: '', type: 'text' }])}><Plus size={16} />Ajouter un champ</button>
          </div>
        </article>
        <section className="rt-custom-fields" aria-label="Champs personnalisés de compte rendu"><h2>Champs personnalisés</h2><p>Ajoutez une copie d’un champ configuré pour les comptes rendus.</p><div className="rt-custom-picker"><select aria-label="Champ personnalisé à ajouter au modèle" value={customFieldId} onChange={event => setCustomFieldId(event.target.value)}><option value="">Sélectionner un champ</option>{usableFields.map(item => <option key={item.id} value={item.id}>{item.name} · {FIELD_TYPES[item.type as keyof typeof FIELD_TYPES]}</option>)}</select><button type="button" className="rt-button rt-button-secondary" disabled={!customFieldId || draft.fields.length >= 25} onClick={addCustomField}><Plus size={16} />Ajouter au modèle</button></div>{!usableFields.length && <p className="rt-note">Aucun champ compatible configuré pour les comptes rendus.</p>}{reportFields.some(item => !['text', 'number', 'date', 'url'].includes(item.type)) && <p className="rt-note">Les modèles de compte rendu acceptent les champs de texte simple, nombre, date et lien web.</p>}</section>
      </fieldset>
      {error && <p className="rt-error" role="alert">{error}</p>}
      <div className="rt-save-actions"><span role="status">{busy ? 'Enregistrement en cours…' : dirty || !selectedId ? 'Modèle non enregistré' : 'Modèle enregistré'}</span>{selectedId && <button type="button" className="rt-button rt-button-danger" disabled={busy || readOnly} onClick={() => void remove()}><Trash2 size={16} />Supprimer le modèle</button>}<button type="submit" className="rt-button rt-button-primary" disabled={busy || readOnly || (!!selectedId && !dirty)}><Save size={16} />{busy ? 'Enregistrement…' : 'Enregistrer le modèle'}</button></div>
    </form>
  </section>;
}

export type { ReportDraft } from '../shared/customization';

export function ReportDraftPreview({ draft, projectName, authorName }: { draft: ReportDraft; projectName: string; authorName: string }) {
  const title = draft.template.titlePattern.replaceAll('{date}', dateLabel(draft.date));
  return <div className="rt-report-preview" aria-label="Aperçu du compte rendu"><header className="rt-blue-header">COMPTE RENDU</header><div className="rt-report-preview-body"><h2>{title}</h2><p className="rt-report-project">{projectName}</p><p className="rt-attribution">Fait le {dateLabel(draft.date)} par {authorName} · Modèle : {draft.template.name}</p>{draft.template.indicators.length > 0 && <><h3>Indicateurs déclaratifs</h3><div className="rt-rated-indicators">{draft.template.indicators.map(item => { const rating = draft.ratings[item.id] ?? 3; return <div key={item.id}><span className={`rt-rating-smile rt-rating-${rating}`} aria-hidden="true"><Smile size={25} /></span><strong>{item.label}</strong><span>{rating} / 5</span></div>; })}</div></>}{draft.template.fields.map(field => { const value = draft.values[field.id] ?? ''; return <section className="rt-report-field" key={field.id}><h3>{field.label}</h3><p>{value ? field.type === 'date' ? dateLabel(value) : value : 'Non renseigné'}</p></section>; })}</div></div>;
}

export function ReportTemplateComposer({ data, projectName, onPrint, onSave, canSave = true }: { data: AppData; projectName: string; onPrint: (draft: ReportDraft) => void; onSave?: (draft: ReportDraft) => void; canSave?: boolean }) {
  const templates = data.reportTemplates ?? [];
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [date, setDate] = useState(data.today);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const template = templates.find(item => item.id === templateId);
  const draft = template ? { template, date, ratings, values } : null;
  function changeTemplate(id: string) {
    if ((Object.keys(values).length || Object.keys(ratings).length) && !window.confirm('Changer de modèle et effacer les valeurs de ce brouillon ?')) return;
    setTemplateId(id); setRatings({}); setValues({});
  }
  return <section className="rt-composer card" aria-label="Rédiger un compte rendu">
    <div className="rt-composer-heading"><h2>Compte rendu à partir d’un modèle</h2><p>{onSave ? 'Renseignez le compte rendu, puis enregistrez-le dans le projet. Les indicateurs et les champs du modèle sont conservés avec le document.' : 'Les modèles sont enregistrés. Cette rédaction est un brouillon local à cette page ; imprimez-le ou enregistrez-le en PDF pour le conserver.'}</p></div>
    {!templates.length ? <p className="rt-note">Créez un modèle dans Personnalisation → Modèle de compte rendu, ou utilisez le bouton « Créer un compte rendu » pour partir du modèle simple.</p> : <form onSubmit={event => {
      event.preventDefault(); if (!draft || !date) return;
      const action = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
      if (onSave && action !== 'print') { if (canSave) onSave(draft); } else onPrint(draft);
    }}>
      <div className="rt-composer-settings"><label className="rt-field"><span>Modèle du compte rendu</span><select required value={templateId} onChange={event => changeTemplate(event.target.value)}><option value="">Sélectionner un modèle</option>{templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="rt-field"><span>Date du compte rendu</span><input type="date" required value={date} onChange={event => setDate(event.target.value)} /></label></div>
      {template && <><div className="rt-composer-indicators">{template.indicators.map(item => <label className="rt-field" key={item.id}><span>Évaluation : {item.label}</span><select aria-label={`Évaluation : ${item.label}`} value={ratings[item.id] ?? 3} onChange={event => setRatings(current => ({ ...current, [item.id]: Number(event.target.value) }))}><option value={1}>1 / 5 · Très défavorable</option><option value={2}>2 / 5 · Défavorable</option><option value={3}>3 / 5 · Neutre</option><option value={4}>4 / 5 · Favorable</option><option value={5}>5 / 5 · Très favorable</option></select></label>)}</div><div className="rt-composer-fields">{template.fields.map(field => <label className="rt-field" key={field.id}><span>{field.label}</span>{field.type === 'text' ? <textarea maxLength={20000} rows={3} value={values[field.id] ?? ''} onChange={event => setValues(current => ({ ...current, [field.id]: event.target.value }))} /> : <input type={field.type === 'url' ? 'url' : field.type === 'number' ? 'number' : 'date'} step={field.type === 'number' ? 'any' : undefined} value={values[field.id] ?? ''} onChange={event => setValues(current => ({ ...current, [field.id]: event.target.value }))} />}</label>)}</div>{draft && date && <ReportDraftPreview draft={draft} projectName={projectName} authorName={data.currentUser.name} />}<div className="rt-save-actions"><button type="submit" name="action" value="print" className="rt-button rt-button-secondary" disabled={!date}>Imprimer le compte rendu / PDF</button>{onSave && <button type="submit" name="action" value="save" className="rt-button rt-button-primary" disabled={!date || !canSave}><Save size={16} />Enregistrer le compte rendu</button>}</div></>}
    </form>}
  </section>;
}
