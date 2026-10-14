import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsDown, ChevronsUp, Flag, Folder, Link2, List, Minus, Pencil, Plus, Search, Settings2, X } from 'lucide-react';
import { STATUS_LABELS, TASK_STATUSES, type Task, type ViewProps } from '../shared/types';
import { formatDate, formatHours, isLate } from '../shared/domain';
import { canProject } from '../shared/permissions';
import { buildProjectTaskListTree, type TaskListNode } from '../shared/task-lists';
import { dependencyProblem, ganttBarRange, ganttStamp, ganttTicks, GANTT_DAY, projectGanttRange, projectGanttRows, type GanttScale, type ProjectGanttRow } from '../shared/project-gantt';
import { CreateMenu, TaskListDialog, type ListEditorState, type MenuAction } from './NestedListView';
import { Modal } from './Dialogs';
import { TaskCheck } from './TaskCheck';
import { useGanttDates, GanttDatePreview } from './GanttDates';
import { GanttColumnsDialog, GanttDetailValue } from './GanttColumns';
import { availableGanttColumns, ganttColumnStorageKey, normalizeGanttColumns, readGanttColumns, type GanttColumnPreferences } from '../shared/gantt-columns';
import './project-gantt.css';

const ROW_HEIGHT = 44;
const dateLabel = (date: string | null) => date ? formatDate(date) : '—';
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'La contrainte n’a pas pu être enregistrée.';
interface ConstraintEditor { successorId?: string; predecessorId?: string; }

function ConstraintDialog({ props, initial, onClose }: { props: ViewProps; initial: ConstraintEditor; onClose: () => void }) {
  const tasks = props.data.tasks.filter(task => task.projectId === props.project.id);
  const [successorId, setSuccessor] = useState(initial.successorId ?? '');
  const [predecessorId, setPredecessor] = useState(initial.predecessorId ?? tasks.find(task => task.id === initial.successorId)?.dependsOnId ?? '');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const pending = useRef(false);
  const editable = !['paused', 'closed'].includes(props.project.status) && canProject(props.data, props.project.id, 'details');
  const successor = tasks.find(task => task.id === successorId);
  const previous = tasks.find(task => task.id === successor?.dependsOnId);
  async function save(event: FormEvent, remove = false) {
    event.preventDefault(); if (!editable || pending.current || !successor) return;
    const problem = !remove ? dependencyProblem(tasks, predecessorId, successorId) : null;
    if (problem) { setError(problem); return; }
    pending.current = true; setBusy(true); setError('');
    try { await props.mutate('tasks', 'PATCH', { dependsOnId: remove ? null : predecessorId }, successorId); props.notify(remove ? 'Contrainte supprimée.' : 'Contrainte enregistrée.'); onClose(); }
    catch (error) { setError(errorMessage(error)); }
    finally { pending.current = false; setBusy(false); }
  }
  return <Modal title="Contrainte entre les tâches" onClose={() => { if (!pending.current) onClose(); }}><form onSubmit={event => void save(event)}>
    <div className="modal-body pzg-constraint-form"><p><strong>Fin → début</strong> : le prédécesseur doit être terminé avant de démarrer l’élément suivant. Les dates planifiées restent celles définies dans les tâches.</p>
      <label className="form-field">Élément précédent<select className="form-input" aria-label="Élément précédent" disabled={!editable || busy} value={predecessorId} onChange={event => { setPredecessor(event.target.value); setError(''); }}><option value="">Choisir le prédécesseur</option>{tasks.filter(task => task.id !== successorId).map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>
      <label className="form-field">Élément suivant<select className="form-input" aria-label="Élément suivant" disabled={!editable || busy} value={successorId} onChange={event => { const task = tasks.find(task => task.id === event.target.value); setSuccessor(event.target.value); setPredecessor(task?.dependsOnId ?? predecessorId); setError(''); }}><option value="">Choisir la tâche ou le jalon suivant</option>{tasks.filter(task => task.id !== predecessorId || task.id === successorId).map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>
      {previous && <p className="pzg-constraint-current">Prédécesseur enregistré : <strong>{previous.title}</strong>{previous.id !== predecessorId && ' — ce lien sera remplacé à l’enregistrement.'}</p>}
      {!editable && <p className="notice">Cette contrainte est consultable en lecture seule.</p>}
      {error && <p role="alert" className="form-error">{error}</p>}
    </div><div className="modal-footer pzg-constraint-footer">{previous && <button type="button" className="text-button text-danger" disabled={!editable || busy} onClick={event => void save(event, true)}>Supprimer la contrainte</button>}<div className="modal-footer-actions"><button className="button button-secondary" type="button" disabled={busy} onClick={onClose}>{editable ? 'Annuler' : 'Fermer'}</button>{editable && <button className="button button-primary" type="submit" disabled={busy || !predecessorId || !successorId}>{busy ? 'Enregistrement…' : 'Enregistrer la contrainte'}</button>}</div></div>
  </form></Modal>;
}

interface Gesture { pointerId: number; source: string; x: number; y: number; moved: boolean; target?: string; }
export function ProjectGanttView(props: ViewProps) {
  return <ProjectGanttCanvas key={ganttColumnStorageKey(props.data.currentUser.id, props.project.id)} {...props} />;
}
function ProjectGanttCanvas(props: ViewProps) {
  const { data, project } = props;
  const [query, setQuery] = useState(''); const [sort, setSort] = useState('none');
  const [resourceId, setResourceId] = useState('all'); const [status, setStatus] = useState('all'); const [kind, setKind] = useState('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const columnKey = ganttColumnStorageKey(data.currentUser.id, project.id);
  const columns = availableGanttColumns(data.customFieldDefinitions ?? []);
  const [savedColumns, setSavedColumns] = useState(() => readGanttColumns(columnKey, columns));
  const preferences = normalizeGanttColumns(savedColumns, columns);
  const visibleColumns = preferences.order.filter(id => !preferences.hidden.includes(id)).map(id => columns.find(column => column.id === id)!);
  const [columnEditor, setColumnEditor] = useState(false); const [detailOffset, setDetailOffset] = useState(0);
  const detailScroll = useRef<HTMLDivElement>(null);
  const [details, setDetails] = useState(() => { try { return localStorage.getItem(columnKey + ':open') === 'true'; } catch { return false; } }); const [charges, setCharges] = useState(false); const [late, setLate] = useState(true); const [links, setLinks] = useState(true); const [linkMode, setLinkMode] = useState(false);
  const [scale, setScale] = useState<GanttScale>('project'); const [anchor, setAnchor] = useState(project.startDate); const [offset, setOffset] = useState(0); const [zoom, setZoom] = useState(1);
  const [listEditor, setListEditor] = useState<ListEditorState | null>(null); const [constraint, setConstraint] = useState<ConstraintEditor | null>(null);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 700px)').matches);
  const [sourceId, setSource] = useState<string | null>(null); const [saving, setSaving] = useState(false); const pending = useRef(false);
  const gesture = useRef<Gesture | null>(null); const suppressClick = useRef(false); const cancelledGesture = useRef(false);
  const [preview, setPreview] = useState<{ x: number; y: number; endX: number; endY: number; target?: string } | null>(null);
  const scroll = useRef<HTMLDivElement>(null); const todayRequest = useRef(false); const mobileInitialized = useRef(false); const marker = useId().replace(/:/g, '');
  const rawTasks = data.tasks.filter(task => task.projectId === project.id);
  const baseRange = projectGanttRange(project, rawTasks, scale, anchor, offset);
  const baseDays = (baseRange.end - baseRange.start) / GANTT_DAY;
  const baseTrackWidth = Math.round((scale === 'month' ? 950 : scale === 'quarter' ? 1150 : scale === 'year' ? 1400 : Math.min(2500, Math.max(950, baseDays * 5))) * zoom);
  const nameWidth = mobile ? details ? 200 : 240 : 430;
  const labelWidth = details ? mobile ? 340 : 820 : nameWidth;
  const dates = useGanttDates({ props, range: baseRange, trackWidth: baseTrackWidth, labelWidth, scroll, blocked: saving || linkMode || !!sourceId, onStart: () => { setSource(null); setLinkMode(false); gesture.current = null; setPreview(null); } });
  const visualData = dates.preview?.record.kind === 'project' ? { ...data, projects: data.projects.map(item => item.id === project.id ? { ...item, ...dates.preview!.patch, startDate: dates.preview!.patch.startDate!, endDate: dates.preview!.patch.endDate! } : item) }
    : dates.preview ? { ...data, tasks: data.tasks.map(task => task.id === dates.preview!.record.id ? { ...task, ...dates.preview!.patch } : task) } : data;
  const visualProject = visualData.projects.find(item => item.id === project.id)!;
  const tasks = visualData.tasks.filter(task => task.projectId === project.id);
  const sortTasks = sort === 'title' ? (a: Task, b: Task) => a.title.localeCompare(b.title, 'fr', { numeric: true }) : sort === 'date' ? (a: Task, b: Task) => (a.endDate ?? '9999').localeCompare(b.endDate ?? '9999') : undefined;
  const tree = buildProjectTaskListTree(visualData, project.id, { search: query, sortTasks: dates.preview && sort === 'date' ? (a, b) => (rawTasks.find(task => task.id === a.id)?.endDate ?? '9999').localeCompare(rawTasks.find(task => task.id === b.id)?.endDate ?? '9999') : sortTasks,
    ...(sort === 'title' ? { sortLists: (a: TaskListNode, b: TaskListNode) => a.name.localeCompare(b.name, 'fr', { numeric: true }) } : {}),
    ...(status !== 'all' || resourceId !== 'all' || kind !== 'all' ? { matchesTask: (task: Task) => (status === 'all' || task.status === status) && (resourceId === 'all' || (resourceId === 'none' ? !task.assigneeId : task.assigneeId === resourceId)) && (kind === 'all' || task.kind === kind) } : {}),
  });
  const fullTree = buildProjectTaskListTree(data, project.id);
  const rows = projectGanttRows(visualProject, tree, collapsed, sort === 'none');
  const range = dates.preview?.range ?? baseRange;
  const trackWidth = dates.preview?.trackWidth ?? baseTrackWidth;
  const majorTicks = ganttTicks(range, true); const minorTicks = ganttTicks(range, false);
  const todayPosition = (ganttStamp(data.today) - range.start) / (range.end - range.start);
  const locked = ['paused', 'closed'].includes(project.status); const editable = !locked && canProject(data, project.id, 'details');
  const visibleTaskRows = new Map(rows.flatMap((row, index) => row.task ? [[row.task.id, { row, index, bar: ganttBarRange(row, range) }] as const] : []));
  const visibleEdges = tasks.flatMap(task => {
    if (!task.dependsOnId) return [];
    const from = visibleTaskRows.get(task.dependsOnId); const to = visibleTaskRows.get(task.id);
    return from?.bar && to?.bar ? [{ task, from, to }] : [];
  });
  const hiddenEdges = tasks.filter(task => task.dependsOnId).length - visibleEdges.length;
  useEffect(() => { const media = window.matchMedia('(max-width: 700px)'); const update = () => setMobile(media.matches); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
  useEffect(() => {
    if (!mobile) { mobileInitialized.current = false; return; }
    if (mobileInitialized.current || !scroll.current) return;
    const focus = todayPosition >= 0 && todayPosition < 1 ? todayPosition : Math.max(0, (ganttStamp(tasks.find(task => task.startDate || task.endDate)?.startDate ?? tasks.find(task => task.startDate || task.endDate)?.endDate ?? project.startDate) - range.start) / (range.end - range.start));
    scroll.current.scrollLeft = Math.max(0, focus * trackWidth - (scroll.current.clientWidth - labelWidth) / 2);
    mobileInitialized.current = true;
  }, [mobile, range.start, range.end, trackWidth, labelWidth, todayPosition, project.startDate]);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') { if (gesture.current) cancelledGesture.current = true; gesture.current = null; setPreview(null); setSource(null); setLinkMode(false); } };
    window.addEventListener('keydown', cancel); return () => window.removeEventListener('keydown', cancel);
  }, []);
  useEffect(() => { if (!editable) { gesture.current = null; setSource(null); setPreview(null); } }, [editable]);
  useEffect(() => {
    if (todayRequest.current && scroll.current) { scroll.current.scrollLeft = Math.max(0, todayPosition * trackWidth - (scroll.current.clientWidth - labelWidth) / 2); todayRequest.current = false; }
  }, [range.start, range.end, trackWidth, labelWidth, todayPosition]);
  const toggle = (id: string) => setCollapsed(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const resetFilters = () => { setQuery(''); setSort('none'); setResourceId('all'); setStatus('all'); setKind('all'); setCollapsed(new Set()); setSource(null); };
  const createActions = (node?: TaskListNode): MenuAction[] => [
    { label: 'Tâche', icon: <Plus size={16} />, action: () => props.createTask({ kind: 'task', listId: node?.kind === 'list' ? node.id : null, phase: node?.name ?? '' }) },
    { label: 'Jalon', icon: <Flag size={16} />, action: () => props.createTask({ kind: 'milestone', listId: node?.kind === 'list' ? node.id : null, phase: node?.name ?? '' }) },
    { label: node ? 'Sous-liste' : 'Liste', icon: <List size={16} />, action: () => setListEditor(node ? { parent: node } : {}) },
  ].filter(item => canProject(data, project.id, item.label === 'Tâche' ? 'taskCreate' : item.label === 'Jalon' ? 'milestoneCreate' : 'listCreate'));
  async function connect(predecessorId: string, successorId: string) {
    if (!editable || pending.current || dates.active || dates.busy) return;
    const problem = dependencyProblem(tasks, predecessorId, successorId);
    if (problem) { props.notify(problem); setSource(null); return; }
    const successor = tasks.find(task => task.id === successorId)!;
    if (successor.dependsOnId === predecessorId) { props.notify('Cette contrainte existe déjà.'); setSource(null); return; }
    if (successor.dependsOnId) { setConstraint({ predecessorId, successorId }); setSource(null); return; }
    pending.current = true; setSaving(true); setSource(null);
    try { await props.mutate('tasks', 'PATCH', { dependsOnId: predecessorId }, successorId); props.notify('Contrainte enregistrée.'); }
    catch (error) { props.notify(errorMessage(error)); }
    finally { pending.current = false; setSaving(false); }
  }
  function begin(event: PointerEvent<HTMLButtonElement>, task: Task) {
    if (!editable || pending.current || dates.active || dates.busy || event.button !== 0) return;
    event.stopPropagation(); event.preventDefault(); cancelledGesture.current = false; const rect = event.currentTarget.getBoundingClientRect();
    gesture.current = { pointerId: event.pointerId, source: task.id, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current; if (!current || current.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 6) current.moved = true;
    if (!current.moved) return;
    const hit = document.elementsFromPoint(event.clientX, event.clientY).map(element => element.closest<HTMLElement>('[data-gantt-target]')).find(element => element?.dataset.ganttTarget && element.dataset.ganttTarget !== current.source);
    const target = hit?.dataset.ganttTarget; current.target = target;
    setPreview({ x: current.x, y: current.y, endX: event.clientX, endY: event.clientY, target: current.target });
  }
  function finish(event: PointerEvent<HTMLButtonElement>) {
    if (cancelledGesture.current) { cancelledGesture.current = false; suppressClick.current = true; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); window.setTimeout(() => { suppressClick.current = false; }, 0); return; }
    const current = gesture.current; if (!current || current.pointerId !== event.pointerId) return;
    gesture.current = null; setPreview(null); event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (current.moved) { suppressClick.current = true; if (current.target) void connect(current.source, current.target); window.setTimeout(() => { suppressClick.current = false; }, 0); }
    else { suppressClick.current = true; if (linkMode && sourceId && sourceId !== current.source) void connect(sourceId, current.source); else setSource(current.source); window.setTimeout(() => { suppressClick.current = false; }, 0); }
  }
  function nameCell(row: ProjectGanttRow) {
    const task = row.task; const resource = data.resources.find(resource => resource.id === task?.assigneeId);
    const predecessor = tasks.find(item => item.id === task?.dependsOnId);
    const blocked = !!predecessor && predecessor.status !== 'done';
    return <div className={`pzg-name${blocked ? ' pzg-blocked' : ''}`} style={{ '--pzg-depth': Math.max(0, row.depth) } as CSSProperties}>
      <div className="pzg-name-primary"><div className="pzg-name-main">{task ? task.kind === 'milestone' ? <Flag size={18} className={isLate(task, data.today) ? 'text-danger' : ''} /> : <TaskCheck task={task} data={data} mutate={props.mutate} notify={props.notify} /> : <button type="button" className="pzg-fold" aria-label={`${collapsed.has(row.id) ? 'Déplier' : 'Replier'} ${row.kind === 'project' ? 'le projet' : 'la liste'} ${row.name}`} aria-expanded={!collapsed.has(row.id)} onClick={() => toggle(row.id)}>{collapsed.has(row.id) ? <Plus size={13} /> : <Minus size={13} />}</button>}
        {row.kind === 'project' && <Folder size={18} className="pzg-folder" />}<button type="button" className="pzg-name-button" title={row.name} onClick={() => task ? props.openTask(task) : toggle(row.id)}>{row.name}</button>{!task && <span className="pzg-count">{row.taskCount}</span>}
      </div><div className="pzg-row-actions">{task ? <><button type="button" className={`pzg-constraint-badge${task.dependsOnId ? ' has-link' : ''}`} aria-label={`Contraintes de ${task.title}`} title={predecessor ? `Démarre après ${predecessor.title}` : 'Définir un prédécesseur'} onClick={() => setConstraint({ successorId: task.id })}><Link2 size={13} />{task.dependsOnId ? '1' : '+'}</button>{resource ? <span className="pzg-avatar" style={{ backgroundColor: resource.color }} title={resource.name} aria-label={resource.name}>{resource.initials}</span> : <span className="pzg-no-assignee">—</span>}</> : <><CreateMenu compact label={`Ajouter dans ${row.kind === 'project' ? 'le projet' : 'la liste'} ${row.name}`} actions={createActions(row.node)} disabled={locked || saving} />{row.node && <button className="pzg-list-edit" type="button" aria-label={`Modifier la liste ${row.name}`} disabled={locked || !canProject(data, project.id, 'listEdit')} onClick={() => setListEditor({ node: row.node })}><Pencil size={13} /></button>}</>}</div>
      </div>{details && <div className="pzg-details-viewport"><div className="pzg-details" style={{ width: visibleColumns.reduce((sum, column) => sum + column.width, 0), transform: `translateX(-${detailOffset}px)` }}>{visibleColumns.map(column => <GanttDetailValue key={column.id} column={column} row={row} data={visualData} />)}</div></div>}
    </div>;
  }
  function timeline(row: ProjectGanttRow) {
    const task = row.task;
    const activeDateRow = dates.preview && (task?.id === dates.preview.record.id || row.kind === 'project' && dates.preview.record.kind === 'project');
    const bar = ganttBarRange(row, range) ?? (activeDateRow ? { left: ganttStamp(row.endDate ?? row.startDate!) < range.start ? 0 : 1 - 16 / trackWidth, right: ganttStamp(row.endDate ?? row.startDate!) < range.start ? 16 / trackWidth : 1, milestone: task?.kind === 'milestone' } : null);
    const dragProps = dates.barProps(row, !linkMode && !sourceId && !saving);
    const blocked = tasks.some(predecessor => predecessor.id === task?.dependsOnId && predecessor.status !== 'done');
    return <div className={`pzg-track${task && (preview?.target === task.id || sourceId && task.id !== sourceId) ? ' pzg-connect-target' : ''}`} data-gantt-target={task?.id}>
      {minorTicks.map(tick => <span className="pzg-gridline" key={tick.date} style={{ left: `${tick.left * 100}%` }} />)}
      {todayPosition >= 0 && todayPosition < 1 && <span className="pzg-today-line" style={{ left: `${todayPosition * 100}%` }} />}
      {bar ? <div className={`pzg-bar-wrapper pzg-bar-${row.kind}${bar.milestone ? ' pzg-milestone' : ''}${task ? ` pzg-status-${task.status}` : ''}${late && task && isLate(task, data.today) ? ' pzg-late' : ''}${blocked ? ' pzg-blocked-bar' : ''}${task && preview?.target === task.id ? ' pzg-drop-target' : ''}`} data-gantt-target={task?.id} style={{ left: `${bar.left * trackWidth}px`, width: bar.milestone ? '18px' : `${Math.max(16, (bar.right - bar.left) * trackWidth)}px` }}>
        {task && editable && <button type="button" className="pzg-port pzg-port-in" data-gantt-target={task.id} aria-label={`Relier au début de ${task.title}`} title="Choisir comme élément suivant" disabled={saving || dates.busy || dates.active} onClick={event => { event.stopPropagation(); if (sourceId) void connect(sourceId, task.id); else setConstraint({ successorId: task.id }); }} />}
        <button type="button" className={`pzg-bar${linkMode && task ? ' pzg-link-selectable' : ''}`} {...dragProps} aria-label={`Ouvrir ${row.name} dans le Gantt`} title={`${row.name} · ${dateLabel(row.startDate)} — ${dateLabel(row.endDate)}`} onPointerDown={event => { if (linkMode && task) begin(event, task); else dragProps.onPointerDown?.(event); }} onPointerMove={linkMode ? move : dragProps.onPointerMove} onPointerUp={linkMode ? finish : dragProps.onPointerUp} onPointerCancel={() => { if (linkMode) { gesture.current = null; setPreview(null); setSource(null); } else dragProps.onPointerCancel?.(); }} onClick={() => { if (dates.consumeClick() || suppressClick.current) return; if (sourceId && task) void connect(sourceId, task.id); else if (linkMode && task) setSource(task.id); else if (task) props.openTask(task); else toggle(row.id); }}>{bar.milestone ? <Flag size={15} /> : <><span className="pzg-progress" style={{ width: `${task?.progress ?? 0}%` }} /><span className="pzg-bar-label">{row.name}</span></>}</button>
        {task && editable && <button type="button" className="pzg-port pzg-port-out" aria-label={`Créer un lien depuis ${task.title}`} title="Glisser vers une autre barre ou cliquer puis choisir sa cible" disabled={saving || dates.busy || dates.active} onPointerDown={event => begin(event, task)} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { gesture.current = null; setPreview(null); }} onClick={event => { event.stopPropagation(); if (!suppressClick.current) setSource(task.id); }} />}
        {dates.handles(row)}
        {charges && <span className="pzg-bar-hours">{formatHours(row.allocatedHours)}</span>}
      </div> : <span className="pzg-undated">{!row.startDate && !row.endDate ? 'Sans date planifiée' : 'Hors période'}</span>}
    </div>;
  }
  return <section className="pzg-view" aria-label="Planning Gantt du projet"><h1 className="sr-only">Planning Gantt</h1>
    {locked && <p className="notice">Ce projet est consultable en lecture seule.</p>}
    <div className="pzg-toolbar"><label className="search-field"><Search size={16} /><input aria-label="Rechercher une tâche ou une liste dans le Gantt" placeholder="Rechercher une tâche ou une liste…" value={query} onChange={event => { setQuery(event.target.value); setCollapsed(new Set()); }} /></label><label>Trier par<select aria-label="Trier le Gantt" value={sort} onChange={event => setSort(event.target.value)}><option value="none">Aucun tri</option><option value="title">Nom</option><option value="date">Date de fin</option></select></label>
      <label>Voir les tâches de<select aria-label="Responsable dans le Gantt" value={resourceId} onChange={event => { setResourceId(event.target.value); setCollapsed(new Set()); }}><option value="all">Tout le monde</option><option value="none">Non assignées</option>{data.resources.filter(resource => tasks.some(task => task.assigneeId === resource.id)).map(resource => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select></label>
      <select aria-label="Statut dans le Gantt" value={status} onChange={event => { setStatus(event.target.value); setCollapsed(new Set()); }}><option value="all">Tous les statuts</option>{TASK_STATUSES.map(value => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}</select><select aria-label="Type d’élément dans le Gantt" value={kind} onChange={event => { setKind(event.target.value); setCollapsed(new Set()); }}><option value="all">Listes, tâches et jalons</option><option value="task">Tâches</option><option value="milestone">Jalons</option></select><button type="button" className="text-button" onClick={resetFilters}>Réinitialiser</button><CreateMenu label="Créer dans le Gantt" actions={createActions()} disabled={locked || saving} />
    </div><div className="pzg-controls"><label><input type="checkbox" checked={charges} onChange={event => setCharges(event.target.checked)} />Charges</label><label><input type="checkbox" checked={late} onChange={event => setLate(event.target.checked)} />Retard</label><label><input type="checkbox" checked={links} onChange={event => setLinks(event.target.checked)} />Contraintes</label><button type="button" className="button button-secondary" onClick={() => { todayRequest.current = true; setAnchor(data.today); setOffset(0); setScale('month'); if (scale === 'month' && anchor === data.today && offset === 0 && scroll.current) scroll.current.scrollLeft = Math.max(0, todayPosition * trackWidth - (scroll.current.clientWidth - labelWidth) / 2); }}><CalendarDays size={15} />Aller à aujourd’hui</button>
      {editable && <button type="button" className="button button-secondary" disabled={saving || dates.busy || dates.active || tasks.length < 2} aria-pressed={linkMode} onClick={() => { setLinkMode(value => !value); setSource(null); }}><Link2 size={15} />Relier les barres</button>}
      {editable && <button type="button" className="button button-secondary" disabled={saving || dates.busy || dates.active || tasks.length < 2} onClick={() => setConstraint({})}><Link2 size={15} />Créer une contrainte</button>}
      <div className="pzg-period"><button type="button" aria-label="Période précédente du Gantt" onClick={() => setOffset(value => value - 1)}><ChevronLeft size={17} /></button><strong>{dateLabel(new Date(range.start).toISOString().slice(0, 10))} — {dateLabel(new Date(range.end - GANTT_DAY).toISOString().slice(0, 10))}</strong><button type="button" aria-label="Période suivante du Gantt" onClick={() => setOffset(value => value + 1)}><ChevronRight size={17} /></button></div>
      <select aria-label="Échelle du Gantt" value={scale} onChange={event => { setScale(event.target.value as GanttScale); setOffset(0); }}><option value="project">Vue du projet entier</option><option value="month">Vue mensuelle</option><option value="quarter">Vue trimestrielle</option><option value="year">Vue annuelle</option></select>
    </div>
    <div className="pzg-help" role="status">{dates.busy ? 'Enregistrement des dates…' : saving ? 'Enregistrement de la contrainte…' : sourceId ? <><strong>{tasks.find(task => task.id === sourceId)?.title}</strong> : cliquez sur le début ou la barre de l’élément suivant.<button type="button" aria-label="Annuler la création du lien" onClick={() => setSource(null)}><X size={15} /></button></> : linkMode ? 'Cliquez ou glissez depuis une première barre vers la suivante pour les relier.' : editable ? 'Glissez les poignées verticales pour modifier la durée, ou la barre pour déplacer ses dates. Reliez le point de fin d’une barre au début d’une autre pour créer une contrainte fin → début. Le bouton Créer une contrainte fonctionne aussi au clavier et pour les éléments sans date.' : 'Les liens fin → début représentent les prédécesseurs des tâches.'}{links && hiddenEdges > 0 && <span> · {hiddenEdges} lien{hiddenEdges > 1 ? 's' : ''} hors de la vue actuelle</span>}</div>
    <div className="pzg-scroll" ref={scroll} role="region" aria-label="Tâches et listes du Gantt" tabIndex={0} style={{ '--pzg-label-width': `${labelWidth}px`, '--pzg-name-width': `${nameWidth}px`, '--pzg-track-width': `${trackWidth}px` } as CSSProperties}>
      <div className="pzg-matrix" style={{ width: labelWidth + trackWidth }}>
        <div className="pzg-header"><div className="pzg-header-name"><div className="pzg-header-actions"><div className="pzg-fold-tools"><button type="button" aria-label="Replier un niveau dans le Gantt" onClick={() => { const visible = rows.filter(row => !row.task && !collapsed.has(row.id)); if (visible.length) { const depth = Math.max(...visible.map(row => row.depth)); setCollapsed(previous => new Set([...previous, ...visible.filter(row => row.depth === depth).map(row => row.id)])); } }}><ChevronUp size={18} /></button><button type="button" aria-label="Déplier un niveau dans le Gantt" onClick={() => { const visible = rows.filter(row => !row.task && collapsed.has(row.id)); if (visible.length) { const depth = Math.min(...visible.map(row => row.depth)); setCollapsed(previous => new Set([...previous].filter(id => !visible.some(row => row.id === id && row.depth === depth)))); } }}><ChevronDown size={18} /></button><button type="button" aria-label="Tout replier dans le Gantt" onClick={() => setCollapsed(new Set([...fullTree.nodes.keys()].map(id => `list:${id}`)))}><ChevronsUp size={18} /></button><button type="button" aria-label="Tout déplier dans le Gantt" onClick={() => setCollapsed(new Set())}><ChevronsDown size={18} /></button></div><div><button type="button" aria-label="Afficher les détails du Gantt" aria-pressed={details} onClick={() => { const next = !details; setDetails(next); try { localStorage.setItem(columnKey + ':open', String(next)); } catch {} }}>Détails {details ? '◂' : '▸'}</button>{details && <button type="button" className="pzg-config-columns" aria-label="Configurer les colonnes du Gantt" onClick={() => setColumnEditor(true)}><Settings2 size={17} /></button>}</div></div><div className="pzg-header-bottom"><strong>Nom</strong>{details && <div ref={detailScroll} className="pzg-details-head-scroll" role="region" aria-label="Défilement des colonnes Détails du Gantt" tabIndex={0} onScroll={event => setDetailOffset(event.currentTarget.scrollLeft)}><div className="pzg-details-head" style={{ width: visibleColumns.reduce((sum, column) => sum + column.width, 0) }}>{visibleColumns.map(column => <span key={column.id} data-gantt-column={column.id} style={{ width: column.width }}>{column.label}</span>)}</div></div>}</div></div><div className="pzg-axis"><div>{majorTicks.map(tick => <span key={tick.date} style={{ left: `${tick.left * 100}%`, width: `${tick.width * 100}%` }}>{tick.label}</span>)}</div><div>{minorTicks.map(tick => <span key={tick.date} style={{ left: `${tick.left * 100}%`, width: `${tick.width * 100}%` }} title={dateLabel(tick.date)}>{tick.label}</span>)}</div></div></div>
        <div className="pzg-body">{rows.map(row => <div className={`pzg-row pzg-row-${row.kind}`} key={row.id} data-task-id={row.task?.id} data-list-id={row.node?.id} data-depth={row.depth} style={{ height: ROW_HEIGHT }}>{nameCell(row)}{timeline(row)}</div>)}
          {links && <svg className="pzg-links" width={trackWidth} height={rows.length * ROW_HEIGHT} aria-label="Contraintes du planning"><defs><marker id={marker} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 Z" /></marker></defs>{visibleEdges.map(({ task, from, to }) => {
            const x1 = Math.min(trackWidth - 5, from.bar!.left * trackWidth + (from.bar!.milestone ? 18 : Math.max(16, (from.bar!.right - from.bar!.left) * trackWidth)) + 11); const x2 = Math.max(5, to.bar!.left * trackWidth - 11); const y1 = from.index * ROW_HEIGHT + ROW_HEIGHT / 2; const y2 = to.index * ROW_HEIGHT + ROW_HEIGHT / 2;
            const bend = Math.min(trackWidth - 3, x1 + 15); const path = x2 >= bend + 8 ? `M${x1},${y1} H${bend} V${y2} H${x2}` : `M${x1},${y1} H${bend} V${y2 - 17} H${Math.max(3, x2 - 12)} V${y2} H${x2}`;
            const label = `Contrainte ${from.row.name} → ${to.row.name}`;
            return <g key={task.id}><path className="pzg-link-line" d={path} markerEnd={`url(#${marker})`} /><path className="pzg-link-hit" d={path} role="button" tabIndex={0} aria-label={label} onClick={() => setConstraint({ successorId: task.id })} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setConstraint({ successorId: task.id }); } }}><title>{label}</title></path></g>;
          })}</svg>}
        </div>
      </div>
    </div><div className="pzg-footer"><span>{tree.visibleTasks.length} élément{tree.visibleTasks.length > 1 ? 's' : ''} · Ordre et listes partagés avec la vue Liste</span><div><button type="button" aria-label="Réduire le Gantt" disabled={zoom <= .5} onClick={() => setZoom(value => Math.max(.5, value - .25))}><Minus size={16} /></button><span>{Math.round(zoom * 100)} %</span><button type="button" aria-label="Agrandir le Gantt" disabled={zoom >= 2} onClick={() => setZoom(value => Math.min(2, value + .25))}><Plus size={16} /></button></div></div>
    {!tree.visibleTasks.length && !tree.roots.length && <div className="empty-state"><List size={26} /><p>{tasks.length ? 'Aucun élément ne correspond aux filtres.' : 'Créez une liste, une tâche ou un jalon pour préparer le planning.'}</p></div>}
    {dates.modal}
    {dates.preview && createPortal(<GanttDatePreview preview={dates.preview} />, document.body)}
    {columnEditor && <GanttColumnsDialog columns={columns} preferences={preferences} onClose={() => setColumnEditor(false)} onApply={next => { setSavedColumns(next); setColumnEditor(false); setDetailOffset(0); if (detailScroll.current) detailScroll.current.scrollLeft = 0; try { localStorage.setItem(columnKey, JSON.stringify(next)); } catch { props.notify('La configuration des colonnes est conservée pour cette visite.'); } }} />}
    {listEditor && <TaskListDialog props={props} editor={listEditor} onClose={() => setListEditor(null)} />}
    {constraint && <ConstraintDialog key={`${constraint.successorId ?? ''}:${constraint.predecessorId ?? ''}`} props={props} initial={constraint} onClose={() => setConstraint(null)} />}
    {preview && createPortal(<svg className="pzg-link-preview" aria-hidden="true"><path d={`M${preview.x},${preview.y} H${preview.endX} V${preview.endY}`} /><circle cx={preview.endX} cy={preview.endY} r="5" /></svg>, document.body)}
  </section>;
}
