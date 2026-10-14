import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { FileText, Frown, Meh, Pencil, Printer, Save, Smile, Trash2, X } from 'lucide-react';
import type { AppData, Mutation, Project, ProjectReport } from '../shared/types';
import type { ReportDraft, ReportTemplate } from '../shared/customization';
import './project-reports.css';

type ReportContent = Pick<ProjectReport, 'templateId' | 'templateName' | 'title' | 'reportDate' | 'indicators' | 'fields'>;
const RATINGS = ['Très défavorable', 'Défavorable', 'Neutre', 'Favorable', 'Très favorable'];
const SIMPLE_TEMPLATE: ReportTemplate = { id: '', name: 'Modèle simple', titlePattern: 'Compte rendu du {date}', indicators: [{ id: 'simple-quality', label: 'Qualité' }], fields: [{ id: 'simple-highlights', label: 'Faits marquants', type: 'text' }] };
const dateLabel = (date: string) => {
  const value = date.trim();
  if (!value) return '—';
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC' }).format(parsed) : '—';
};
const message = (error: unknown) => error instanceof Error ? error.message : 'Le compte rendu n’a pas pu être enregistré. Réessayez.';
const clone = (report: ReportContent): ReportContent => ({ templateId: report.templateId, templateName: report.templateName, title: report.title, reportDate: report.reportDate.trim(), indicators: report.indicators.map(item => ({ ...item })), fields: report.fields.map(item => ({ ...item, value: item.type === 'text' ? item.value : item.value.trim() })) });

function fromTemplate(template: ReportTemplate, reportDate: string, initial?: ReportDraft): ReportContent {
  return { templateId: template.id || null, templateName: template.name, title: template.titlePattern.replaceAll('{date}', dateLabel(reportDate)), reportDate,
    indicators: template.indicators.map(item => ({ ...item, rating: initial?.ratings[item.id] ?? 3 })),
    fields: template.fields.map(item => { const value = initial?.values[item.id] ?? ''; return { ...item, value: item.type === 'text' ? value : value.trim() }; }) };
}

export function ReportRatingBadge({ label, rating }: { label: string; rating: number }) {
  const Icon = rating <= 2 ? Frown : rating === 3 ? Meh : Smile;
  return <span className="pr-rating-badge" aria-label={`${label} : ${rating} sur 5, ${RATINGS[rating - 1] ?? ''}`}><span className={`pr-rating-icon pr-rating-${rating}`} aria-hidden="true"><Icon size={25} /></span><span>{label}</span><small>{rating} / 5</small></span>;
}

export function ReportSnapshot({ report, projectName }: { report: ProjectReport; projectName: string }) {
  return <article className="pr-snapshot" aria-label="Compte rendu enregistré">
    <header className="pr-document-header"><FileText size={21} aria-hidden="true" />COMPTE RENDU</header>
    <div className="pr-document-body"><h2>{report.title}</h2><p className="pr-project-name">{projectName}</p><p className="pr-attribution">Fait le {dateLabel(report.reportDate)} par {report.authorName} · Modèle : {report.templateName}</p>
      {!!report.indicators.length && <section><h3>Indicateurs déclaratifs</h3><div className="pr-ratings">{report.indicators.map(item => <ReportRatingBadge key={item.id} label={item.label} rating={item.rating} />)}</div></section>}
      {report.fields.map(field => <section key={field.id} className="pr-content-field"><h3>{field.label}</h3><p>{!field.value ? 'Non renseigné' : field.type === 'date' ? dateLabel(field.value) : field.type === 'url' && /^https?:\/\//i.test(field.value) ? <a href={field.value} rel="noopener noreferrer" target="_blank">{field.value}</a> : field.value}</p></section>)}
    </div>
  </article>;
}

export function ProjectReportDialog({ data, project, report, initialDraft, mutate, notify, onClose }: {
  data: AppData; project: Project; report: ProjectReport | null; initialDraft?: ReportDraft;
  mutate: Mutation; notify: (text: string) => void; onClose: () => void;
}) {
  const templates = data.reportTemplates ?? [];
  const currentReport = report && ((data.projectReports ?? []).find(item => item.id === report.id && item.projectId === project.id) ?? report);
  const [draft, setDraft] = useState<ReportContent>(() => report ? clone(report) : fromTemplate(initialDraft?.template ?? templates[0] ?? SIMPLE_TEMPLATE, initialDraft?.date ?? data.today, initialDraft));
  const [baseline, setBaseline] = useState(() => JSON.stringify(draft));
  const [editing, setEditing] = useState(!report);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [printed, setPrinted] = useState<ProjectReport | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const inFlight = useRef(false);
  const titlePattern = useRef<string | null>(report ? null : (initialDraft?.template ?? templates[0] ?? SIMPLE_TEMPLATE).titlePattern);
  const printingCleanup = useRef<(() => void) | null>(null);
  const locked = project.status === 'paused' || project.status === 'closed';
  const dirty = editing && JSON.stringify(draft) !== baseline;
  const preservedTemplate = !!draft.templateId && !templates.some(template => template.id === draft.templateId);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { printingCleanup.current?.(); element?.close(); };
  }, []);

  function close() {
    if (inFlight.current || (dirty && !window.confirm('Fermer le compte rendu sans enregistrer les modifications ?'))) return;
    onClose();
  }
  function update<K extends keyof ReportContent>(key: K, value: ReportContent[K]) { setDraft(current => ({ ...current, [key]: value })); setError(''); }
  function selectTemplate(id: string) {
    if (inFlight.current || !window.confirm('Changer de modèle ? Les indicateurs et les champs de ce compte rendu seront remplacés, ainsi que leurs valeurs.')) return;
    const template = templates.find(item => item.id === id) ?? SIMPLE_TEMPLATE;
    titlePattern.current = template.titlePattern;
    setDraft(fromTemplate(template, draft.reportDate)); setError('');
  }
  function updateDate(reportDate: string) {
    setDraft(current => ({ ...current, reportDate, title: titlePattern.current && current.title === titlePattern.current.replaceAll('{date}', dateLabel(current.reportDate)) ? titlePattern.current.replaceAll('{date}', dateLabel(reportDate)) : current.title }));
    setError('');
  }
  function startEditing() {
    if (!currentReport || locked) return;
    const next = clone(currentReport);
    setDraft(next); setBaseline(JSON.stringify(next)); titlePattern.current = null; setEditing(true); setError('');
  }
  function cancelEditing() {
    if (inFlight.current || (dirty && !window.confirm('Annuler les modifications du compte rendu ?'))) return;
    if (currentReport) { const next = clone(currentReport); setDraft(next); setBaseline(JSON.stringify(next)); }
    setEditing(false); setError('');
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (inFlight.current || locked) return;
    if (!draft.title.trim() || !draft.reportDate) { setError('Renseignez le titre et la date du compte rendu.'); return; }
    inFlight.current = true; setBusy(true); setError('');
    const content = { ...clone(draft), title: draft.title.trim() };
    try {
      await mutate('project-reports', report ? 'PATCH' : 'POST', report ? content : { projectId: project.id, ...content }, report?.id);
      notify(report ? 'Compte rendu mis à jour.' : 'Compte rendu enregistré dans le projet.'); onClose();
    } catch (failure) { setError(message(failure)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function remove() {
    if (!currentReport || locked || inFlight.current || !window.confirm(`Supprimer le compte rendu « ${currentReport.title} » ?`)) return;
    inFlight.current = true; setBusy(true); setError('');
    try { await mutate('project-reports', 'DELETE', undefined, currentReport.id); notify('Compte rendu supprimé.'); onClose(); }
    catch (failure) { setError(message(failure)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function print() {
    if (!currentReport || inFlight.current || printingCleanup.current) return;
    const previous = document.body.getAttribute('data-pz-print');
    const cleanup = () => { window.removeEventListener('afterprint', cleanup); if (previous === null) document.body.removeAttribute('data-pz-print'); else document.body.setAttribute('data-pz-print', previous); printingCleanup.current = null; setPrinted(null); };
    printingCleanup.current = cleanup;
    window.addEventListener('afterprint', cleanup, { once: true });
    flushSync(() => setPrinted({ ...currentReport, ...clone(currentReport) }));
    document.body.setAttribute('data-pz-print', 'project-report');
    try { window.print(); } catch (failure) { cleanup(); setError(message(failure)); }
  }

  return <>
    <dialog className="pr-dialog" ref={dialog} aria-label={report ? 'Compte rendu du projet' : 'Créer un compte rendu'} onCancel={event => { event.preventDefault(); close(); }}>
      <form onSubmit={save}>
        <header className="pr-dialog-header"><div><h2>{report ? 'COMPTE RENDU DU PROJET' : 'CRÉER UN COMPTE RENDU'}</h2><p>{project.name}</p></div><button type="button" className="pr-icon-button" aria-label="Fermer le compte rendu" onClick={close} disabled={busy}><X size={23} /></button></header>
        <div className="pr-dialog-body">
          {locked && <p className="pr-note" role="status">Ce projet est {project.status === 'closed' ? 'clos' : 'interrompu'}. Les comptes rendus restent consultables et imprimables.</p>}
          {editing ? <fieldset className="pr-fieldset" disabled={busy || locked}>
            <div className="pr-settings"><label className="pr-field"><span>Modèle du compte rendu</span><select value={draft.templateId ?? ''} onChange={event => selectTemplate(event.target.value)}><option value="">Modèle simple</option>{preservedTemplate && <option value={draft.templateId!}>{draft.templateName} · version conservée</option>}{templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select><small>Les champs et indicateurs sont conservés avec chaque compte rendu.</small></label><label className="pr-field"><span>Date du compte rendu</span><input type="date" required value={draft.reportDate} onChange={event => updateDate(event.target.value)} /></label></div>
            <label className="pr-field pr-title-field"><span>Titre du compte rendu</span><input required maxLength={500} value={draft.title} onChange={event => update('title', event.target.value)} /></label>
            <section className="pr-editor-document"><header className="pr-document-header"><FileText size={21} aria-hidden="true" />COMPTE RENDU</header><div className="pr-document-body">
              {!!draft.indicators.length && <><h3>Indicateurs déclaratifs</h3><div className="pr-indicator-inputs">{draft.indicators.map(item => <label key={item.id} className="pr-field"><ReportRatingBadge label={item.label} rating={item.rating} /><span className="sr-only">Évaluation : {item.label}</span><select aria-label={`Évaluation : ${item.label}`} value={item.rating} onChange={event => update('indicators', draft.indicators.map(indicator => indicator.id === item.id ? { ...indicator, rating: Number(event.target.value) } : indicator))}>{RATINGS.map((rating, index) => <option key={rating} value={index + 1}>{index + 1} / 5 · {rating}</option>)}</select></label>)}</div></>}
              {draft.fields.map(field => <label className="pr-field pr-report-input" key={field.id}><span>{field.label}</span>{field.type === 'text' ? <textarea maxLength={20000} rows={4} value={field.value} onChange={event => update('fields', draft.fields.map(item => item.id === field.id ? { ...item, value: event.target.value } : item))} /> : <input type={field.type === 'url' ? 'url' : field.type === 'number' ? 'number' : 'date'} maxLength={20000} step={field.type === 'number' ? 'any' : undefined} value={field.value} onChange={event => update('fields', draft.fields.map(item => item.id === field.id ? { ...item, value: event.target.value } : item))} />}</label>)}
              {!draft.fields.length && <p className="pr-note">Ce modèle ne contient aucun champ.</p>}
            </div></section>
          </fieldset> : currentReport && <ReportSnapshot report={currentReport} projectName={project.name} />}
          {error && <p className="pr-error" role="alert">{error}</p>}
        </div>
        <footer className="pr-dialog-footer">
          <div className="pr-footer-left">{currentReport && <button className="pr-button pr-button-secondary" type="button" onClick={print} disabled={busy}><Printer size={16} />{editing ? 'Imprimer la version enregistrée / PDF' : 'Imprimer le compte rendu / PDF'}</button>}</div>
          <div className="pr-footer-actions">{editing ? <><button className="pr-button pr-button-secondary" type="button" disabled={busy} onClick={report ? cancelEditing : close}>{report ? 'Annuler les modifications' : 'Annuler'}</button><button className="pr-button pr-button-blue" type="submit" disabled={busy || locked || (!!report && !dirty)}><Save size={16} />{busy ? 'Enregistrement…' : report ? 'Enregistrer les modifications' : 'Enregistrer le compte rendu'}</button></> : <><button className="pr-button pr-button-danger" type="button" disabled={busy || locked} onClick={() => void remove()}><Trash2 size={16} />Supprimer le compte rendu</button><button className="pr-button pr-button-blue" type="button" disabled={busy || locked} onClick={startEditing}><Pencil size={16} />Modifier le compte rendu</button></>}</div>
        </footer>
      </form>
    </dialog>
    {printed && createPortal(<article className="print-report pr-print-report"><ReportSnapshot report={printed} projectName={project.name} /><footer>Compte rendu enregistré · Planzone 8</footer></article>, document.body)}
  </>;
}
