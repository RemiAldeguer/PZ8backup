import { canProject } from '../shared/permissions';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, ChevronsDown, ChevronsUp, Flag, List, MessageSquare, Minus, Pencil, Plus, Search, Settings2, Trash2 } from 'lucide-react';
import { STATUS_LABELS, TASK_STATUSES, type Resource, type Task, type TaskStatus, type ViewProps } from '../shared/types';
import { formatHours, isLate } from '../shared/domain';
import { projectStatusLabel } from '../shared/customization';
import { buildProjectTaskListTree, orderedTaskListItems, projectTaskListParentOptions, type TaskListNode } from '../shared/task-lists';
import { taskListNodeReference } from '../shared/project-item-moves';
import { useProjectItemMoves } from './ProjectItemMoves';
import { LIST_COLUMNS, listColumnStorageKey, moveListColumn, normalizeListColumns, readListColumns, visibleListColumns, type ListColumnId, type ListColumnPreferences } from '../shared/list-columns';
import { Modal } from './Dialogs';
import { TaskCheck } from './TaskCheck';
import './list-columns.css';
import './nested-list-view.css';
import { ColumnResizeHandle } from './table/ColumnResizeHandle';
import { readTableColumns, type TableColumn } from './table/column-preferences';

const taskColumnCatalog: TableColumn[] = LIST_COLUMNS.map(column => ({ ...column, width: { task: 530, status: 130, tags: 155, assignee: 110, dates: 220, allocated: 105 }[column.id], minWidth: column.id === 'task' ? 240 : column.id === 'dates' ? 160 : 60 }));

function failure(error: unknown): string { return error instanceof Error ? error.message : 'L’enregistrement a échoué. Réessayez.'; }
function dateLabel(date: string | null): string { return date ? date.slice(0, 10).split('-').reverse().join('/') : '—'; }
function avatarTextColor(color: string): string {
  const rgb = color.match(/[a-f0-9]{2}/gi)?.slice(0, 3).map(channel => {
    const value = parseInt(channel, 16) / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
  return rgb?.length === 3 && .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2] > .179 ? '#172b33' : '#fff';
}
function Avatar({ resource }: { resource: Resource }) {
  return <span className="nlv-avatar" aria-label={resource.name} title={resource.name} style={{ backgroundColor: resource.color, color: avatarTextColor(resource.color) }}>{resource.initials}</span>;
}
function loadListColumns(key: string): ListColumnPreferences {
  try { return readListColumns(localStorage.getItem(key)); } catch { return normalizeListColumns(undefined); }
}

function ListColumnsDialog({ preferences, onApply, onClose }: {
  preferences: ListColumnPreferences; onApply: (preferences: ListColumnPreferences) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => normalizeListColumns(preferences));
  return <Modal title="Configurer les colonnes" onClose={onClose}>
    <div className="modal-body lc-config-body"><p>Choisissez les colonnes affichées et utilisez les flèches pour changer leur ordre.</p>
      <ol className="lc-config-list" aria-label="Ordre des colonnes">{draft.order.map((id, index) => {
        const label = LIST_COLUMNS.find(column => column.id === id)!.label;
        return <li key={id}><span className="lc-column-position" aria-hidden="true">{index + 1}</span><label><input type="checkbox" checked={!draft.hidden.includes(id)} disabled={id === 'task'} onChange={event => setDraft(previous => ({ ...previous, hidden: event.target.checked ? previous.hidden.filter(column => column !== id) : [...previous.hidden, id] }))} />{label}{id === 'task' && <small>Obligatoire</small>}</label><div className="lc-order-controls"><button className="icon-button" type="button" aria-label={`Déplacer ${label} vers la gauche`} title="Afficher cette colonne plus tôt" disabled={index === 0} onClick={() => setDraft(previous => moveListColumn(previous, id, -1))}><ArrowUp size={17} /></button><button className="icon-button" type="button" aria-label={`Déplacer ${label} vers la droite`} title="Afficher cette colonne plus tard" disabled={index === draft.order.length - 1} onClick={() => setDraft(previous => moveListColumn(previous, id, 1))}><ArrowDown size={17} /></button></div></li>;
      })}</ol><p className="lc-settings-note">Cette configuration est conservée pour vous et pour ce projet dans ce navigateur.</p>
    </div><div className="modal-footer lc-config-footer"><button className="text-button" type="button" onClick={() => setDraft(normalizeListColumns(undefined))}>Rétablir les colonnes</button><div className="modal-footer-actions"><button className="button button-secondary" type="button" onClick={onClose}>Annuler</button><button className="button button-primary" type="button" onClick={() => onApply(draft)}>Appliquer</button></div></div>
  </Modal>;
}

export interface MenuAction { label: string; icon: ReactNode; action: () => void; }
export function CreateMenu({ label, actions, disabled, compact = false }: { label: string; actions: MenuAction[]; disabled: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const height = menu.current?.offsetHeight ?? 145;
      const width = menu.current?.offsetWidth ?? 160;
      const below = window.innerHeight - rect.bottom;
      setPosition({ left: Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width)), top: below < height + 10 && rect.top > below ? Math.max(8, rect.top - height - 6) : Math.max(8, Math.min(window.innerHeight - height - 8, rect.bottom + 6)) });
    };
    place(); menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  return <div className={`nlv-menu-container${compact ? ' nlv-menu-compact' : ''}`} ref={container} onKeyDown={event => {
    if (!open) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
    if (event.key === 'Tab') { trigger.current?.focus(); setOpen(false); }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = [...menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []];
    const current = items.findIndex(item => item === document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }}><button type="button" ref={trigger} className={compact ? 'nlv-icon-action' : 'button button-primary nlv-create'} aria-label={label} aria-haspopup="menu" aria-expanded={open} disabled={disabled || !actions.length} onClick={() => setOpen(value => !value)}><Plus size={compact ? 15 : 17} />{!compact && <span>Créer</span>}</button>
    {open && !disabled && actions.length > 0 && createPortal(<div ref={menu} role="menu" aria-label={label} className="nlv-create-menu" style={{ position: 'fixed', left: position.left, top: position.top, right: 'auto' }}>{actions.map(item => <button type="button" role="menuitem" key={item.label} onClick={() => { trigger.current?.focus(); setOpen(false); item.action(); }}>{item.icon}{item.label}</button>)}</div>, document.body)}
  </div>;
}

export interface ListEditorState { node?: TaskListNode; parent?: TaskListNode; }
export function TaskListDialog({ props, editor, onClose }: { props: ViewProps; editor: ListEditorState; onClose: () => void }) {
  const { data, project } = props;
  const node = editor.node;
  const initialParent = node?.parentId ?? editor.parent?.id ?? '';
  const [name, setName] = useState(node?.name ?? '');
  const [parent, setParent] = useState(initialParent);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const locked = project.status === 'closed' || project.status === 'paused' || !canProject(data, project.id, node ? 'listEdit' : 'listCreate');
  const dirty = name !== (node?.name ?? '') || parent !== initialParent;
  const tree = buildProjectTaskListTree(data, project.id);
  const actualParents = projectTaskListParentOptions(data.taskLists ?? [], project.id, node?.kind === 'list' ? node.id : undefined);
  const legacyParents = node?.kind === 'list' ? [] : tree.roots.filter(item => item.kind === 'legacy-phase' && item.id !== node?.id);
  function close() { if (submitting.current) return; if (!dirty || window.confirm('Fermer sans enregistrer les modifications de la liste ?')) onClose(); }
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (locked || submitting.current) return;
    const trimmed = name.trim();
    if (!trimmed) { setError('Saisissez le nom de la liste.'); return; }
    submitting.current = true; setBusy(true); setError('');
    const parentNode = tree.nodes.get(parent);
    try {
      if (node?.kind === 'list') await props.mutate('task-lists', 'PATCH', { name: trimmed, parentId: parent || null }, node.id);
      else await props.mutate('task-lists', 'POST', {
        projectId: project.id, name: trimmed, parentId: parentNode?.kind === 'legacy-phase' ? null : parent || null,
        ...(node?.legacyPhase != null ? { sourcePhase: node.legacyPhase } : {}),
        ...(parentNode?.legacyPhase != null ? { parentPhase: parentNode.legacyPhase } : {}),
      });
      props.notify(node ? 'Liste modifiée.' : 'Liste créée.'); onClose();
    } catch (err) { setError(failure(err)); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <Modal title={node ? 'Modifier la liste' : 'Créer une liste'} onClose={close}><form onSubmit={event => void save(event)}>
    <fieldset className="nlv-list-form" disabled={busy || locked}><div className="modal-body"><label className="form-field">Nom de la liste<input className="form-input" value={name} maxLength={200} required onChange={event => setName(event.target.value)} autoComplete="off" /></label>
      <label className="form-field">Liste parente<select className="form-input" value={parent} onChange={event => setParent(event.target.value)}><option value="">Projet (racine)</option>{actualParents.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}{legacyParents.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {node?.legacyPhase != null && <p className="nlv-editor-note">Les tâches de cette ancienne phase seront conservées dans la liste.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div><div className="modal-footer"><button type="button" className="button button-secondary" onClick={close}>Annuler</button><button className="button button-primary" type="submit">{busy ? 'Enregistrement…' : node ? 'Enregistrer la liste' : 'Créer la liste'}</button></div></fieldset>
  </form></Modal>;
}

function TaskStatusSelect({ task, props }: { task: Task; props: ViewProps }) {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  return <select className={`status-select nlv-status-select status-${task.status}`} aria-label={`Statut de ${task.title}`} value={task.status} disabled={busy || props.project.status === 'closed' || props.project.status === 'paused'} onChange={async event => {
    if (pending.current) return;
    const status = event.currentTarget.value as TaskStatus;
    pending.current = true; setBusy(true);
    try { await props.mutate('tasks', 'PATCH', { status }, task.id); } catch (error) { props.notify(failure(error)); }
    finally { pending.current = false; setBusy(false); }
  }}>{TASK_STATUSES.map(status => <option value={status} key={status}>{STATUS_LABELS[status]}</option>)}</select>;
}

export function NestedListView(props: ViewProps) {
  const { data, project } = props;
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [resourceId, setResourceId] = useState('all');
  const [kind, setKind] = useState('all');
  const [sort, setSort] = useState('none');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editor, setEditor] = useState<ListEditorState | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const deletion = useRef(false);
  const storageKey = listColumnStorageKey(props.preferenceScope ?? data.currentUser.id, project.id);
  const widthsKey = storageKey + ':widths';
  const [savedWidths, setSavedWidths] = useState(() => ({ key: widthsKey, value: readTableColumns(widthsKey, taskColumnCatalog).widths }));
  const widths = savedWidths.key === widthsKey ? savedWidths.value : readTableColumns(widthsKey, taskColumnCatalog).widths;
  const columnWidth = (id: ListColumnId) => widths[id] ?? taskColumnCatalog.find(column => column.id === id)!.width;
  function resizeColumn(id: ListColumnId, width: number, persist: boolean) {
    const next = { ...widths, [id]: width }; setSavedWidths({ key: widthsKey, value: next });
    if (persist) { try { localStorage.setItem(widthsKey, JSON.stringify({ version: 1, widths: next })); } catch { props.notify('La largeur est conservée pour cette visite.'); } }
  }
  const [savedColumns, setSavedColumns] = useState(() => ({ key: storageKey, preferences: loadListColumns(storageKey) }));
  const [configuringColumns, setConfiguringColumns] = useState(false);
  const preferences = savedColumns.key === storageKey ? savedColumns.preferences : loadListColumns(storageKey);
  const columns = visibleListColumns(preferences);
  const locked = project.status === 'closed' || project.status === 'paused';
  const projectTasks = data.tasks.filter(task => task.projectId === project.id);
  const assignedResources = data.resources.filter(resource => projectTasks.some(task => task.assigneeId === resource.id));
  const sortTasks = sort === 'title' ? (a: Task, b: Task) => a.title.localeCompare(b.title, 'fr', { numeric: true }) : sort === 'date' ? (a: Task, b: Task) => (a.endDate ?? '9999').localeCompare(b.endDate ?? '9999') : undefined;
  const tree = buildProjectTaskListTree(data, project.id, {
    search: query,
    ...(status !== 'all' || resourceId !== 'all' || kind !== 'all' ? { matchesTask: (task: Task) => (status === 'all' || task.status === status) && (resourceId === 'all' || (resourceId === 'none' ? task.assigneeId === null : task.assigneeId === resourceId)) && (kind === 'all' || task.kind === kind) } : {}),
    sortTasks,
    ...(sort === 'title' ? { sortLists: (a: TaskListNode, b: TaskListNode) => a.name.localeCompare(b.name, 'fr', { numeric: true }) } : {}),
  });
  const fullTree = buildProjectTaskListTree(data, project.id);
  const movement = useProjectItemMoves(props, fullTree, sort === 'none', () => { setSort('none'); setCollapsed(new Set()); });
  const visibleNodes: TaskListNode[] = [];
  const collectNodes = (nodes: TaskListNode[]) => { for (const node of nodes) { visibleNodes.push(node); if (!collapsed.has(node.id)) collectNodes(node.children); } };
  collectNodes(tree.roots);
  const commentCounts = useMemo(() => {
    const ids = new Set(projectTasks.map(task => task.id));
    const counts = new Map<string, number>();
    for (const comment of data.comments) if (comment.taskId && ids.has(comment.taskId) && (!comment.projectId || comment.projectId === project.id)) counts.set(comment.taskId, (counts.get(comment.taskId) ?? 0) + 1);
    return counts;
  }, [data.comments, data.tasks, project.id]);
  const applyColumns = (next: ListColumnPreferences) => {
    const normalized = normalizeListColumns(next); setSavedColumns({ key: storageKey, preferences: normalized }); setConfiguringColumns(false);
    try { localStorage.setItem(storageKey, JSON.stringify(normalized)); } catch { props.notify('Les colonnes ont été modifiées pour cette visite. Le navigateur ne permet pas de conserver cette configuration.'); }
  };
  const toggle = (id: string) => setCollapsed(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const foldLevel = () => {
    const expanded = visibleNodes.filter(node => !collapsed.has(node.id));
    if (!expanded.length) return;
    const depth = Math.max(...expanded.map(node => node.depth));
    setCollapsed(current => new Set([...current, ...expanded.filter(node => node.depth === depth).map(node => node.id)]));
  };
  const unfoldLevel = () => {
    const folded = visibleNodes.filter(node => collapsed.has(node.id));
    if (!folded.length) return;
    const depth = Math.min(...folded.map(node => node.depth));
    setCollapsed(current => new Set([...current].filter(id => !folded.some(node => node.id === id && node.depth === depth))));
  };
  const createIn = (node: TaskListNode | undefined, taskKind: 'task' | 'milestone') => props.createTask({ kind: taskKind, listId: node?.kind === 'list' ? node.id : null, phase: node?.kind === 'list' ? node.name : node?.legacyPhase ?? '' });
  const menuActions = (node?: TaskListNode): MenuAction[] => [
    { label: 'Tâche', icon: <Plus size={16} />, action: () => createIn(node, 'task') },
    { label: 'Jalon', icon: <Flag size={16} />, action: () => createIn(node, 'milestone') },
    { label: node ? 'Sous-liste' : 'Liste', icon: <List size={16} />, action: () => setEditor(node ? { parent: node } : {}) },
  ].filter(item => canProject(data, project.id, item.label === 'Tâche' ? 'taskCreate' : item.label === 'Jalon' ? 'milestoneCreate' : 'listCreate'));
  async function remove(node: TaskListNode) {
    if (deletion.current || locked || !canProject(data, project.id, 'listDelete') || !node.list || node.aggregate.taskCount || node.children.length || !window.confirm(`Supprimer la liste vide « ${node.name} » ?`)) return;
    deletion.current = true; setDeleting(node.id);
    try { await props.mutate('task-lists', 'DELETE', undefined, node.id); props.notify('Liste supprimée.'); }
    catch (error) { props.notify(failure(error)); }
    finally { deletion.current = false; setDeleting(null); }
  }
  function taskRow(task: Task, depth: number) {
    const resource = data.resources.find(item => item.id === task.assigneeId);
    const dependency = data.tasks.find(item => item.id === task.dependsOnId);
    const blocked = !task.dependencyConstraint && dependency && dependency.status !== 'done';
    const cells: Record<ListColumnId, ReactNode> = {
      task: <div className="nlv-name-cell proj-task-name-cell" style={{ '--nlv-depth': depth } as CSSProperties}>{movement.handle({ type: 'task', id: task.id }, task.title)}{task.kind === 'task' ? <TaskCheck task={task} data={data} mutate={props.mutate} notify={props.notify} /> : <Flag size={18} className="nlv-milestone-icon" aria-label="Jalon" />}<button className="proj-task-name nlv-task-name" {...movement.dragProps({ type: 'task', id: task.id })} onClick={() => props.openTask(task)}><strong>{task.title}</strong></button>{blocked && <span className="nlv-dependency" title={`Bloquée par ${dependency.title}`} aria-label={`Bloquée par ${dependency.title}`}>↳</span>}</div>,
      status: <TaskStatusSelect task={task} props={props} />,
      tags: <button type="button" className="lc-tags-cell" aria-label={`Modifier les tags de ${task.title}`} onClick={() => props.openTask(task)}>{task.tags.length ? <span className="tag-list">{task.tags.slice(0, 2).map((tag, index) => <span className="tag" key={`${tag}-${index}`}>{tag}</span>)}{task.tags.length > 2 && <span className="nlv-extra-tags">+{task.tags.length - 2}</span>}</span> : <span className="nlv-empty-tags"><Plus size={13} aria-hidden="true" /><span className="sr-only">Ajouter un tag</span></span>}</button>,
      assignee: resource ? <Avatar resource={resource} /> : <span className="nlv-unassigned" title="Non assignée">—</span>,
      dates: <span className="nlv-date-pair"><span className="nlv-date-box">{dateLabel(task.startDate)}</span><span className={`nlv-date-box${isLate(task, data.today) ? ' text-danger' : ''}`}>{dateLabel(task.endDate)}</span></span>,
      allocated: <span className="nlv-allocated">{formatHours(task.allocatedHours)}</span>,
    };
    const comments = commentCounts.get(task.id) ?? 0;
    return <tr key={task.id} className={`nlv-task-row${blocked ? ' nlv-blocked' : ''}${task.status === 'done' ? ' nlv-done' : ''}${movement.rowClass({ type: 'task', id: task.id })}`} data-task-id={task.id} data-depth={depth} {...movement.dropProps({ type: 'task', id: task.id })}>{columns.map(id => <td key={id} data-column={id}>{cells[id]}</td>)}<td className="nlv-actions-cell">{comments > 0 && <button className="nlv-comment-count" aria-label={`Voir les ${comments} commentaire${comments > 1 ? 's' : ''} de ${task.title}`} title={`${comments} commentaire${comments > 1 ? 's' : ''}`} onClick={() => props.openTask(task)}>{comments}<MessageSquare size={14} /></button>}</td></tr>;
  }
  function listRows(node: TaskListNode): ReactNode {
    const actual = fullTree.nodes.get(node.id) ?? node;
    const empty = !actual.aggregate.taskCount && !actual.children.length;
    const cells: Record<ListColumnId, ReactNode> = {
      task: <div className="nlv-name-cell nlv-list-name" style={{ '--nlv-depth': node.depth } as CSSProperties}>{movement.handle(taskListNodeReference(node), node.name)}<button type="button" className="nlv-fold-button" aria-label={`${collapsed.has(node.id) ? 'Déplier' : 'Replier'} la liste ${node.name}`} aria-expanded={!collapsed.has(node.id)} onClick={() => toggle(node.id)}>{collapsed.has(node.id) ? <Plus size={13} /> : <Minus size={13} />}</button><strong {...movement.dragProps(taskListNodeReference(node))}>{node.name}</strong><span className="nlv-list-count" title="Tâches et jalons dans cette liste et ses sous-listes">{node.aggregate.taskCount}</span>{movement.nest(taskListNodeReference(node), node.name)}</div>,
      status: null, tags: null, assignee: null,
      dates: <span className="nlv-date-pair"><span className="nlv-date-box">{dateLabel(node.aggregate.startDate)}</span><span className="nlv-date-box">{dateLabel(node.aggregate.endDate)}</span></span>,
      allocated: <strong className="nlv-allocated">{formatHours(node.aggregate.allocatedHours)}</strong>,
    };
    return <Fragment key={node.id}><tr className={`nlv-list-row${movement.rowClass(taskListNodeReference(node))}`} data-list-id={node.id} data-depth={node.depth} {...movement.dropProps(taskListNodeReference(node))}>{columns.map(id => <td key={id} data-column={id}>{cells[id]}</td>)}<td className="nlv-actions-cell"><div className="nlv-row-actions"><CreateMenu compact label={`Ajouter dans la liste ${node.name}`} actions={menuActions(node)} disabled={locked || deleting !== null || movement.moving} /><button type="button" className="nlv-icon-action" aria-label={`Modifier la liste ${node.name}`} title="Renommer ou déplacer la liste" disabled={locked || deleting !== null || movement.moving} onClick={() => setEditor({ node })}><Pencil size={14} /></button>{node.kind === 'list' && <button type="button" className="nlv-icon-action nlv-delete" aria-label={`Supprimer la liste ${node.name}`} title={empty ? 'Supprimer cette liste vide' : 'Retirez ses tâches et ses sous-listes avant de la supprimer'} disabled={locked || deleting !== null || movement.moving || !empty} onClick={() => void remove(actual)}><Trash2 size={14} /></button>}</div></td></tr>{!collapsed.has(node.id) && <>{orderedTaskListItems(node.tasks, node.children, sort === 'none').map(item => item.type === 'task' ? taskRow(item.task, node.depth + 1) : listRows(item.node))}</>}</Fragment>;
  }
  return <div className="lc-list-view nlv-list-view"><h1 className="sr-only">Liste des tâches</h1>
    {locked && <div className="notice">Ce projet est {projectStatusLabel(project, data).toLocaleLowerCase('fr')}. Ses données sont disponibles en lecture.</div>}
    <div className="nlv-toolbar"><label className="search-field nlv-search"><Search size={16} /><input placeholder="Rechercher une tâche ou une liste…" aria-label="Rechercher une tâche ou une liste" value={query} onChange={event => { setQuery(event.target.value); setCollapsed(new Set()); }} /></label>
      <label className="nlv-toolbar-select">Trier par<select aria-label="Trier les tâches" value={sort} onChange={event => setSort(event.target.value)}><option value="none">Aucun tri</option><option value="title">Nom</option><option value="date">Date de fin</option></select></label>
      <label className="nlv-toolbar-select">Voir les tâches de<select aria-label="Filtrer par responsable" value={resourceId} onChange={event => { setResourceId(event.target.value); setCollapsed(new Set()); }}><option value="all">Tout le monde</option><option value="none">Non assignées</option>{assignedResources.map(resource => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select></label>
      <select aria-label="Filtrer par statut" value={status} onChange={event => { setStatus(event.target.value); setCollapsed(new Set()); }}><option value="all">Tous les statuts</option>{TASK_STATUSES.map(value => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}</select>
      <select aria-label="Filtrer le type d’élément" value={kind} onChange={event => { setKind(event.target.value); setCollapsed(new Set()); }}><option value="all">Listes, tâches et jalons</option><option value="task">Tâches</option><option value="milestone">Jalons</option></select>
      <button type="button" className="text-button nlv-reset" onClick={() => { setQuery(''); setStatus('all'); setResourceId('all'); setKind('all'); setSort('none'); setCollapsed(new Set()); }}>Réinitialiser</button>
      <CreateMenu label="Créer" actions={menuActions()} disabled={locked || deleting !== null || movement.moving} />
    </div>
    <section className="nlv-list-surface" aria-label="Listes du projet"><div className="nlv-table-tools"><div className="nlv-fold-tools" aria-label="Déplier les listes"><button type="button" aria-label="Replier un niveau" title="Replier un niveau" onClick={foldLevel} disabled={!visibleNodes.some(node => !collapsed.has(node.id))}><ChevronUp size={19} /></button><button type="button" aria-label="Déplier un niveau" title="Déplier un niveau" onClick={unfoldLevel} disabled={!visibleNodes.some(node => collapsed.has(node.id))}><ChevronDown size={19} /></button><button type="button" aria-label="Tout replier" title="Tout replier" onClick={() => setCollapsed(new Set(fullTree.nodes.keys()))} disabled={!fullTree.nodes.size}><ChevronsUp size={19} /></button><button type="button" aria-label="Tout déplier" title="Tout déplier" onClick={() => setCollapsed(new Set())} disabled={!collapsed.size}><ChevronsDown size={19} /></button></div><span className="nlv-result-count" role="status">{tree.visibleTasks.length} élément{tree.visibleTasks.length > 1 ? 's' : ''}</span><button className="nlv-columns-button" type="button" aria-label="Configurer les colonnes" title="Configurer les colonnes" onClick={() => setConfiguringColumns(true)}><Settings2 size={18} /></button></div>
      <p className="nlv-drag-help">Glissez le nom ou la poignée d’un élément : en haut pour le placer avant, au centre d’une liste pour l’y ajouter, en bas pour le placer après. Pour placer une liste dans une autre, déposez-la au centre ou utilisez Imbriquer. Un clic sur la poignée permet aussi de choisir la destination. Le déplacement revient à l’ordre manuel.</p>
      <div className="nlv-drag-announcement" aria-live="polite">{movement.moving ? 'Enregistrement du déplacement…' : movement.drop?.label ?? ''}</div>
      <div className="table-scroll lc-table-scroll nlv-table-scroll" inert={movement.moving} role="region" tabIndex={0} aria-label="Liste des tâches et sous-listes"><table className="proj-table lc-task-table nlv-table nlv-resizable" style={{ width: columns.reduce((sum, id) => sum + columnWidth(id), 106), minWidth: columns.reduce((sum, id) => sum + columnWidth(id), 106), tableLayout: 'fixed' }}><colgroup>{columns.map(id => <col key={id} style={{ width: columnWidth(id) }} />)}<col style={{ width: 106 }} /></colgroup><thead><tr>{columns.map(id => <th key={id} scope="col" data-column={id}>{id === 'dates' ? <span className="nlv-dates-heading"><span className="sr-only">Dates planifiées</span><span aria-hidden="true">Début</span><span aria-hidden="true">Fin</span></span> : LIST_COLUMNS.find(column => column.id === id)!.label}<ColumnResizeHandle label={LIST_COLUMNS.find(column => column.id === id)!.label} width={columnWidth(id)} defaultWidth={taskColumnCatalog.find(column => column.id === id)!.width} min={taskColumnCatalog.find(column => column.id === id)!.minWidth} max={900} onChange={width => resizeColumn(id, width, false)} onCommit={width => resizeColumn(id, width, true)} /></th>)}<th scope="col" className="nlv-actions-heading"><span className="sr-only">Actions et commentaires</span></th></tr></thead><tbody>{orderedTaskListItems(tree.rootTasks, tree.roots, sort === 'none').map(item => item.type === 'task' ? taskRow(item.task, 0) : listRows(item.node))}</tbody></table></div>
      {!locked && <div className={`nlv-root-drop${movement.rowClass({ type: 'root' })}`} {...movement.dropProps({ type: 'root' })}>Déposer à la fin du projet, hors des listes</div>}
      {!tree.rootTasks.length && !tree.roots.length && <div className="empty-state nlv-empty"><List size={28} /><h2>Aucun élément à afficher</h2><p>{projectTasks.length || (data.taskLists ?? []).some(list => list.projectId === project.id) ? 'Essayez de modifier vos filtres.' : 'Créez une liste, une tâche ou un jalon pour commencer.'}</p></div>}
    </section>
    {editor && <TaskListDialog props={props} editor={editor} onClose={() => setEditor(null)} />}
    {configuringColumns && <ListColumnsDialog key={storageKey} preferences={preferences} onApply={applyColumns} onClose={() => setConfiguringColumns(false)} />}
    {movement.dialog}
  </div>;
}
