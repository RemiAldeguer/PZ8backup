import { canEditTime, canProject, canValidateTime, globalRole, isAdmin, projectMemberIds } from '../shared/permissions';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CalendarCheck, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsDown, ChevronsUp, Edit3, Eye, Folder, FolderOpen, Minus, Plus, Trash2, X } from 'lucide-react';
import { PROJECT_STATUS_LABELS, type AppData, type ProjectStatus, type Resource, type Task, type TimeEntry, type ViewProps } from '../shared/types';
import { canValidateResourceTime } from '../shared/resources';
import { formatHours } from '../shared/domain';
import { addCalendarDays, buildTimeSheet, mondayOfWeek, projectTimeResources, weekDates, type TimeSheetRow } from '../shared/time-sheets';
import './time-view.css';
import { TaskCheck } from './TaskCheck';
import { CustomFieldInputs } from './CustomFieldInputs';
import { PersonalNavigation } from './PersonalNavigation';
import { TimeIntegrationControl } from './TimeIntegrationControl';
import { timeIntegrationIndex } from '../shared/time-integration';
import { Modal } from './Dialogs';

type Validation = 'all' | 'pending' | 'validated';
type Selection = { taskId: string; resourceId: string; date: string };
type Editor = { entry?: TimeEntry; taskId?: string; resourceId?: string; date?: string; readOnly?: boolean };
type IntegrationEditor = { scope: 'project' | 'resource'; id?: string; date?: string; chooseResource?: boolean };
const weekdays = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const decimal = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const dateLabel = (date: string) => new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'La modification n’a pas pu être enregistrée.';
const formValue = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
function weekLabel(dates: string[]): string {
  const formatter = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const first = new Date(`${dates[0]}T12:00:00Z`);
  const last = new Date(`${dates[6]}T12:00:00Z`);
  return `Semaine du ${first.getUTCMonth() === last.getUTCMonth() && first.getUTCFullYear() === last.getUTCFullYear() ? String(first.getUTCDate()).padStart(2, '0') : formatter.format(first)} au ${formatter.format(last)}`;
}
function allRows(rows: TimeSheetRow[]): TimeSheetRow[] { return rows.flatMap(row => [row, ...allRows(row.children)]); }
function Avatar({ resource }: { resource?: Resource }) {
  return <span className="avatar time-avatar" style={{ background: resource?.color ?? '#d9e5ed', color: resource ? '#fff' : '#637086' }} aria-hidden="true">{resource?.initials ?? '—'}</span>;
}
function TimeDialog({ title, children, onClose, onSubmit, readOnly = false, externalPending = false }: { title: string; children: ReactNode; onClose: () => void; onSubmit: (form: FormData) => Promise<void>; readOnly?: boolean; externalPending?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const blocked = busy || externalPending;
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || externalPending || readOnly) return;
    const form = new FormData(event.currentTarget);
    busyRef.current = true; setBusy(true); setError('');
    try { await onSubmit(form); onClose(); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="modal op-dialog time-dialog" aria-label={title} onCancel={event => { event.preventDefault(); if (!blocked) onClose(); }}>
    <form onSubmit={submit}><div className="modal-header"><div><span className="eyebrow">SUIVI TEMPOREL</span><h2>{title}</h2></div><button className="icon-button" type="button" aria-label="Fermer le formulaire" disabled={blocked} onClick={onClose}><X size={20} /></button></div><div className="modal-body"><fieldset className="time-dialog-fields" disabled={blocked}>{children}</fieldset>{error && <p className="form-error" role="alert">{error}</p>}</div><div className="modal-actions"><button type="button" className="button button-secondary" disabled={blocked} onClick={onClose}>{readOnly ? 'Fermer' : 'Annuler'}</button>{!readOnly && <button className="button button-primary" type="submit" disabled={blocked}>{busy ? 'Enregistrement…' : externalPending ? 'Lecture de l’image…' : 'Enregistrer'}</button>}</div></form>
  </dialog>;
}

function TimeEntryEditor({ editor, data, resources, tasks, currentProjectId, onClose, onSubmit }: {
  editor: Editor; data: AppData; resources: Resource[]; tasks: Task[]; currentProjectId: string;
  onClose: () => void; onSubmit: (form: FormData, customValues: Record<string, string>) => Promise<void>;
}) {
  const entry = editor.entry;
  const readOnly = Boolean(editor.readOnly);
  const [customValues, setCustomValues] = useState<Record<string, string>>(() => ({ ...entry?.customValues }));
  const [hours, setHours] = useState(String(entry?.hours ?? 1));
  const [imageReading, setImageReading] = useState(false);
  const imageReadingRef = useRef(false);
  function imagePending(pending: boolean) { imageReadingRef.current = pending; setImageReading(pending); }
  const resourceId = entry?.resourceId ?? (resources.some(resource => resource.id === editor.resourceId) ? editor.resourceId : resources.some(resource => resource.id === data.currentUser.id) ? data.currentUser.id : resources[0]?.id ?? '');
  return <TimeDialog title={readOnly ? 'Consulter la saisie de temps' : entry ? 'Modifier la saisie de temps' : 'Saisir du temps'} readOnly={readOnly} externalPending={imageReading} onClose={onClose} onSubmit={async form => {
    if (imageReadingRef.current) throw new Error('Attendez la fin de la lecture de l’image avant d’enregistrer.');
    await onSubmit(form, customValues);
  }}><div className="form-grid"><label className="field full-width"><span>Tâche</span><select name="taskId" required autoFocus disabled={Boolean(entry) || readOnly} defaultValue={entry?.taskId ?? editor.taskId ?? ''}><option value="" disabled>Choisir une tâche</option>{tasks.map(task => <option key={task.id} value={task.id}>{task.title}{!currentProjectId && !entry ? ` — ${data.projects.find(project => project.id === task.projectId)?.name ?? ''}` : ''}</option>)}</select></label><label className="field full-width"><span>Ressource</span><select name="resourceId" required disabled={Boolean(entry) || readOnly} defaultValue={resourceId}>{resources.map(resource => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select></label><label className="field"><span>Date</span><input name="date" type="date" required readOnly={readOnly} defaultValue={entry?.date ?? editor.date ?? data.today} /></label><label className="field"><span>Temps passé (heures)</span><input name="hours" type="number" min="0.01" max="24" step="0.01" required readOnly={readOnly} value={hours} onChange={event => setHours(event.target.value)} /></label><label className="field full-width"><span>Note</span><textarea name="note" rows={3} maxLength={2000} readOnly={readOnly} defaultValue={entry?.note ?? ''} placeholder="Qu’avez-vous réalisé ?" /></label></div>
    <CustomFieldInputs definitions={data.customFieldDefinitions ?? []} scope="time-entry" values={customValues} onChange={setCustomValues} heading="Champs personnalisés de la saisie" builtinValues={{ hours: hours.trim() ? Number(hours) : Number.NaN }} readOnly={readOnly} onPendingChange={imagePending} />
    {readOnly ? <p className="time-readonly-note">{entry?.integrationValidated ? 'Cette saisie est validée par une date d’intégration. Ajustez cette date pour rouvrir la période.' : entry?.validated ? 'Cette saisie est validée. Retirez sa validation dans l’historique avant de la modifier.' : 'Consultation de la saisie enregistrée.'}</p> : <p className="muted">Le tarif de la ressource est conservé à la création de la saisie. Les temps validés restent verrouillés jusqu’au retrait de leur validation.</p>}
  </TimeDialog>;
}

export function TimeView({ data, mutate, notify, openTask, openResource, scopeProjectId, projectContext = false }: ViewProps & { scopeProjectId?: string; projectContext?: boolean }) {
  const [weekStart, setWeekStart] = useState(() => mondayOfWeek(data.today));
  const [projectId, setProjectId] = useState(scopeProjectId ?? '');
  const [selectedMode, setMode] = useState<'personal' | 'team'>(() => projectContext ? 'team' : 'personal');
  const mode = projectContext ? 'team' : selectedMode;
  const [teamResourceId, setTeamResourceId] = useState('');
  const [projectStatus, setProjectStatus] = useState<ProjectStatus | 'all'>('all');
  const effectiveProjectStatus = projectContext ? 'all' : projectStatus;
  const [includeInactive, setIncludeInactive] = useState(projectContext);
  const [includeFinished, setIncludeFinished] = useState(true);
  const [validation, setValidation] = useState<Validation>('all');
  const [details, setDetails] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [editor, setEditor] = useState<Editor | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [integrationEditor, setIntegrationEditor] = useState<IntegrationEditor | null>(null);
  const [integrationBusy, setIntegrationBusy] = useState(false);
  const integrationPending = useRef(false);
  const integration = useMemo(() => timeIntegrationIndex(data), [data]);
  const [pendingActions, setPendingActions] = useState<Set<string>>(() => new Set());
  const history = useRef<HTMLElement>(null);
  const currentProjectId = projectContext ? scopeProjectId ?? '' : projectId;
  const allMemberResources = useMemo(() => currentProjectId ? projectTimeResources(data, currentProjectId) : projectContext ? [] : data.resources, [data, currentProjectId, projectContext]);
  const allowedTeamIds = new Set([data.currentUser.id, ...(data.resources.find(resource => resource.id === data.currentUser.id)?.validatesTimeForIds ?? []), ...data.projects.filter(project => canProject(data, project.id, 'time')).flatMap(project => [...projectMemberIds(data, project)])]);
  const memberResources = isAdmin(data) || projectContext ? allMemberResources : allMemberResources.filter(resource => allowedTeamIds.has(resource.id));
  const filteredResources = memberResources.filter(resource => includeInactive || resource.active);
  useEffect(() => { setProjectId(scopeProjectId ?? ''); setSelection(null); setCollapsed(new Set()); setEditor(null); }, [scopeProjectId]);
  useEffect(() => { setMode(projectContext ? 'team' : 'personal'); setIncludeInactive(projectContext); setSelection(null); }, [projectContext]);
  useEffect(() => {
    if (teamResourceId && !memberResources.some(resource => resource.id === teamResourceId && (includeInactive || resource.active))) {
      setTeamResourceId(''); setSelection(null);
    }
  }, [memberResources, includeInactive, teamResourceId]);
  const dates = useMemo(() => weekDates(weekStart), [weekStart]);
  const resourceId = mode === 'personal' ? data.currentUser.id : teamResourceId || undefined;
  const rows = useMemo(() => projectContext && !currentProjectId ? [] : buildTimeSheet(data, {
    weekStart, resourceId, projectId: currentProjectId || undefined,
    projectStatuses: effectiveProjectStatus === 'all' ? undefined : [effectiveProjectStatus], includeInactive, includeFinished, validation,
  }), [data, weekStart, resourceId, currentProjectId, effectiveProjectStatus, includeInactive, includeFinished, validation, projectContext]);
  const tree = useMemo(() => allRows(rows), [rows]);
  const visible: { row: TimeSheetRow; depth: number }[] = [];
  function appendVisible(row: TimeSheetRow, depth: number) {
    visible.push({ row, depth });
    if (!collapsed.has(row.id) && (details || row.kind === 'resource')) row.children.forEach(child => appendVisible(child, depth + 1));
  }
  rows.forEach(row => appendVisible(row, 0));
  const totals = {
    allocated: rows.reduce((sum, row) => sum + row.allocated, 0), spent: rows.reduce((sum, row) => sum + row.spent, 0),
    week: rows.reduce((sum, row) => sum + row.weekSpent, 0), remaining: rows.reduce((sum, row) => sum + row.remaining, 0),
    days: dates.map((_, index) => rows.reduce((sum, row) => sum + row.days[index], 0)),
  };
  const weeklyEntries = rows.flatMap(row => row.entries).filter(entry => entry.date >= dates[0] && entry.date <= dates[6]).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const shownEntries = selection ? weeklyEntries.filter(entry => entry.taskId === selection.taskId && entry.resourceId === selection.resourceId && entry.date === selection.date) : weeklyEntries;
  const validator = data.resources.find(resource => resource.id === data.currentUser.id);
  const canValidate = (id: string) => canValidateTime(data, id, projectContext ? currentProjectId : undefined);
  const integrationProject = data.projects.find(project => project.id === currentProjectId);
  const integrationPerson = data.resources.find(resource => resource.id === (mode === 'personal' ? data.currentUser.id : teamResourceId));
  const canIntegrateProject = (id?: string) => {
    const project = data.projects.find(project => project.id === id);
    return Boolean(project && canProject(data, project.id, 'time') && project.status !== 'paused' && project.status !== 'closed');
  };
  const editorProject = integrationEditor?.scope === 'project' ? data.projects.find(project => project.id === integrationEditor.id) : undefined;
  const editorResource = integrationEditor?.scope === 'resource' ? data.resources.find(resource => resource.id === integrationEditor.id) : undefined;
  const integrationTarget = editorProject ? { scope: 'project' as const, id: editorProject.id, name: editorProject.name, date: editorProject.timeIntegrationDate } : editorResource ? { scope: 'resource' as const, id: editorResource.id, name: editorResource.name, date: editorResource.timeIntegrationDate } : undefined;
  function totalIntegrationButton(date: string, id?: string) {
    const target: IntegrationEditor = projectContext ? { scope: 'project', id: currentProjectId, date } : { scope: 'resource', id: id ?? (mode === 'personal' ? data.currentUser.id : teamResourceId || undefined), date };
    target.chooseResource = target.scope === 'resource' && !target.id;
    const resource = data.resources.find(resource => resource.id === target.id);
    const allowed = target.scope === 'project' ? canIntegrateProject(target.id) : target.chooseResource ? filteredResources.some(resource => canValidate(resource.id)) : Boolean(resource && canValidate(resource.id));
    const label = target.scope === 'project' ? `Date d’intégration projet au ${dateLabel(date)}` : target.chooseResource ? `Choisir une ressource pour l’intégration au ${dateLabel(date)}` : `Date d’intégration de ${resource?.name ?? 'la ressource'} au ${dateLabel(date)}`;
    return <button type="button" className="time-day-integration-button" aria-label={label} title={allowed ? label : 'Ce périmètre est disponible en consultation'} disabled={!allowed} onClick={() => setIntegrationEditor(target)}><CalendarCheck size={14} aria-hidden="true" /></button>;
  }
  const dayCovered = (date: string, id: string, projectId?: string) => integration.covers(date, id, projectId ?? (currentProjectId || undefined));
  const headerCovered = (date: string) => rows.length > 0 && rows.every(row => dayCovered(date, row.resourceId, row.projectId));
  const writableTask = (taskId: string) => {
    const task = data.tasks.find(item => item.id === taskId);
    const project = data.projects.find(item => item.id === task?.projectId);
    return Boolean(task?.kind === 'task' && project && project.status !== 'paused' && project.status !== 'closed');
  };
  const candidateTasks = data.tasks.filter(task => task.kind === 'task' && (!projectContext || Boolean(currentProjectId)) && (!currentProjectId || task.projectId === currentProjectId) && writableTask(task.id) && (effectiveProjectStatus === 'all' || data.projects.find(project => project.id === task.projectId)?.status === effectiveProjectStatus));
  const edited = editor?.entry;
  const resources = memberResources.filter(resource => resource.active || resource.id === edited?.resourceId);
  const editorTasks = edited ? data.tasks.filter(task => task.id === edited.taskId) : candidateTasks;
  const monthLabel = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${dates[3]}T12:00:00Z`));
  const monthDate = new Date(`${dates[3]}T12:00:00Z`);
  const firstWeekday = (new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), 1)).getUTCDay() + 6) % 7;
  const monthWeek = Math.floor((monthDate.getUTCDate() + firstWeekday - 1) / 7) + 1;
  function changeWeek(date: string) { setWeekStart(mondayOfWeek(date)); setSelection(null); }
  function toggle(row: TimeSheetRow) { setCollapsed(current => { const next = new Set(current); next.has(row.id) ? next.delete(row.id) : next.add(row.id); return next; }); }
  function collapseLevel() {
    const openParents = tree.filter(row => row.children.length && !collapsed.has(row.id));
    if (!openParents.length) return;
    const deepest = Math.max(...openParents.map(row => row.kind === 'phase' ? 2 : row.kind === 'project' ? 1 : 0));
    setCollapsed(current => new Set([...current, ...openParents.filter(row => (row.kind === 'phase' ? 2 : row.kind === 'project' ? 1 : 0) === deepest).map(row => row.id)]));
  }
  function expandLevel() {
    const closedParents = tree.filter(row => row.children.length && collapsed.has(row.id));
    if (!closedParents.length) return;
    const shallowest = Math.min(...closedParents.map(row => row.kind === 'resource' ? 0 : row.kind === 'project' ? 1 : 2));
    setCollapsed(current => { const next = new Set(current); closedParents.filter(row => (row.kind === 'resource' ? 0 : row.kind === 'project' ? 1 : 2) === shallowest).forEach(row => next.delete(row.id)); return next; });
  }
  function logDay(row: TimeSheetRow, date: string) {
    if (!row.taskId) return;
    const next = { taskId: row.taskId, resourceId: row.resourceId, date };
    setSelection(next);
    if (!dayCovered(date, row.resourceId, row.projectId) && writableTask(row.taskId) && data.resources.find(resource => resource.id === row.resourceId)?.active) setEditor(next);
    else history.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  async function entryAction(entry: TimeEntry, remove = false) {
    if (pendingActions.has(entry.id)) return;
    if (integration.entryCovered(entry)) { notify('Cette saisie est validée par une date d’intégration. Ajustez cette date pour rouvrir la période.'); return; }
    if (remove && entry.validated) { notify('Retirez la validation dans une opération séparée avant suppression.'); return; }
    if (remove && !window.confirm('Supprimer cette saisie de temps ?')) return;
    setPendingActions(current => new Set(current).add(entry.id));
    try {
      await mutate('time-entries', remove ? 'DELETE' : 'PATCH', remove ? undefined : { validated: !entry.validated }, entry.id);
      notify(remove ? 'Saisie supprimée.' : entry.validated ? 'Validation retirée.' : 'Temps validé.');
    } catch (error) { notify(errorMessage(error)); }
    finally { setPendingActions(current => { const next = new Set(current); next.delete(entry.id); return next; }); }
  }
  return <section className={`time-view ${projectContext ? 'time-project-view' : ''}`} aria-label="Suivi temporel">
    <h1 className="sr-only">{projectContext ? 'Suivi temporel du projet' : 'Suivi temporel'}</h1>
    {!projectContext && <PersonalNavigation active="time" />}
    <div className="time-toolbar">
      <div className="time-week-picker"><button type="button" aria-label="Semaine précédente" onClick={() => changeWeek(addCalendarDays(weekStart, -7))}><ChevronLeft size={18} /></button><span aria-live="polite">{weekLabel(dates)}</span><button type="button" aria-label="Semaine suivante" onClick={() => changeWeek(addCalendarDays(weekStart, 7))}><ChevronRight size={18} /></button><label className="time-date-picker" title="Choisir une semaine"><CalendarDays size={17} /><input aria-label="Date de la semaine" type="date" value={weekStart} onChange={event => { if (event.target.value) changeWeek(event.target.value); }} /></label></div>
      {projectContext ? <label className="time-filter time-project-person-filter"><span>Filtrer par :</span><select aria-label="Ressource du suivi temporel" value={teamResourceId} onChange={event => { setTeamResourceId(event.target.value); setSelection(null); }}><option value="">Toute l’équipe du projet</option>{filteredResources.map(resource => <option key={resource.id} value={resource.id}>{resource.name}{resource.active ? '' : ' · Inactive'}</option>)}</select></label> : <label className="time-filter time-project-filter"><span>Filtrer par :</span><span className="time-select-with-icon"><Folder size={16} /><select aria-label="Projet" value={projectId} onChange={event => { setProjectId(event.target.value); setSelection(null); }}><option value="">Tous les projets</option>{data.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></span></label>}
      <details className="time-options"><summary>Et par : <strong>{includeInactive ? 'Toutes les ressources' : 'Ressources actives'}{includeFinished ? ', tâches terminées' : ''}</strong><ChevronDown size={14} /></summary><div className="time-options-panel">{!projectContext && <label><span>Statut des projets</span><select aria-label="Statut des projets" value={projectStatus} onChange={event => { setProjectStatus(event.target.value as ProjectStatus | 'all'); setSelection(null); }}><option value="all">Tous les statuts</option>{Object.entries(PROJECT_STATUS_LABELS).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></label>}<label className="checkbox-field"><input type="checkbox" checked={includeInactive} onChange={event => { setIncludeInactive(event.target.checked); setSelection(null); }} />Inclure les ressources inactives</label><label className="checkbox-field"><input type="checkbox" checked={includeFinished} onChange={event => { setIncludeFinished(event.target.checked); setSelection(null); }} />Inclure les tâches terminées</label></div></details>
      <div className="time-toolbar-actions"><button type="button" className="time-today" onClick={() => changeWeek(data.today)}>Aujourd’hui</button><label className="time-details-toggle">Détails<input type="checkbox" checked={details} onChange={event => setDetails(event.target.checked)} /><span aria-hidden="true" /></label><button type="button" className="button button-primary time-add" aria-label="Saisir du temps" disabled={globalRole(data) === 'visitor' || !candidateTasks.some(task => memberResources.some(resource => canEditTime(data, task.id, resource.id))) || !candidateTasks.length || !memberResources.some(resource => resource.active)} onClick={() => { setSelection(null); setEditor({ date: dates.includes(data.today) ? data.today : weekStart, resourceId }); }}><Plus size={16} />Ajouter</button></div>
    </div>
    <div className="time-filter-bar"><span>Unité : heures</span><label><span className="sr-only">Filtrer la validation des temps</span><select aria-label="Filtrer la validation des temps" value={validation} onChange={event => { setValidation(event.target.value as Validation); setSelection(null); }}><option value="all">Tous les temps</option><option value="pending">À valider</option><option value="validated">Validés</option></select></label>{mode === 'team' && !projectContext && <select aria-label="Ressource du suivi temporel" value={teamResourceId} onChange={event => { setTeamResourceId(event.target.value); setSelection(null); }}><option value="">Toute l’équipe</option>{filteredResources.map(resource => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select>}<span className="time-filter-hint">Cliquez sur une cellule de tâche pour saisir du temps.</span></div>
    {projectContext && integrationProject ? <TimeIntegrationControl key={`project:${integrationProject.id}`} target={{ scope: 'project', id: integrationProject.id, name: integrationProject.name, date: integrationProject.timeIntegrationDate }} canManage={canProject(data, integrationProject.id, 'time') && integrationProject.status !== 'paused' && integrationProject.status !== 'closed'} mutate={mutate} notify={notify} /> : !projectContext && integrationPerson ? <TimeIntegrationControl key={`resource:${integrationPerson.id}`} target={{ scope: 'resource', id: integrationPerson.id, name: integrationPerson.name, date: integrationPerson.timeIntegrationDate }} canManage={canValidate(integrationPerson.id)} mutate={mutate} notify={notify} /> : !projectContext && mode === 'team' ? <p className="time-integration-team-hint">Chaque ressource possède sa propre date d’intégration. Utilisez Date d’intégration sur sa ligne ou sélectionnez une ressource.</p> : null}
    <div className="time-matrix-scroll" tabIndex={0} role="region" aria-label="Grille hebdomadaire défilante">
      <table className="time-matrix" aria-label="Suivi temporel hebdomadaire"><colgroup><col className="time-name-col" />{dates.map(date => <col key={date} className="time-day-col" />)}<col span={4} className="time-total-col" /></colgroup><thead><tr><th className="time-name-heading" scope="col" rowSpan={2}><div className="time-heading-controls">{projectContext ? <span className="time-project-members-title">Ressources du projet</span> : <div className="time-mode" aria-label="Périmètre du suivi"><button type="button" aria-pressed={mode === 'personal'} onClick={() => { setMode('personal'); setSelection(null); }}>Personnel</button><button type="button" aria-pressed={mode === 'team'} onClick={() => { setMode('team'); setSelection(null); }}>Équipe</button></div>}<div className="time-expand-controls"><button type="button" aria-label="Replier un niveau" disabled={!details} onClick={collapseLevel}><ChevronUp size={18} /></button><button type="button" aria-label="Déplier un niveau" disabled={!details} onClick={expandLevel}><ChevronDown size={18} /></button><button type="button" aria-label="Tout replier" onClick={() => setCollapsed(new Set(tree.filter(row => row.children.length).map(row => row.id)))}><ChevronsUp size={18} /></button><button type="button" aria-label="Tout déplier" onClick={() => { setCollapsed(new Set()); setDetails(true); }}><ChevronsDown size={18} /></button></div></div></th><th className="time-month-heading" scope="colgroup" colSpan={7}>{monthLabel}<span> | Semaine {monthWeek}</span></th><th scope="col" rowSpan={2}>Alloué</th><th scope="col" rowSpan={2}>Passé</th><th scope="col" rowSpan={2}>Passé<br />(semaine)</th><th scope="col" rowSpan={2}>Restant</th></tr><tr>{dates.map((date, index) => <th key={date} scope="col" className={`${index > 4 ? 'time-weekend' : ''} ${date === data.today ? 'time-current-day' : ''} ${headerCovered(date) ? 'time-day-integrated' : ''}`} aria-label={`${weekdays[index]} ${dateLabel(date)}`}><span>{weekdays[index]}</span><strong>{date.slice(8)}</strong>{headerCovered(date) && <Check size={12} aria-label="Journée validée" />}</th>)}</tr></thead><tbody>{visible.map(({ row, depth }) => {
        const resource = data.resources.find(item => item.id === row.resourceId);
        const task = data.tasks.find(item => item.id === row.taskId);
        const hasChildren = row.children.length > 0 && (details || row.kind === 'resource');
        const expanded = hasChildren && !collapsed.has(row.id);
        return <tr key={row.id} className={`time-row time-row-${row.kind}`} data-row-kind={row.kind} data-resource-id={row.resourceId} data-project-id={row.projectId} data-task-id={row.taskId}>
          <th scope="row" className="time-row-name"><div className="time-row-label" style={{ paddingLeft: 12 + depth * 23 }}>
            {hasChildren ? <button type="button" className="time-row-toggle" aria-label={`${expanded ? 'Replier' : 'Déplier'} ${row.label}`} aria-expanded={expanded} onClick={() => toggle(row)}>{expanded ? <Minus size={12} /> : <Plus size={12} />}</button> : <span className="time-row-toggle-space" />}
            {row.kind === 'resource' ? <Avatar resource={resource} /> : row.kind === 'project' ? expanded ? <FolderOpen className="time-folder" size={21} /> : <Folder className="time-folder" size={21} /> : row.kind === 'task' && task ? <TaskCheck task={task} data={data} mutate={mutate} notify={notify} /> : null}
            <span className="time-row-title">{row.kind === 'resource' && openResource ? <button type="button" className="time-name-button" onClick={() => openResource(resource ?? null)}>{row.label}</button> : task ? <button type="button" className="time-name-button" onClick={() => openTask(task)}>{row.label}</button> : <span>{row.label}</span>}{row.kind === 'resource' && <small>{row.jobTitle || 'Fonction non renseignée'}{resource?.active === false ? ' · Inactive' : ''}</small>}{row.kind === 'resource' && resource?.timeIntegrationDate && <small className="time-resource-integration">Intégré jusqu’au {dateLabel(resource.timeIntegrationDate)}</small>}{row.kind === 'resource' && resource && !projectContext && mode === 'team' && <button type="button" className="time-resource-integration-button" aria-label={`Date d’intégration de ${resource.name}`} onClick={() => setIntegrationEditor({ scope: 'resource', id: resource.id })}>Date d’intégration</button>}</span>
          </div></th>{dates.map((date, index) => {
            const integrated = dayCovered(date, row.resourceId, row.projectId);
            return <td key={date} data-date={date} data-integrated={integrated ? 'true' : undefined} className={`time-day-cell ${index > 4 ? 'time-weekend' : ''} ${date === data.today ? 'time-current-day' : ''} ${integrated ? 'time-day-integrated' : ''} ${selection?.taskId === row.taskId && selection?.resourceId === row.resourceId && selection?.date === date ? 'time-selected-cell' : ''}`} title={integrated ? 'Journée validée par une date d’intégration' : undefined}>{row.kind === 'task' ? <button type="button" className="time-cell-button" disabled={!writableTask(row.taskId ?? '') || !resource?.active || !canEditTime(data, row.taskId ?? '', row.resourceId ?? '')} aria-label={`${integrated ? 'Consulter les temps' : 'Saisir du temps'} pour ${row.label} le ${date}`} title={integrated ? 'Journée validée ; consultez les saisies ci-dessous.' : !writableTask(row.taskId ?? '') ? 'Le projet est interrompu ou clos ; les temps restent consultables ci-dessous.' : !resource?.active ? 'Cette ressource est inactive ; son historique reste consultable ci-dessous.' : undefined} onClick={() => logDay(row, date)}>{decimal.format(row.days[index])}{integrated && <Check size={12} aria-label="Journée validée" />}</button> : row.kind === 'resource' || row.kind === 'project' ? <div className="time-day-total"><span>{decimal.format(row.days[index])}{integrated && <Check size={12} aria-label="Journée validée" />}</span>{totalIntegrationButton(date, row.resourceId)}</div> : <>{decimal.format(row.days[index])}{integrated && <Check size={12} aria-label="Journée validée" />}</>}</td>;
          })}<td className="time-summary" data-summary="allocated">{decimal.format(row.allocated)}</td><td className="time-summary" data-summary="spent">{decimal.format(row.spent)}</td><td className="time-summary" data-summary="week">{decimal.format(row.weekSpent)}</td><td className={`time-summary ${row.remaining < 0 ? 'time-overrun' : ''}`} data-summary="remaining">{decimal.format(row.remaining)}</td>
        </tr>;
      })}</tbody><tfoot><tr><th scope="row">Total {mode === 'personal' ? 'personnel' : 'équipe'}</th>{totals.days.map((amount, index) => <td key={dates[index]} data-date={dates[index]} className={headerCovered(dates[index]) ? 'time-day-integrated' : undefined}><div className="time-day-total"><span>{decimal.format(amount)}</span>{totalIntegrationButton(dates[index])}</div></td>)}<td data-summary="allocated">{decimal.format(totals.allocated)}</td><td data-summary="spent">{decimal.format(totals.spent)}</td><td data-summary="week">{decimal.format(totals.week)}</td><td data-summary="remaining" className={totals.remaining < 0 ? 'time-overrun' : ''}>{decimal.format(totals.remaining)}</td></tr></tfoot></table>
      {!rows.length && (projectContext ? <div className="time-empty time-project-empty"><p>{memberResources.length ? 'Aucune ressource ne correspond aux filtres sélectionnés.' : 'Aucune ressource n’est associée à ce projet.'}</p>{currentProjectId && <a className="button button-secondary" href={`#project/${currentProjectId}/team`}>Afficher l’équipe du projet</a>}</div> : <p className="time-empty">Aucune ressource dans ce périmètre. Ajustez les filtres ou passez à la vue Équipe.</p>)}
    </div>
    <p className="time-formula">Alloué et passé couvrent l’historique du périmètre choisi. Restant = alloué − passé ; une valeur négative signale un dépassement d’allocation.</p>
    <section ref={history} className="time-history" aria-label="Détail des saisies"><div className="time-history-heading"><div><h2>Saisies de la semaine <span>{shownEntries.length}</span></h2>{selection && <p>{data.tasks.find(task => task.id === selection.taskId)?.title} · {dateLabel(selection.date)}</p>}</div>{selection && <button type="button" className="time-text-action" onClick={() => setSelection(null)}>Toutes les saisies de la semaine</button>}<span className="time-history-total">{formatHours(shownEntries.reduce((sum, entry) => sum + entry.hours, 0))}</span></div><div className="time-history-scroll"><table className="time-history-table" aria-label="Saisies de la semaine"><thead><tr><th>Date</th><th>Ressource / tâche</th><th>Temps</th><th>Note</th><th>Validation</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{shownEntries.map(entry => {
        const resource = data.resources.find(item => item.id === entry.resourceId);
        const task = data.tasks.find(item => item.id === entry.taskId);
        const writable = writableTask(entry.taskId);
        const pending = pendingActions.has(entry.id);
        const integrated = integration.entryCovered(entry);
        return <tr key={entry.id}><td>{dateLabel(entry.date)}</td><td><div className="time-history-resource"><Avatar resource={resource} /><div><strong>{resource?.name ?? 'Ressource supprimée'}</strong>{task && <button type="button" className="time-name-button" onClick={() => openTask(task)}>{task.title}</button>}</div></div></td><td className="time-history-hours">{formatHours(entry.hours)}</td><td className="time-history-note">{entry.note || '—'}</td><td><button type="button" className={`badge ${entry.validated ? 'badge-success' : 'badge-warning'}`} aria-label={`${entry.validated ? 'Retirer la validation' : 'Valider'} : ${resource?.name}, ${entry.hours} heures le ${entry.date}`} disabled={integrated || !writable || !canValidateTime(data, entry.resourceId, projectContext ? task?.projectId : undefined) || pending} title={integrated ? 'Validé par une date d’intégration ; ajustez la date pour rouvrir la période' : !writable ? 'Le projet est interrompu ou clos' : !canValidate(entry.resourceId) ? 'Aucune délégation de validation pour cette ressource' : undefined} onClick={() => void entryAction(entry)}>{entry.validated && <Check size={13} />}{integrated ? 'Validé · intégré' : entry.validated ? 'Validé' : 'À valider'}</button></td><td><div className="time-entry-actions"><button type="button" className="icon-button" aria-label={`Consulter la saisie du ${entry.date} pour ${resource?.name}`} onClick={() => setEditor({ entry, readOnly: true })}><Eye size={15} /></button><button type="button" className="icon-button" aria-label={`Modifier la saisie du ${entry.date} pour ${resource?.name}`} disabled={!writable || entry.validated || pending || !canEditTime(data, entry.taskId, entry.resourceId)} title={entry.validated ? 'Retirez la validation avant modification' : 'Modifier la saisie'} onClick={() => setEditor({ entry })}><Edit3 size={15} /></button><button type="button" className="icon-button danger" aria-label={`Supprimer la saisie du ${entry.date} pour ${resource?.name}`} disabled={!writable || entry.validated || pending || !canEditTime(data, entry.taskId, entry.resourceId)} title={entry.validated ? 'Retirez la validation dans une opération séparée avant suppression' : 'Supprimer la saisie'} onClick={() => void entryAction(entry, true)}><Trash2 size={15} /></button></div></td></tr>;
      })}</tbody></table>{!shownEntries.length && <p className="time-empty">Aucune saisie pour {selection ? 'cette cellule' : 'cette semaine'}. Ajoutez du temps ou ajustez les filtres.</p>}</div></section>
    {integrationEditor && <Modal title={integrationEditor.scope === 'project' ? 'Date d’intégration projet' : 'Date d’intégration ressource'} onClose={() => { if (!integrationPending.current) setIntegrationEditor(null); }}><div className="modal-body">
      {integrationEditor.chooseResource && <label className="field"><span>Ressource à intégrer</span><select aria-label="Ressource à intégrer" value={integrationEditor.id ?? ''} disabled={integrationBusy} onChange={event => { if (!integrationPending.current) setIntegrationEditor(current => current ? { ...current, id: event.target.value || undefined } : null); }}><option value="" disabled>Choisir une ressource</option>{filteredResources.map(resource => <option key={resource.id} value={resource.id} disabled={!canValidate(resource.id)}>{resource.name}</option>)}</select></label>}
      {integrationTarget ? <TimeIntegrationControl key={`${integrationTarget.scope}:${integrationTarget.id}:${integrationEditor.date ?? ''}`} target={integrationTarget} initialDate={integrationEditor.date} canManage={integrationTarget.scope === 'project' ? canIntegrateProject(integrationTarget.id) : canValidate(integrationTarget.id)} mutate={mutate} notify={notify} onSaved={() => setIntegrationEditor(null)} onPendingChange={pending => { integrationPending.current = pending; setIntegrationBusy(pending); }} /> : <p className="time-integration-scope">Choisissez la ressource dont vous souhaitez valider les journées jusqu’au {integrationEditor.date ? dateLabel(integrationEditor.date) : 'jour sélectionné'} inclus.</p>}
    </div></Modal>}

    {editor && <TimeEntryEditor key={edited?.id ?? `${editor.taskId ?? ''}:${editor.resourceId ?? ''}:${editor.date ?? ''}`} editor={editor} data={data} resources={resources} tasks={editorTasks} currentProjectId={currentProjectId} onClose={() => setEditor(null)} onSubmit={async (form, customValues) => {
      const payload = { date: formValue(form, 'date'), hours: Number(form.get('hours')), note: formValue(form, 'note'), customValues };
      const taskId = edited?.taskId ?? formValue(form, 'taskId');
      const selectedResourceId = edited?.resourceId ?? formValue(form, 'resourceId');
      if (!edited && (!candidateTasks.some(task => task.id === taskId) || !memberResources.some(resource => resource.id === selectedResourceId && resource.active))) {
        throw new Error('Choisissez une tâche disponible et une ressource active de ce périmètre.');
      }
      if (integration.covers(payload.date, selectedResourceId, data.tasks.find(task => task.id === taskId)?.projectId)) throw new Error('Cette journée est validée par une date d’intégration. Ajustez cette date pour rouvrir la période.');
      await mutate('time-entries', edited ? 'PATCH' : 'POST', edited ? payload : { ...payload, taskId, resourceId: selectedResourceId }, edited?.id);
      setSelection(null);
      notify(edited ? 'Saisie mise à jour.' : 'Temps enregistré.');
    }} />}
  </section>;
}
