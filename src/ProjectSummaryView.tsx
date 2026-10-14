import { projectTimeEntries } from '../shared/planzone-preferences';
import { useState, type ReactNode } from 'react';
import { CheckCircle2, ChevronRight, Cloud, CloudLightning, CloudRain, CloudSun, Coins, FileDown, FilePlus, FileText, Files, Flag, Folder, Frown, Meh, MessageSquare, Pencil, Plus, Smile, Sun, Target, Users } from 'lucide-react';
import { STATUS_LABELS, type Task, type ViewProps } from '../shared/types';
import { formatDate, formatHours, isLate, taskMetrics } from '../shared/domain';
import { projectZoneMetrics } from '../shared/zone-projects';
import { projectStatusLabel, strategicScore } from '../shared/customization';
import { isCivilDate } from '../shared/time-integration';
import { canProject } from '../shared/permissions';
import { TaskCheck } from './TaskCheck';
import { CustomRichTextPreview } from './CustomFieldInputs';
import './project-summary-actions.css';
import './project-summary.css';
import { ProjectCapacityPanel } from './CapacityPlanView';

const dateLabel = (date: string | null) => date && isCivilDate(date) ? date.split('-').reverse().join('/') : 'Non planifié';
const percent = (value: number) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value)} %`;
const stamp = (value: string | null) => value && isCivilDate(value) ? Date.parse(value + 'T00:00:00Z') : null;
function axisTextColor(color: string) {
  const rgb = color.match(/[a-f\d]{2}/gi)?.slice(0, 3).map(channel => { const value = parseInt(channel, 16) / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }) ?? [0, 0, 0];
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 > .179 ? '#172b33' : '#fff';
}
function Card({ title, label = title, children, action, className = '' }: { title: string; label?: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return <section className={`pzs-card ${className}`} aria-label={label}><header className="pzs-card-heading"><h2>{title}</h2>{action}</header>{children}</section>;
}

function SummaryTasks({ props, overdue }: { props: ViewProps; overdue: boolean }) {
  const [mine, setMine] = useState(false); const { data, project } = props;
  const tasks = data.tasks.filter(task => task.projectId === project.id && task.kind === 'task' && task.status !== 'done' && isLate(task, data.today) === overdue && (!mine || task.assigneeId === data.currentUser.id))
    .sort((a, b) => (a.endDate ?? '9999').localeCompare(b.endDate ?? '9999') || a.title.localeCompare(b.title, 'fr'));
  const label = overdue ? 'Tâches en retard' : 'Tâches à venir';
  const locked = project.status === 'paused' || project.status === 'closed';
  return <Card title={label} className={`pzs-tasks-card ${overdue ? 'pzs-overdue-card' : ''}`} action={<div className="pzs-task-controls"><span className="pzs-task-count" aria-label={`${tasks.length} ${label.toLocaleLowerCase('fr')}`}>{tasks.length}</span><label className="pzs-mine-filter"><span>Moi</span><input type="checkbox" role="switch" aria-label={`Voir uniquement mes ${label.toLocaleLowerCase('fr')}`} checked={mine} onChange={event => setMine(event.target.checked)} /><span>Tout le monde</span></label>{!overdue && canProject(data, project.id, 'taskCreate') && <button type="button" className="pzs-icon-action" aria-label="Nouvelle tâche" title="Ajouter une tâche" disabled={locked} onClick={() => props.createTask()}><Plus size={16} /></button>}</div>}>
    <div className="pzs-task-scroll proj-priority-list" role="region" aria-label={`Liste des ${label.toLocaleLowerCase('fr')}`} tabIndex={0}>
      {tasks.length ? tasks.map(task => <div key={task.id} className={`pzs-task-row${overdue ? ' pzs-late' : ''}`} data-task-id={task.id}><TaskCheck task={task} data={data} mutate={props.mutate} notify={props.notify} /><button type="button" className="pzs-task-open" onClick={() => props.openTask(task)}><span className="pzs-task-title">{task.title}</span><span className={`pzs-task-status pzs-task-status-${task.status}`}>{STATUS_LABELS[task.status]}</span><time dateTime={task.endDate ?? undefined}>{dateLabel(task.endDate)}</time></button></div>) : <div className="pzs-empty"><CheckCircle2 size={22} /><p>{mine ? 'Aucune tâche dans ce périmètre personnel.' : overdue ? 'Aucune tâche en retard.' : 'Aucune tâche ouverte à venir.'}</p></div>}
    </div>
  </Card>;
}

function MilestoneTimeline({ milestones, props }: { milestones: Task[]; props: ViewProps }) {
  if (!props.project.startDate || !props.project.endDate) return <div className="pzs-timeline pzs-empty"><p>Dates du projet à renseigner</p></div>;
  const start = stamp(props.project.startDate); const end = stamp(props.project.endDate); const today = stamp(props.data.today);
  if (start === null || end === null || end < start || today === null) return <p className="pzs-period">Dates du projet à renseigner.</p>;
  const position = (value: number) => Math.min(100, Math.max(0, (value - start) / Math.max(86_400_000, end - start) * 100));
  return <div className="pzs-project-timeline" aria-label="Jalons sur la période du projet"><div className="pzs-timeline-track">
    {milestones.map(task => { const date = stamp(task.endDate ?? task.startDate); return date !== null && <button type="button" key={task.id} className={`pzs-timeline-milestone${task.status === 'done' ? ' pzs-complete' : isLate(task, props.data.today) ? ' pzs-late' : ''}`} style={{ left: `${position(date)}%` }} aria-label={`Ouvrir le jalon ${task.title}`} title={`${task.title} · ${dateLabel(task.endDate ?? task.startDate)}${date < start || date > end ? ' · Hors de la période du projet' : ''}`} onClick={() => props.openTask(task)}><Flag size={15} /></button>; })}
    <span className="pzs-today-marker" style={{ left: `${position(today)}%` }} title={`${dateLabel(props.data.today)}${today < start ? ' · Avant le début du projet' : today > end ? ' · Après la fin du projet' : ''}`}><span>Aujourd’hui</span></span>
  </div><div className="pzs-timeline-dates"><span>Début : {dateLabel(props.project.startDate)}</span><span>Fin : {dateLabel(props.project.endDate)}</span></div></div>;
}

export function ProjectSummaryView(props: ViewProps) {
  const { data, project } = props;
  const [expandedAxes, setExpandedAxes] = useState(false);
  const tasks = data.tasks.filter(task => task.projectId === project.id);
  const milestones = tasks.filter(task => task.kind === 'milestone').sort((a, b) => (a.endDate ?? '9999').localeCompare(b.endDate ?? '9999'));
  const metrics = taskMetrics(tasks, projectTimeEntries(data), data.today); const activity = projectZoneMetrics(data, [project]);
  const axes = (data.strategicAxes ?? []).filter(axis => project.strategicRatings?.[axis.id] !== undefined);
  const score = strategicScore(project, data.strategicAxes ?? []);
  const reports = (data.projectReports ?? []).filter(report => report.projectId === project.id).sort((a, b) => b.reportDate.localeCompare(a.reportDate) || b.createdAt.localeCompare(a.createdAt));
  const locked = project.status === 'paused' || project.status === 'closed';
  const WeatherIcon = [CloudLightning, CloudRain, Cloud, CloudSun, Sun][Math.max(0, Math.min(4, project.weather - 1))];
  const segments = [
    { id: 'realized', label: 'Réalisé', value: activity.realizedPercent, hours: metrics.realizedHours },
    { id: 'late', label: 'Retard', value: activity.latePercent, hours: metrics.lateHours },
    { id: 'open', label: 'Ouvert', value: activity.openPercent, hours: metrics.openHours },
  ];
  return <div className="pzs-summary-container proj-summary">
    <div className="pzs-summary"><h1 className="sr-only">Synthèse du projet {project.name}</h1>
      <div className="pzs-command-bar"><section className="pzs-strategy ci-project-strategy" aria-label="Stratégie du projet"><Target size={23} aria-hidden="true" /><span className="pzs-score-label">Score stratégique :</span><strong className={`ci-score-pill${score < 0 ? ' ci-score-negative' : ''}`}>{axes.length ? score : '—'}</strong><div className="pzs-axis-tags">{axes.length ? (expandedAxes ? axes : axes.slice(0, 3)).map(axis => { const rating = project.strategicRatings![axis.id]; return <span key={axis.id} className="pzs-axis-tag ci-axis-tag" style={{ backgroundColor: axis.color, color: axisTextColor(axis.color) }} title={`${axis.name} · ${axis.scale[rating + 2]} · Poids ${axis.weight}`}>{axis.code}</span>; }) : <span className="pzs-strategy-empty">Aucune évaluation</span>}{axes.length > 3 && <button type="button" className="pzs-more-axes" aria-label={expandedAxes ? 'Réduire les axes stratégiques' : 'Afficher les autres axes stratégiques'} aria-expanded={expandedAxes} onClick={() => setExpandedAxes(value => !value)}>{expandedAxes ? 'Réduire' : `+ ${axes.length - 3}`}</button>}</div><button type="button" className="pzs-icon-action" aria-label="Modifier l’évaluation stratégique" title="Modifier l’évaluation stratégique" disabled={!props.editProject} onClick={() => props.editProject?.(project)}><Pencil size={17} /></button></section>
        <div className="pzs-project-state"><button type="button" className="pzs-weather" aria-label={`Modifier la météo du projet : ${project.weather || 'non renseignée'} sur 5`} title="Météo déclarée du projet" disabled={!props.editProject} onClick={() => props.editProject?.(project)}>{project.weather > 0 && <WeatherIcon size={27} />}<span>{project.weather > 0 ? `${project.weather}/5` : '—'}</span></button><button type="button" className={`pzs-project-status pzs-project-${project.status}`} aria-label="Modifier le statut du projet" disabled={!props.editProject} onClick={() => props.editProject?.(project)}><Folder size={16} />{projectStatusLabel(project, data)}<ChevronRight size={16} /></button></div>
        <div className="psr-actions" aria-label="Rapports du projet"><button type="button" className="psr-action psr-flash" onClick={props.openFlashReport} disabled={!props.openFlashReport}><FileDown size={24} />Rapport flash</button><button type="button" className="psr-action psr-create" aria-label="Créer un compte rendu" onClick={props.createReport} disabled={!props.createReport || locked}><FilePlus size={24} />Créer un compte rendu</button></div>
      </div>
      {locked && <p className="pzs-locked-notice">Ce projet est {projectStatusLabel(project, data).toLocaleLowerCase('fr')}. Les tâches et comptes rendus restent consultables.</p>}
      <ProjectCapacityPanel data={data} project={project} />
      <div className="pzs-top-grid">
        <Card title="Derniers comptes rendus" className="psr-latest pzs-reports-card"><div className="pzs-report-scroll">{reports.length ? reports.slice(0, 5).map(report => <article className="psr-report-row" key={report.id}><FileText className="psr-report-icon" size={19} aria-hidden="true" /><div className="psr-report-meta"><button type="button" onClick={() => props.openReport?.(report)} disabled={!props.openReport}>{report.title}</button><p>par {report.authorName} · {dateLabel(report.reportDate)}</p></div><div className="psr-indicators">{report.indicators.map(indicator => { const Icon = indicator.rating <= 2 ? Frown : indicator.rating === 3 ? Meh : Smile; return <span key={indicator.id} className={`psr-indicator psr-rating-${indicator.rating}`} aria-label={`${indicator.label} : ${indicator.rating} sur 5`} title={`${indicator.label} : ${indicator.rating} / 5`}><Icon size={27} aria-hidden="true" /><span>{indicator.label}</span></span>; })}</div></article>) : <p className="psr-empty">Aucun compte rendu enregistré pour ce projet.</p>}</div></Card>
        <Card title="Description" className="pzs-description-card" action={<button type="button" className="pzs-icon-action" aria-label="Modifier la description du projet" disabled={!props.editProject} onClick={() => props.editProject?.(project)}><Pencil size={17} /></button>}><div className="pzs-description-scroll" tabIndex={0} role="region" aria-label="Description du projet">{project.descriptionFormat === 'markdown' ? <CustomRichTextPreview value={project.description} /> : <p>{project.description || 'Aucune description pour ce projet.'}</p>}</div></Card>
      </div>
      <div className="pzs-middle-grid">
        <Card title="Jalons" className="pzs-milestones-card"><div className="pzs-milestone-scroll" role="region" aria-label="Jalons du projet" tabIndex={0}>{milestones.length ? milestones.map(task => <button type="button" key={task.id} className={`pzs-milestone-row${task.status === 'done' ? ' pzs-complete' : isLate(task, data.today) ? ' pzs-late' : ''}`} onClick={() => props.openTask(task)}><Flag size={17} /><span>{task.title}</span><time dateTime={task.endDate ?? undefined}>{dateLabel(task.endDate)}</time></button>) : <div className="pzs-empty"><Flag size={24} /><p>Aucun jalon défini.</p></div>}</div></Card>
        <Card title="Suivi de l’activité" className="pzs-activity-card"><div className="pzs-activity-body"><div className="pzs-activity-labels">{segments.map(segment => <div className={`pzs-activity-segment pzs-${segment.id}`} key={segment.id} data-metric={segment.id}><span>{segment.label}</span><strong>{activity.activityBasis === 'none' ? '—' : percent(segment.value)}</strong><small>{formatHours(segment.hours)}</small></div>)}</div><div className="pzs-activity-bars" role="img" aria-label={segments.map(segment => `${segment.label} : ${activity.activityBasis === 'none' ? 'non défini' : percent(segment.value)}`).join(', ')}>{segments.map(segment => segment.value > 0 && <span className={`pzs-bar pzs-bar-${segment.id}`} key={segment.id} style={{ flexGrow: segment.value, flexBasis: 0 }} />)}</div>
          <div className="pzs-activity-stats"><dl><div><dt>Alloué</dt><dd data-metric="allocated">{formatHours(metrics.allocatedHours)}</dd></div><div><dt>Passé</dt><dd data-metric="spent">{formatHours(metrics.spentHours)}</dd></div><div><dt>Reste à faire</dt><dd data-metric="remaining" className={activity.remainingHours < 0 ? 'pzs-late' : ''}>{formatHours(activity.remainingHours)}</dd></div></dl><dl><div><dt>Jalons réalisés</dt><dd data-metric="milestones">{metrics.completedMilestones} / {metrics.milestones}</dd></div><div><dt>Tâches complétées</dt><dd data-metric="completed">{metrics.completed} / {metrics.total}</dd></div></dl></div>
          <MilestoneTimeline milestones={milestones} props={props} />
          {activity.activityBasis === 'tasks' && <p className="pzs-activity-basis">Activité calculée par tâche ; aucune heure allouée.</p>}
        </div></Card>
      </div>
      <div className="pzs-bottom-grid"><SummaryTasks props={props} overdue={false} /><SummaryTasks props={props} overdue /></div>
    </div>
  </div>;
}
