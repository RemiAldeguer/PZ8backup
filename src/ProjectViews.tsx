import { useState, type CSSProperties, type DragEvent } from 'react';
import {
  ArrowRight, CalendarDays, CheckCircle2, ChevronDown,
  ChevronLeft, ChevronRight, Clock3, Flag, GripVertical,
  Plus, Search, Sun, Users,
} from 'lucide-react';
import {
  STATUS_LABELS, TASK_STATUSES, type Resource, type Task, type TaskStatus, type ViewProps,
} from '../shared/types';
import { formatDate, formatHours, formatMoney, isLate, taskMetrics } from '../shared/domain';
import { NestedListView } from './NestedListView';
import { ProjectGanttView } from './ProjectGanttView';
import { associatedResourceProjectIds } from '../shared/resources';
import { projectStatusLabel } from '../shared/customization';
import { ProjectRoleControl } from './RoleSelect';
import { canProject, projectMemberIds } from '../shared/permissions';
import { ProjectTeamMembership } from './ProjectTeamMembership';
import { TaskCheck } from './TaskCheck';
import './task-check-project.css';
import './project-summary-actions.css';
import './list-columns.css';

const DAY = 86_400_000;
const stamp = (date: string) => Date.parse(`${date.slice(0, 10)}T12:00:00Z`);
const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const shortDate = (date: string) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(stamp(date)));
const resourceType = { human: 'Humaine', virtual: 'Virtuelle', material: 'Matérielle' };

function ProjectHeading({ title, description, props, action = true }: { title: string; description: string; props: ViewProps; action?: boolean }) {
  const zone = props.data.zones.find((item) => item.id === props.project.zoneId);
  return <header className="proj-header">
    <div><div className="eyebrow">{zone?.name ?? 'Projet'} <span aria-hidden="true">/</span> {props.project.name}</div><h1>{title}</h1><p>{description}</p></div>
    {action && canProject(props.data, props.project.id, 'taskCreate') && <button className="button button-primary" onClick={() => props.createTask()} disabled={props.project.status === 'closed' || props.project.status === 'paused'}><Plus size={17} /> Nouvelle tâche</button>}
  </header>;
}

function Avatar({ resource, size = '' }: { resource: Resource; size?: string }) {
  return <span className={`avatar ${size}`} style={{ '--avatar-color': resource.color, backgroundColor: resource.color } as CSSProperties} title={resource.name}>{resource.initials}</span>;
}

function StatusSelect({ task, props, compact = false }: { task: Task; props: ViewProps; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  return <select className={`status-select status-${task.status}${compact ? ' compact' : ''}`} aria-label={`Statut de ${task.title}`} value={task.status}
    disabled={busy || props.project.status === 'closed' || props.project.status === 'paused'}
    onChange={async (event) => {
      const status = event.currentTarget.value as TaskStatus;
      setBusy(true);
      try { await props.mutate('tasks', 'PATCH', { status }, task.id); }
      catch (error) { props.notify(error instanceof Error ? error.message : 'Impossible de modifier ce statut.'); }
      finally { setBusy(false); }
    }}>{TASK_STATUSES.map((status) => <option value={status} key={status}>{STATUS_LABELS[status]}</option>)}</select>;
}

function ProjectStateNotice({ props }: { props: ViewProps }) {
  return props.project.status === 'paused' || props.project.status === 'closed'
    ? <div className="notice">Ce projet est {projectStatusLabel(props.project, props.data).toLocaleLowerCase('fr')}. Ses données sont disponibles en lecture.</div> : null;
}

export { ProjectSummaryView as SummaryView } from './ProjectSummaryView';

export function ListView(props: ViewProps) {
  return <NestedListView key={props.project.id} {...props} />;
}

export function BoardView(props: ViewProps) {
  const [query, setQuery] = useState('');
  const [dragged, setDragged] = useState<string | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const tasks = props.data.tasks.filter((task) => task.projectId === props.project.id && task.kind === 'task' && task.title.toLocaleLowerCase('fr').includes(query.toLocaleLowerCase('fr')));
  const editable = props.project.status !== 'closed' && props.project.status !== 'paused';
  async function onDrop(event: DragEvent<HTMLElement>, status: TaskStatus) {
    event.preventDefault(); setOver(null); setDragged(null);
    const id = event.dataTransfer.getData('application/planzone-task') || event.dataTransfer.getData('text/plain');
    const task = tasks.find((item) => item.id === id);
    if (!editable || busy || !task || task.status === status) return;
    setBusy(true);
    try { await props.mutate('tasks', 'PATCH', { status }, task.id); }
    catch (error) { props.notify(error instanceof Error ? error.message : 'Impossible de déplacer cette tâche.'); }
    finally { setBusy(false); }
  }
  return <div><ProjectHeading title="Tableau de suivi" description="Faites avancer les tâches d’une étape à l’autre, à votre rythme." props={props} /><ProjectStateNotice props={props} /><div className="proj-toolbar"><label className="search-field"><Search size={17} /><input placeholder="Rechercher une tâche…" aria-label="Rechercher dans le tableau" value={query} onChange={(event) => setQuery(event.target.value)} /></label><span className="muted">Glissez une carte ou utilisez son menu de statut.</span>{busy && <span role="status" className="muted">Enregistrement…</span>}</div>
    <div className="proj-board">{TASK_STATUSES.map((status) => {
      const column = tasks.filter((task) => task.status === status);
      return <section key={status} className={`proj-board-column ${over === status ? 'drag-over' : ''}`} data-status={status} aria-label={STATUS_LABELS[status]}
        onDragOver={(event) => { if (editable && !busy) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setOver(status); } }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null); }} onDrop={(event) => { void onDrop(event, status); }}>
        <div className="proj-board-heading"><span className={`status-dot status-${status}`} /><h2>{STATUS_LABELS[status]}</h2><span className="subtle-badge">{column.length}</span></div><div className="proj-board-cards">{column.map((task) => {
          const resource = props.data.resources.find((item) => item.id === task.assigneeId);
          return <article className={`card proj-task-card ${dragged === task.id ? 'is-dragging' : ''}`} key={task.id} draggable={editable && !busy} onDragStart={(event) => { event.dataTransfer.setData('application/planzone-task', task.id); event.dataTransfer.setData('text/plain', task.id); event.dataTransfer.effectAllowed = 'move'; setDragged(task.id); }} onDragEnd={() => { setDragged(null); setOver(null); }}>
            <div className="proj-card-phase"><span>{task.phase || 'Sans phase'}</span><GripVertical size={14} aria-hidden="true" /></div><button className="proj-card-open" onClick={() => props.openTask(task)}>{task.title}</button>{task.tags.length > 0 && <div className="tag-list">{task.tags.slice(0, 2).map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div>}<div className="proj-card-footer"><span className={isLate(task, props.data.today) ? 'text-danger' : 'muted'}><CalendarDays size={13} /> {task.endDate ? shortDate(task.endDate) : 'Sans date'}</span>{resource && <Avatar resource={resource} />}</div><div className="proj-card-progress"><div className="progress-bar"><span style={{ width: `${task.progress}%` }} /></div><span>{task.progress}%</span></div><StatusSelect task={task} props={props} compact />
          </article>;
        })}{column.length === 0 && <div className="proj-board-empty">Aucune tâche à cette étape</div>}</div>
      </section>;
    })}</div>
  </div>;
}

export function GanttView(props: ViewProps) {
  return <ProjectGanttView key={props.project.id} {...props} />;
}

export { CalendarView } from './CalendarView';

export function TeamView(props: ViewProps) {
  const { data, project } = props;
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const tasks = data.tasks.filter((task) => task.projectId === project.id);
  const memberIds = projectMemberIds(data, project);
  const assigned = data.resources.filter(resource => memberIds.has(resource.id));
  const resources = assigned.filter((resource) => resource.name.toLocaleLowerCase('fr').includes(query.toLocaleLowerCase('fr')) && (type === 'all' || resource.type === type));
  const unassigned = tasks.filter((task) => task.kind === 'task' && task.assigneeId === null).length;
  return <div><ProjectHeading title="Équipe du projet" description="Les membres du projet, leurs affectations et leur contribution." props={props} /><ProjectTeamMembership props={props} /><div className="proj-resource-types">{(['human', 'virtual', 'material'] as const).map((resourceKind) => <div className="card" key={resourceKind}><Users size={19} /><span className="muted">Ressources {resourceKind === 'human' ? 'humaines' : resourceKind === 'virtual' ? 'virtuelles' : 'matérielles'}</span><strong>{assigned.filter((resource) => resource.type === resourceKind).length}</strong></div>)}</div><div className="proj-toolbar"><label className="search-field"><Search size={17} /><input placeholder="Rechercher une ressource…" aria-label="Rechercher une ressource du projet" value={query} onChange={(event) => setQuery(event.target.value)} /></label><select aria-label="Filtrer par type de ressource" value={type} onChange={(event) => setType(event.target.value)}><option value="all">Tous les types</option><option value="human">Humaines</option><option value="virtual">Virtuelles</option><option value="material">Matérielles</option></select><span className="muted">{unassigned} tâche{unassigned > 1 ? 's' : ''} non assignée{unassigned > 1 ? 's' : ''}</span></div><section className="card proj-resource-card"><div className="table-scroll"><table className="proj-table"><thead><tr><th>Ressource</th><th>Nature</th><th>Classification</th><th>Rôle projet</th><th>Profil de coût</th><th>Tâches</th><th>Alloué</th><th>Temps déclaré</th></tr></thead><tbody>{resources.map((resource) => {
      const resourceTasks = tasks.filter((task) => task.assigneeId === resource.id);
      const profile = data.profiles.find((item) => item.id === resource.profileId);
      const taskIds = new Set(tasks.map((task) => task.id));
      const hours = data.timeEntries.filter((entry) => entry.resourceId === resource.id && taskIds.has(entry.taskId)).reduce((sum, entry) => sum + entry.hours, 0);
      return <tr key={resource.id}><td><span className="proj-person"><Avatar resource={resource} /><span><button className="text-button" aria-label={`Ouvrir la fiche de ${resource.name}`} onClick={() => props.openResource?.(resource)}><strong>{resource.name}</strong></button><small className="muted">{resource.jobTitle || 'Fonction non renseignée'}{!resource.active && ' · Inactive'}</small></span></span></td><td>{resourceType[resource.type]}</td><td>{resource.classification === 'internal' ? 'Interne' : 'Externe'}</td><td><ProjectRoleControl data={data} project={project} resource={resource} mutate={props.mutate} notify={props.notify} /></td><td>{profile ? <span className="proj-profile-label"><strong>{profile.name}</strong><small>{formatMoney(profile.dailyRate)} / jour</small></span> : <span className="muted">Aucun profil attribué</span>}</td><td>{resourceTasks.filter((task) => task.kind === 'task').length}</td><td className="numeric">{formatHours(resourceTasks.reduce((sum, task) => sum + task.allocatedHours, 0))}</td><td className="numeric">{formatHours(hours)}</td></tr>;
    })}</tbody></table></div>{resources.length === 0 && <div className="empty-state"><Users size={30} /><p>{assigned.length ? 'Aucune ressource ne correspond aux filtres.' : 'Associez une ressource depuis sa fiche ou affectez-la à une tâche.'}</p></div>}</section><p className="muted proj-view-note">Cliquez sur une ressource pour ouvrir sa fiche. Les projets associés et les affectations aux tâches déterminent les membres de cette équipe.</p></div>;
}
