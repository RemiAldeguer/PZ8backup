import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { CalendarDays, Check, CheckCircle2, AlertCircle, ArrowRight, Search, ChevronLeft, ChevronRight, Clock3, Flag, Folder, LayoutDashboard, Link2, LockKeyhole, MessageSquare, Umbrella } from 'lucide-react';
import { STATUS_LABELS, type Resource, type Task, type ViewProps } from '../shared/types';
import { formatDate, isLate } from '../shared/domain';
import { addCalendarDays, weekDates } from '../shared/time-sheets';
import { personalCalendarItems, personalCalendarTimeRange, personalTaskDependency, personalTaskGroups, personalTimedLayout, personalWeekNumber, type PersonalCalendarItem } from '../shared/personal-calendar';
import { Modal } from './Dialogs';
import { TaskCheck } from './TaskCheck';
import './personal-view.css';
import { globalRole, isAdmin } from '../shared/permissions';
import { PersonalNavigation } from './PersonalNavigation';
import { PlanningWarnings } from './PlanningWarnings';

const weekdays = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
const dateObject = (date: string) => new Date(`${date}T12:00:00Z`);
const monthLabel = (date: string) => new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(dateObject(date));
const dayLabel = (date: string) => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(dateObject(date));
const monthShort = (date: string) => new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' }).format(dateObject(date));
const clock = (minutes: number) => `${Math.floor(minutes / 60).toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`;
const entryKey = (entry: PersonalCalendarItem) => `${entry.kind}-${entry.item.id}`;
const projectHref = (id: string) => `#project/${encodeURIComponent(id)}/summary`;

function textColor(color: string): string {
  const channels = /^#[a-f0-9]{6}$/i.test(color) ? color.slice(1).match(/.{2}/g)!.map(channel => {
    const value = parseInt(channel, 16) / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  }) : [0, 0, 0];
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2] > .179 ? '#000' : '#fff';
}

function ResourceAvatar({ resource, initials }: { resource?: Resource; initials?: string }) {
  return <span className="pd-avatar" style={{ background: resource?.color ?? '#65d6eb', color: textColor(resource?.color ?? '#65d6eb') }} aria-hidden="true">{resource?.initials ?? initials ?? '?'}</span>;
}

function TaskCard({ title, tasks, late, completed, props }: { title: string; tasks: Task[]; late?: boolean; completed?: boolean; props: ViewProps }) {
  const [sort, setSort] = useState<{ key: 'title' | 'status' | 'date'; ascending: boolean }>({ key: 'date', ascending: true });
  const sorted = [...tasks].sort((a, b) => {
    const left = sort.key === 'title' ? a.title : sort.key === 'status' ? STATUS_LABELS[a.status] : a.endDate ?? '9999-12-31';
    const right = sort.key === 'title' ? b.title : sort.key === 'status' ? STATUS_LABELS[b.status] : b.endDate ?? '9999-12-31';
    return left.localeCompare(right, 'fr') * (sort.ascending ? 1 : -1);
  });
  const toggleSort = (key: typeof sort.key) => setSort(previous => ({ key, ascending: previous.key === key ? !previous.ascending : true }));
  const sortLabel = (key: typeof sort.key, label: string) => <button onClick={() => toggleSort(key)} aria-label={`Trier ${title.toLocaleLowerCase('fr')} par ${label.toLocaleLowerCase('fr')}`}>
    {label}<span aria-hidden="true">{sort.key === key ? sort.ascending ? '↑' : '↓' : '↕'}</span>
  </button>;
  return <section className={`pd-card pd-task-card${late ? ' pd-late-card' : ''}`} aria-label={title}>
    <header className="pd-card-heading"><h2>{title}</h2><span className={`pd-count ${late ? 'pd-count-red' : completed ? 'pd-count-green' : 'pd-count-blue'}`}>{tasks.length}</span></header>
    <div className="pd-task-table-scroll" tabIndex={0} aria-label={`Liste complète : ${title.toLocaleLowerCase('fr')}`}>
      <table className="pd-task-table"><thead><tr><th className="pd-check-heading"><Check size={15} aria-hidden="true" /><span className="sr-only">Validation</span></th>
        <th aria-sort={sort.key === 'title' ? sort.ascending ? 'ascending' : 'descending' : 'none'}>{sortLabel('title', 'Nom')}</th>
        <th aria-sort={sort.key === 'status' ? sort.ascending ? 'ascending' : 'descending' : 'none'}>{sortLabel('status', 'Statut')}</th>
        <th aria-sort={sort.key === 'date' ? sort.ascending ? 'ascending' : 'descending' : 'none'}>{sortLabel('date', 'Date de fin')}</th></tr></thead>
        <tbody>{sorted.map(task => {
          const project = props.data.projects.find(item => item.id === task.projectId);
          const dependency = personalTaskDependency(task, props.data.tasks);
          return <tr key={task.id} className={`${isLate(task, props.data.today) ? 'pd-task-late' : ''}${dependency ? ' pd-task-blocked' : ''}`}>
            <td className="pd-task-check"><TaskCheck task={task} data={props.data} mutate={props.mutate} notify={props.notify} /></td>
            <td className="pd-task-name"><button className="pd-task-open" onClick={() => props.openTask(task)}>{task.title}</button>
              {project && <a className="pd-task-project" href={projectHref(project.id)}>{project.name}</a>}
              {dependency && <button className="pd-dependency" onClick={() => props.openTask(dependency)} title={`En attente de ${dependency.title}`}><LockKeyhole size={11} aria-hidden="true" /><span>En attente de {dependency.title}</span></button>}</td>
            <td><button className={`pd-status pd-status-${task.status}`} aria-label={`Ouvrir le statut de ${task.title}`} onClick={() => props.openTask(task)}>{STATUS_LABELS[task.status]}<ChevronRight size={16} aria-hidden="true" /></button></td>
            <td className="pd-task-date">{task.endDate ? <time dateTime={task.endDate}>{new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(dateObject(task.endDate))}</time> : <span>Non planifié</span>}</td>
          </tr>;
        })}</tbody></table>
      {!tasks.length && <p className="pd-empty">{late ? 'Aucune tâche en retard.' : completed ? 'Aucune tâche terminée dans ce filtre.' : 'Aucune tâche à venir ou ouverte dans ce filtre.'}</p>}
    </div>
  </section>;
}

function CalendarEntry({ entry, date, props, onOpen, className = '', style }: {
  entry: PersonalCalendarItem; date: string; props: ViewProps; onOpen: (entry: PersonalCalendarItem) => void;
  className?: string; style?: CSSProperties;
}) {
  const projectId = 'projectId' in entry.item ? entry.item.projectId : undefined;
  const project = props.data.projects.find(item => item.id === projectId);
  const range = personalCalendarTimeRange(entry, date);
  const background = entry.kind === 'unavailability' ? '#233036' : entry.kind === 'milestone' ? '#a23f36' : project?.color ?? '#657647';
  const Icon = entry.kind === 'task' ? Check : entry.kind === 'milestone' ? Flag : entry.kind === 'event' ? CalendarDays : Umbrella;
  const time = range ? `${clock(range.start)} – ${clock(range.end)}` : entry.kind === 'milestone' ? 'Jalon' : 'Toute la journée';
  return <button className={`pd-calendar-entry pd-entry-${entry.kind} ${className}`} data-calendar-item-id={entry.item.id}
    style={{ background, color: textColor(background), ...style }} onClick={() => onOpen(entry)}
    title={`${entry.item.title} · ${time}${project ? ` · ${project.name}` : ''}`}>
    <Icon size={13} aria-hidden="true" /><span><small>{time}</small><strong>{entry.item.title}</strong></span>
  </button>;
}

function CalendarDetails({ entry, props, onClose }: { entry: PersonalCalendarItem; props: ViewProps; onClose: () => void }) {
  if (entry.kind === 'task' || entry.kind === 'milestone') return null;
  const item = entry.item;
  const project = entry.kind === 'event' ? props.data.projects.find(value => value.id === entry.item.projectId) : undefined;
  const resourceIds = entry.kind === 'event' ? entry.item.resourceIds : [entry.item.resourceId];
  const resourceNames = props.data.resources.filter(resource => resourceIds.includes(resource.id)).map(resource => resource.name);
  return <Modal title={entry.kind === 'event' ? 'Événement' : 'Indisponibilité'} onClose={onClose}><div className="modal-body pd-calendar-detail">
    <h2>{item.title}</h2><p>{formatDate(item.startDate)}{item.endDate !== item.startDate ? ` au ${formatDate(item.endDate)}` : ''}</p>
    <p>{item.allDay ? 'Toute la journée' : `${item.startTime} – ${item.endTime}`}</p>
    {resourceNames.length > 0 && <p><strong>{entry.kind === 'event' ? 'Participants : ' : 'Ressource : '}</strong>{resourceNames.join(', ')}</p>}
    {entry.kind === 'unavailability' && <p><strong>Type : </strong>{{ leave: 'Congés', sick: 'Maladie', other: 'Autre' }[entry.item.reason]}</p>}
    {entry.kind === 'event' && entry.item.description && <p className="pd-detail-description">{entry.item.description}</p>}
    {project && <a href={projectHref(project.id)} onClick={onClose}><Folder size={16} />{project.name}</a>}
  </div><div className="modal-footer"><button className="button button-secondary" onClick={onClose}>Fermer</button><a className="button button-primary" href="#calendar" onClick={onClose}><Link2 size={15} />Ouvrir le calendrier</a></div></Modal>;
}

function PersonalCalendar({ props, resourceId, includeBlocked }: { props: ViewProps; resourceId: string; includeBlocked: boolean }) {
  const [selectedDate, setSelectedDate] = useState(props.data.today);
  const [detail, setDetail] = useState<PersonalCalendarItem | null>(null);
  const timeline = useRef<HTMLDivElement>(null);
  const dates = weekDates(selectedDate);
  const days = useMemo(() => dates.map(date => ({ date, entries: personalCalendarItems(props.data, resourceId, date, includeBlocked) })), [dates.join(','), props.data, resourceId, includeBlocked]);
  const selected = days.find(day => day.date === selectedDate)!.entries;
  const allDay = selected.filter(entry => !personalCalendarTimeRange(entry, selectedDate));
  const timed = personalTimedLayout(selected, selectedDate);
  const onOpen = (entry: PersonalCalendarItem) => {
    if (entry.kind === 'task' || entry.kind === 'milestone') props.openTask(entry.item);
    else setDetail(entry);
  };
  useEffect(() => {
    if (timeline.current) timeline.current.scrollTop = Math.max(0, Math.floor((timed[0]?.start ?? 8 * 60) / 60) - 1) * 40;
  }, [selectedDate, resourceId]);
  return <section className="pd-card pd-calendar-card" aria-label="Mon calendrier hebdomadaire">
    <header className="pd-card-heading"><h2>{monthLabel(selectedDate)}</h2><CalendarDays size={18} aria-hidden="true" /></header>
    <div className="pd-calendar-toolbar"><div className="pd-week-control">
      <button aria-label="Semaine précédente" onClick={() => setSelectedDate(date => addCalendarDays(date, -7))}><ChevronLeft size={19} /></button>
      <span>Semaine {personalWeekNumber(selectedDate)}</span><button aria-label="Semaine suivante" onClick={() => setSelectedDate(date => addCalendarDays(date, 7))}><ChevronRight size={19} /></button>
    </div><button className="pd-today" onClick={() => setSelectedDate(props.data.today)}>Aujourd’hui</button></div>
    <p className="pd-calendar-range">Du {formatDate(dates[0])} au {formatDate(dates[6])}</p>
    <div className="pd-calendar-panels">
      <div className="pd-week-list" tabIndex={0} aria-label="Agenda de la semaine">
        {days.map(({ date, entries }, index) => <section key={date} className={`pd-week-day${index >= 5 ? ' pd-weekend' : ''}${date === props.data.today ? ' pd-current-day' : ''}${date === selectedDate ? ' pd-selected-day' : ''}`} data-date={date} aria-label={dayLabel(date)}>
          <button className="pd-day-select" aria-pressed={date === selectedDate} aria-label={`Afficher ${dayLabel(date)}`} onClick={() => setSelectedDate(date)}><small>{weekdays[index]}</small><strong>{date.slice(8)}</strong><small>{monthShort(date)}</small></button>
          <div className="pd-day-entries">{entries.length ? entries.map(entry => <CalendarEntry key={entryKey(entry)} entry={entry} date={date} props={props} onOpen={onOpen} />) : <p>Aucun élément planifié</p>}</div>
        </section>)}
      </div>
      <section className="pd-day-agenda" aria-label={`Détail du ${dayLabel(selectedDate)}`}><h3>{dayLabel(selectedDate)}</h3>
        <div className="pd-day-all-day"><h4>Toute la journée</h4>{allDay.length ? allDay.map(entry => <CalendarEntry key={entryKey(entry)} entry={entry} date={selectedDate} props={props} onOpen={onOpen} />) : <p>Aucun élément pour la journée entière.</p>}</div>
        <div className="pd-timed-heading"><h4>Horaires</h4><span>{timed.length} rendez-vous</span></div>
        {timed.length > 0 ? <div className="pd-timeline-scroll" ref={timeline} tabIndex={0} aria-label={`Horaires du ${dayLabel(selectedDate)}`}><div className="pd-timeline">
          {Array.from({ length: 24 }, (_, hour) => <div className="pd-hour" key={hour} style={{ top: hour * 40 }}><time>{clock(hour * 60)}</time><span /></div>)}
          <div className="pd-timed-items">{timed.map(item => <CalendarEntry key={entryKey(item.entry)} className="pd-timed-entry" entry={item.entry} date={selectedDate} props={props} onOpen={onOpen}
            style={{ top: item.start / 60 * 40, height: Math.max(28, (item.end - item.start) / 60 * 40), left: `${item.lane / item.lanes * 100}%`, width: `${100 / item.lanes}%` }} />)}</div>
        </div></div> : <p className="pd-empty pd-no-timed">Aucun événement ni indisponibilité avec horaires ce jour.</p>}
      </section>
    </div>
    <footer className="pd-calendar-footer"><a href="#calendar"><CalendarDays size={15} />Ouvrir le calendrier complet</a><span><i className="pd-legend-today" />Aujourd’hui<i className="pd-legend-weekend" />Week-end</span></footer>
    {detail && <CalendarDetails entry={detail} props={props} onClose={() => setDetail(null)} />}
  </section>;
}

export function PersonalView(props: ViewProps) {
  const [resourceId, setResourceId] = useState(props.data.currentUser.id);
  const [includeBlocked, setIncludeBlocked] = useState(true);
  const [taskScope, setTaskScope] = useState<'all' | 'upcoming' | 'overdue' | 'completed'>('all');
  const [search, setSearch] = useState('');
  const resource = props.data.resources.find(item => item.id === resourceId);
  const actualId = resource || resourceId === props.data.currentUser.id ? resourceId : props.data.currentUser.id;
  const groups = personalTaskGroups(props.data, actualId, includeBlocked);
  const simplify = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('fr');
  const matching = (task: Task) => !search.trim() || simplify([task.title, ...task.tags, props.data.projects.find(project => project.id === task.projectId)?.name ?? ''].join(' ')).includes(simplify(search.trim()));
  const upcoming = groups.upcoming.filter(matching), overdue = groups.overdue.filter(matching), completed = groups.completed.filter(matching);
  const choose = (scope: typeof taskScope) => setTaskScope(previous => previous === scope ? 'all' : scope);
  const resources = [...props.data.resources].sort((a, b) => Number(b.id === props.data.currentUser.id) - Number(a.id === props.data.currentUser.id) || a.name.localeCompare(b.name, 'fr'));
  if (globalRole(props.data) === 'visitor') return <div className="pd-personal-view"><PersonalNavigation active="summary" data={props.data} /><div className="card empty-state"><h1>Mon espace</h1><p>Vos projets, documents et discussions sont accessibles depuis la navigation.</p><button className="button button-secondary" onClick={() => props.openResource?.(props.data.resources.find(resource => resource.id === props.data.currentUser.id) ?? null)}>Ma capacité</button></div></div>;
  return <div className="pd-personal-view">
    <PersonalNavigation active="summary" data={props.data} />
    <header className="pd-summary-toolbar"><div className="pd-summary-title"><h1>{actualId === props.data.currentUser.id ? 'Ma synthèse' : `Synthèse de ${resource?.name ?? props.data.currentUser.name}`}</h1><p>Vos priorités et votre planning, au même endroit.</p></div><button className="button button-secondary" onClick={() => props.openResource?.(props.data.resources.find(resource => resource.id === actualId) ?? null)}>Ma capacité<ArrowRight size={15} /></button>
      <div className="pd-summary-controls"><label className="pd-blocked-switch">Tâches bloquées<input type="checkbox" role="switch" checked={includeBlocked} onChange={event => setIncludeBlocked(event.target.checked)} aria-label="Afficher les tâches bloquées" /><span aria-hidden="true" /></label>
        <label className="pd-resource-select"><strong>La synthèse de</strong><span className="pd-resource-picker"><ResourceAvatar resource={resource} initials={props.data.currentUser.name.slice(0, 1)} /><select disabled={!isAdmin(props.data)} aria-label="La synthèse de" value={actualId} onChange={event => setResourceId(event.target.value)}>
          {!props.data.resources.some(item => item.id === props.data.currentUser.id) && <option value={props.data.currentUser.id}>{props.data.currentUser.name}</option>}
          {resources.map(item => <option key={item.id} value={item.id}>{item.name}{item.id === props.data.currentUser.id ? ' (Moi)' : ''}{!item.active ? ' (inactive)' : ''}</option>)}
        </select></span></label></div>
    </header>
    <div className="pd-summary-metrics" aria-label="Résumé des tâches">
      <button type="button" className="pd-summary-metric" aria-pressed={taskScope === 'upcoming'} onClick={() => choose('upcoming')}><span className="pd-metric-icon"><Clock3 size={20} /></span><span><small>À venir et ouvertes</small><strong>{groups.upcoming.length}</strong></span></button>
      <button type="button" className="pd-summary-metric pd-metric-late" aria-pressed={taskScope === 'overdue'} onClick={() => choose('overdue')}><span className="pd-metric-icon"><AlertCircle size={20} /></span><span><small>En retard</small><strong>{groups.overdue.length}</strong></span></button>
      <button type="button" className="pd-summary-metric pd-metric-completed" aria-pressed={taskScope === 'completed'} onClick={() => choose('completed')}><span className="pd-metric-icon"><CheckCircle2 size={20} /></span><span><small>Tâches terminées</small><strong>{groups.completed.length}</strong></span></button>
      <div className="pd-summary-metric"><span className="pd-metric-icon"><LockKeyhole size={20} /></span><span><small>Tâches bloquées</small><strong>{groups.blockedCount}</strong></span></div>
    </div>
    <div className="pd-task-filters"><label><Search size={16} aria-hidden="true" /><span className="sr-only">Rechercher dans mes tâches</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Rechercher une tâche, un projet ou un tag…" /></label><span>{taskScope === 'completed' ? 'Tâches terminées' : taskScope === 'overdue' ? 'Tâches en retard' : taskScope === 'upcoming' ? 'Tâches à venir' : 'Toutes les tâches ouvertes'}</span>{(search || taskScope !== 'all') && <button type="button" className="time-text-action" onClick={() => { setSearch(''); setTaskScope('all'); }}>Réinitialiser les filtres</button>}</div>
    <PlanningWarnings data={props.data} resourceId={actualId} startDate={props.data.today} endDate={addCalendarDays(props.data.today, 6)} />
    {!includeBlocked && groups.blockedCount > 0 && <p className="pd-filter-note">{groups.blockedCount} tâche{groups.blockedCount > 1 ? 's bloquées masquées' : ' bloquée masquée'}. Activez « Tâches bloquées » pour les afficher.</p>}
    <div className="pd-dashboard-grid"><div className="pd-task-cards">{taskScope === 'completed' ? <TaskCard title="Tâches terminées" tasks={completed} completed props={props} /> : <>{taskScope !== 'overdue' && <TaskCard title="Tâches à venir et ouvertes" tasks={upcoming} props={props} />}{taskScope !== 'upcoming' && <TaskCard title="Tâches en retard" tasks={overdue} late props={props} />}</>}</div>
      <PersonalCalendar key={actualId} props={props} resourceId={actualId} includeBlocked={includeBlocked} /></div>
  </div>;
}
