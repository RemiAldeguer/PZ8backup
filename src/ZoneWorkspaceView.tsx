import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, ChevronsDown, ChevronsUp, Flag, Folder, FolderOpen, List, ListTree, Minus, Plus, Search } from 'lucide-react';
import { STATUS_LABELS, TASK_STATUSES, type Project, type TaskStatus, type ViewProps } from '../shared/types';
import { formatHours, isLate } from '../shared/domain';
import { projectStatusLabel } from '../shared/customization';
import { buildZoneElementTree, flattenZoneElements, type ZoneElementRow } from '../shared/zone-elements';
import { isCivilDate } from '../shared/time-integration';
import { ProjectsView } from './ZoneProjectsView';
import { TaskCheck } from './TaskCheck';
import { ProjectGanttView } from './ProjectGanttView';
import './zone-workspace.css';

export type ZoneView = 'projects' | 'list' | 'gantt';
type Props = ViewProps & { zoneId: string | null; view: ZoneView; createProject: () => void; editProject: (project: Project) => void; onZoneChange: (id: string | null) => void };
export function zoneViewHash(zoneId: string | null, view: ZoneView) { return zoneId ? `#zones/${encodeURIComponent(zoneId)}/${view}` : view === 'projects' ? '#projects' : `#projects/${view}`; }
const DAY = 86_400_000;
const stamp = (value: string | null) => value && isCivilDate(value) ? Date.parse(value + 'T00:00:00Z') : null;
const isoDate = (value: number) => new Date(value).toISOString().slice(0, 10);
const dateLabel = (value: string | null) => value ? value.split('-').reverse().join('/') : '—';
const tickLabel = (value: number) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(value));

export function ZoneWorkspaceView(props: Props) {
  return <div className="zv-workspace"><nav className="zv-tabs" aria-label="Vues de la zone">{([
    ['projects', 'Projets', Folder], ['list', 'Liste', List], ['gantt', 'Gantt', CalendarDays],
  ] as const).map(([id, label, Icon]) => <a key={id} href={zoneViewHash(props.zoneId, id)} aria-current={props.view === id ? 'page' : undefined}><Icon size={17} />{label}</a>)}</nav>
    {props.view === 'projects' ? <ProjectsView {...props} /> : props.view === 'gantt' ? <ZoneGanttView {...props} /> : <ZoneElementsView {...props} />}
  </div>;
}

function ZoneGanttView(props: Props) {
  const { data, zoneId } = props;
  const [projectId, setProjectId] = useState('');
  const zone = data.zones.find(item => item.id === zoneId);
  const scopedProjects = data.projects.filter(item => !zoneId || item.zoneId === zoneId);
  const projects = scopedProjects.filter(item => !projectId || item.id === projectId);
  const title = zoneId ? 'Planning Gantt de la zone' : 'Planning Gantt global';
  return <section className="zv-elements" aria-label={title}>
    <header className="zv-heading"><div><span className="zv-context"><FolderOpen size={19} />{zone?.name ?? 'Toutes les zones'}</span><h1>{zoneId ? 'Gantt de la zone' : 'Gantt global'}</h1><p>Les mêmes outils de planning que dans les projets, avec leurs listes, tâches et jalons.</p></div><button type="button" className="button button-primary" onClick={props.createProject}><Plus size={16} />Projet</button></header>
    <div className="zv-toolbar"><label>Zone<select aria-label="Choisir une zone" value={zoneId ?? ''} onChange={event => props.onZoneChange(event.target.value || null)}><option value="">Toutes les zones</option>{data.zones.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Projet<select aria-label="Filtrer les éléments par projet" value={projectId} onChange={event => setProjectId(event.target.value)}><option value="">Tous les projets</option>{scopedProjects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
    {projects.length ? <ProjectGanttView {...props} project={projects[0]} scope={{ projects, key: zoneId ? `zone:${zoneId}` : 'global', title: zoneId ? 'Gantt des projets de la zone' : 'Gantt de tous les projets' }} /> : <div className="zv-empty"><FolderOpen size={31} /><h2>{scopedProjects.length ? 'Aucun projet ne correspond au filtre' : 'Aucun projet dans cette zone'}</h2><p>Créez un projet pour organiser ses listes, tâches et jalons.</p>{projectId && <button type="button" className="button button-secondary" onClick={() => setProjectId('')}>Tous les projets</button>}</div>}
    <p className="zv-note">Chaque modification s’applique au projet de l’élément. Les projets verrouillés restent en lecture seule ; les contraintes relient des éléments du même projet.</p>
  </section>;
}

function ZoneElementsView(props: Props) {
  const { data, zoneId, view, openTask, openProject } = props;
  const [query, setQuery] = useState(''); const [projectId, setProjectId] = useState('');
  const [status, setStatus] = useState<TaskStatus | ''>(''); const [resourceId, setResourceId] = useState('');
  const [kind, setKind] = useState<'task' | 'milestone' | ''>(''); const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [scale, setScale] = useState<'zone' | '30' | '90' | '366'>('zone'); const [periodOffset, setPeriodOffset] = useState(0);
  const zone = data.zones.find(item => item.id === zoneId);
  const scopedProjects = data.projects.filter(project => !zoneId || project.zoneId === zoneId);
  const scopedIds = new Set(scopedProjects.map(project => project.id));
  const scopedTasks = data.tasks.filter(task => scopedIds.has(task.projectId));
  const resources = data.resources.filter(resource => scopedTasks.some(task => task.assigneeId === resource.id));
  const roots = useMemo(() => buildZoneElementTree(data, { zoneId, projectId: projectId || undefined, search: query, status: status || undefined, resourceId: resourceId || undefined, kind: kind || undefined }), [data, zoneId, projectId, query, status, resourceId, kind]);
  const allRows = useMemo(() => flattenZoneElements(roots), [roots]);
  const rows = flattenZoneElements(roots, collapsed);
  const visibleTasks = allRows.filter(row => row.kind === 'task');
  const bounds = allRows.flatMap(row => [stamp(row.startDate), stamp(row.endDate)].filter((value): value is number => value !== null));
  const today = stamp(data.today)!;
  const earliest = bounds.length ? Math.min(...bounds) : today; const latest = bounds.length ? Math.max(...bounds) : today;
  const totalDays = Math.max(30, Math.ceil((latest - earliest) / DAY) + 15);
  const days = scale === 'zone' ? totalDays : Number(scale);
  const start = earliest - 7 * DAY + periodOffset * days * DAY; const end = start + days * DAY;
  const position = (value: number) => (value - start) / (end - start) * 100;
  const todayPosition = position(today);
  function toggle(id: string) { setCollapsed(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function reset() { setQuery(''); setProjectId(''); setStatus(''); setResourceId(''); setKind(''); }
  function name(row: ZoneElementRow) {
    const task = row.task; const children = row.children.length > 0;
    return <div className="zv-row-name" style={{ paddingLeft: 12 + Math.min(row.depth, 20) * 20 }}>
      {children ? <button type="button" className="zv-fold" aria-label={`${collapsed.has(row.id) ? 'Développer' : 'Replier'} ${row.name}`} aria-expanded={!collapsed.has(row.id)} onClick={() => toggle(row.id)}>{collapsed.has(row.id) ? <Plus size={12} /> : <Minus size={12} />}</button> : <span className="zv-fold-placeholder" />}
      {task ? task.kind === 'milestone' ? <Flag size={17} className={isLate(task, data.today) ? 'zv-late' : ''} /> : <TaskCheck task={task} data={data} mutate={props.mutate} notify={props.notify} /> : row.kind === 'project' ? <Folder size={17} className="zv-folder" /> : <ListTree size={17} />}
      <button type="button" className="zv-name-button" onClick={() => task ? openTask(task) : row.kind === 'project' ? openProject(row.project) : toggle(row.id)}>{row.name}</button>
      {!task && <span className="zv-count">{row.aggregate.taskCount}</span>}
      {row.kind === 'project' && <a className="zv-project-link" href={`#project/${encodeURIComponent(row.project.id)}/list`} aria-label={`Ouvrir la liste du projet ${row.name}`} title="Ouvrir la liste du projet"><ChevronRight size={15} /></a>}
    </div>;
  }
  function timeline(row: ZoneElementRow) {
    const rowStart = stamp(row.startDate) ?? stamp(row.endDate); const rowEnd = stamp(row.endDate) ?? stamp(row.startDate);
    const milestone = row.task?.kind === 'milestone';
    const last = rowEnd === null ? null : rowEnd + (milestone ? 0 : DAY);
    const visible = rowStart !== null && last !== null && (milestone ? last >= start : last > start) && rowStart < end;
    const left = rowStart === null ? 0 : Math.max(0, position(rowStart));
    const width = last === null ? 0 : Math.max(.3, Math.min(100, position(last)) - left);
    return <div className="zv-gantt-track">
      {Array.from({ length: 7 }, (_, index) => <span key={index} className="zv-gridline" style={{ left: `${index / 6 * 100}%` }} />)}
      {todayPosition >= 0 && todayPosition <= 100 && <span className="zv-today-line" style={{ left: `${todayPosition}%` }} title="Aujourd’hui" />}
      {visible ? <button type="button" className={`zv-gantt-bar zv-bar-${row.kind}${row.task ? ` zv-bar-${row.task.status}` : ''}${milestone ? ' zv-milestone' : ''}`} style={{ left: `${Math.min(left, 99)}%`, width: milestone ? undefined : `${width}%` }} aria-label={`Ouvrir ${row.name} dans le Gantt`} title={`${row.name} · ${dateLabel(row.startDate)} — ${dateLabel(row.endDate)}`} onClick={() => row.task ? openTask(row.task) : row.kind === 'project' ? openProject(row.project) : toggle(row.id)}>{milestone ? <Flag size={14} /> : <><span className="zv-gantt-progress" style={{ width: `${row.task?.progress ?? 0}%` }} /><span className="zv-bar-label">{row.name}</span></>}</button> : rowStart === null ? <span className="zv-undated">Sans date planifiée</span> : null}
    </div>;
  }
  return <section className="zv-elements" aria-label={view === 'list' ? 'Liste des éléments de la zone' : 'Planning Gantt de la zone'}>
    <header className="zv-heading"><div><span className="zv-context"><FolderOpen size={19} />{zone?.name ?? 'Toutes les zones'}</span><h1>{view === 'list' ? 'Liste de la zone' : 'Gantt de la zone'}</h1><p>Projets, listes, sous-listes, tâches et jalons dans un même {view === 'list' ? 'tableau' : 'planning'}.</p></div><button type="button" className="button button-primary" onClick={props.createProject}><Plus size={16} />Projet</button></header>
    <div className="zv-toolbar">
      <label>Zone<select aria-label="Choisir une zone" value={zoneId ?? ''} onChange={event => props.onZoneChange(event.target.value || null)}><option value="">Toutes les zones</option>{data.zones.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Projet<select aria-label="Filtrer les éléments par projet" value={projectId} onChange={event => setProjectId(event.target.value)}><option value="">Tous les projets</option>{scopedProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <label>Statut<select aria-label="Statut des éléments de la zone" value={status} onChange={event => setStatus(event.target.value as TaskStatus | '')}><option value="">Tous les statuts</option>{TASK_STATUSES.map(item => <option key={item} value={item}>{STATUS_LABELS[item]}</option>)}</select></label>
      <label>Ressource<select aria-label="Ressource des éléments de la zone" value={resourceId} onChange={event => setResourceId(event.target.value)}><option value="">Tout le monde</option><option value="unassigned">Non assignés</option>{resources.map(resource => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select></label>
      <label>Type<select aria-label="Type des éléments de la zone" value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="">Tâches et jalons</option><option value="task">Tâches</option><option value="milestone">Jalons</option></select></label>
      <label className="zv-search"><Search size={15} /><input type="search" aria-label="Rechercher un élément de la zone" placeholder="Projet, liste, tâche ou tag…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      {(query || projectId || status || resourceId || kind) && <button type="button" className="zv-reset" onClick={reset}>Réinitialiser les filtres</button>}
    </div>
    <div className="zv-display-controls"><span>{roots.length} projet{roots.length > 1 ? 's' : ''} · {visibleTasks.length} élément{visibleTasks.length > 1 ? 's' : ''}</span><button type="button" className="button button-secondary" onClick={() => setCollapsed(new Set(allRows.filter(row => row.children.length).map(row => row.id)))}><ChevronsUp size={15} />Tout replier</button><button type="button" className="button button-secondary" onClick={() => setCollapsed(new Set())}><ChevronsDown size={15} />Tout déplier</button></div>
    {view === 'gantt' && <div className="zv-gantt-controls"><button type="button" className="icon-button" aria-label="Période précédente du Gantt de zone" onClick={() => setPeriodOffset(value => value - 1)}><ChevronLeft size={18} /></button><strong>{dateLabel(isoDate(start))} — {dateLabel(isoDate(end - DAY))}</strong><button type="button" className="icon-button" aria-label="Période suivante du Gantt de zone" onClick={() => setPeriodOffset(value => value + 1)}><ChevronRight size={18} /></button><select aria-label="Échelle du Gantt de zone" value={scale} onChange={event => { setScale(event.target.value as typeof scale); setPeriodOffset(0); }}><option value="zone">Vue de la zone</option><option value="30">Mois</option><option value="90">Trimestre</option><option value="366">Année</option></select><button type="button" className="button button-secondary" onClick={() => setPeriodOffset(Math.floor((today - (earliest - 7 * DAY)) / (days * DAY)))}>Aujourd’hui</button></div>}
    {roots.length ? <div className="zv-table-scroll" role="region" aria-label="Éléments de zone, défilement horizontal" tabIndex={0}><table className={`zv-table${view === 'gantt' ? ' zv-gantt-table' : ''}`} aria-label={view === 'list' ? 'Éléments de la zone' : 'Gantt de la zone'}><thead><tr><th scope="col">Projet / liste / élément</th>{view === 'gantt' ? <th scope="col"><div className="zv-gantt-axis">{Array.from({ length: 7 }, (_, index) => <span key={index} style={{ left: `${index / 6 * 100}%` }}>{tickLabel(start + index / 6 * (end - start))}</span>)}</div></th> : <><th scope="col">Statut</th><th scope="col">Tags</th><th scope="col">Assigné à</th><th scope="col">Début</th><th scope="col">Fin</th><th scope="col">Alloué</th><th scope="col">Passé</th></>}</tr></thead><tbody>{rows.map(row => <tr key={row.id} className={`zv-row zv-row-${row.kind}`} data-project-id={row.project.id} data-task-id={row.task?.id} data-list-id={row.list?.id} data-row-kind={row.kind} data-depth={row.depth}><th scope="row">{name(row)}</th>{view === 'gantt' ? <td>{timeline(row)}</td> : <><td><span className={`zv-status${row.task ? ` zv-status-${row.task.status}` : ''}`}>{row.task ? STATUS_LABELS[row.task.status] : row.kind === 'project' ? projectStatusLabel(row.project, data) : 'Liste'}</span></td><td><div className="zv-tags">{row.task?.tags.map(tag => <span key={tag}>{tag}</span>)}</div></td><td>{row.task?.assigneeId ? (() => { const resource = data.resources.find(item => item.id === row.task!.assigneeId); return resource ? <button type="button" className="zv-assignee" onClick={() => props.openResource?.(resource)} title={resource.name}><span style={{ backgroundColor: resource.color }}>{resource.initials}</span>{resource.name}</button> : '—'; })() : '—'}</td><td className="zv-date">{dateLabel(row.startDate)}</td><td className={`zv-date${row.task && isLate(row.task, data.today) ? ' zv-late' : ''}`}>{dateLabel(row.endDate)}</td><td className="zv-number">{formatHours(row.aggregate.allocatedHours)}</td><td className="zv-number">{formatHours(row.spentHours)}</td></>}</tr>)}</tbody></table></div> : <div className="zv-empty"><FolderOpen size={31} /><h2>{scopedProjects.length ? 'Aucun élément ne correspond aux filtres' : 'Aucun projet dans cette zone'}</h2><p>{scopedProjects.length ? 'Modifiez la recherche ou les filtres pour retrouver les éléments.' : 'Créez un projet pour organiser ses listes, tâches et jalons.'}</p>{scopedProjects.length > 0 && <button type="button" className="button button-secondary" onClick={reset}>Effacer les filtres</button>}</div>}
    <p className="zv-note">Les totaux des projets et listes incluent tous leurs éléments, même ceux masqués par les filtres. {view === 'gantt' && 'Le planning affiche les dates prévues ; les éléments sans date restent accessibles par leur nom.'}</p>
  </section>;
}
