import { useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, CalendarDays, ChevronRight, Clock3, Coins, FileDown, Files, Folder, LayoutDashboard, List, ListTree, MessageSquare, PanelsTopLeft, Plus, Tag, X } from 'lucide-react';
import { PROJECT_STATUS_LABELS, PROJECT_VIEW_IDS, type AppData, type Mutation, type Project, type ProjectViewId } from '../shared/types';
import { strategicScore, type ProjectTemplate } from '../shared/customization';
import { Modal } from './Dialogs';
import { CustomFieldInputs, RichTextInput } from './CustomFieldInputs';
import './project-creation.css';

const views: { id: ProjectViewId; label: string; detail: string; icon: typeof Folder }[] = [
  { id: 'summary', label: 'Synthèse', detail: 'Synthèse de la performance du projet', icon: LayoutDashboard },
  { id: 'list', label: 'Liste', detail: 'Liste de tous les éléments du projet', icon: List },
  { id: 'gantt', label: 'Gantt', detail: 'Les éléments du projet sur un axe temporel', icon: ListTree },
  { id: 'calendar', label: 'Calendrier', detail: 'Événements, tâches et jalons sur un calendrier', icon: CalendarDays },
  { id: 'board', label: 'Tableau', detail: 'Les tâches organisées par statut', icon: PanelsTopLeft },
  { id: 'time', label: 'Suivi temporel', detail: 'Temps passés et reste à faire des ressources', icon: Clock3 },
  { id: 'discussions', label: 'Discussions', detail: 'Les échanges entre vous et vos collaborateurs', icon: MessageSquare },
  { id: 'documents', label: 'Documents', detail: 'Les documents et dossiers liés à ce projet', icon: Files },
  { id: 'budget', label: 'Budget', detail: 'Les dépenses, recettes et coûts du projet', icon: Coins },
  { id: 'reports', label: 'Rapports / Exports', detail: 'Les rapports et exports du projet', icon: FileDown },
];
function templateDates(template: ProjectTemplate | undefined, today: string) {
  const end = new Date(`${today}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + Math.max(0, ...(template?.tasks.flatMap(task => [task.startOffsetDays ?? 0, task.endOffsetDays ?? 0]) ?? [])));
  return { startDate: today, endDate: end.toISOString().slice(0, 10) };
}
function LabelsPicker({ title, values, suggestions, maxLength, onChange }: { title: string; values: string[]; suggestions: string[]; maxLength: number; onChange: (values: string[]) => void }) {
  const [open, setOpen] = useState(false); const [text, setText] = useState('');
  const add = (value: string) => {
    const label = value.trim();
    if (!label || label.length > maxLength || values.length >= 20) return;
    if (!values.some(item => item.toLocaleLowerCase('fr') === label.toLocaleLowerCase('fr'))) onChange([...values, label]);
    setText('');
  };
  return <section className="prc-labels"><h3>{title}</h3><div className="prc-chips">{values.map(value => <span key={value}>{title.includes('tags') ? <Tag size={13} /> : <Folder size={13} />}{value}<button type="button" aria-label={`Retirer ${value}`} onClick={() => onChange(values.filter(item => item !== value))}><X size={13} /></button></span>)}<button type="button" className="prc-add-label" aria-label={title} aria-expanded={open} onClick={() => setOpen(!open)}><Plus size={19} /></button></div>
    {open && <div className="prc-label-picker"><div><input className="form-input" aria-label={title.includes('tags') ? 'Nouveau tag du projet' : 'Nouveau portefeuille du projet'} maxLength={maxLength} value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(text); } }} placeholder={title.includes('tags') ? 'Nom du tag…' : 'Nom du portefeuille…'} /><button className="button button-secondary" type="button" disabled={!text.trim() || values.length >= 20} onClick={() => add(text)}>Ajouter</button></div>{suggestions.filter(value => !values.some(item => item.toLocaleLowerCase('fr') === value.toLocaleLowerCase('fr'))).slice(0, 8).map(value => <button type="button" className="prc-suggestion" key={value} disabled={values.length >= 20} onClick={() => add(value)}>{value}</button>)}</div>}
  </section>;
}

export function ProjectCreationDialog({ project, data, initialZoneId, initialTemplateId, mutate, onClose, notify }: {
  project: Project | null; data: AppData; initialZoneId?: string; initialTemplateId?: string; mutate: Mutation; onClose: () => void; notify: (message: string) => void;
}) {
  const templates = data.projectTemplates ?? [];
  const initialTemplate = !project ? templates.find(template => template.id === initialTemplateId) : undefined;
  const [stage, setStage] = useState<'choice' | 'blank' | 'template' | 'edit'>(project ? 'edit' : initialTemplate ? 'template' : 'choice');
  const [templateId, setTemplateId] = useState(initialTemplate?.id ?? '');
  const [draft, setDraft] = useState({ name: project?.name ?? initialTemplate?.name ?? '', description: project?.description ?? initialTemplate?.description ?? '',
    descriptionFormat: project?.descriptionFormat ?? initialTemplate?.descriptionFormat ?? 'plain' as 'plain' | 'markdown',
    zoneId: project?.zoneId ?? data.zones.find(zone => zone.id === initialZoneId)?.id ?? data.zones[0]?.id ?? '',
    startDate: project?.startDate ?? data.today, endDate: project?.endDate ?? templateDates(initialTemplate, data.today).endDate,
    status: project?.status ?? 'open', customStatusId: project?.customStatusId ?? null, weather: project?.weather ?? 4,
    budget: project?.budget ?? initialTemplate?.budget ?? 0, color: project?.color ?? initialTemplate?.color ?? '#ff6b24',
    tags: [...project?.tags ?? []], portfolioNames: [...project?.portfolioNames ?? []], enabledViews: [...project?.enabledViews ?? PROJECT_VIEW_IDS] });
  const [customValues, setCustomValues] = useState<Record<string, string>>(() => ({ ...project?.customValues }));
  const [strategicRatings, setStrategicRatings] = useState<Record<string, number>>(() => ({ ...project?.strategicRatings }));
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [imageReading, setImageReading] = useState(false);
  const saving = useRef(false);
  const field = <K extends keyof typeof draft>(key: K, value: typeof draft[K]) => setDraft(previous => ({ ...previous, [key]: value }));
  const close = () => { if (!busy && !imageReading && !saving.current) onClose(); };
  const selectedTemplate = templates.find(template => template.id === templateId);
  const chooseTemplate = (id: string) => {
    const template = templates.find(item => item.id === id); setTemplateId(template?.id ?? '');
    setDraft(previous => ({ ...previous, name: template?.name ?? '', description: template?.description ?? '', descriptionFormat: template?.descriptionFormat ?? 'plain', budget: template?.budget ?? 0, color: template?.color ?? '#ff6b24', ...templateDates(template, data.today) }));
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (saving.current || imageReading) return;
    if (!draft.enabledViews.length) { setError('Activez au moins une vue du projet.'); return; }
    if (stage === 'template' && !selectedTemplate) { setError('Sélectionnez un modèle de projet.'); return; }
    saving.current = true; setBusy(true); setError('');
    try {
      await mutate('projects', project ? 'PATCH' : 'POST', { ...draft,
        ...(Object.keys(customValues).length || project?.customValues ? { customValues } : {}),
        ...(Object.keys(strategicRatings).length || project?.strategicRatings ? { strategicRatings } : {}),
        ...(!project && stage === 'template' && templateId ? { templateId } : {}),
      }, project?.id);
      notify(project ? 'Le projet a été mis à jour.' : 'Votre projet a été créé.'); onClose();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Le projet n’a pas pu être enregistré.'); }
    finally { saving.current = false; setBusy(false); }
  };
  if (stage === 'choice') return <Modal key="choice" title="Créer un nouveau projet" label="Nouveau projet" className="prc-dialog prc-choice" onClose={close}><div className="modal-body"><h3>Comment voulez-vous créer votre projet ?</h3><div className="prc-choice-grid"><button type="button" className="prc-choice-card" aria-label="Depuis zéro" onClick={() => setStage('blank')}><span className="prc-choice-art"><Folder size={64} strokeWidth={1.7} /></span><strong>Depuis zéro</strong><p>Créez et personnalisez votre projet depuis une base nouvelle</p></button><button type="button" className="prc-choice-card" aria-label="À partir d’un modèle" onClick={() => { setStage('template'); if (!templateId && templates[0]) chooseTemplate(templates[0].id); }}><span className="prc-choice-art prc-template-art"><PanelsTopLeft size={64} strokeWidth={1.7} /></span><strong>À partir d’un modèle</strong><p>Gagnez du temps à l’aide d’un modèle de projet prédéfini</p></button></div></div></Modal>;
  const zone = data.zones.find(item => item.id === draft.zoneId);
  const axes = data.strategicAxes ?? [];
  return <Modal key="form" title={project ? 'Paramètres du projet' : stage === 'template' ? 'Créer un projet à partir d’un modèle' : 'Créer un projet de zéro'} label={project ? 'Paramètres du projet' : 'Nouveau projet'} className="prc-dialog prc-form-dialog" onClose={close} large>
    <form onSubmit={save} className="prc-form"><div className="modal-body"><fieldset disabled={busy || imageReading} className="prc-fields">
      <div className="prc-zone-row">{!project && <button type="button" className="prc-back" aria-label="Changer le mode de création" onClick={() => { setStage('choice'); setError(''); }}><ArrowLeft size={16} /></button>}<span>Dans la zone</span><i style={{ background: zone?.color }}>{Math.max(1, data.zones.findIndex(item => item.id === draft.zoneId) + 1)}</i><Folder size={19} /><label><span className="sr-only">Zone</span><select className="form-input" required value={draft.zoneId} onChange={event => field('zoneId', event.target.value)}>{data.zones.map(zone => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</select></label></div>
      {stage === 'template' && <section className="prc-template-selection"><label className="form-field">Modèle de projet<select className="form-input" required value={templateId} onChange={event => chooseTemplate(event.target.value)}><option value="">Choisir un modèle</option>{templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>{selectedTemplate ? <p>{selectedTemplate.description}<small>{selectedTemplate.tasks.length} tâche(s) et jalon(s) · phases, listes et dépendances repris · dates relatives au début du projet</small></p> : <p>{templates.length ? 'Sélectionnez un modèle de projet.' : 'Aucun modèle disponible.'} <a href="#customization/project-templates" onClick={close}>Créer un modèle dans Personnalisation</a> ou <button type="button" onClick={() => setStage('blank')}>partir de zéro</button>.</p>}</section>}
      <div className="prc-columns"><div className="prc-column"><label className="form-field prc-name">Nom du projet<input className="form-input" autoComplete="off" required maxLength={200} value={draft.name} onChange={event => field('name', event.target.value)} placeholder="Nommer votre projet" /></label>
        <div className="prc-label-grid"><LabelsPicker title="Ajouter des portefeuilles" values={draft.portfolioNames} suggestions={[...new Set(data.projects.flatMap(item => item.portfolioNames ?? []))]} maxLength={100} onChange={value => field('portfolioNames', value)} /><LabelsPicker title="Ajouter des tags" values={draft.tags} suggestions={[...new Set([...data.projects.flatMap(item => item.tags ?? []), ...data.tasks.flatMap(item => item.tags)])]} maxLength={50} onChange={value => field('tags', value)} /></div>
        <div className="form-field prc-description"><label htmlFor="prc-description">Description</label><RichTextInput id="prc-description" label="Description" value={draft.description} onChange={value => field('description', value)} onFormat={() => field('descriptionFormat', 'markdown')} /><span className="prc-description-count">{draft.description.length} / 10 000</span></div>
        <CustomFieldInputs definitions={data.customFieldDefinitions ?? []} scope="project" values={customValues} onChange={setCustomValues} onPendingChange={setImageReading} builtinValues={{ budget: draft.budget }} />
        {!data.customFieldDefinitions?.some(item => item.scope === 'project') && <div className="prc-custom-empty"><h3>Champs personnalisés</h3><p>Aucun champ projet configuré. <a href="#customization/custom-fields" onClick={close}>Configurer les champs</a></p></div>}
        {axes.length > 0 && <details className="prc-additional" open={!!project}><summary>Axes stratégiques <span>Score : {strategicScore({ ...draft, id: project?.id ?? '', strategicRatings }, axes)}</span></summary><div className="ci-strategic-fields">{axes.map(axis => <label className="ci-field" key={axis.id}><span>{axis.code}</span><select className="form-input" aria-label={`Évaluation ${axis.code}`} value={strategicRatings[axis.id] ?? ''} onChange={event => setStrategicRatings(previous => { const next = { ...previous }; if (event.target.value === '') delete next[axis.id]; else next[axis.id] = Number(event.target.value); return next; })}><option value="">Non évalué</option>{axis.scale.map((label, index) => <option key={index} value={index - 2}>{index - 2} · {label}</option>)}</select></label>)}</div><p className="ci-strategic-note">Score stratégique : <strong>{strategicScore({ ...draft, id: project?.id ?? '', strategicRatings }, axes)}</strong> · Somme des évaluations multipliées par le poids de chaque axe.</p></details>}
      </div><div className="prc-column"><div className="prc-dates"><label className={`form-field prc-status prc-status-${draft.status}`}>Statut du projet<div><Folder size={16} /><select className="form-input" aria-label="État" value={draft.customStatusId ?? draft.status} onChange={event => { const definition = data.projectStatusDefinitions?.find(item => item.id === event.target.value); setDraft(previous => ({ ...previous, status: definition?.baseStatus ?? event.target.value as Project['status'], customStatusId: definition?.id ?? null })); }}>{Object.entries(PROJECT_STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}{draft.customStatusId && !data.projectStatusDefinitions?.some(item => item.id === draft.customStatusId) && <option value={draft.customStatusId}>{PROJECT_STATUS_LABELS[draft.status]} (ancien statut personnalisé)</option>}{data.projectStatusDefinitions?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronRight size={17} /></div></label><label className="form-field">Date de début<input className="form-input" type="date" required value={draft.startDate} onChange={event => field('startDate', event.target.value)} /></label><label className="form-field">Date de fin<input className="form-input" type="date" required min={draft.startDate} value={draft.endDate} onChange={event => field('endDate', event.target.value)} /></label></div>
        <section className="prc-views" aria-label="Vues du projet à activer"><div className="prc-views-heading"><h3>Vues</h3><label className="prc-switch"><span>Tout activer</span><input type="checkbox" role="switch" checked={draft.enabledViews.length === PROJECT_VIEW_IDS.length} onChange={event => field('enabledViews', event.target.checked ? [...PROJECT_VIEW_IDS] : ['summary'])} /></label></div><div className="prc-view-list">{views.map(view => <label className="prc-view-row" key={view.id}><view.icon size={18} /><strong>{view.label}</strong><em>{view.detail}</em><input type="checkbox" role="switch" aria-label={`Activer la vue ${view.label}`} checked={draft.enabledViews.includes(view.id)} onChange={event => field('enabledViews', event.target.checked ? [...draft.enabledViews, view.id] : draft.enabledViews.filter(id => id !== view.id))} /></label>)}</div><p className="prc-view-note">L’équipe reste accessible. Conservez au moins une vue ; « Tout activer » désactivé conserve la synthèse. Ces choix ne suppriment aucune donnée.</p></section>
        <details className="prc-additional" open={!!project}><summary>Budget et présentation</summary><div className="form-grid"><label className="form-field">Budget alloué (€)<input className="form-input" type="number" min="0" max="1000000000" step="0.01" required value={draft.budget} onChange={event => field('budget', Number(event.target.value))} /></label><label className="form-field">Météo déclarée<select className="form-input" value={draft.weather} onChange={event => field('weather', Number(event.target.value))}>{[[5, 'Très favorable'], [4, 'Favorable'], [3, 'À surveiller'], [2, 'Difficile'], [1, 'Critique']].map(([value, label]) => <option key={value} value={value}>{value}/5 · {label}</option>)}</select></label><label className="form-field">Couleur du projet<input className="form-input ci-color-input" type="color" value={draft.color} onChange={event => field('color', event.target.value)} /></label></div></details>
      </div></div>
    </fieldset>{error && <p role="alert" className="form-error">{error}</p>}{(draft.status === 'paused' || draft.status === 'closed') && <p className="form-notice">Ce statut verrouille les tâches, les temps, les dépenses, les recettes et les commentaires. Reprenez le projet depuis ses paramètres pour les modifier.</p>}</div><footer className="modal-footer"><button className="button button-secondary" type="button" disabled={busy || imageReading} onClick={close}>Annuler</button><button className="button button-primary" aria-label={project ? 'Enregistrer le projet' : 'Créer le projet'} disabled={busy || imageReading || !draft.zoneId || (stage === 'template' && !selectedTemplate)}>{busy ? 'Enregistrement…' : project ? 'Enregistrer le projet' : 'Créer'}</button></footer></form>
  </Modal>;
}
