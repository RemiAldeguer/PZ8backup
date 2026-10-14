import { canCreateProject, canProject, isAdmin } from '../shared/permissions';
import { useMemo, useRef, useState } from 'react';
import { ChevronDown, Cloud, CloudLightning, CloudRain, CloudSun, Edit3, Folder, FolderOpen, Minus, Plus, Search, Sun } from 'lucide-react';
import { PROJECT_STATUS_LABELS, type Project, type ProjectStatus, type ViewProps, type Zone } from '../shared/types';
import { formatHours } from '../shared/domain';
import { projectAssignedResources, projectTaskTags, projectZoneMetrics } from '../shared/zone-projects';
import { projectBudgetMetrics } from '../shared/project-budget';
import './zone-projects.css';

type ProjectsProps = ViewProps & {
  createProject: () => void;
  zoneId: string | null;
  onZoneChange?: (id: string | null) => void;
  editProject?: (project: Project) => void;
  embedded?: boolean;
};
type Sort = 'default' | 'name' | 'start' | 'end' | 'remaining';
type Metrics = ReturnType<typeof projectZoneMetrics>;
type BudgetMetrics = ReturnType<typeof projectBudgetMetrics>;
const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
const dateFormat = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const percentFormat = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const currencyFormat = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const budgetColumns = [
  { key: 'allocated', label: 'Alloué', metric: 'budget-allocated', explanation: 'Budget alloué au projet.' },
  { key: 'planned', label: 'Planifié', metric: 'budget-planned', explanation: 'Valorisation des heures allouées aux tâches au tarif actuel des profils, plus les dépenses prévues ou payées.' },
  { key: 'actual', label: 'Réel', metric: 'budget-actual', explanation: 'Valorisation des temps saisis avec leur tarif historique, plus les dépenses payées. Les temps non validés sont inclus.' },
  { key: 'plannedMargin', label: 'Marge planifiée', metric: 'budget-planned-margin', explanation: 'Budget alloué moins le budget planifié.' },
  { key: 'actualMargin', label: 'Marge réelle', metric: 'budget-actual-margin', explanation: 'Budget alloué moins le coût réel.' },
  { key: 'earned', label: 'Acquis', metric: 'budget-earned', explanation: 'Valorisation des allocations selon l’avancement des tâches, hors dépenses.' },
] as const;
const tagColors = ['#087b59', '#346c82', '#6545b2', '#922989', '#146e86', '#a65023'];
function shortDate(date: string) { return date ? dateFormat.format(new Date(`${date}T12:00:00Z`)) : '—'; }
function tagColor(tag: string) { return tagColors[Array.from(tag).reduce((sum, character) => sum + character.codePointAt(0)!, 0) % tagColors.length]; }
function activityTitle(metrics: Metrics) {
  return metrics.activityBasis === 'allocated_hours'
    ? 'Activité pondérée par les heures allouées aux tâches. Le retard correspond au travail restant des tâches échues.'
    : metrics.activityBasis === 'tasks'
      ? 'Sans heures allouées : activité calculée à partir de la progression des tâches.'
      : 'Aucune tâche de travail : activité non définie.';
}
function Weather({ value, average = false }: { value: number | null; average?: boolean }) {
  if (value === null) return <span className="zp-no-value" aria-label="Météo non renseignée">—</span>;
  const Icon = [CloudLightning, CloudRain, Cloud, CloudSun, Sun][Math.max(0, Math.min(4, Math.round(value) - 1))];
  const label = `${average ? 'Météo moyenne des projets affichés' : 'Météo du projet'} : ${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)} / 5`;
  return <span className={`zp-weather zp-weather-${Math.round(value)}`} title={label} role="img" aria-label={label}><Icon size={30} strokeWidth={1.8} /></span>;
}
function MetricCells({ metrics }: { metrics: Metrics }) {
  return <>
    <td className="zp-number zp-realized" data-metric="realized" title={activityTitle(metrics)}>{percentFormat.format(metrics.realizedPercent)} %</td>
    <td className="zp-number zp-late" data-metric="late" title={activityTitle(metrics)}>{percentFormat.format(metrics.latePercent)} %</td>
    <td className="zp-number" data-metric="open" title={activityTitle(metrics)}>{percentFormat.format(metrics.openPercent)} %</td>
    <td className="zp-number zp-work" data-metric="allocated">{formatHours(metrics.allocatedHours)}</td>
    <td className="zp-number zp-work" data-metric="spent">{formatHours(metrics.spentHours)}</td>
    <td className={`zp-number zp-work${metrics.remainingHours < 0 ? ' zp-late' : ''}`} data-metric="remaining">{formatHours(metrics.remainingHours)}</td>
  </>;
}
function BudgetCells({ metrics }: { metrics: BudgetMetrics }) {
  return <>{budgetColumns.map(column => {
    const amount = metrics[column.key];
    const value = currencyFormat.format(Math.abs(amount)) === currencyFormat.format(0) ? 0 : amount;
    const isMargin = column.key === 'plannedMargin' || column.key === 'actualMargin';
    const missing = column.key === 'planned' || column.key === 'plannedMargin' ? metrics.plannedMissing
      : column.key === 'actual' || column.key === 'actualMargin' ? metrics.actualMissing
      : column.key === 'earned' ? metrics.earnedMissing : 0;
    const missingExplanation = missing === 0 ? '' : column.key === 'actual' || column.key === 'actualMargin'
      ? ` Calcul incomplet : ${missing} saisie${missing > 1 ? 's' : ''} de temps sans tarif historique ou base journalière enregistrée.`
      : ` Calcul incomplet : ${missing} allocation${missing > 1 ? 's' : ''} de tâche${missing > 1 ? 's' : ''} sans tarif de profil exploitable.`;
    const boundExplanation = missing === 0 ? '' : isMargin
      ? ' Cette marge est une borne supérieure ; les coûts inconnus peuvent la diminuer.'
      : ' Ce montant est une borne inférieure ; les coûts inconnus ne sont pas inclus.';
    const title = `${column.explanation}${missingExplanation}${boundExplanation}`;
    const number = `${missing ? isMargin ? '≤ ' : '≥ ' : ''}${currencyFormat.format(value)}`;
    const color = isMargin ? value < 0 ? ' zp-late' : value > 0 && !missing ? ' zp-realized' : ''
      : column.key === 'actual' && value > metrics.allocated ? ' zp-late' : '';
    return <td key={column.key} className={`zp-number zp-budget${color}${column.key === 'allocated' ? ' zp-budget-first' : ''}`} data-metric={column.metric} title={title} aria-label={`${column.label} : ${number}. ${title}`}>{number}</td>;
  })}</>;
}

export function ProjectsView({ data, createProject, openProject, zoneId, onZoneChange, editProject, mutate, notify, embedded = false }: ProjectsProps) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState<Sort>('default');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const inFlight = useRef(new Set<string>());
  const zone = data.zones.find(item => item.id === zoneId);
  const scoped = data.projects.filter(project => !zoneId || project.zoneId === zoneId);
  const needle = query.trim().toLocaleLowerCase('fr');
  const visible = scoped.filter(project => (status === 'all' || project.status === status || project.customStatusId === status) && `${project.name} ${project.description}`.toLocaleLowerCase('fr').includes(needle));
  const metrics = useMemo(() => new Map(data.projects.map(project => [project.id, projectZoneMetrics(data, [project])])), [data]);
  const budgets = useMemo(() => new Map(data.projects.map(project => [project.id, projectBudgetMetrics(data, [project])])), [data]);
  const groups = data.zones.filter(item => (!zoneId || item.id === zoneId) && (visible.some(project => project.zoneId === item.id) || item.id === zoneId));
  const showBudget = isAdmin(data) || visible.length > 0 && visible.every(project => canProject(data, project.id, 'budget'));
  const isFiltered = Boolean(needle || status !== 'all');
  function toggleZone(id: string) {
    setCollapsed(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  async function changeStatus(project: Project, next: string) {
    if (next === (project.customStatusId ?? project.status) || inFlight.current.has(project.id)) return;
    const definition = data.projectStatusDefinitions?.find(item => item.id === next);
    const baseStatus = definition?.baseStatus ?? next as ProjectStatus;
    inFlight.current.add(project.id);
    setPending(new Set(inFlight.current));
    try { await mutate('projects', 'PATCH', { status: baseStatus, customStatusId: definition?.id ?? null }, project.id); notify(`Statut de « ${project.name} » enregistré : ${definition?.name ?? PROJECT_STATUS_LABELS[baseStatus]}.`); }
    catch (error) { notify(error instanceof Error ? error.message : 'Le statut du projet n’a pas pu être enregistré.'); }
    finally { inFlight.current.delete(project.id); setPending(new Set(inFlight.current)); }
  }
  function orderedProjects(item: Zone) {
    const projects = visible.filter(project => project.zoneId === item.id);
    if (sort === 'default') return projects;
    return [...projects].sort((a, b) => {
      if (sort === 'name') return collator.compare(a.name, b.name);
      if (sort === 'start') return a.startDate.localeCompare(b.startDate) || collator.compare(a.name, b.name);
      if (sort === 'end') return a.endDate.localeCompare(b.endDate) || collator.compare(a.name, b.name);
      return metrics.get(a.id)!.remainingHours - metrics.get(b.id)!.remainingHours || collator.compare(a.name, b.name);
    });
  }
  const columns = editProject ? 21 : 20;
  return <section className={`zp-view${embedded ? ' zp-embedded' : ''}`}>
    <header className="zp-heading">
      <div className="zp-context"><span className="zp-context-icon"><FolderOpen size={20} /></span><h1>{zone?.name ?? 'Tous les projets'}</h1><span className="zp-view-label">Projets</span></div>
      <button className="button button-primary zp-create" aria-label="Nouveau projet" disabled={!canCreateProject(data)} onClick={createProject}><Plus size={16} />Projet</button>
    </header>
    <div className="zp-toolbar">
      {!embedded && onZoneChange && <label className="zp-filter"><span>Zone :</span><select aria-label="Choisir une zone" value={zoneId ?? ''} onChange={event => onZoneChange(event.target.value || null)}><option value="">Toutes les zones</option>{data.zones.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <label className="zp-filter"><span>Trier par :</span><select aria-label="Trier les projets" value={sort} onChange={event => setSort(event.target.value as Sort)}><option value="default">Aucun tri</option><option value="name">Nom du projet</option><option value="start">Date de début</option><option value="end">Date de fin</option><option value="remaining">Travail restant</option></select></label>
      <label className="zp-filter"><span>Filtrer par :</span><select aria-label="Statut des projets" value={status} onChange={event => setStatus(event.target.value)}><option value="all">Tous les statuts</option>{Object.entries(PROJECT_STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}{data.projectStatusDefinitions?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="zp-search"><Search size={15} /><input aria-label="Rechercher un projet" placeholder="Rechercher un projet…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      {isFiltered && <button className="zp-reset" onClick={() => { setQuery(''); setStatus('all'); }}>Réinitialiser</button>}
    </div>
    <div className="zp-table-context"><span>{visible.length} projet{visible.length > 1 ? 's' : ''}{isFiltered ? ` affiché${visible.length > 1 ? 's' : ''} sur ${scoped.length}` : ''}</span><span>Travail en heures · Budget en euros · synthèse des projets affichés</span></div>
    {!groups.length && <div className="zp-empty"><FolderOpen size={30} /><h2>{isFiltered ? 'Aucun projet ne correspond à ces filtres' : 'Votre première zone de projets commence ici'}</h2><p>{isFiltered ? 'Modifiez le statut ou le texte recherché pour retrouver vos projets.' : 'Créez un projet et choisissez sa zone pour suivre son activité et ses temps de travail.'}</p>{isFiltered ? <button className="button button-secondary" onClick={() => { setQuery(''); setStatus('all'); }}>Effacer les filtres</button> : <button className="button button-primary" disabled={!canCreateProject(data)} onClick={createProject}>Créer un projet</button>}</div>}
    <div className="zp-table-scroll" hidden={!groups.length} tabIndex={0} role="region" aria-label="Tableau des projets, défilement horizontal">
      <table className="zp-table" aria-label="Projets de la zone">
        <caption className="sr-only">Projets par zone, activité, temps de travail en heures et budget en euros</caption>
        <colgroup><col className="zp-col-name" /><col className="zp-col-zone" /><col className="zp-col-date" /><col className="zp-col-date" /><col className="zp-col-tags" /><col className="zp-col-status" /><col className="zp-col-weather" /><col className="zp-col-team" /><col className="zp-col-activity" /><col className="zp-col-activity" /><col className="zp-col-activity" /><col className="zp-col-work" /><col className="zp-col-work" /><col className="zp-col-work" />{(showBudget ? budgetColumns : []).map(column => <col key={column.key} className="zp-col-budget" />)}{editProject && <col className="zp-col-edit" />}</colgroup>
        <thead className="zp-overview-head"><tr><th scope="col">Nom du projet</th><th scope="col">Zone</th><th scope="col">Date de début</th><th scope="col">Date de fin</th><th scope="col">Tags des tâches</th><th scope="col">Statut</th><th scope="col">Météo</th><th scope="col">Équipe</th><th scope="col">Réalisé</th><th scope="col">Retard</th><th scope="col">Ouvert</th><th scope="col">Alloué</th><th scope="col">Passé</th><th scope="col">Restant</th>{(showBudget ? budgetColumns : []).map(column => <th key={column.key} scope="col" title={`Budget en euros : ${column.explanation}`}>{column.label}</th>)}{editProject && <th scope="col"><span className="sr-only">Modifier</span></th>}</tr></thead>
        {groups.map(item => {
          const projects = orderedProjects(item);
          const total = scoped.filter(project => project.zoneId === item.id).length;
          const groupMetrics = projectZoneMetrics(data, projects);
          const groupBudget = projectBudgetMetrics(data, projects);
          const index = data.zones.findIndex(candidate => candidate.id === item.id) + 1;
          const isCollapsed = collapsed.has(item.id);
          return <tbody key={item.id} className="zp-zone-group">
            <tr className="zp-zone-summary" data-zone-id={item.id}>
              <th scope="row" className="zp-zone-title" colSpan={2}><div><button className="zp-collapse" aria-label={`${isCollapsed ? 'Développer' : 'Réduire'} ${item.name}`} aria-expanded={!isCollapsed} onClick={() => toggleZone(item.id)}>{isCollapsed ? <Plus size={12} /> : <Minus size={12} />}</button><span className="zp-zone-marker" style={{ background: item.color }}>{index}</span><span className="zp-zone-name">{item.name}<small title={`${projects.length} projets affichés sur ${total}`}>({isFiltered ? `${projects.length} / ${total}` : projects.length})</small></span></div></th>
              <td colSpan={4} className="zp-summary-detail">{groupMetrics.completedTasks} / {groupMetrics.totalTasks} tâches terminées{groupMetrics.overdueTasks > 0 && <span>{groupMetrics.overdueTasks} en retard</span>}</td>
              <td className="zp-weather-cell"><Weather value={groupMetrics.weather} average /></td><td />
              <MetricCells metrics={groupMetrics} />{showBudget && <BudgetCells metrics={groupBudget} />}{editProject && <td />}
            </tr>
            {!isCollapsed && <>
              <tr className="zp-group-heading"><th scope="col" rowSpan={2} className="zp-name-cell">Nom du projet</th><th scope="col" rowSpan={2}>Zone</th><th scope="col" rowSpan={2}>Date de début</th><th scope="col" rowSpan={2}>Date de fin</th><th scope="col" rowSpan={2}>Tags des tâches</th><th scope="col" rowSpan={2}>Statut</th><th scope="col" rowSpan={2}>Météo</th><th scope="col" rowSpan={2}>Équipe</th><th colSpan={3} scope="colgroup">Suivi de l’activité</th><th colSpan={3} scope="colgroup">Travail <span>(heures)</span></th>{showBudget && <th colSpan={6} scope="colgroup">Budget <span>(euros)</span></th>}{editProject && <th rowSpan={2} scope="col"><span className="sr-only">Modifier</span></th>}</tr>
              <tr className="zp-group-subheading"><th scope="col">Réalisé</th><th scope="col">Retard</th><th scope="col">Ouvert</th><th scope="col">Alloué</th><th scope="col">Passé</th><th scope="col">Restant</th>{(showBudget ? budgetColumns : []).map(column => <th key={column.key} scope="col" title={column.explanation}>{column.label}</th>)}</tr>
              {projects.map(project => {
                const members = projectAssignedResources(data, project.id);
                const tags = projectTaskTags(data, project.id);
                return <tr key={project.id} className="zp-project-row" data-project-id={project.id}>
                  <th scope="row" className="zp-name-cell"><button className="zp-project-link" onClick={() => openProject(project)} title={project.description || project.name}><Folder size={18} strokeWidth={1.5} /><span>{project.name}</span></button></th>
                  <td className="zp-zone-cell"><span className="zp-zone-marker" style={{ background: item.color }} title={item.name}>{index}</span></td>
                  <td className="zp-date">{shortDate(project.startDate)}</td><td className="zp-date">{shortDate(project.endDate)}</td>
                  <td className="zp-tags-cell">{tags.length ? <div className="zp-tags" title={`Tags du projet et des tâches : ${tags.join(', ')}`}>{tags.slice(0, 2).map(tag => <span key={tag} style={{ background: tagColor(tag) }}>{tag}</span>)}{tags.length > 2 && <small>+{tags.length - 2}</small>}</div> : <span className="zp-no-value">—</span>}</td>
                  <td><div className={`zp-status zp-status-${project.status}${pending.has(project.id) ? ' zp-status-saving' : ''}`}><Folder size={14} /><select aria-label={`Statut du projet ${project.name}`} value={project.customStatusId ?? project.status} disabled={pending.has(project.id) || !canProject(data, project.id, 'details')} onChange={event => void changeStatus(project, event.target.value)}>{Object.entries(PROJECT_STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}{data.projectStatusDefinitions?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={13} /></div></td>
                  <td className="zp-weather-cell"><Weather value={project.weather} /></td>
                  <td className="zp-team">{members.length ? <div title={`Ressources associées : ${members.map(resource => resource.name).join(', ')}`}>{members.slice(0, 2).map(resource => <span key={resource.id}>{resource.name}</span>)}{members.length > 2 && <small>+{members.length - 2}</small>}</div> : <span className="zp-no-value">—</span>}</td>
                  <MetricCells metrics={metrics.get(project.id)!} />
                  {showBudget && <BudgetCells metrics={budgets.get(project.id)!} />}
                  {editProject && <td className="zp-edit-cell"><button className="zp-edit" disabled={!canProject(data, project.id, 'details')} aria-label={`Modifier le projet ${project.name}`} onClick={() => editProject(project)}><Edit3 size={15} /></button></td>}
                </tr>;
              })}
              {!projects.length && <tr><td colSpan={columns} className="zp-group-empty">Aucun projet à afficher dans cette zone.</td></tr>}
            </>}
          </tbody>;
        })}
        {!groups.length && <tbody><tr><td colSpan={columns} className="zp-group-empty">Aucun projet à afficher. Ajustez vos filtres ou créez un projet.</td></tr></tbody>}
      </table>
    </div>
    <p className="zp-note">L’activité suit la progression des tâches ; le travail passé correspond aux temps saisis. Un restant négatif indique un dépassement de l’allocation. Le budget acquis valorise les allocations selon l’avancement des tâches, hors dépenses. Les signes ≥ et ≤ signalent un calcul incomplet lorsque des tarifs manquent.</p>
  </section>;
}
