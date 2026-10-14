import { canCreateProject, canProject, isAdmin } from '../shared/permissions';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Cloud, CloudLightning, CloudRain, CloudSun, Edit3, Folder, FolderOpen, Minus, Plus, Search, Sun, Settings2 } from 'lucide-react';
import { PROJECT_STATUS_LABELS, type Project, type ProjectStatus, type ViewProps, type Zone } from '../shared/types';
import { formatHours } from '../shared/domain';
import { projectAssignedResources, projectTaskTags, projectZoneMetrics } from '../shared/zone-projects';
import { projectBudgetMetrics } from '../shared/project-budget';
import './zone-projects.css';
import { projectTableColumns, type ProjectTableColumn, type ProjectMetricId, BUDGET_COLUMNS as budgetColumns } from './projects/project-columns';
import { ProjectCustomValue } from './projects/ProjectCustomValue';
import { ColumnResizeHandle } from './table/ColumnResizeHandle';
import { normalizeTableColumns, readTableColumns, type TableColumnPreferences } from './table/column-preferences';
import { TableColumnsDialog } from './table/TableColumnsDialog';

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
const tagColors = ['#087b59', '#346c82', '#6545b2', '#922989', '#146e86', '#a65023'];
function shortDate(date: string | null) { return date ? dateFormat.format(new Date(`${date}T12:00:00Z`)) : '—'; }
function tagColor(tag: string) { return tagColors[Array.from(tag).reduce((sum, character) => sum + character.codePointAt(0)!, 0) % tagColors.length]; }
function activityTitle(metrics: Metrics) {
  return metrics.activityBasis === 'allocated_hours'
    ? 'Activité pondérée par les heures allouées aux tâches. Le retard correspond au travail restant des tâches échues.'
    : metrics.activityBasis === 'tasks'
      ? 'Sans heures allouées : activité calculée à partir de la progression des tâches.'
      : 'Aucune tâche de travail : activité non définie.';
}
function Weather({ value, average = false }: { value: number | null; average?: boolean }) {
  if (value === null || value === 0) return <span className="zp-no-value" aria-label="Météo non renseignée">—</span>;
  const Icon = [CloudLightning, CloudRain, Cloud, CloudSun, Sun][Math.max(0, Math.min(4, Math.round(value) - 1))];
  const label = `${average ? 'Météo moyenne des projets affichés' : 'Météo du projet'} : ${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)} / 5`;
  return <span className={`zp-weather zp-weather-${Math.round(value)}`} title={label} role="img" aria-label={label}><Icon size={30} strokeWidth={1.8} /></span>;
}
function MetricCell({ metrics, id }: { metrics: Metrics; id: ProjectMetricId }) {
  const activity = ['realized', 'late', 'open'].includes(id);
  const value = { realized: metrics.realizedPercent, late: metrics.latePercent, open: metrics.openPercent, allocated: metrics.allocatedHours, spent: metrics.spentHours, remaining: metrics.remainingHours }[id];
  return <td className={`zp-number${activity ? '' : ' zp-work'}${id === 'realized' ? ' zp-realized' : id === 'late' || id === 'remaining' && value < 0 ? ' zp-late' : ''}`} data-metric={id} data-column={id} title={activity ? activityTitle(metrics) : undefined}>{activity ? percentFormat.format(value) + ' %' : formatHours(value)}</td>;
}
function BudgetCell({ metrics, column }: { metrics: BudgetMetrics; column: typeof budgetColumns[number] }) {
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
    return <td key={column.key} className={`zp-number zp-budget${color}${column.key === 'allocated' ? ' zp-budget-first' : ''}`} data-metric={column.metric} data-column={column.metric} title={title} aria-label={`${column.label} : ${number}. ${title}`}>{number}</td>;

}

export function ProjectsView({ data, createProject, openProject, zoneId, onZoneChange, editProject, mutate, notify, embedded = false, preferenceScope }: ProjectsProps) {
  const catalog = useMemo(() => projectTableColumns(data.customFieldDefinitions ?? []), [data.customFieldDefinitions]);
  const columnKey = `planzone8-project-table:v1:${encodeURIComponent(preferenceScope ?? data.currentUser.id)}`;
  const [savedColumns, setSavedColumns] = useState(() => readTableColumns(columnKey, catalog));
  const [configuringColumns, setConfiguringColumns] = useState(false);
  useEffect(() => setSavedColumns(readTableColumns(columnKey, catalog)), [columnKey]);
  const preferences = normalizeTableColumns(savedColumns, catalog);
  function applyColumns(next: TableColumnPreferences, persist = true) { setSavedColumns(next); if (persist) { try { localStorage.setItem(columnKey, JSON.stringify(next)); } catch { notify('L’affichage est conservé pour cette visite.'); } } }
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
      if (sort === 'start') return (a.startDate ?? '9999-12-31').localeCompare(b.startDate ?? '9999-12-31') || collator.compare(a.name, b.name);
      if (sort === 'end') return (a.endDate ?? '9999-12-31').localeCompare(b.endDate ?? '9999-12-31') || collator.compare(a.name, b.name);
      return metrics.get(a.id)!.remainingHours - metrics.get(b.id)!.remainingHours || collator.compare(a.name, b.name);
    });
  }
  const availableColumns = catalog.filter(column => (showBudget || !column.budget) && (editProject || column.id !== 'edit'));
  const columns = preferences.order.flatMap(id => { const column = availableColumns.find(column => column.id === id); return column && !preferences.hidden.includes(id) ? [column] : []; });
  const columnWidth = (column: ProjectTableColumn) => preferences.widths[column.id] ?? column.width;
  const totalWidth = columns.reduce((sum, column) => sum + columnWidth(column), 0);
  function resize(column: ProjectTableColumn, width: number, persist: boolean) { applyColumns({ ...preferences, widths: { ...preferences.widths, [column.id]: width } }, persist); }
  function header(column: ProjectTableColumn) { return <><span className="zp-header-label">{column.heading ?? column.label}</span><ColumnResizeHandle label={column.label} width={columnWidth(column)} defaultWidth={column.width} min={column.minWidth ?? 60} max={900} onChange={width => resize(column, width, false)} onCommit={width => resize(column, width, true)} /></>; }
  const headingGroups: { group: ProjectTableColumn['group']; columns: ProjectTableColumn[] }[] = [];
  for (const column of columns) { const previous = headingGroups.at(-1); if (column.group && previous?.group === column.group) previous.columns.push(column); else headingGroups.push({ group: column.group, columns: [column] }); }
  function aggregateCell(column: ProjectTableColumn, aggregate: Metrics, budget: BudgetMetrics) { if (column.metric) return <MetricCell key={column.id} metrics={aggregate} id={column.metric} />; if (column.budget) return <BudgetCell key={column.id} metrics={budget} column={column.budget} />; return <td key={column.id} data-column={column.id}>{column.id === 'weather' && <Weather value={aggregate.weather} average />}</td>; }
  return <section className={`zp-view${embedded ? ' zp-embedded' : ''}`}>
    <header className="zp-heading">
      <div className="zp-context"><span className="zp-context-icon"><FolderOpen size={20} /></span><h1>{zone?.name ?? 'Tous les projets'}</h1><span className="zp-view-label">Projets</span></div>
      <button className="button button-primary zp-create" aria-label="Nouveau projet" disabled={!canCreateProject(data)} onClick={createProject}><Plus size={16} />Projet</button>
    </header>
    <div className="zp-toolbar">
      {!embedded && onZoneChange && <label className="zp-filter"><span>Zone :</span><select aria-label="Choisir une zone" value={zoneId ?? ''} onChange={event => onZoneChange(event.target.value || null)}><option value="">Toutes les zones</option>{data.zones.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <label className="zp-filter"><span>Trier par :</span><select aria-label="Trier les projets" value={sort} onChange={event => setSort(event.target.value as Sort)}><option value="default">Aucun tri</option><option value="name">Nom du projet</option><option value="start">Date de début</option><option value="end">Date de fin</option><option value="remaining">Travail restant</option></select></label>
      <label className="zp-filter"><span>Filtrer par :</span><select aria-label="Statut des projets" value={status} onChange={event => setStatus(event.target.value)}><option value="all">Tous les statuts</option>{Object.entries(PROJECT_STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}{data.projectStatusDefinitions?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <button type="button" className="zp-column-trigger" aria-label="Configurer les colonnes des projets" onClick={() => setConfiguringColumns(true)}><Settings2 size={16} />Colonnes</button>
      <label className="zp-search"><Search size={15} /><input aria-label="Rechercher un projet" placeholder="Rechercher un projet…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      {isFiltered && <button className="zp-reset" onClick={() => { setQuery(''); setStatus('all'); }}>Réinitialiser</button>}
    </div>
    <div className="zp-table-context"><span>{visible.length} projet{visible.length > 1 ? 's' : ''}{isFiltered ? ` affiché${visible.length > 1 ? 's' : ''} sur ${scoped.length}` : ''}</span><span>Travail en heures · Budget en euros · synthèse des projets affichés</span></div>
    {!groups.length && <div className="zp-empty"><FolderOpen size={30} /><h2>{isFiltered ? 'Aucun projet ne correspond à ces filtres' : 'Votre première zone de projets commence ici'}</h2><p>{isFiltered ? 'Modifiez le statut ou le texte recherché pour retrouver vos projets.' : 'Créez un projet et choisissez sa zone pour suivre son activité et ses temps de travail.'}</p>{isFiltered ? <button className="button button-secondary" onClick={() => { setQuery(''); setStatus('all'); }}>Effacer les filtres</button> : <button className="button button-primary" disabled={!canCreateProject(data)} onClick={createProject}>Créer un projet</button>}</div>}
    <div className="zp-table-scroll" hidden={!groups.length} tabIndex={0} role="region" aria-label="Tableau des projets, défilement horizontal">
      <table className="zp-table zp-configured-table" aria-label="Projets de la zone" style={{ width: totalWidth, minWidth: totalWidth, tableLayout: 'fixed' }}>
        <caption className="sr-only">Projets par zone, activité, temps de travail en heures et budget en euros</caption>
        <colgroup>{columns.map(column => <col key={column.id} style={{ width: columnWidth(column) }} />)}</colgroup>
        <thead className="zp-overview-head"><tr>{columns.map(column => <th key={column.id} scope="col" data-column={column.id} title={column.budget?.explanation}>{header(column)}</th>)}</tr></thead>
        {groups.map(item => {
          const projects = orderedProjects(item);
          const total = scoped.filter(project => project.zoneId === item.id).length;
          const groupMetrics = projectZoneMetrics(data, projects);
          const groupBudget = projectBudgetMetrics(data, projects);
          const index = data.zones.findIndex(candidate => candidate.id === item.id) + 1;
          const isCollapsed = collapsed.has(item.id);
          return <tbody key={item.id} className="zp-zone-group">
            <tr className="zp-zone-summary" data-zone-id={item.id}>
              <th scope="row" className="zp-zone-title" data-column="name"><div><button className="zp-collapse" aria-label={`${isCollapsed ? 'Développer' : 'Réduire'} ${item.name}`} aria-expanded={!isCollapsed} onClick={() => toggleZone(item.id)}>{isCollapsed ? <Plus size={12} /> : <Minus size={12} />}</button><span className="zp-zone-marker" style={{ background: item.color }}>{index}</span><span className="zp-zone-name">{item.name}<small title={`${projects.length} projets affichés sur ${total}`}>({isFiltered ? `${projects.length} / ${total}` : projects.length})</small></span><small className="zp-summary-detail">{groupMetrics.completedTasks} / {groupMetrics.totalTasks} tâches terminées</small></div></th>
              {columns.filter(column => column.id !== 'name').map(column => aggregateCell(column, groupMetrics, groupBudget))}
            </tr>
            {!isCollapsed && <>
              <tr className="zp-group-heading">{headingGroups.map((group, i) => group.group ? <th key={i} colSpan={group.columns.length} scope="colgroup">{group.group === 'activity' ? 'Suivi de l’activité' : group.group === 'work' ? 'Travail (heures)' : 'Budget (euros)'}</th> : <th key={i} scope="col" rowSpan={2} data-column={group.columns[0].id} className={group.columns[0].id === 'name' ? 'zp-name-cell' : undefined}>{header(group.columns[0])}</th>)}</tr>
              <tr className="zp-group-subheading">{columns.filter(column => column.group).map(column => <th key={column.id} scope="col" data-column={column.id} title={column.budget?.explanation}>{header(column)}</th>)}</tr>
              {projects.map(project => {
                const members = projectAssignedResources(data, project.id);
                const tags = projectTaskTags(data, project.id);
                return <tr key={project.id} className="zp-project-row" data-project-id={project.id}>
                  {columns.map(column => {
                    if (column.id === 'name') return <th key={column.id} data-column={column.id} scope="row" className="zp-name-cell"><button className="zp-project-link" onClick={() => openProject(project)} title={project.description || project.name}><Folder size={18} strokeWidth={1.5} /><span>{project.name}</span></button></th>;
                    if (column.id === 'zone') return <td key={column.id} data-column={column.id} className="zp-zone-cell"><span className="zp-zone-marker" style={{ background: item.color }} title={item.name}>{index}</span></td>;
                    if (column.id === 'tags') return <td key={column.id} data-column={column.id} className="zp-tags-cell">{tags.length ? <div className="zp-tags" title={`Tags du projet et des tâches : ${tags.join(', ')}`}>{tags.slice(0, 2).map(tag => <span key={tag} style={{ background: tagColor(tag) }}>{tag}</span>)}{tags.length > 2 && <small>+{tags.length - 2}</small>}</div> : <span className="zp-no-value">—</span>}</td>;
                    if (column.id === 'status') return <td key={column.id} data-column={column.id}><div className={`zp-status zp-status-${project.status}${pending.has(project.id) ? ' zp-status-saving' : ''}`}><Folder size={14} /><select aria-label={`Statut du projet ${project.name}`} value={project.customStatusId ?? project.status} disabled={pending.has(project.id) || !canProject(data, project.id, 'details')} onChange={event => void changeStatus(project, event.target.value)}>{Object.entries(PROJECT_STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}{data.projectStatusDefinitions?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={13} /></div></td>;
                    if (column.id === 'weather') return <td key={column.id} data-column={column.id} className="zp-weather-cell"><Weather value={project.weather} /></td>;
                    if (column.id === 'team') return <td key={column.id} data-column={column.id} className="zp-team">{members.length ? <div title={`Ressources associées : ${members.map(resource => resource.name).join(', ')}`}>{members.slice(0, 2).map(resource => <span key={resource.id}>{resource.name}</span>)}{members.length > 2 && <small>+{members.length - 2}</small>}</div> : <span className="zp-no-value">—</span>}</td>;
                    if (column.id === 'start' || column.id === 'end') return <td key={column.id} className="zp-date" data-column={column.id}>{shortDate(column.id === 'start' ? project.startDate : project.endDate)}</td>;
                    if (column.metric) return <MetricCell key={column.id} metrics={metrics.get(project.id)!} id={column.metric} />;
                    if (column.budget) return <BudgetCell key={column.id} metrics={budgets.get(project.id)!} column={column.budget} />;
                    if (column.field) return <td key={column.id} data-column={column.id} className="zp-custom-value"><ProjectCustomValue field={column.field} project={project} definitions={data.customFieldDefinitions ?? []} /></td>;
                    return <td key={column.id} data-column={column.id} className="zp-edit-cell"><button className="zp-edit" disabled={!canProject(data, project.id, 'details')} aria-label={`Modifier le projet ${project.name}`} onClick={() => editProject?.(project)}><Edit3 size={15} /></button></td>;
                  })}
                </tr>;
              })}
              {!projects.length && <tr><td colSpan={columns.length} className="zp-group-empty">Aucun projet à afficher dans cette zone.</td></tr>}
            </>}
          </tbody>;
        })}
        {!groups.length && <tbody><tr><td colSpan={columns.length} className="zp-group-empty">Aucun projet à afficher. Ajustez vos filtres ou créez un projet.</td></tr></tbody>}
      </table>
    </div>
    {configuringColumns && <TableColumnsDialog title="Configurer les colonnes des projets" columns={availableColumns} preferences={preferences} onClose={() => setConfiguringColumns(false)} onApply={next => { applyColumns(normalizeTableColumns(next, catalog)); setConfiguringColumns(false); }} />}
    <p className="zp-note">L’activité suit la progression des tâches ; le travail passé correspond aux temps saisis. Un restant négatif indique un dépassement de l’allocation. Le budget acquis valorise les allocations selon l’avancement des tâches, hors dépenses. Les signes ≥ et ≤ signalent un calcul incomplet lorsque des tarifs manquent.</p>
  </section>;
}
