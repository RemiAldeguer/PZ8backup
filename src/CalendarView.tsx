import { canProject, globalRole, isAdmin } from '../shared/permissions';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Flag, Plus, Trash2, Umbrella, Users } from 'lucide-react';
import type { CalendarEvent, Resource, Task, Unavailability, ViewProps } from '../shared/types';
import { formatDate } from '../shared/domain';
import { associatedResourceProjectIds } from '../shared/resources';
import { Modal } from './Dialogs';
import { TaskCheck } from './TaskCheck';
import './calendar-view.css';

const DAY = 86_400_000;
const dateStamp = (date: string) => Date.parse(`${date}T12:00:00Z`);
const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const monthOf = (date: string) => new Date(`${date.slice(0, 7)}-01T12:00:00Z`);
const isWritable = (status: string) => status !== 'paused' && status !== 'closed';
const failure = (error: unknown) => error instanceof Error ? error.message : 'L’enregistrement a échoué. Réessayez.';
type AddKind = 'task' | 'milestone' | 'event' | 'unavailability';
type Editor = { kind: 'task' | 'milestone'; date: string } | { kind: 'event'; date: string; item?: CalendarEvent } | { kind: 'unavailability'; date: string; item?: Unavailability };
type CalendarItem = { kind: 'task'; item: Task } | { kind: 'milestone'; item: Task } | { kind: 'event'; item: CalendarEvent } | { kind: 'unavailability'; item: Unavailability };
const reasons = { leave: 'Congés', sick: 'Maladie', other: 'Autre' };

function dateRangeError(startDate: string, endDate: string, allDay = true, startTime = '', endTime = '') {
  const valid = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(dateStamp(date)) && isoDate(new Date(dateStamp(date))) === date;
  if (!valid(startDate) || !valid(endDate)) return 'Sélectionnez des dates valides.';
  if (endDate < startDate) return 'La date de fin doit suivre la date de début.';
  if (!allDay && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime))) return 'Indiquez une heure de début et une heure de fin.';
  if (!allDay && startDate === endDate && startTime >= endTime) return 'L’heure de fin doit suivre l’heure de début.';
  return '';
}

function AddMenu({ onChoose, taskDisabled, eventDisabled, canChoose }: { onChoose: (kind: AddKind) => void; taskDisabled: boolean; eventDisabled: boolean; canChoose?: (kind: AddKind) => boolean }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options: { kind: AddKind; label: string; icon: ReactNode }[] = [
    { kind: 'task', label: 'Tâche', icon: <Check size={18} /> },
    { kind: 'milestone', label: 'Jalon', icon: <Flag size={18} /> },
    { kind: 'event', label: 'Événement', icon: <CalendarDays size={18} /> },
    { kind: 'unavailability', label: 'Indisponibilité', icon: <Umbrella size={18} /> },
  ];
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
      const choices = [...(container.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const current = choices.indexOf(document.activeElement as HTMLButtonElement);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (current + (event.key === 'ArrowUp' ? -1 : 1) + choices.length) % choices.length;
      choices[index]?.focus();
    };
    container.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keyboard); };
  }, [open]);
  return <div className="calendar-add-container" ref={container} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <button className="button button-primary calendar-add-trigger" ref={trigger} disabled={!!canChoose && !options.some(option => canChoose(option.kind))} aria-label="Ajouter au calendrier" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}><Plus size={17} /> Ajouter <ChevronDown size={14} /></button>
    {open && <div className="calendar-add-menu" role="menu" aria-label="Ajouter au calendrier">{options.map(option => <button role="menuitem" disabled={(canChoose && !canChoose(option.kind)) || (taskDisabled && (option.kind === 'task' || option.kind === 'milestone')) || (eventDisabled && option.kind === 'event')} key={option.kind} onClick={() => { setOpen(false); onChoose(option.kind); }}>{option.icon}{option.label}</button>)}</div>}
  </div>;
}

function CalendarForm({ title, onClose, children, busy, error, onSave, onDelete, locked = false, submitLabel }: {
  title: string; onClose: () => void; children: ReactNode; busy: boolean; error: string;
  onSave: (event: FormEvent) => void; onDelete?: () => void; locked?: boolean; submitLabel: string;
}) {
  const dismiss = useCallback(() => { if (!busy) onClose(); }, [busy, onClose]);
  return <div className="calendar-editor"><Modal title={title} onClose={dismiss}><form onSubmit={onSave}>
    <div className="modal-body">
      {locked && <p className="form-notice">Ce projet est interrompu ou clos. Ses événements sont disponibles en lecture.</p>}
      <fieldset className="calendar-form-fields" disabled={busy || locked}>{children}</fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
    <div className="modal-footer">{onDelete && !locked && <button type="button" className="button button-danger" disabled={busy} onClick={onDelete}><Trash2 size={15} /> Supprimer</button>}<button className="button button-secondary" type="button" disabled={busy} onClick={dismiss}>{locked ? 'Fermer' : 'Annuler'}</button>{!locked && <button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Enregistrement…' : submitLabel}</button>}</div>
  </form></Modal></div>;
}

function TaskCreateForm({ props, kind, date, selectedProjectId, onClose, onSaved }: {
  props: ViewProps & { global?: boolean }; kind: 'task' | 'milestone'; date: string; selectedProjectId: string;
  onClose: () => void; onSaved: (date: string) => void;
}) {
  const projects = props.data.projects.filter(project => isWritable(project.status) && canProject(props.data, project.id, kind === 'milestone' ? 'milestoneCreate' : 'taskCreate'));
  const [draft, setDraft] = useState({ title: '', projectId: props.global ? (projects.some(project => project.id === selectedProjectId) ? selectedProjectId : projects[0]?.id ?? '') : props.project.id,
    assigneeId: '', phase: 'Sans phase', startDate: date, endDate: date, allocatedHours: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const field = <K extends keyof typeof draft>(key: K, value: typeof draft[K]) => setDraft(previous => ({ ...previous, [key]: value }));
  const save = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    const dateError = dateRangeError(draft.startDate, kind === 'milestone' ? draft.startDate : draft.endDate);
    if (dateError) { setError(dateError); return; }
    if (!draft.title.trim()) { setError('Indiquez un titre.'); return; }
    if (!projects.some(project => project.id === draft.projectId)) { setError('Choisissez un projet ouvert.'); return; }
    setBusy(true);
    try {
      await props.mutate('tasks', 'POST', { ...draft, title: draft.title.trim(), kind, assigneeId: draft.assigneeId || null,
        endDate: kind === 'milestone' ? draft.startDate : draft.endDate, allocatedHours: kind === 'milestone' ? 0 : draft.allocatedHours });
      props.notify(kind === 'milestone' ? 'Le jalon a été créé.' : 'La tâche a été créée.'); onSaved(draft.startDate);
    } catch (caught) { setError(failure(caught)); } finally { setBusy(false); }
  };
  return <CalendarForm title={kind === 'milestone' ? 'Nouveau jalon' : 'Nouvelle tâche'} busy={busy} error={error} onClose={onClose} onSave={save} submitLabel={kind === 'milestone' ? 'Créer le jalon' : 'Créer la tâche'}>
    <label className="form-field">Titre<input required maxLength={200} value={draft.title} onChange={event => field('title', event.target.value)} placeholder={kind === 'milestone' ? 'Ex. : Validation du cadrage' : 'Ex. : Préparer le déploiement'} /></label>
    {props.global ? <label className="form-field">Projet<select required value={draft.projectId} onChange={event => field('projectId', event.target.value)}><option value="" disabled>Choisir un projet</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label> : <p className="calendar-form-context">{props.project.name}</p>}
    <div className="form-grid"><label className="form-field">Assigné à<select disabled={!canProject(props.data, draft.projectId, 'team')} value={draft.assigneeId} onChange={event => field('assigneeId', event.target.value)}><option value="">Non assigné</option>{props.data.resources.filter(resource => resource.active).map(resource => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select></label>
      <label className="form-field">Phase<input maxLength={200} list="calendar-task-phases" value={draft.phase} onChange={event => field('phase', event.target.value)} /><datalist id="calendar-task-phases">{[...new Set(props.data.tasks.filter(task => task.projectId === draft.projectId).map(task => task.phase))].map(phase => <option key={phase} value={phase} />)}</datalist></label>
      {kind === 'milestone' ? <label className="form-field full-width">Date du jalon<input type="date" required value={draft.startDate} onChange={event => field('startDate', event.target.value)} /></label> : <><label className="form-field">Début<input type="date" required value={draft.startDate} onChange={event => field('startDate', event.target.value)} /></label><label className="form-field">Fin<input type="date" required min={draft.startDate} value={draft.endDate} onChange={event => field('endDate', event.target.value)} /></label><label className="form-field full-width">Travail alloué (heures)<input type="number" min={0} max={100000} step="0.5" required value={draft.allocatedHours} onChange={event => field('allocatedHours', Number(event.target.value))} /></label></>}
    </div>
  </CalendarForm>;
}

function EventForm({ props, date, item, selectedProjectId, onClose, onSaved }: {
  props: ViewProps & { global?: boolean }; date: string; item?: CalendarEvent; selectedProjectId: string;
  onClose: () => void; onSaved: (date: string) => void;
}) {
  const initialProjectId = props.global ? (props.data.projects.some(project => project.id === selectedProjectId && isWritable(project.status)) ? selectedProjectId : '') : props.project.id;
  const [draft, setDraft] = useState({ title: item?.title ?? '', description: item?.description ?? '', projectId: item?.projectId ?? initialProjectId, resourceIds: item?.resourceIds ?? [],
    allDay: item?.allDay ?? true, startDate: item?.startDate ?? date, endDate: item?.endDate ?? date,
    startTime: item?.startTime ?? '09:00', endTime: item?.endTime ?? '10:00' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const field = <K extends keyof typeof draft>(key: K, value: typeof draft[K]) => setDraft(previous => ({ ...previous, [key]: value }));
  const project = props.data.projects.find(value => value.id === draft.projectId);
  const locked = globalRole(props.data) === 'visitor' || Boolean(project && (!isWritable(project.status) || !canProject(props.data, project.id, item ? 'eventEdit' : 'eventCreate')));
  const projects = props.data.projects.filter(value => isWritable(value.status) || value.id === item?.projectId);
  const resources = props.data.resources.filter(resource => resource.active || draft.resourceIds.includes(resource.id));
  const save = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    const dateError = dateRangeError(draft.startDate, draft.endDate, draft.allDay, draft.startTime, draft.endTime);
    if (dateError) { setError(dateError); return; }
    if (!draft.title.trim()) { setError('Indiquez le nom de l’événement.'); return; }
    setBusy(true);
    try {
      await props.mutate('calendar-events', item ? 'PATCH' : 'POST', { ...draft, title: draft.title.trim(), projectId: draft.projectId || null,
        startTime: draft.allDay ? null : draft.startTime, endTime: draft.allDay ? null : draft.endTime }, item?.id);
      props.notify(item ? 'L’événement a été enregistré.' : 'L’événement a été créé.'); onSaved(draft.startDate);
    } catch (caught) { setError(failure(caught)); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!item || !window.confirm(`Supprimer l’événement « ${item.title} » ?`)) return;
    setBusy(true); setError('');
    try { await props.mutate('calendar-events', 'DELETE', undefined, item.id); props.notify('L’événement a été supprimé.'); onClose(); }
    catch (caught) { setError(failure(caught)); } finally { setBusy(false); }
  };
  return <CalendarForm title={item ? 'Modifier l’événement' : 'Nouvel événement'} busy={busy} error={error} onClose={onClose} onSave={save} onDelete={item ? remove : undefined} locked={locked} submitLabel={item ? 'Enregistrer' : 'Créer l’événement'}>
    <label className="form-field">Nom de l’événement<input required maxLength={200} value={draft.title} onChange={event => field('title', event.target.value)} placeholder="Ex. : Réunion de lancement" /></label>
    <label className="form-field">Projet<select value={draft.projectId} onChange={event => field('projectId', event.target.value)}><option value="">Sans projet</option>{projects.map(value => <option key={value.id} value={value.id}>{value.name}{!isWritable(value.status) ? ' (lecture seule)' : ''}</option>)}</select></label>
    <fieldset className="calendar-participants"><legend>Participants</legend><div>{resources.map(resource => <label key={resource.id}><input type="checkbox" checked={draft.resourceIds.includes(resource.id)} onChange={event => field('resourceIds', event.target.checked ? [...draft.resourceIds, resource.id] : draft.resourceIds.filter(id => id !== resource.id))} /><ResourceAvatar resource={resource} /><span>{resource.name}{!resource.active ? ' (inactive)' : ''}</span></label>)}</div></fieldset>
    <label className="calendar-choice"><input type="checkbox" checked={draft.allDay} onChange={event => field('allDay', event.target.checked)} />Toute la journée</label>
    <div className="form-grid"><label className="form-field">Début<input type="date" required value={draft.startDate} onChange={event => field('startDate', event.target.value)} /></label><label className="form-field">Fin<input type="date" required min={draft.startDate} value={draft.endDate} onChange={event => field('endDate', event.target.value)} /></label>
      {!draft.allDay && <><label className="form-field">De<input type="time" required value={draft.startTime} onChange={event => field('startTime', event.target.value)} /></label><label className="form-field">À<input type="time" required value={draft.endTime} onChange={event => field('endTime', event.target.value)} /></label></>}
    </div>
    <label className="form-field">Description (optionnel)<textarea rows={3} maxLength={10000} value={draft.description} onChange={event => field('description', event.target.value)} /></label>
  </CalendarForm>;
}

function ResourceAvatar({ resource }: { resource: Resource }) {
  return <span className="calendar-resource-avatar" aria-hidden="true" style={{ backgroundColor: resource.color }}>{resource.initials}</span>;
}

function UnavailabilityForm({ props, date, item, selectedResourceId, onClose, onSaved }: {
  props: ViewProps; date: string; item?: Unavailability; selectedResourceId: string; onClose: () => void; onSaved: (date: string) => void;
}) {
  const active = props.data.resources.filter(resource => resource.active && (isAdmin(props.data) || resource.id === props.data.currentUser.id));
  const defaultResource = active.find(resource => resource.id === selectedResourceId) ?? active.find(resource => resource.id === props.data.currentUser.id) ?? active[0];
  const [draft, setDraft] = useState({ title: item?.title ?? '', resourceId: item?.resourceId ?? defaultResource?.id ?? '', reason: item?.reason ?? 'leave',
    allDay: item?.allDay ?? true, startDate: item?.startDate ?? date, endDate: item?.endDate ?? date,
    startTime: item?.startTime ?? '09:00', endTime: item?.endTime ?? '12:00' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const field = <K extends keyof typeof draft>(key: K, value: typeof draft[K]) => setDraft(previous => ({ ...previous, [key]: value }));
  const resources = props.data.resources.filter(resource => (isAdmin(props.data) || resource.id === props.data.currentUser.id || resource.id === item?.resourceId) && (resource.active || resource.id === item?.resourceId));
  const save = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    const dateError = dateRangeError(draft.startDate, draft.allDay ? draft.endDate : draft.startDate, draft.allDay, draft.startTime, draft.endTime);
    if (dateError) { setError(dateError); return; }
    if (!draft.title.trim()) { setError('Indiquez le nom de l’indisponibilité.'); return; }
    if (!draft.resourceId) { setError('Choisissez une ressource.'); return; }
    setBusy(true);
    try {
      await props.mutate('unavailabilities', item ? 'PATCH' : 'POST', { ...draft, title: draft.title.trim(), endDate: draft.allDay ? draft.endDate : draft.startDate,
        startTime: draft.allDay ? null : draft.startTime, endTime: draft.allDay ? null : draft.endTime }, item?.id);
      props.notify(item ? 'L’indisponibilité a été enregistrée.' : 'L’indisponibilité a été créée.'); onSaved(draft.startDate);
    } catch (caught) { setError(failure(caught)); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!item || !window.confirm(`Supprimer l’indisponibilité « ${item.title} » ?`)) return;
    setBusy(true); setError('');
    try { await props.mutate('unavailabilities', 'DELETE', undefined, item.id); props.notify('L’indisponibilité a été supprimée.'); onClose(); }
    catch (caught) { setError(failure(caught)); } finally { setBusy(false); }
  };
  return <CalendarForm locked={globalRole(props.data) === 'visitor' || !isAdmin(props.data) && !!item && item.resourceId !== props.data.currentUser.id} title={item ? 'Modifier l’indisponibilité' : 'Créer une indisponibilité'} busy={busy} error={error} onClose={onClose} onSave={save} onDelete={item ? remove : undefined} submitLabel={item ? 'Enregistrer' : 'Créer'}>
    <div className="form-grid"><label className="form-field">Nom de l’indisponibilité<input required maxLength={200} value={draft.title} onChange={event => field('title', event.target.value)} placeholder="Nommer l’indisponibilité" /></label>
      <label className="form-field">Pour<select required value={draft.resourceId} onChange={event => field('resourceId', event.target.value)}><option value="" disabled>Choisir une ressource</option>{resources.map(resource => <option key={resource.id} value={resource.id}>{resource.name}{resource.id === props.data.currentUser.id ? ' (Moi)' : ''}{!resource.active ? ' (inactive)' : ''}</option>)}</select></label>
      <label className="form-field">Type<select value={draft.reason} onChange={event => field('reason', event.target.value as Unavailability['reason'])}>{Object.entries(reasons).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    <fieldset className="calendar-day-mode"><legend className="sr-only">Durée de l’indisponibilité</legend><label className="calendar-choice"><input type="radio" name="absence-duration" checked={draft.allDay} onChange={() => field('allDay', true)} />Toute la journée</label><label className="calendar-choice"><input type="radio" name="absence-duration" checked={!draft.allDay} onChange={() => field('allDay', false)} />Journée partielle</label></fieldset>
    {draft.allDay ? <div className="form-grid"><label className="form-field">Début<input type="date" required value={draft.startDate} onChange={event => field('startDate', event.target.value)} /></label><label className="form-field">Fin<input type="date" required min={draft.startDate} value={draft.endDate} onChange={event => field('endDate', event.target.value)} /></label></div> : <><div className="calendar-partial-dates"><label className="form-field">Le<input type="date" required value={draft.startDate} onChange={event => field('startDate', event.target.value)} /></label><label className="form-field">De<input type="time" required value={draft.startTime} onChange={event => field('startTime', event.target.value)} /></label><label className="form-field">À<input type="time" required value={draft.endTime} onChange={event => field('endTime', event.target.value)} /></label></div><p className="calendar-form-context">La durée saisie est déduite de la capacité du jour.</p></>}
  </CalendarForm>;
}

export function CalendarView(props: ViewProps & { global?: boolean }) {
  const { data, global = false } = props;
  const [month, setMonth] = useState(() => monthOf(data.today));
  const [resourceId, setResourceId] = useState('all');
  const [projectId, setProjectId] = useState('all');
  const [itemType, setItemType] = useState('all');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const closeEditor = useCallback(() => setEditor(null), []);
  const closeExpanded = useCallback(() => setExpandedDate(null), []);
  const scopeProjectId = global ? projectId : props.project.id;
  const events = data.calendarEvents ?? [];
  const absences = data.unavailabilities ?? [];
  const projectMemberIds = new Set(data.resources.filter(resource => associatedResourceProjectIds(resource, data.tasks, data.projects).includes(scopeProjectId)).map(resource => resource.id));
  events.filter(event => event.projectId === scopeProjectId).forEach(event => event.resourceIds.forEach(id => projectMemberIds.add(id)));
  const matchesResource = (ids: string[]) => resourceId === 'all' || (resourceId === 'none' ? ids.length === 0 : ids.includes(resourceId));
  const tasks = data.tasks.filter(task => (scopeProjectId === 'all' || task.projectId === scopeProjectId) && (task.startDate || task.endDate)
    && (itemType === 'all' || itemType === task.kind) && matchesResource(task.assigneeId ? [task.assigneeId] : []));
  const scopedEvents = events.filter(event => (scopeProjectId === 'all' || event.projectId === scopeProjectId) && (itemType === 'all' || itemType === 'event') && matchesResource(event.resourceIds));
  const scopedAbsences = absences.filter(absence => (scopeProjectId === 'all' || projectMemberIds.has(absence.resourceId)) && (itemType === 'all' || itemType === 'unavailability') && matchesResource([absence.resourceId]));
  const items: CalendarItem[] = [
    ...tasks.map(item => ({ kind: item.kind, item } as CalendarItem)),
    ...scopedEvents.map(item => ({ kind: 'event' as const, item })),
    ...scopedAbsences.map(item => ({ kind: 'unavailability' as const, item })),
  ];
  const dayItems = (date: string) => items.filter(({ item }) => date >= (item.startDate ?? item.endDate!) && date <= (item.endDate ?? item.startDate!));
  const first = new Date(month.getTime() - ((month.getUTCDay() + 6) % 7) * DAY);
  const monthLabel = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(month);
  const previousNext = (direction: number) => { setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + direction, 1, 12))); setExpandedDate(null); };
  const choose = (kind: AddKind, date = data.today) => { setExpandedDate(null); setEditor({ kind, date } as Editor); };
  const saved = (date: string) => { setMonth(monthOf(date)); setEditor(null); setExpandedDate(null); setItemType('all'); setResourceId('all'); if (global) setProjectId('all'); };
  const taskDisabled = global ? !data.projects.some(project => isWritable(project.status)) : !isWritable(props.project.status);
  const historicalResourceIds = new Set<string>();
  data.tasks.filter(task => scopeProjectId === 'all' || task.projectId === scopeProjectId).forEach(task => { if (task.assigneeId) historicalResourceIds.add(task.assigneeId); });
  events.filter(event => scopeProjectId === 'all' || event.projectId === scopeProjectId).forEach(event => event.resourceIds.forEach(id => historicalResourceIds.add(id)));
  absences.filter(absence => scopeProjectId === 'all' || projectMemberIds.has(absence.resourceId)).forEach(absence => historicalResourceIds.add(absence.resourceId));
  const resourceOptions = data.resources.filter(resource => resource.active || resource.id === resourceId || historicalResourceIds.has(resource.id));

  function openItem(item: CalendarItem) {
    setExpandedDate(null);
    if (item.kind === 'task' || item.kind === 'milestone') props.openTask(item.item);
    else if (item.kind === 'event') setEditor({ kind: 'event', date: item.item.startDate, item: item.item });
    else setEditor({ kind: 'unavailability', date: item.item.startDate, item: item.item });
  }
  function ItemContent({ value, expanded = false }: { value: CalendarItem; expanded?: boolean }) {
    const item = value.item;
    const project = 'projectId' in item ? data.projects.find(project => project.id === item.projectId) : undefined;
    const absenceResource = value.kind === 'unavailability' ? data.resources.find(resource => resource.id === value.item.resourceId) : undefined;
    const eventPeriod = value.kind === 'event' ? value.item.allDay ? 'Journée entière'
      : value.item.startDate === value.item.endDate ? `${value.item.startTime} – ${value.item.endTime}`
        : `${formatDate(value.item.startDate)} ${value.item.startTime} → ${formatDate(value.item.endDate)} ${value.item.endTime}` : '';
    const details = value.kind === 'unavailability' ? `${absenceResource?.name ?? 'Ressource'} · ${value.item.allDay ? 'Journée entière' : `${value.item.startTime} – ${value.item.endTime}`}`
      : value.kind === 'event' ? `${eventPeriod}${value.item.resourceIds.length ? ` · ${value.item.resourceIds.length} participant${value.item.resourceIds.length > 1 ? 's' : ''}` : ''}` : '';
    const label = value.kind === 'event' ? `Ouvrir l’événement ${item.title}` : value.kind === 'unavailability' ? `Ouvrir l’indisponibilité ${item.title}` : `Ouvrir ${item.title}`;
    const style = project ? { '--calendar-project-color': project.color } as CSSProperties : undefined;
    return <div className={`calendar-item-row calendar-item-${value.kind}${expanded ? ' calendar-item-expanded' : ''}${'status' in item ? ` status-${item.status}` : ''}`} style={style}>
      {value.kind === 'task' && <TaskCheck task={value.item} data={data} mutate={props.mutate} notify={props.notify} />}
      <button className="calendar-item-open" aria-label={label} title={`${project?.name ? `${project.name} · ` : ''}${item.title}${details ? ` · ${details}` : ''}`} onClick={() => openItem(value)}>
        {value.kind === 'milestone' ? <Flag size={13} /> : value.kind === 'event' ? <CalendarDays size={13} /> : value.kind === 'unavailability' ? <Umbrella size={13} /> : null}
        <span>{global && project && <small>{project.name}</small>}<strong>{item.title}</strong>{details && <small>{details}</small>}{expanded && value.kind === 'unavailability' && <small>{reasons[value.item.reason]} · {formatDate(value.item.startDate)}{value.item.endDate !== value.item.startDate ? ` — ${formatDate(value.item.endDate)}` : ''}</small>}</span>
      </button>
    </div>;
  }

  return <div className="calendar-view">
    <header className="calendar-heading"><div><div className="eyebrow">{global ? 'MES PROJETS' : props.project.name}</div><h1>{global ? 'Calendrier global' : 'Calendrier du projet'}</h1><p>Tâches, jalons, événements et disponibilités de vos ressources.</p></div><AddMenu canChoose={kind => kind === 'unavailability' ? globalRole(data) !== 'visitor' : kind === 'event' ? globalRole(data) !== 'visitor' && (global || canProject(data, props.project.id, 'eventCreate')) : (global ? data.projects : [props.project]).some(project => canProject(data, project.id, kind === 'milestone' ? 'milestoneCreate' : 'taskCreate'))} onChoose={kind => choose(kind)} taskDisabled={taskDisabled} eventDisabled={!global && !isWritable(props.project.status)} /></header>
    <div className="calendar-toolbar"><div className="calendar-filters"><span>Filtrer par :</span>{global && <select aria-label="Filtrer le calendrier par projet" value={projectId} onChange={event => { setProjectId(event.target.value); setExpandedDate(null); }}><option value="all">Tous les projets</option>{data.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>}
      <select aria-label="Filtrer le calendrier par ressource" value={resourceId} onChange={event => { setResourceId(event.target.value); setExpandedDate(null); }}><option value="all">Toutes les ressources</option><option value="none">Non assignées</option>{resourceOptions.map(resource => <option key={resource.id} value={resource.id}>{resource.name}{!resource.active ? ' (inactive)' : ''}</option>)}</select>
      <select aria-label="Filtrer le calendrier par type" value={itemType} onChange={event => { setItemType(event.target.value); setExpandedDate(null); }}><option value="all">Tâches, jalons, événements, indisponibilités</option><option value="task">Tâches</option><option value="milestone">Jalons</option><option value="event">Événements</option><option value="unavailability">Indisponibilités</option></select>
    </div><div className="calendar-navigation"><div className="calendar-month-control"><button aria-label="Mois précédent" onClick={() => previousNext(-1)}><ChevronLeft size={17} /></button><strong className="capitalize">{monthLabel}</strong><button aria-label="Mois suivant" onClick={() => previousNext(1)}><ChevronRight size={17} /></button><label className="calendar-month-picker" title="Choisir un mois"><CalendarDays size={17} /><input type="month" aria-label="Choisir un mois" value={isoDate(month).slice(0, 7)} onChange={event => { if (event.target.value) { setMonth(monthOf(`${event.target.value}-01`)); setExpandedDate(null); } }} /></label></div><button className="button button-secondary" onClick={() => { setMonth(monthOf(data.today)); setExpandedDate(null); }}>Aujourd’hui</button><span className="calendar-count">{items.length} élément{items.length > 1 ? 's' : ''} planifié{items.length > 1 ? 's' : ''}</span></div></div>
    <div className="calendar-legend" aria-label="Légende du calendrier"><span><Check size={14} /> Tâche</span><span><Flag size={14} /> Jalon</span><span><CalendarDays size={14} /> Événement</span><span><Umbrella size={14} /> Indisponibilité</span></div>
    <div className="card calendar-grid-scroll"><div className="calendar-weekdays">{['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'].map(day => <span key={day}>{day}</span>)}</div><div className="calendar-month-grid">{Array.from({ length: 42 }, (_, index) => {
      const date = new Date(first.getTime() + index * DAY);
      const dateKey = isoDate(date);
      const values = dayItems(dateKey);
      return <div key={dateKey} className={`calendar-day${date.getUTCMonth() !== month.getUTCMonth() ? ' outside-month' : ''}${index % 7 >= 5 ? ' weekend' : ''}${dateKey === data.today ? ' is-today' : ''}`} data-date={dateKey}>
        <div className="calendar-day-heading"><button className="calendar-day-add" aria-label={`Ajouter un élément le ${formatDate(dateKey)}`} onClick={() => choose(taskDisabled ? 'unavailability' : 'task', dateKey)}><Plus size={12} /></button><span aria-current={dateKey === data.today ? 'date' : undefined}>{date.getUTCDate()}</span></div>
        {values.slice(0, 3).map(value => <ItemContent key={`${value.kind}-${value.item.id}`} value={value} />)}
        {values.length > 3 && <button className="calendar-more" aria-expanded={expandedDate === dateKey} onClick={() => setExpandedDate(dateKey)}>+ {values.length - 3} autres</button>}
      </div>;
    })}</div></div>
    <p className="calendar-help">Les week-ends sont grisés. Cliquez sur un élément pour ouvrir sa fiche ; le bouton Ajouter permet de planifier un élément ou une indisponibilité.</p>
    {expandedDate && <Modal title={`${formatDate(expandedDate)} · ${dayItems(expandedDate).length} éléments`} onClose={closeExpanded}><div className="modal-body calendar-expanded-list">{dayItems(expandedDate).map(value => <ItemContent key={`${value.kind}-${value.item.id}`} value={value} expanded />)}</div></Modal>}
    {editor && (editor.kind === 'task' || editor.kind === 'milestone') && <TaskCreateForm key={`${editor.kind}-${editor.date}`} props={props} kind={editor.kind} date={editor.date} selectedProjectId={projectId} onClose={closeEditor} onSaved={saved} />}
    {editor?.kind === 'event' && <EventForm key={editor.item?.id ?? editor.date} props={props} item={editor.item} date={editor.date} selectedProjectId={projectId} onClose={closeEditor} onSaved={saved} />}
    {editor?.kind === 'unavailability' && <UnavailabilityForm key={editor.item?.id ?? editor.date} props={props} item={editor.item} date={editor.date} selectedResourceId={resourceId} onClose={closeEditor} onSaved={saved} />}
  </div>;
}
