import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CalendarDays, Flag, MessageSquare, Trash2, X } from 'lucide-react';
import type { AppData, Mutation, Project, Task, TaskCreationOptions } from '../shared/types';
import { PROJECT_STATUS_LABELS, STATUS_LABELS, TASK_STATUSES } from '../shared/types';
import { projectStatusLabel } from '../shared/customization';
import { CustomFieldInputs } from './CustomFieldInputs';
import { canProject } from '../shared/permissions';
import { TaskDiscussion } from './ProjectCollaborationViews';
import { legacyTaskPhase, projectTaskListParentOptions } from '../shared/task-lists';

export function Modal({ title, children, onClose, large = false, className = '', label = title }: { title: string; children: ReactNode; onClose: () => void; large?: boolean; className?: string; label?: string }) {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    modalRef.current?.querySelector<HTMLElement>('input,button,select,textarea')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab') return;
      const controls = [...(modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],summary,[tabindex="0"],[contenteditable="true"]') ?? [])]
        .filter(control => control.tabIndex >= 0 && control.getClientRects().length > 0 && getComputedStyle(control).visibility !== 'hidden');
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, []);
  return <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={`modal ${large ? 'modal-large' : ''} ${className}`} ref={modalRef} role="dialog" aria-modal="true" aria-label={label}>
      <div className="modal-header"><div><span className="eyebrow">PLANZONE 8</span><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Fermer la fenêtre"><X size={20} /></button></div>
      {children}
    </div>
  </div>;
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'L’enregistrement a échoué. Réessayez.'; }

function taskTagValues(values: string[]): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const tag = value.trim();
    if (!tag) continue;
    if (tag.length > 50) throw new Error('Un tag ne peut pas dépasser 50 caractères.');
    const key = tag.toLocaleLowerCase('fr');
    if (seen.has(key)) continue;
    seen.add(key); tags.push(tag);
  }
  if (tags.length > 20) throw new Error('Vous pouvez ajouter jusqu’à 20 tags par tâche.');
  return tags;
}

export function TaskDialog({ task, initial, project, data, mutate, onClose, notify }: {
  task: Task | null; initial?: TaskCreationOptions; project: Project; data: AppData; mutate: Mutation; onClose: () => void; notify: (message: string) => void;
}) {
  const [draft, setDraft] = useState({
    title: task?.title ?? '', description: task?.description ?? '',
    phase: task?.phase ?? initial?.phase ?? 'Cadrage', listId: task?.listId ?? initial?.listId ?? '', status: task?.status ?? 'todo', progress: task?.progress ?? 0,
    assigneeId: task?.assigneeId ?? '', startDate: task?.startDate ?? '', endDate: task?.endDate ?? '',
    allocatedHours: task?.allocatedHours ?? (canProject(data, project.id, 'team') ? 8 : 0), kind: task?.kind ?? initial?.kind ?? 'task', dependsOnId: task?.dependsOnId ?? '',
  });
  const [tags, setTags] = useState<string[]>(() => [...task?.tags ?? []]);
  const [tagInput, setTagInput] = useState('');
  const [tagError, setTagError] = useState('');
  const addTags = (input = tagInput) => {
    try { setTags(taskTagValues([...tags, ...input.split(',')])); setTagInput(''); setTagError(''); }
    catch (err) { setTagError(errorMessage(err)); }
  };
  const knownTags = [...new Set(data.tasks.flatMap(item => item.tags))].filter(tag => tag.trim() && tag.length <= 50
    && !tags.some(existing => existing.toLocaleLowerCase('fr') === tag.toLocaleLowerCase('fr'))
    && (!tagInput.trim() || tag.toLocaleLowerCase('fr').includes(tagInput.trim().toLocaleLowerCase('fr'))))
    .filter((tag, index, all) => all.findIndex(other => other.toLocaleLowerCase('fr') === tag.toLocaleLowerCase('fr')) === index)
    .slice(0, 8);
  const [customValues, setCustomValues] = useState<Record<string, string>>(() => ({ ...task?.customValues }));
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [imageReading, setImageReading] = useState(false);
  const saveInFlight = useRef(false);
  const locked = project.status === 'paused' || project.status === 'closed';
  const editDetails = canProject(data, project.id, `${draft.kind === 'milestone' ? 'milestone' : 'task'}${task ? 'Edit' : 'Create'}`);
  const editProgress = task ? canProject(data, project.id, 'taskComplete', task) : editDetails;
  const editAllocation = canProject(data, project.id, 'ownAllocation', task ?? undefined);
  const canSave = task ? editDetails || editProgress || editAllocation || canProject(data, project.id, 'customValues') : editDetails;
  const field = <K extends keyof typeof draft>(key: K, value: typeof draft[K]) => setDraft(prev => ({ ...prev, [key]: value }));
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (locked || imageReading || saveInFlight.current) return;
    saveInFlight.current = true; setBusy(true); setError('');
    try {
      const payload = { ...draft, listId: draft.listId || null, assigneeId: draft.assigneeId || null, dependsOnId: draft.dependsOnId || null,
        startDate: draft.startDate || null, endDate: draft.endDate || null,
        allocatedHours: draft.kind === 'milestone' ? 0 : draft.allocatedHours,
        tags: taskTagValues([...tags, ...tagInput.split(',')]),
        ...(Object.keys(customValues).length || task?.customValues ? { customValues } : {}),
      };
      await mutate('tasks', task ? 'PATCH' : 'POST', task ? payload : { ...payload, projectId: project.id }, task?.id);
      notify(task ? 'La tâche a été enregistrée.' : 'Votre tâche a été créée.'); onClose();
    } catch (err) { setError(errorMessage(err)); } finally { saveInFlight.current = false; setBusy(false); }
  };
  const remove = async () => {
    if (!task || locked || imageReading || saveInFlight.current || !window.confirm(`Supprimer « ${task.title} » ? Cette action est définitive.`)) return;
    saveInFlight.current = true;
    setBusy(true); setError('');
    try { await mutate('tasks', 'DELETE', undefined, task.id); notify('La tâche a été supprimée.'); onClose(); }
    catch (err) { setError(errorMessage(err)); } finally { saveInFlight.current = false; setBusy(false); }
  };
  const close = () => { if (!busy && !imageReading && !saveInFlight.current) onClose(); };
  const listOptions = projectTaskListParentOptions(data.taskLists ?? [], project.id);
  const legacyPhases = [...new Set([...data.tasks.filter(item => item.projectId === project.id && !item.listId).map(legacyTaskPhase), ...(!draft.listId ? [legacyTaskPhase(draft)] : [])])].filter((phase): phase is string => phase !== null);
  const selectedPhase = legacyTaskPhase(draft);
  const listSelection = draft.listId ? `list:${draft.listId}` : selectedPhase ? `phase:${encodeURIComponent(selectedPhase)}` : 'root';
  const chooseList = (selection: string) => {
    if (selection.startsWith('list:')) {
      const selected = listOptions.find(item => item.id === selection.slice(5));
      if (selected) setDraft(previous => ({ ...previous, listId: selected.id, phase: selected.name }));
    } else setDraft(previous => ({ ...previous, listId: '', phase: selection.startsWith('phase:') ? decodeURIComponent(selection.slice(6)) : 'Sans phase' }));
  };
  const dependency = data.tasks.find(t => t.id === draft.dependsOnId);
  return <Modal title={task ? 'Détail de la tâche' : 'Nouvelle tâche'} onClose={close} large>
    <div className="modal-body task-dialog-grid">
      <form id="task-form" onSubmit={save} className="task-details">
        <div className="task-context"><CalendarDays size={15} />{project.name}</div>
        {locked && <div className="form-notice">Ce projet est {projectStatusLabel(project, data).toLocaleLowerCase('fr')}. Reprenez-le depuis ses paramètres pour le modifier.</div>}
        <fieldset disabled={locked || busy}>
          <label className="form-field">Titre<input className="form-input task-title-input" disabled={!editDetails} required maxLength={200} value={draft.title} placeholder="Ex. : Préparer le pilote" onChange={e => field('title', e.target.value)} /></label>
          <div className="form-grid">
            <label className="form-field">Statut<select className="form-input" disabled={!editProgress} value={draft.status} onChange={e => setDraft(prev => ({ ...prev, status: e.target.value as Task['status'], progress: e.target.value === 'done' ? 100 : prev.progress }))}>{TASK_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select></label>
            <label className="form-field">Type<select className="form-input" disabled={!editDetails} value={draft.kind} onChange={e => field('kind', e.target.value as Task['kind'])}><option value="task">Tâche</option><option value="milestone">Jalon</option></select></label>
            <label className="form-field">Assigné à<select className="form-input" disabled={!canProject(data, project.id, 'team')} value={draft.assigneeId} onChange={e => field('assigneeId', e.target.value)}><option value="">Non assigné</option>{data.resources.filter(r => r.active || r.id === draft.assigneeId).map(r => <option key={r.id} value={r.id}>{r.name}{!r.active ? ' (inactive)' : ''}</option>)}</select></label>
            <label className="form-field">Liste<select className="form-input" disabled={!editDetails} value={listSelection} onChange={event => chooseList(event.target.value)}><option value="root">Hors liste</option>{listOptions.map(list => <option key={list.id} value={`list:${list.id}`}>{list.label}</option>)}{legacyPhases.map(phase => <option key={`phase:${phase}`} value={`phase:${encodeURIComponent(phase)}`}>{phase}</option>)}</select></label>
            {!draft.listId && <label className="form-field">Phase<input className="form-input" list="project-phases" maxLength={200} disabled={!editDetails} value={draft.phase} onChange={e => field('phase', e.target.value)} /><datalist id="project-phases">{legacyPhases.map(phase => <option key={phase}>{phase}</option>)}</datalist></label>}
            <label className="form-field">Début<input className="form-input" type="date" disabled={!editDetails} value={draft.startDate} onChange={e => field('startDate', e.target.value)} /></label>
            <label className="form-field">Fin<input className="form-input" type="date" value={draft.endDate} min={draft.startDate || undefined} onChange={e => field('endDate', e.target.value)} /></label>
            <label className="form-field">Travail alloué (heures)<input className="form-input" type="number" min="0" max="100000" step="0.5" disabled={draft.kind === 'milestone' || !editAllocation} value={draft.kind === 'milestone' ? 0 : draft.allocatedHours} onChange={e => field('allocatedHours', Number(e.target.value))} /></label>
            <label className="form-field">Avancement (%)<input className="form-input" type="number" min="0" max="100" step="1" disabled={draft.status === 'done' || !editProgress} value={draft.status === 'done' ? 100 : draft.progress} onChange={e => field('progress', Number(e.target.value))} /></label>
          </div>
          <label className="form-field">Description<textarea className="form-input" rows={4} maxLength={10000} value={draft.description} placeholder="Objectif, livrables et informations utiles…" onChange={e => field('description', e.target.value)} /></label>
          <fieldset className="lc-task-tags" disabled={!editDetails} aria-label="Tags de la tâche"><div className="lc-task-tags-heading"><h3>Tags</h3><span>{tags.length} / 20</span></div>
            {tags.length > 0 && <ul className="lc-tag-chips" aria-label="Tags ajoutés">{tags.map((tag, index) => <li key={`${tag}-${index}`}><span>{tag}</span><button type="button" aria-label={`Retirer le tag ${tag}`} onClick={() => { setTags(previous => previous.filter((_, position) => position !== index)); setTagError(''); }}><X size={13} /></button></li>)}</ul>}
            <div className="lc-tag-input-row"><label className="sr-only" htmlFor="task-tag-input">Ajouter un tag</label><input id="task-tag-input" className="form-input" value={tagInput} maxLength={1040} placeholder="Ajouter un tag…" aria-describedby="task-tag-help" aria-invalid={!!tagError} onChange={event => { setTagInput(event.target.value); setTagError(''); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addTags(); } }} /><button className="button button-secondary" type="button" disabled={!tagInput.trim()} onClick={() => addTags()}>Ajouter</button></div>
            <p id="task-tag-help" className="lc-tag-help">Appuyez sur Entrée pour ajouter un tag. Vous pouvez séparer plusieurs tags par des virgules.</p>
            {knownTags.length > 0 && <div className="lc-tag-suggestions"><span>Tags existants</span>{knownTags.map(tag => <button type="button" key={tag} disabled={tags.length >= 20} onClick={() => addTags(tag)}>{tag}</button>)}</div>}
            {tagError && <p className="form-error" role="alert">{tagError}</p>}
          </fieldset>
          <label className="form-field">Démarre après<select className="form-input" disabled={!canProject(data, project.id, 'details')} value={draft.dependsOnId} onChange={e => field('dependsOnId', e.target.value)}><option value="">Aucune dépendance</option>{data.tasks.filter(t => t.projectId === project.id && t.id !== task?.id).map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
          {dependency && dependency.status !== 'done' && <div className="form-notice"><Flag size={15} /> Cette tâche pourra démarrer lorsque « {dependency.title} » sera terminée.</div>}
          <CustomFieldInputs definitions={data.customFieldDefinitions ?? []} scope="task" readOnly={!canProject(data, project.id, 'customValues')} values={customValues} onChange={setCustomValues} onPendingChange={setImageReading} builtinValues={{ allocatedHours: draft.kind === 'milestone' ? 0 : draft.allocatedHours, progress: draft.status === 'done' ? 100 : draft.progress }} />
        </fieldset>
        {error && <p role="alert" className="form-error">{error}</p>}
      </form>
      {task ? <TaskDiscussion data={data} task={task} project={project} mutate={mutate} notify={notify} /> : <aside className="task-comments"><h3><MessageSquare size={18} />Discussion</h3><div className="empty-state compact"><MessageSquare size={26} /><p>Enregistrez la tâche pour ajouter un commentaire.</p></div></aside>}
    </div>
    <div className="modal-footer">{task && !locked && canProject(data, project.id, task.kind === 'milestone' ? 'milestoneDelete' : 'taskDelete') && <button className="button button-danger" disabled={busy || imageReading} onClick={remove}><Trash2 size={16} />Supprimer</button>}<div className="modal-footer-actions"><button className="button button-secondary" disabled={busy || imageReading} onClick={close}>Fermer</button><button className="button button-primary" type="submit" form="task-form" disabled={busy || imageReading || locked || !canSave}>{busy ? 'Enregistrement…' : task ? 'Enregistrer' : 'Créer la tâche'}</button></div></div>
  </Modal>;
}

export { ProjectCreationDialog as ProjectDialog } from './ProjectCreationDialog';
