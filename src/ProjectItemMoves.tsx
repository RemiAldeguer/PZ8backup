import { canProject } from '../shared/permissions';
import { useEffect, useRef, useState, type DragEvent, type FormEvent, type MouseEvent, type PointerEvent } from 'react';
import { CornerDownRight, GripVertical } from 'lucide-react';
import type { ViewProps } from '../shared/types';
import { planProjectItemMove, projectItemKey, taskListNodeReference, type ProjectItemMove, type ProjectItemPlacement, type ProjectItemReference, type ProjectItemTarget } from '../shared/project-item-moves';
import { projectTaskListPath, type ProjectTaskListTree } from '../shared/task-lists';
import { Modal } from './Dialogs';

type Destination = { target: ProjectItemTarget; placement: ProjectItemPlacement; label: string };
function message(error: unknown) { return error instanceof Error ? error.message : 'Le déplacement a échoué. Réessayez.'; }

function MoveDialog({ props, source, title, tree, nestOnly = false, onClose, onMoved }: {
  props: ViewProps; source: ProjectItemReference; title: string; tree: ProjectTaskListTree; nestOnly?: boolean; onClose: () => void; onMoved: () => void;
}) {
  const [targetKey, setTargetKey] = useState(nestOnly ? '' : 'root');
  const [placement, setPlacement] = useState<ProjectItemPlacement>('inside');
  const [busy, setBusy] = useState(false); const pending = useRef(false); const [error, setError] = useState('');
  const locked = props.project.status === 'closed' || props.project.status === 'paused';
  const targets: { value: string; ref: ProjectItemTarget; label: string }[] = nestOnly ? [] : [{ value: 'root', ref: { type: 'root' }, label: 'Projet (racine)' }];
  for (const node of tree.nodes.values()) {
    const ref = taskListNodeReference(node);
    const path = node.kind === 'list' ? projectTaskListPath(props.data.taskLists ?? [], props.project.id, node.id).map(list => list.name).join(' / ') : node.name;
    targets.push({ value: projectItemKey(ref), ref, label: `Liste : ${path}` });
  }
  if (!nestOnly) for (const task of tree.tasks) targets.push({ value: `task:${task.id}`, ref: { type: 'task', id: task.id }, label: `${task.kind === 'milestone' ? 'Jalon' : 'Tâche'} : ${task.title}` });
  const allowed = targets.filter(item => {
    try {
      planProjectItemMove(props.data, { projectId: props.project.id, source, target: item.ref, placement: item.ref.type === 'task' ? 'before' : 'inside' }, () => crypto.randomUUID());
      return true;
    } catch { return false; }
  });
  const target = allowed.find(item => item.value === targetKey)?.ref;
  const close = () => { if (!pending.current) onClose(); };
  async function save(event: FormEvent) {
    event.preventDefault(); if (pending.current || locked || !target) return;
    pending.current = true; setBusy(true); setError('');
    try {
      await props.mutate('project-item-moves', 'POST', { projectId: props.project.id, source, target, placement: nestOnly ? 'inside' : placement });
      props.notify(nestOnly ? 'Liste imbriquée.' : 'Élément déplacé.'); onMoved(); onClose();
    } catch (error) { setError(message(error)); }
    finally { pending.current = false; setBusy(false); }
  }
  return <Modal title={nestOnly ? 'Imbriquer la liste' : 'Déplacer l’élément'} onClose={close}><form onSubmit={event => void save(event)}><fieldset className="nlv-list-form" disabled={busy || locked}><div className="modal-body"><p><strong>{title}</strong></p>
    {nestOnly && <p>Cette liste, ses sous-listes et leurs tâches seront placées dans la liste choisie.</p>}
    <label className="form-field">{nestOnly ? 'Liste de destination' : 'Destination'}<select className="form-input" value={targetKey} onChange={event => { setTargetKey(event.target.value); const next = allowed.find(item => item.value === event.target.value)?.ref; setPlacement(next?.type === 'root' ? 'inside' : next?.type === 'task' && placement === 'inside' ? 'after' : placement); }}>{nestOnly && <option value="" disabled>Choisir une liste</option>}{allowed.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
    {nestOnly && !allowed.length && <p className="nlv-editor-note">Créez une autre liste dans ce projet pour pouvoir y placer celle-ci.</p>}
    {!nestOnly && <label className="form-field">Emplacement<select className="form-input" value={placement} onChange={event => setPlacement(event.target.value as ProjectItemPlacement)}>{target?.type !== 'root' && <option value="before">Avant</option>}{target?.type !== 'task' && <option value="inside">{target?.type === 'root' ? 'À la fin du projet' : 'Dans la liste'}</option>}{target?.type !== 'root' && <option value="after">Après</option>}</select></label>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div><div className="modal-footer"><button type="button" className="button button-secondary" onClick={close}>Annuler</button><button type="submit" className="button button-primary" disabled={!target}>{busy ? 'Déplacement…' : nestOnly ? 'Imbriquer' : 'Déplacer'}</button></div></fieldset></form></Modal>;
}

export function useProjectItemMoves(props: ViewProps, tree: ProjectTaskListTree, manualOrder: boolean, onMoved: () => void) {
  const [source, setSource] = useState<ProjectItemReference | null>(null);
  const active = useRef<ProjectItemReference | null>(null);
  const [drop, setDrop] = useState<Destination | null>(null);
  const [moving, setMoving] = useState(false); const pending = useRef(false);
  const [editor, setEditor] = useState<{ source: ProjectItemReference; title: string; nestOnly?: boolean } | null>(null);
  const validCache = useRef(new Map<string, boolean>());
  const gesture = useRef<{ id: number; x: number; y: number; source: ProjectItemReference; active: boolean } | null>(null);
  const suppressClick = useRef(false);
  const locked = props.project.status === 'closed' || props.project.status === 'paused';
  const disabled = locked || moving;
  const canDrag = !disabled;
  const canMove = (ref: ProjectItemReference) => canProject(props.data, props.project.id, ref.type === 'task' ? props.data.tasks.find(task => task.id === ref.id)?.kind === 'milestone' ? 'milestoneEdit' : 'taskEdit' : 'listEdit');
  useEffect(() => {
    const cancel = () => { if (gesture.current?.active) suppressClick.current = true; clear(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && gesture.current) { event.preventDefault(); cancel(); } };
    window.addEventListener('blur', cancel); document.addEventListener('keydown', escape);
    return () => { window.removeEventListener('blur', cancel); document.removeEventListener('keydown', escape); };
  }, []);
  useEffect(() => { clear(); }, [props.project.id, locked]);
  const refs = new Map<string, { ref: ProjectItemTarget; label: string }>([['root', { ref: { type: 'root' }, label: 'le projet' }]]);
  for (const node of tree.nodes.values()) { const ref = taskListNodeReference(node); refs.set(projectItemKey(ref), { ref, label: `la liste ${node.name}` }); }
  for (const task of tree.tasks) refs.set(`task:${task.id}`, { ref: { type: 'task', id: task.id }, label: task.title });
  function clear() { active.current = null; setSource(null); setDrop(null); gesture.current = null; }
  function start(ref: ProjectItemReference) { if (!canDrag || !canMove(ref)) return; validCache.current.clear(); active.current = ref; setSource(ref); }
  function destination(ref: ProjectItemTarget, placement: ProjectItemPlacement): Destination | null {
    const selected = active.current; if (!selected || !canDrag) return null;
    const key = `${projectItemKey(selected)}|${projectItemKey(ref)}|${placement}`;
    let valid = validCache.current.get(key);
    if (valid === undefined) {
      try { planProjectItemMove(props.data, { projectId: props.project.id, source: selected, target: ref, placement }, () => crypto.randomUUID()); valid = true; }
      catch { valid = false; }
      validCache.current.set(key, valid);
    }
    return valid ? { target: ref, placement, label: `${placement === 'before' ? 'Avant' : placement === 'after' ? 'Après' : 'Dans'} ${refs.get(projectItemKey(ref))?.label ?? 'la liste'}` } : null;
  }
  function show(next: Destination | null) { setDrop(old => old?.label === next?.label && old?.placement === next?.placement && old && next && projectItemKey(old.target) === projectItemKey(next.target) ? old : next); }
  function placementAt(ref: ProjectItemTarget, y: number, rect: DOMRect): ProjectItemPlacement {
    const fraction = (y - rect.top) / Math.max(rect.height, 1);
    return ref.type === 'task' ? fraction < .5 ? 'before' : 'after' : fraction < .25 ? 'before' : fraction > .75 ? 'after' : 'inside';
  }
  async function save(selected: ProjectItemReference, next: Destination) {
    if (pending.current || locked || !canMove(selected)) return;
    pending.current = true; setMoving(true); clear();
    try {
      await props.mutate('project-item-moves', 'POST', { projectId: props.project.id, source: selected, target: next.target, placement: next.placement } satisfies ProjectItemMove);
      props.notify('Élément déplacé.'); onMoved();
    } catch (error) { props.notify(message(error)); }
    finally { pending.current = false; setMoving(false); }
  }
  function destinationAt(x: number, y: number) {
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-key]');
    const target = element && refs.get(element.dataset.dropKey ?? '')?.ref;
    return element && target ? destination(target, target.type === 'root' ? 'inside' : placementAt(target, y, element.getBoundingClientRect())) : null;
  }
  function pointerMove(event: PointerEvent<HTMLElement>) {
    const candidate = gesture.current; if (!candidate || candidate.id !== event.pointerId) return;
    if (!candidate.active && Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y) < (event.pointerType === 'touch' ? 8 : 4)) return;
    if (!candidate.active) { candidate.active = true; start(candidate.source); }
    event.preventDefault();
    show(destinationAt(event.clientX, event.clientY));
    const scroll = document.querySelector<HTMLElement>('.nlv-table-scroll');
    if (scroll) { const rect = scroll.getBoundingClientRect(); scroll.scrollBy(event.clientX > rect.right - 30 ? 12 : event.clientX < rect.left + 30 ? -12 : 0, 0); }
    if (event.clientY > window.innerHeight - 50) window.scrollBy(0, 16);
    else if (event.clientY < 50) window.scrollBy(0, -16);
  }
  function dragProps(ref: ProjectItemReference) {
    return {
      draggable: false,
      'data-drag-enabled': canDrag && canMove(ref),
      onDragStart: (event: DragEvent<HTMLElement>) => event.preventDefault(),
      onClickCapture: (event: MouseEvent<HTMLElement>) => { if (suppressClick.current && event.detail > 0) { event.preventDefault(); event.stopPropagation(); } suppressClick.current = false; },
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (event.button !== 0 || !event.isPrimary || !canDrag || !canMove(ref) || gesture.current) return;
        suppressClick.current = false;
        event.currentTarget.setPointerCapture(event.pointerId);
        gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, source: ref, active: false };
      },
      onPointerMove: pointerMove,
      onPointerCancel: clear,
      onLostPointerCapture: () => { if (gesture.current) { if (gesture.current.active) suppressClick.current = true; clear(); } },
      onPointerUp: (event: PointerEvent<HTMLElement>) => {
        const candidate = gesture.current; if (!candidate || candidate.id !== event.pointerId) return;
        if (candidate.active) {
          suppressClick.current = true; event.preventDefault();
          const next = destinationAt(event.clientX, event.clientY);
          if (next) void save(candidate.source, next); else clear();
        } else gesture.current = null;
      },
    };
  }
  function handle(ref: ProjectItemReference, title: string) {
    return <button type="button" className="nlv-drag-handle" aria-label={`Déplacer ${ref.type === 'task' ? 'la tâche' : 'la liste'} ${title}`} title={manualOrder ? 'Glisser pour déplacer, ou cliquer pour choisir une destination' : 'Glisser pour déplacer et revenir à l’ordre manuel, ou cliquer pour choisir une destination'} disabled={disabled} {...dragProps(ref)}
      onClick={() => { if (!disabled) setEditor({ source: ref, title }); }}
    ><GripVertical size={15} aria-hidden="true" /></button>;
  }
  function dropProps(ref: ProjectItemTarget) {
    return { 'data-drop-key': projectItemKey(ref) };
  }
  function nest(ref: ProjectItemReference, title: string) {
    return <button type="button" className="nlv-nest-action" aria-label={`Imbriquer la liste ${title}`} title="Mettre cette liste dans une autre liste" disabled={disabled} onClick={() => setEditor({ source: ref, title, nestOnly: true })}><CornerDownRight size={14} aria-hidden="true" />Imbriquer</button>;
  }
  const rowClass = (ref: ProjectItemTarget) => `${source && projectItemKey(source) === projectItemKey(ref) ? ' nlv-dragging' : ''}${drop && projectItemKey(drop.target) === projectItemKey(ref) ? ` nlv-drop-${drop.placement}` : ''}`;
  return { moving, source, drop, handle, nest, dragProps, dropProps, rowClass, dialog: editor ? <MoveDialog props={props} tree={tree} {...editor} onClose={() => setEditor(null)} onMoved={onMoved} /> : null };
}
