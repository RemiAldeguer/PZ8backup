import { useEffect, useRef, useState, type FormEvent, type PointerEvent, type RefObject } from 'react';
import { preferenceGanttPatch } from '../shared/planning-preferences';
import { planzonePreferences } from '../shared/planzone-preferences';
import { canProject } from '../shared/permissions';
import { GANTT_DAY, ganttStamp, type GanttRange, type ProjectGanttRow } from '../shared/project-gantt';
import { ganttDurationDays, type GanttDatePart, type GanttDatePatch, type GanttDateRecord } from '../shared/gantt-dates';
import type { ViewProps } from '../shared/types';
import { formatDate } from '../shared/domain';
import { Modal } from './Dialogs';

export interface DatePreview { record: GanttDateRecord; patch: GanttDatePatch; range: GanttRange; trackWidth: number; x: number; y: number; }
interface DateDrag { record: GanttDateRecord; part: GanttDatePart; pointerId: number; originX: number; scrollLeft: number; x: number; y: number; moved: boolean; range: GanttRange; trackWidth: number; }
const recordFrom = (row: ProjectGanttRow, projectId: string): GanttDateRecord | null => row.task ? { id: row.task.id, kind: row.task.kind, startDate: row.startDate, endDate: row.endDate } : row.kind === 'project' ? { id: row.projectId ?? (row.id.startsWith('project:') ? row.id.slice('project:'.length) : projectId), kind: 'project', startDate: row.startDate, endDate: row.endDate } : null;

export function useGanttDates({ props, range, trackWidth, labelWidth, scroll, blocked, onStart }: { props: ViewProps; range: GanttRange; trackWidth: number; labelWidth: number; scroll: RefObject<HTMLDivElement | null>; blocked: boolean; onStart: () => void }) {
  const [preview, setPreview] = useState<DatePreview | null>(null); const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<GanttDateRecord | null>(null);
  const drag = useRef<DateDrag | null>(null); const pending = useRef(false); const swallowed = useRef(false); const frame = useRef(0);
  const currentPreview = useRef<DatePreview | null>(null); const cancelled = useRef(false);
  const allowed = (record: GanttDateRecord) => {
    const projectId = record.kind === 'project' ? record.id : props.data.tasks.find(task => task.id === record.id)?.projectId;
    const project = props.data.projects.find(project => project.id === projectId);
    const task = props.data.tasks.find(item => item.id === record.id);
    return !!project && !['paused', 'closed'].includes(project.status) && canProject(props.data, project.id, record.kind === 'project' ? 'details' : record.kind === 'milestone' ? 'milestoneEdit' : 'taskEdit') && (record.kind !== 'task' || !planzonePreferences(props.data).linkAllocationToDuration || canProject(props.data, project.id, 'ownAllocation', task));
  };
  function show(value: DatePreview | null) { currentPreview.current = value; setPreview(value); }
  function stopFrame() { if (frame.current) cancelAnimationFrame(frame.current); frame.current = 0; }
  function cancel() { if (!drag.current) return; cancelled.current = true; drag.current = null; stopFrame(); show(null); }
  useEffect(() => { const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); }; window.addEventListener('keydown', escape); return () => { window.removeEventListener('keydown', escape); stopFrame(); }; }, []);
  useEffect(() => { if (drag.current && !allowed(drag.current.record)) cancel(); }, [props.data.currentUser.role, props.data.projects, props.data.permissionPolicies]);
  function calculate(active: DateDrag) {
    const pixels = active.x - active.originX + (scroll.current?.scrollLeft ?? active.scrollLeft) - active.scrollLeft;
    const delta = pixels / active.trackWidth * (active.range.end - active.range.start) / GANTT_DAY;
    const patch = preferenceGanttPatch(props.data, active.record, active.part, delta);
    if (patch) show({ record: active.record, patch, range: active.range, trackWidth: active.trackWidth, x: active.x, y: active.y });
  }
  function pan() {
    frame.current = 0; const active = drag.current; const container = scroll.current;
    if (!active?.moved || !container) return;
    const rect = container.getBoundingClientRect(); const left = rect.left + labelWidth; const right = rect.right;
    const speed = active.x < left + 22 ? -12 : active.x > right - 22 ? 12 : 0;
    if (speed) { const before = container.scrollLeft; container.scrollLeft += speed; if (container.scrollLeft !== before) calculate(active); }
    frame.current = requestAnimationFrame(pan);
  }
  async function commit(record: GanttDateRecord, patch: GanttDatePatch) {
    if (pending.current || !allowed(record)) { show(null); return; }
    if (patch.startDate === record.startDate && patch.endDate === record.endDate) { show(null); setEditor(null); return; }
    pending.current = true; setBusy(true);
    try { await props.mutate(record.kind === 'project' ? 'projects' : 'tasks', 'PATCH', patch, record.id); props.notify('Dates du planning enregistrées.'); setEditor(null); }
    catch (error) { props.notify(error instanceof Error ? error.message : 'Les dates n’ont pas pu être enregistrées.'); }
    finally { pending.current = false; setBusy(false); show(null); }
  }
  function begin(event: PointerEvent<HTMLButtonElement>, row: ProjectGanttRow, part: GanttDatePart) {
    const record = recordFrom(row, props.project.id);
    if (!record || !allowed(record) || blocked || pending.current || drag.current || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); onStart(); cancelled.current = false;
    drag.current = { record, part, pointerId: event.pointerId, originX: event.clientX, scrollLeft: scroll.current?.scrollLeft ?? 0, x: event.clientX, y: event.clientY, moved: false, range, trackWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current; if (!active || event.pointerId !== active.pointerId) return;
    active.x = event.clientX; active.y = event.clientY;
    if (Math.abs(active.x - active.originX) >= 4) active.moved = true;
    if (active.moved) { calculate(active); if (!frame.current) frame.current = requestAnimationFrame(pan); }
  }
  function finish(event: PointerEvent<HTMLButtonElement>, openOnClick: boolean) {
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (cancelled.current) { cancelled.current = false; swallowed.current = true; window.setTimeout(() => { swallowed.current = false; }, 0); return; }
    const active = drag.current; if (!active || event.pointerId !== active.pointerId) return;
    drag.current = null; stopFrame();
    if (active.moved) { swallowed.current = true; const draft = currentPreview.current; if (draft) void commit(active.record, draft.patch); else show(null); }
    else if (openOnClick) { swallowed.current = true; setEditor(active.record); }
    window.setTimeout(() => { swallowed.current = false; }, 0);
  }
  function handles(row: ProjectGanttRow) {
    const record = recordFrom(row, props.project.id);
    if (!record || !allowed(record) || blocked) return null;
    const a = row.startDate ?? row.endDate; const b = row.endDate ?? row.startDate;
    const parts: GanttDatePart[] = record.kind === 'milestone' ? ['move'] : ['start', 'end'];
    return parts.filter(part => drag.current?.record.id === record.id && drag.current.part === part || part === 'move' || (part === 'start' ? !!a && ganttStamp(a) >= range.start : !!b && ganttStamp(b) + GANTT_DAY <= range.end)).map(part => {
      const label = `${part === 'start' ? 'Modifier le début de' : part === 'end' ? 'Modifier la fin de' : 'Déplacer la date de'} ${row.name}`;
      return <button type="button" key={part} className={`pzg-date-handle pzg-date-${part}`} aria-label={label} title={`${label} · Glisser, ou flèches du clavier (Maj : 7 jours)`} disabled={busy} onPointerDown={event => begin(event, row, part)} onPointerMove={move} onPointerUp={event => finish(event, true)} onPointerCancel={() => { cancel(); cancelled.current = false; }} onClick={event => { event.stopPropagation(); if (!swallowed.current) setEditor(record); }} onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || busy || drag.current) return;
        event.preventDefault(); event.stopPropagation(); const patch = preferenceGanttPatch(props.data, record, part, (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 7 : 1)); if (patch) void commit(record, patch);
      }}><span aria-hidden="true">{part === 'move' ? '↔' : '⋮'}</span></button>;
    });
  }
  function barProps(row: ProjectGanttRow, enabled: boolean) {
    const record = recordFrom(row, props.project.id); if (!enabled || !row.task || !record || !allowed(record)) return {};
    return { onPointerDown: (event: PointerEvent<HTMLButtonElement>) => begin(event, row, 'move'), onPointerMove: move, onPointerUp: (event: PointerEvent<HTMLButtonElement>) => finish(event, false), onPointerCancel: () => { cancel(); cancelled.current = false; }, 'data-date-draggable': true };
  }
  return { preview, busy, active: !!preview, handles, barProps, consumeClick: () => swallowed.current, modal: editor && <DateEditor key={`${editor.kind}:${editor.id}`} record={editor} name={editor.kind === 'project' ? props.data.projects.find(project => project.id === editor.id)?.name ?? '' : props.data.tasks.find(task => task.id === editor.id)?.title ?? ''} editable={allowed(editor)} busy={busy} onSave={patch => commit(editor, patch)} onClose={() => { if (!pending.current) setEditor(null); }} /> };
}

function DateEditor({ record, name, editable, busy, onSave, onClose }: { record: GanttDateRecord; name: string; editable: boolean; busy: boolean; onSave: (patch: GanttDatePatch) => Promise<void>; onClose: () => void }) {
  const [start, setStart] = useState(record.startDate ?? record.endDate ?? ''); const [end, setEnd] = useState(record.endDate ?? record.startDate ?? ''); const [error, setError] = useState('');
  async function save(event: FormEvent) { event.preventDefault(); if (!editable || busy) return; if (!start || !end || start > end) { setError('La fin doit suivre ou égaler le début.'); return; } await onSave(record.kind === 'milestone' ? { startDate: record.startDate ? end : null, endDate: record.endDate ? end : null } : { startDate: start, endDate: end }); }
  return <Modal title="Modifier les dates du Gantt" onClose={onClose}><form onSubmit={event => void save(event)}><div className="modal-body pzg-date-form"><strong>{name}</strong><fieldset disabled={!editable || busy}>{record.kind === 'milestone' ? <label className="form-field">Date du jalon<input type="date" className="form-input" value={end} required onChange={event => { setStart(event.target.value); setEnd(event.target.value); }} /></label> : <><label className="form-field">Date de début<input type="date" className="form-input" value={start} required onChange={event => setStart(event.target.value)} /></label><label className="form-field">Date de fin<input type="date" className="form-input" value={end} min={start} required onChange={event => setEnd(event.target.value)} /></label></>}</fieldset>{error && <p role="alert" className="form-error">{error}</p>}</div><div className="modal-footer"><button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>Annuler</button><button type="submit" className="button button-primary" disabled={!editable || busy}>{busy ? 'Enregistrement…' : 'Enregistrer les dates'}</button></div></form></Modal>;
}

export function GanttDatePreview({ preview, relatedCount = 0 }: { preview: DatePreview; relatedCount?: number }) {
  const duration = ganttDurationDays(preview.patch);
  return <div className="pzg-date-preview" role="status" style={{ left: Math.max(8, Math.min(window.innerWidth - 270, preview.x - 80)), top: Math.max(8, preview.y - 64) }}><strong>{formatDate(preview.patch.startDate ?? preview.patch.endDate)} — {formatDate(preview.patch.endDate ?? preview.patch.startDate)}</strong>{preview.record.kind !== 'milestone' && <span>{duration} jour{duration !== 1 ? 's' : ''}</span>}{relatedCount > 0 && <span>+ {relatedCount} élément{relatedCount > 1 ? 's' : ''} lié{relatedCount > 1 ? 's' : ''} replanifié{relatedCount > 1 ? 's' : ''}</span>}</div>;
}
