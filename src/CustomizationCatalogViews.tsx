import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Calculator, CalendarDays, ChevronDown, ChevronUp, FileText, Flag, Folder, Hash, Image, Link, List, Plus, Trash2, X } from 'lucide-react';
import { canCreateProject } from '../shared/permissions';
import type { AppData, Mutation } from '../shared/types';
import { templateFromProject, type CustomFieldDefinition, type CustomFieldScope, type CustomFieldType, type ProjectTemplate, type TemplateTask } from '../shared/customization';
import { CUSTOM_FIELD_TYPE_LABELS, FORMULA_BUILTINS, validateFormulaDefinitions } from '../shared/custom-field-values';
import './customization-catalog.css';

type CatalogProps = { data: AppData; mutate: Mutation; notify: (message: string) => void; readOnly?: boolean };
const failureMessage = (error: unknown) => error instanceof Error ? error.message : 'L’enregistrement a échoué. Réessayez.';
const euros = (amount: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(amount);
const scopeLabels: Record<CustomFieldScope, string> = { task: 'Éléments de projets', project: 'Projets', resource: 'Ressources', report: 'Comptes rendus', 'time-entry': 'Saisies de temps' };
const typeLabels = CUSTOM_FIELD_TYPE_LABELS;
const scopeOrder: CustomFieldScope[] = ['task', 'project', 'resource', 'report', 'time-entry'];

function CatalogDialog({ title, children, onClose, busy, wide = false, kind = 'pc' }: { title: string; children: ReactNode; onClose: () => void; busy: boolean; wide?: boolean; kind?: 'pc' | 'cf' }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => { element?.close(); }; }, []);
  return <dialog className={`${kind}-dialog ${wide ? `${kind}-dialog-wide` : ''}`} ref={dialog} aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className={`${kind}-dialog-header`}><h2>{title}</h2><button type="button" className={`${kind}-icon-button`} aria-label="Fermer le formulaire" disabled={busy} onClick={onClose}><X size={23} /></button></header>
    {children}
  </dialog>;
}

const blankTemplate = (): Omit<ProjectTemplate, 'id'> => ({ name: '', description: '', budget: 0, color: '#ff6b24', tasks: [] });
const blankTask = (kind: TemplateTask['kind']): TemplateTask => ({ key: `task-${crypto.randomUUID()}`, title: '', description: '', phase: 'Planification et préparation', kind, allocatedHours: kind === 'task' ? 8 : 0, tags: [], startOffsetDays: null, endOffsetDays: null, dependsOnKey: null });

function ProjectTemplateEditor({ template, data, mutate, notify, onClose }: CatalogProps & { template: ProjectTemplate | null; onClose: () => void }) {
  const [draft, setDraft] = useState<Omit<ProjectTemplate, 'id'>>(() => template ? { name: template.name, description: template.description, budget: template.budget, color: template.color, tasks: template.tasks.map(task => ({ ...task, tags: [...task.tags] })),
    ...(template.taskLists ? { taskLists: template.taskLists.map(list => ({ ...list })) } : {}) } : blankTemplate());
  const [sourceId, setSourceId] = useState('');
  const [taskTags, setTaskTags] = useState<Record<string, string>>(() => Object.fromEntries((template?.tasks ?? []).map(task => [task.key, task.tags.join(', ')])));
  const [busy, setBusy] = useState(false); const busyRef = useRef(false); const [error, setError] = useState('');
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const listPath = (key: string) => {
    const names: string[] = []; const visited = new Set<string>();
    let list = draft.taskLists?.find(item => item.key === key);
    while (list && !visited.has(list.key)) {
      visited.add(list.key); names.unshift(list.name);
      const parentKey = list.parentKey;
      list = parentKey ? draft.taskLists?.find(item => item.key === parentKey) : undefined;
    }
    return names.join(' / ');
  };
  const change = <K extends keyof typeof draft>(key: K, value: typeof draft[K]) => setDraft(previous => ({ ...previous, [key]: value }));
  const changeTask = (key: string, updates: Partial<TemplateTask>) => setDraft(previous => ({ ...previous, tasks: previous.tasks.map(task => task.key === key ? { ...task, ...updates } : task) }));
  function addTask(kind: TemplateTask['kind']) { if (draft.tasks.length >= 200) return; const task = blankTask(kind); setDraft(previous => ({ ...previous, tasks: [...previous.tasks, task] })); setTaskTags(previous => ({ ...previous, [task.key]: '' })); setExpandedTask(task.key); }
  function importProject(id: string) {
    if (sourceId === id) return;
    const project = data.projects.find(item => item.id === id);
    if (project && (draft.name || draft.description || draft.tasks.length || draft.taskLists?.length) && !window.confirm('Remplacer le contenu de ce modèle par celui du projet sélectionné ?')) return;
    setSourceId(id);
    if (project) { const imported = templateFromProject(project, data.tasks, data.taskLists); setDraft(imported); setTaskTags(Object.fromEntries(imported.tasks.map(task => [task.key, task.tags.join(', ')]))); setExpandedTask(null); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busyRef.current) return;
    if (draft.tasks.some(task => !task.title.trim())) { setError('Renseignez le titre de chaque tâche et de chaque jalon.'); return; }
    if (draft.tasks.some(task => task.startOffsetDays !== null && task.endOffsetDays !== null && task.endOffsetDays < task.startOffsetDays)) { setError('Le décalage de fin doit être supérieur ou égal au décalage de début.'); return; }
    if (draft.tasks.some(task => task.tags.length > 20 || task.tags.some(tag => tag.length > 50))) { setError('Chaque élément accepte au maximum 20 tags de 50 caractères.'); return; }
    busyRef.current = true; setBusy(true); setError('');
    try {
      const payload = { ...draft, name: draft.name.trim(), tasks: draft.tasks.map(task => ({ ...task, title: task.title.trim(), phase: task.phase.trim(), allocatedHours: task.kind === 'milestone' ? 0 : task.allocatedHours })) };
      await mutate('project-templates', template ? 'PATCH' : 'POST', payload, template?.id);
      notify(template ? 'Le modèle de projet a été modifié.' : 'Le modèle de projet a été créé.'); onClose();
    } catch (error) { setError(failureMessage(error)); } finally { busyRef.current = false; setBusy(false); }
  }
  async function remove() {
    if (!template || busyRef.current || !window.confirm(`Supprimer le modèle « ${template.name} » ? Les projets déjà créés seront conservés.`)) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await mutate('project-templates', 'DELETE', undefined, template.id); notify('Le modèle de projet a été supprimé.'); onClose(); }
    catch (error) { setError(failureMessage(error)); } finally { busyRef.current = false; setBusy(false); }
  }
  return <CatalogDialog title={template ? 'Modifier le modèle de projet' : 'Nouveau modèle de projet'} onClose={onClose} busy={busy} wide>
    <form onSubmit={save}><div className="pc-dialog-body"><fieldset className="pc-fields" disabled={busy}>
      {!template && <label className="pc-field">Partir d’un projet existant<select value={sourceId} onChange={event => importProject(event.target.value)}><option value="">Créer un modèle vide</option>{data.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}
      <div className="pc-form-grid"><label className="pc-field pc-field-full">Nom du modèle<input required maxLength={200} value={draft.name} onChange={event => change('name', event.target.value)} placeholder="Ex. : Déploiement d’un logiciel" /></label>
        <label className="pc-field">Budget alloué (€)<input type="number" required min="0" max="1000000000000" step="0.01" value={draft.budget} onChange={event => change('budget', Number(event.target.value))} /></label>
        <label className="pc-field">Couleur du modèle<input type="color" value={draft.color} onChange={event => change('color', event.target.value)} /></label>
        <label className="pc-field pc-field-full">Description<textarea rows={3} maxLength={10000} value={draft.description} onChange={event => change('description', event.target.value)} /></label></div>
      <section className="pc-template-tasks" aria-label="Tâches et jalons du modèle"><div className="pc-section-heading"><h3>Tâches et jalons <span>{draft.tasks.length}</span></h3><div className="pc-task-add-actions"><button className="pc-secondary-button" type="button" disabled={draft.tasks.length >= 200} onClick={() => addTask('task')}><Plus size={15} />Ajouter une tâche</button><button className="pc-secondary-button" type="button" disabled={draft.tasks.length >= 200} onClick={() => addTask('milestone')}><Flag size={15} />Ajouter un jalon</button></div></div>
        <p className="pc-help">Les dates sont des décalages en jours par rapport au début du nouveau projet. Les affectations et les temps passés ne sont pas copiés.</p>
        {!!draft.taskLists?.length && <div aria-label="Listes conservées dans le modèle"><h3>Listes <span>{draft.taskLists.length}</span></h3><ul className="pc-help">{draft.taskLists.map(list => <li key={list.key}>{listPath(list.key)}</li>)}</ul></div>}
        {!draft.tasks.length && <p className="pc-task-empty">Ce modèle ne contient pas encore de tâche ni de jalon.</p>}
        {draft.tasks.map((task, index) => <article className="pc-task-editor" key={task.key}>
          <div className="pc-task-editor-header"><button type="button" aria-expanded={expandedTask === task.key} aria-controls={`pc-task-${task.key}`} onClick={() => setExpandedTask(previous => previous === task.key ? null : task.key)}>{task.kind === 'milestone' ? <Flag size={16} /> : <FileText size={16} />}<strong>{task.title || `${task.kind === 'milestone' ? 'Nouveau jalon' : 'Nouvelle tâche'} ${index + 1}`}</strong><span>{task.listKey ? listPath(task.listKey) : task.phase}</span>{expandedTask === task.key ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button><button className="pc-icon-button pc-delete-icon" type="button" aria-label={`Retirer ${task.title || `l’élément ${index + 1}`} du modèle`} onClick={() => { setDraft(previous => ({ ...previous, tasks: previous.tasks.filter(item => item.key !== task.key).map(item => ({ ...item, dependsOnKey: item.dependsOnKey === task.key ? null : item.dependsOnKey })) })); if (expandedTask === task.key) setExpandedTask(null); }}><Trash2 size={16} /></button></div>
          {expandedTask === task.key && <div className="pc-task-editor-body pc-form-grid" id={`pc-task-${task.key}`}>
            <label className="pc-field pc-field-full">Titre de l’élément<input required maxLength={200} value={task.title} onChange={event => changeTask(task.key, { title: event.target.value })} /></label>
            <label className="pc-field">Type d’élément<select value={task.kind} onChange={event => changeTask(task.key, { kind: event.target.value as TemplateTask['kind'], allocatedHours: event.target.value === 'milestone' ? 0 : task.allocatedHours })}><option value="task">Tâche</option><option value="milestone">Jalon</option></select></label>
            {!!draft.taskLists?.length && <label className="pc-field">Liste de l’élément<select value={task.listKey ? `list:${task.listKey}` : task.phase.trim() && task.phase.trim() !== 'Sans phase' ? 'phase' : 'root'} onChange={event => changeTask(task.key, event.target.value === 'root' ? { listKey: null, phase: 'Sans phase' } : event.target.value === 'phase' ? { listKey: null } : { listKey: event.target.value.slice(5) })}>{!!task.phase.trim() && task.phase.trim() !== 'Sans phase' && <option value="phase">Phase : {task.phase}</option>}<option value="root">Racine du projet</option>{draft.taskLists.map(list => <option key={list.key} value={`list:${list.key}`}>{listPath(list.key)}</option>)}</select></label>}
            <label className="pc-field">Phase<input maxLength={200} value={task.phase} onChange={event => changeTask(task.key, { phase: event.target.value })} /></label>
            <label className="pc-field">Travail alloué (heures)<input type="number" min="0" max="100000" step="0.5" disabled={task.kind === 'milestone'} value={task.allocatedHours} onChange={event => changeTask(task.key, { allocatedHours: Number(event.target.value) })} /></label>
            <label className="pc-field">Démarre après<select value={task.dependsOnKey ?? ''} onChange={event => changeTask(task.key, { dependsOnKey: event.target.value || null })}><option value="">Aucune dépendance</option>{draft.tasks.filter(item => item.key !== task.key).map(item => <option key={item.key} value={item.key}>{item.title || 'Élément sans titre'}</option>)}</select></label>
            <label className="pc-field">Début : décalage en jours<input type="number" min="-36500" max="36500" step="1" value={task.startOffsetDays ?? ''} placeholder="Sans date" onChange={event => changeTask(task.key, { startOffsetDays: event.target.value === '' ? null : Number(event.target.value) })} /></label>
            <label className="pc-field">Fin : décalage en jours<input type="number" min={task.startOffsetDays ?? -36500} max="36500" step="1" value={task.endOffsetDays ?? ''} placeholder="Sans date" onChange={event => changeTask(task.key, { endOffsetDays: event.target.value === '' ? null : Number(event.target.value) })} /></label>
            <label className="pc-field pc-field-full">Description de l’élément<textarea rows={2} maxLength={10000} value={task.description} onChange={event => changeTask(task.key, { description: event.target.value })} /></label>
            <label className="pc-field pc-field-full">Tags (séparés par des virgules)<input maxLength={1100} value={taskTags[task.key] ?? task.tags.join(', ')} onChange={event => { setTaskTags(previous => ({ ...previous, [task.key]: event.target.value })); changeTask(task.key, { tags: event.target.value.split(',').map(tag => tag.trim()).filter(Boolean) }); }} /></label>
          </div>}
        </article>)}
      </section>
    </fieldset>{error && <p className="pc-error" role="alert">{error}</p>}</div><footer className="pc-dialog-footer">{template && <button type="button" className="pc-danger-button" disabled={busy} onClick={remove}><Trash2 size={15} />Supprimer le modèle</button>}<div><button className="pc-secondary-button" type="button" disabled={busy} onClick={onClose}>Annuler</button><button className="pc-primary-button" disabled={busy}>{busy ? 'Enregistrement…' : template ? 'Enregistrer le modèle' : 'Créer le modèle'}</button></div></footer></form>
  </CatalogDialog>;
}

export function ProjectTemplatesView({ data, mutate, notify, onCreateProject, readOnly = false }: CatalogProps & { onCreateProject: (template: ProjectTemplate) => void }) {
  const templates = data.projectTemplates ?? [];
  const [editor, setEditor] = useState<ProjectTemplate | 'new' | null>(null);
  return <div className="pc-view"><div className="pc-toolbar"><p>{templates.length ? `${templates.length} modèle${templates.length > 1 ? 's' : ''} de projet` : 'Modèles de projet'}</p><button className="pc-primary-button" disabled={readOnly} onClick={() => setEditor('new')}><Plus size={17} />Modèle</button></div>
    {templates.length ? <div className="pc-template-grid">{templates.map(template => <article className="pc-template-card" key={template.id} aria-label={`Modèle ${template.name}`}>
      <h2>{template.name}</h2><p className="pc-template-description">{template.description}</p><div className="pc-template-meta"><span><FileText size={13} />{template.tasks.filter(task => task.kind === 'task').length} tâche(s)</span><span><Flag size={13} />{template.tasks.filter(task => task.kind === 'milestone').length} jalon(s)</span>{!!template.taskLists?.length && <span><List size={13} />{template.taskLists.length} liste(s)</span>}<span>{euros(template.budget)}</span></div>
      <footer><button className="pc-text-button" aria-label={`Modifier le modèle ${template.name}`} disabled={readOnly} onClick={() => setEditor(template)}>Modifier</button><button className="pc-primary-button" aria-label={`Créer un projet à partir de ${template.name}`} disabled={!canCreateProject(data)} onClick={() => onCreateProject(template)}>Créer un projet</button></footer>
    </article>)}</div> : <div className="pc-empty"><Folder size={34} /><h2>Créez votre premier modèle de projet</h2><p>Préparez un modèle vide ou reprenez la structure d’un projet existant pour réutiliser ses phases, ses tâches et ses jalons.</p><button className="pc-primary-button" disabled={readOnly} onClick={() => setEditor('new')}><Plus size={16} />Créer un modèle</button></div>}
    {editor && !readOnly && <ProjectTemplateEditor template={editor === 'new' ? null : editor} data={data} mutate={mutate} notify={notify} onClose={() => setEditor(null)} />}
  </div>;
}

function FieldIcon({ type }: { type: CustomFieldType }) { const Icon = type === 'date' ? CalendarDays : type === 'number' ? Hash : type === 'url' ? Link : ['select', 'multi_select'].includes(type) ? List : type === 'formula' ? Calculator : type === 'image' ? Image : FileText; return <Icon size={19} aria-hidden="true" />; }
type FieldDraft = { name: string; scope: CustomFieldScope; type: CustomFieldType; fr: string; en: string; options: string; formula: string };
const draftForField = (field: CustomFieldDefinition): FieldDraft => ({ name: field.name, scope: field.scope, type: field.type, fr: field.translations.fr, en: field.translations.en, options: field.options.join('\n'), formula: field.formula ?? '' });

function CustomFieldEditor({ definition, definitions, initialScope, mutate, notify, onClose, isDialog = false, readOnly = false }: { definition: CustomFieldDefinition | null; definitions: CustomFieldDefinition[]; initialScope: CustomFieldScope; mutate: Mutation; notify: (message: string) => void; onClose: () => void; isDialog?: boolean; readOnly?: boolean }) {
  const initial = definition ? draftForField(definition) : { name: '', scope: initialScope, type: 'text' as const, fr: '', en: '', options: '', formula: '' };
  const [draft, setDraft] = useState<FieldDraft>(initial);
  const [busy, setBusy] = useState(false); const busyRef = useRef(false); const [error, setError] = useState('');
  const change = <K extends keyof FieldDraft>(key: K, value: FieldDraft[K]) => setDraft(previous => ({ ...previous, [key]: value }));
  const changed = !definition || JSON.stringify(initial) !== JSON.stringify(draft);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busyRef.current) return;
    const options = draft.options.split('\n').map(option => option.trim()).filter(Boolean);
    if (['select', 'multi_select'].includes(draft.type) && !options.length) { setError('Ajoutez au moins une option à la liste de choix.'); return; }
    if (['select', 'multi_select'].includes(draft.type) && new Set(options).size !== options.length) { setError('Chaque option doit être unique.'); return; }
    if (['select', 'multi_select'].includes(draft.type) && (options.length > 50 || options.some(option => option.length > 200))) { setError('Une liste accepte au maximum 50 options de 200 caractères.'); return; }
    busyRef.current = true; setBusy(true); setError('');
    try {
      const payload = { name: draft.name.trim(), scope: draft.scope, type: draft.type, translations: { fr: draft.fr.trim(), en: draft.en.trim() }, options: ['select', 'multi_select'].includes(draft.type) ? options : [], ...(draft.type === 'formula' ? { formula: draft.formula.trim() } : definition?.formula ? { formula: '' } : {}) };
      validateFormulaDefinitions([...definitions.filter(field => field.id !== definition?.id), { ...payload, id: definition?.id ?? 'new-field' }]);
      await mutate('custom-field-definitions', definition ? 'PATCH' : 'POST', payload, definition?.id);
      notify(definition ? 'Le champ personnalisé a été modifié.' : 'Le champ personnalisé a été créé.'); onClose();
    } catch (error) { setError(failureMessage(error)); } finally { busyRef.current = false; setBusy(false); }
  }
  async function remove() {
    if (!definition || busyRef.current || !window.confirm(`Supprimer le champ « ${definition.name} » ? Un champ encore utilisé dans une fiche ne peut pas être supprimé.`)) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await mutate('custom-field-definitions', 'DELETE', undefined, definition.id); notify('Le champ personnalisé a été supprimé.'); onClose(); }
    catch (error) { setError(failureMessage(error)); } finally { busyRef.current = false; setBusy(false); }
  }
  const content = <form onSubmit={save} className="cf-editor-form"><div className={isDialog ? 'cf-dialog-body' : 'cf-accordion-body'}><fieldset className="cf-fields" disabled={busy || readOnly}>
    <label className="cf-field">Nom<input required maxLength={200} value={draft.name} onChange={event => change('name', event.target.value)} placeholder="Ex. : Date d’envoi" /></label>
    <div className="cf-form-grid"><label className="cf-field">Éléments concernés<select disabled={!!definition} value={draft.scope} onChange={event => change('scope', event.target.value as CustomFieldScope)}>{scopeOrder.map(scope => <option key={scope} value={scope}>{scopeLabels[scope]}</option>)}</select></label>
      <label className="cf-field">Type de champ<select value={draft.type} onChange={event => change('type', event.target.value as CustomFieldType)}>{Object.entries(typeLabels).map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select></label></div>
    {definition && <p className="cf-help">Les éléments concernés sont conservés. Un changement de type est accepté si les valeurs enregistrées et les formules qui utilisent ce champ restent compatibles.</p>}
    <h3>Traductions</h3><div className="cf-form-grid"><label className="cf-field"><span>🇫🇷 Français (FR)</span><input maxLength={200} value={draft.fr} onChange={event => change('fr', event.target.value)} placeholder={draft.name || 'Libellé français'} /></label><label className="cf-field"><span>🇬🇧 Anglais (EN)</span><input maxLength={200} value={draft.en} onChange={event => change('en', event.target.value)} placeholder="Libellé anglais" /></label></div>
    {['select', 'multi_select'].includes(draft.type) && <label className="cf-field">Options (une par ligne)<textarea required rows={4} maxLength={10000} value={draft.options} onChange={event => change('options', event.target.value)} placeholder={'Faible\nMoyen\nÉlevé'} /></label>}
    {draft.type === 'formula' && <section className="cf-formula-config" aria-label="Configuration de la formule"><label className="cf-field">Expression de la formule<textarea required rows={3} maxLength={1000} value={draft.formula} onChange={event => change('formula', event.target.value)} placeholder={draft.scope === 'task' ? '{allocatedHours} * {progress} / 100' : draft.scope === 'project' ? '{budget} / 2' : draft.scope === 'time-entry' ? '{hours} * 2' : '(10 + 5) * 2'} /></label><p className="cf-help">Opérations : +, −, * et /. Utilisez des parenthèses et des références entre accolades. Le résultat se calcule dans la fiche ; il n’est pas modifiable manuellement.</p><div className="cf-formula-references">{[...FORMULA_BUILTINS[draft.scope], ...definitions.filter(field => field.scope === draft.scope && field.id !== definition?.id && ['number', 'formula'].includes(field.type)).map(field => ({ id: field.id, label: field.translations.fr || field.name }))].map(field => <button type="button" className="cf-reference-button" key={field.id} title={`Insérer {${field.id}}`} onClick={() => change('formula', `${draft.formula}${draft.formula && !/\s$/.test(draft.formula) ? ' ' : ''}{${field.id}}`)}>{field.label}<code>{`{${field.id}}`}</code></button>)}</div></section>}
    {draft.type === 'rich_text' && <p className="cf-help">Texte avec mise en forme : gras, italique et listes. L’éditeur conserve le texte et affiche un aperçu.</p>}
    {draft.type === 'image' && <p className="cf-help">Choisissez une image PNG, JPEG, GIF ou WebP (64 Ko maximum), ou renseignez un lien direct HTTP ou HTTPS dans la fiche.</p>}
    <section className="cf-permissions" aria-label="Permissions du champ"><h3>Permissions</h3><p><span>Lecture de la configuration :</span><strong>Rôles autorisés pour cette vue</strong></p><p><span>Modification de la configuration :</span><strong>Droits de gestion de la personnalisation</strong></p><small>L’accès à la vue suit les paramètres de la Planzone ; les droits de modification restent distincts.</small></section>
  </fieldset>{error && <p className="cf-error" role="alert">{error}</p>}</div><footer className={isDialog ? 'cf-dialog-footer' : 'cf-editor-footer'}>{definition && <button className="cf-danger-button" type="button" disabled={busy || readOnly} onClick={remove}><Trash2 size={14} />Supprimer</button>}<div>{isDialog && <button className="cf-secondary-button" type="button" disabled={busy || readOnly} onClick={onClose}>Annuler</button>}<button className="cf-primary-button" disabled={busy || readOnly || !changed}>{busy ? 'Enregistrement…' : definition ? 'Modifier' : 'Créer le champ'}</button></div></footer></form>;
  return isDialog ? <CatalogDialog title="Nouveau champ personnalisé" kind="cf" busy={busy} onClose={onClose}>{content}</CatalogDialog> : content;
}

export function CustomFieldsView({ data, mutate, notify, readOnly = false }: CatalogProps) {
  const [scope, setScope] = useState<CustomFieldScope>('task');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const definitions = (data.customFieldDefinitions ?? []).filter(field => field.scope === scope);
  return <div className="cf-view"><div className="cf-toolbar"><label>Éléments concernés :<select value={scope} onChange={event => { setScope(event.target.value as CustomFieldScope); setExpanded(null); }}>{scopeOrder.map(scope => <option key={scope} value={scope}>{scopeLabels[scope]}</option>)}</select></label><button className="cf-primary-button" disabled={readOnly} onClick={() => setAdding(true)}><Plus size={16} />Ajouter</button></div>
    {scope === 'time-entry' && <p className="cf-scope-help">Ces champs apparaissent dans le formulaire de saisie du temps personnel et du projet. Leurs valeurs sont conservées avec chaque saisie ; les formules peuvent utiliser le temps passé en heures.</p>}
    <div className="cf-definition-list">{definitions.length ? definitions.map(field => <section className="cf-accordion" key={field.id}><button className="cf-accordion-toggle" aria-expanded={expanded === field.id} aria-controls={`cf-field-${field.id}`} onClick={() => setExpanded(previous => previous === field.id ? null : field.id)}><FieldIcon type={field.type} /><strong>{field.name}</strong><span>{typeLabels[field.type]}</span>{expanded === field.id ? <ChevronUp size={21} /> : <ChevronDown size={21} />}</button>{expanded === field.id && <div id={`cf-field-${field.id}`}><CustomFieldEditor readOnly={readOnly} key={JSON.stringify(field)} definition={field} definitions={data.customFieldDefinitions ?? []} initialScope={scope} mutate={mutate} notify={notify} onClose={() => setExpanded(null)} /></div>}</section>) : <div className="cf-empty"><FileText size={31} /><h2>Aucun champ personnalisé</h2><p>Ajoutez du texte, une liste, une formule, une image, un lien, une date ou un nombre pour {scope === 'task' ? 'les tâches et jalons' : scopeLabels[scope].toLowerCase()}.</p><button className="cf-primary-button" disabled={readOnly} onClick={() => setAdding(true)}><Plus size={16} />Créer un champ personnalisé</button></div>}</div>
    {adding && !readOnly && <CustomFieldEditor definition={null} definitions={data.customFieldDefinitions ?? []} initialScope={scope} mutate={mutate} notify={notify} onClose={() => setAdding(false)} isDialog />}
  </div>;
}
