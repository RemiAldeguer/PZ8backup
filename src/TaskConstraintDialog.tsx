import { useRef, useState, type FormEvent } from 'react';
import type { Task, TaskConstraint, ViewProps } from '../shared/types';
import { formatDate } from '../shared/domain';
import { canProject } from '../shared/permissions';
import { dependencyProblem } from '../shared/project-gantt';
import { DEFAULT_TASK_CONSTRAINT, planTaskConstraints } from '../shared/task-constraints';
import { preferenceConstraintShift } from '../shared/planning-preferences';
import { Modal } from './Dialogs';
import './task-constraints.css';

export interface ConstraintEditor { successorId?: string; predecessorId?: string; projectId?: string; }
const dateLabel = (date: string | null | undefined) => date ? formatDate(date) : 'Non définie';
export function ConstraintDialog({ props, initial, onClose }: { props: ViewProps; initial: ConstraintEditor; onClose: () => void }) {
  const tasks = props.data.tasks.filter(task => task.projectId === props.project.id);
  const initialTask = tasks.find(task => task.id === initial.successorId);
  const [successorId, setSuccessor] = useState(initial.successorId ?? '');
  const [predecessorId, setPredecessor] = useState(initial.predecessorId ?? initialTask?.dependsOnId ?? '');
  const [settings, setSettings] = useState<TaskConstraint>({ ...initialTask?.dependencyConstraint ?? DEFAULT_TASK_CONSTRAINT });
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const editable = !['paused', 'closed'].includes(props.project.status) && canProject(props.data, props.project.id, 'details');
  const successor = tasks.find(task => task.id === successorId), predecessor = tasks.find(task => task.id === predecessorId);
  const previous = tasks.find(task => task.id === successor?.dependsOnId);
  let preview: Task[] = [], previewError = '';
  if (successor && predecessor) {
    try { preview = planTaskConstraints(tasks, { ...successor, dependsOnId: predecessorId, dependencyConstraint: settings }, successor, preferenceConstraintShift(props.data)); }
    catch (error) { previewError = error instanceof Error ? error.message : 'Prévisualisation indisponible.'; }
  }
  const changed = preview.filter(task => { const old = tasks.find(item => item.id === task.id); return old?.startDate !== task.startDate || old?.endDate !== task.endDate; });
  const successorPreview = preview.find(task => task.id === successorId) ?? successor;
  function field<K extends keyof TaskConstraint>(key: K, value: TaskConstraint[K]) { setSettings(current => ({ ...current, [key]: value })); setError(''); }
  async function save(event: FormEvent, remove = false) {
    event.preventDefault(); if (!editable || pending.current || !successor) return;
    const problem = remove ? null : dependencyProblem(tasks, predecessorId, successorId, true) ?? previewError;
    if (problem) { setError(problem); return; }
    if (!remove && (!Number.isInteger(settings.offset) || settings.offset < 0 || settings.offset > 36500)) { setError('Indiquez un décalage entier entre 0 et 36 500.'); return; }
    pending.current = true; setBusy(true); setError('');
    try {
      await props.mutate('tasks', 'PATCH', { dependsOnId: remove ? null : predecessorId, dependencyConstraint: remove ? null : settings }, successorId);
      props.notify(remove ? 'Contrainte supprimée.' : 'Contrainte enregistrée et planning mis à jour.'); onClose();
    } catch (error) { setError(error instanceof Error ? error.message : 'La contrainte n’a pas pu être enregistrée.'); }
    finally { pending.current = false; setBusy(false); }
  }
  function card(side: 'start' | 'end') {
    const task = side === 'start' ? successorPreview : predecessor;
    return <section className="tc-card"><h3>{side === 'start' ? 'Le début' : 'La fin'}</h3>
      <label className="form-field">{side === 'start' ? 'Élément suivant' : 'Élément précédent'}<select className="form-input" disabled={!editable || busy} value={side === 'start' ? successorId : predecessorId} onChange={event => {
        if (side === 'end') setPredecessor(event.target.value);
        else { const next = tasks.find(task => task.id === event.target.value); setSuccessor(event.target.value); setPredecessor(next?.dependsOnId ?? predecessorId); setSettings({ ...next?.dependencyConstraint ?? DEFAULT_TASK_CONSTRAINT }); }
        setError('');
      }}><option value="">Choisir un élément</option>{tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>
      <dl><div><dt>Début</dt><dd>{dateLabel(task?.startDate)}</dd></div><div><dt>Fin</dt><dd>{dateLabel(task?.endDate)}</dd></div></dl><span className="tc-mini-bar" aria-hidden="true" />
    </section>;
  }
  return <Modal title={previous ? 'Mettre à jour une contrainte fin → début' : 'Créer une contrainte fin → début'} label="Contrainte entre les tâches" className="tc-dialog" onClose={() => { if (!pending.current) onClose(); }}>
    <form onSubmit={event => void save(event)}><div className="modal-body">
      <div className="tc-grid">{card('start')}<fieldset className="tc-settings" disabled={!editable || busy}><legend>Commence</legend>
        <label className="sr-only" htmlFor="tc-mode">Relation temporelle</label><select id="tc-mode" className="form-input" value={settings.mode} onChange={event => field('mode', event.target.value as TaskConstraint['mode'])}><option value="exact">Exactement</option><option value="not_before">Au plus tôt</option><option value="not_after">Au plus tard</option></select>
        <div className="tc-offset"><label className="sr-only" htmlFor="tc-offset">Décalage</label><input id="tc-offset" className="form-input" type="number" min="0" max="36500" step="1" required value={Number.isFinite(settings.offset) ? settings.offset : ''} onChange={event => field('offset', event.target.value === '' ? NaN : Number(event.target.value))} />
          <label className="sr-only" htmlFor="tc-unit">Unité du décalage</label><select id="tc-unit" className="form-input" value={settings.unit} onChange={event => field('unit', event.target.value as TaskConstraint['unit'])}><option value="days">Jour(s)</option><option value="weeks">Semaine(s)</option></select>
          <label className="sr-only" htmlFor="tc-direction">Sens du décalage</label><select id="tc-direction" className="form-input" value={settings.direction} onChange={event => field('direction', event.target.value as TaskConstraint['direction'])}><option value="after">Après</option><option value="before">Avant</option></select>
        </div><label className="tc-auto"><input type="checkbox" checked={settings.automatic} onChange={event => field('automatic', event.target.checked)} />Replanifier automatiquement les éléments liés</label>
      </fieldset>{card('end')}</div>
      <p className="tc-help">Décalage en jours calendaires. Zéro jour après la fin correspond au lendemain. Les déplacements conservent la durée des autres éléments ; les règles du calendrier de travail de la Planzone s’appliquent.</p>
      {previous && previous.id !== predecessorId && <p className="notice">Prédécesseur enregistré : <strong>{previous.title}</strong> — ce lien sera remplacé à l’enregistrement.</p>}
      {previous && !successor?.dependencyConstraint && editable && <p className="tc-help">Enregistrer ces paramètres active la contrainte de planning sur cette ancienne dépendance.</p>}
      {((successor?.kind !== 'milestone' && !successor?.startDate) || !successor?.endDate || !predecessor?.endDate) && settings.automatic && successor && predecessor && <p className="notice">La replanification attend les dates nécessaires. Les éléments sans durée définie ne sont pas déplacés.</p>}
      {changed.length > 0 && <p className="tc-preview" role="status">{changed.length} élément{changed.length > 1 ? 's seront replanifiés' : ' sera replanifié'} à l’enregistrement.</p>}
      {!editable && <p className="notice">Cette contrainte est consultable en lecture seule.</p>}
      {error && <p role="alert" className="form-error">{error}</p>}
    </div><div className="modal-footer pzg-constraint-footer">{previous && <button type="button" className="button tc-delete" disabled={!editable || busy} onClick={event => void save(event, true)}>Supprimer la contrainte</button>}<div className="modal-footer-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>{editable ? 'Annuler' : 'Fermer'}</button>{editable && <button className="button button-primary" type="submit" disabled={busy || !predecessorId || !successorId}>{busy ? 'Enregistrement…' : 'Enregistrer la contrainte'}</button>}</div></div></form>
  </Modal>;
}
