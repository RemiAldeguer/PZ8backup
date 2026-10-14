import { Fragment, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, ChevronsDown, ChevronsUp, Folder, Info, Minus, Plus } from 'lucide-react';
import { formatHours } from '../shared/domain';
import { normalizeResource } from '../shared/resources';
import {
  buildResourcePlanningRows, resourceAvatarTextColor, resourceOccupancyBand, resourcePlanningAmount, resourcePlanningPeriods,
  type ResourcePlanningGranularity, type ResourcePlanningMode, type ResourcePlanningPeriod, type ResourcePlanningUnit,
} from '../shared/resource-planning';
import type { Resource, ViewProps } from '../shared/types';
import './resource-planning.css';

const titles: Record<ResourcePlanningMode, string> = { capacity: 'Capacité', load: 'Charge prévisionnelle', occupancy: 'Taux d’occupation' };
const decimal = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const percentage = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const displayDate = (date: string) => new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
const periodRange = (period: ResourcePlanningPeriod) => `${displayDate(period.startDate)} – ${displayDate(period.endDate)}`;
const resourceTypeOrder: Record<Resource['type'], number> = { human: 0, material: 1, virtual: 2 };
function amount(hours: number, resource: Resource, unit: ResourcePlanningUnit): string {
  const number = resourcePlanningAmount(hours, resource, unit);
  return number === null ? '—' : decimal.format(number);
}

export function ResourcePlanningView({ data, openResource, openProject, mode }: ViewProps & { mode: ResourcePlanningMode }) {
  const initialYear = Number(data.today.slice(0, 4));
  const [year, setYear] = useState(Number.isInteger(initialYear) && initialYear >= 1900 && initialYear <= 2200 ? initialYear : new Date().getUTCFullYear());
  const [yearDraft, setYearDraft] = useState(String(year));
  const [granularity, setGranularity] = useState<ResourcePlanningGranularity>('monthly');
  const [unit, setUnit] = useState<ResourcePlanningUnit>('days');
  const [sort, setSort] = useState<'type' | 'name'>('type');
  const [type, setType] = useState('all');
  const [resourceId, setResourceId] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const yearInput = useRef<HTMLInputElement>(null);
  const periods = useMemo(() => resourcePlanningPeriods(year, granularity), [year, granularity]);
  const resources = useMemo(() => data.resources.filter(resource =>
    (includeInactive || resource.active) && (!resourceId || resource.id === resourceId) &&
    (type === 'all' || resource.type === type || (type === 'internal' && resource.type === 'human' && resource.classification === 'internal') || (type === 'external' && resource.type === 'human' && resource.classification === 'external')),
  ).sort((left, right) => (sort === 'type' ? resourceTypeOrder[left.type] - resourceTypeOrder[right.type] : 0) || left.name.localeCompare(right.name, 'fr')), [data.resources, includeInactive, resourceId, type, sort]);
  const rows = useMemo(() => buildResourcePlanningRows({ resources, tasks: data.tasks, projects: data.projects, unavailabilities: data.unavailabilities }, periods), [resources, data.tasks, data.projects, data.unavailabilities, periods]);
  const undated = rows.reduce((sum, row) => sum + row.undatedTaskCount, 0);
  const expandable = rows.filter(row => row.projects.length);
  const unitSymbol = unit === 'hours' ? 'h' : 'j';
  const totalColumns = periods.length + 1;
  function changeYear(next: number) { setYear(next); setYearDraft(String(next)); }
  function commitYear() {
    const next = Number(yearDraft);
    if (Number.isInteger(next) && next >= 1900 && next <= 2200) changeYear(next);
    else setYearDraft(String(year));
  }
  function toggle(id: string) { setExpanded(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; }); }
  return <section className={`resource-planning-view rpv-${mode}`} aria-label={titles[mode]}>
    <header className="rpv-heading"><h1>{titles[mode]}</h1></header>
    <div className="rpv-toolbar">
      <label className="rpv-control"><span>Trier par :</span><select aria-label="Trier les ressources" value={sort} onChange={event => setSort(event.target.value as 'type' | 'name')}><option value="type">Type</option><option value="name">Nom</option></select></label>
      <label className="rpv-control rpv-type-filter"><span>Filtrer :</span><select aria-label="Filtrer le type de ressources" value={type} onChange={event => setType(event.target.value)}><option value="all">Toutes les ressources</option><option value="human">Humaines</option><option value="internal">Humaines internes</option><option value="external">Humaines externes</option><option value="material">Matérielles</option><option value="virtual">Virtuelles</option></select></label>
      <div className="rpv-year" role="group" aria-label="Année affichée"><button type="button" aria-label="Année précédente" disabled={year <= 1900} onClick={() => changeYear(year - 1)}><ChevronLeft size={18} /></button><input ref={yearInput} aria-label="Année de planification" type="number" min="1900" max="2200" step="1" value={yearDraft} onChange={event => setYearDraft(event.target.value)} onBlur={commitYear} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitYear(); event.currentTarget.blur(); } }} /><button type="button" aria-label="Année suivante" disabled={year >= 2200} onClick={() => changeYear(year + 1)}><ChevronRight size={18} /></button><button type="button" aria-label="Choisir une année" onClick={() => { yearInput.current?.focus(); yearInput.current?.select(); }}><CalendarDays size={18} /></button></div>
      <details className="rpv-explanation"><summary aria-label="Comprendre les calculs"><Info size={19} /></summary><div><strong>Capacité et charge du calendrier</strong><p>La capacité provient des heures configurées du lundi au dimanche dans chaque fiche ressource, après retrait des jours fériés et des indisponibilités. Les absences qui se chevauchent sont déduites une seule fois.</p><p>La charge correspond aux heures allouées réparties sur les jours planifiés des tâches. Les temps déjà saisis restent dans le suivi temporel. Les réglages actuels de capacité s’appliquent à l’année affichée ; une ressource inactive a une capacité nulle.</p><p>Les jours utilisent les heures par jour propres à chaque ressource, indépendamment de son profil de coût.</p></div></details>
      <label className="rpv-view-control"><span className="sr-only">Vue de planification</span><select aria-label="Vue de planification" value={granularity} onChange={event => setGranularity(event.target.value as ResourcePlanningGranularity)}><option value="monthly">Vue mensuelle</option><option value="weekly">Vue hebdomadaire</option></select></label>
    </div>
    <div className="rpv-subtoolbar">
      <label className="rpv-control rpv-unit-control"><span>{mode === 'occupancy' ? 'Charge en :' : 'Unité :'}</span><select aria-label="Unité de planification" value={unit} onChange={event => setUnit(event.target.value as ResourcePlanningUnit)}><option value="days">jours</option><option value="hours">heures</option></select></label>
      <label className="rpv-control rpv-individual-filter"><span>Ressource :</span><select aria-label="Choisir une ressource" value={resourceId} onChange={event => setResourceId(event.target.value)}><option value="">Toutes</option>{data.resources.filter(resource => includeInactive || resource.active).map(resource => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select></label>
      <label className="rpv-inactive"><input type="checkbox" checked={includeInactive} onChange={event => { setIncludeInactive(event.target.checked); if (!event.target.checked && data.resources.find(resource => resource.id === resourceId)?.active === false) setResourceId(''); }} />Inclure les inactives</label>
    </div>
    <div className="rpv-table-scroll" tabIndex={0} aria-label={`Tableau ${titles[mode].toLocaleLowerCase('fr')} — ${year}`}>
      <table className="rpv-table"><caption className="sr-only">{titles[mode]} des ressources en {year}, {granularity === 'monthly' ? 'par mois' : 'par semaine'}. {mode === 'occupancy' ? 'Taux en pourcentage ; branches projet en charge.' : `Valeurs en ${unit === 'hours' ? 'heures' : 'jours'}.`}</caption>
        <thead><tr><th scope="col" className="rpv-resource-column"><div><span>Ressource</span>{mode !== 'capacity' && <div className="rpv-tree-actions"><button type="button" aria-label="Déplier toutes les ressources" disabled={!expandable.length} onClick={() => setExpanded(new Set(expandable.map(row => row.resource.id)))}><ChevronsDown size={19} /></button><button type="button" aria-label="Replier toutes les ressources" disabled={!expanded.size} onClick={() => setExpanded(new Set())}><ChevronsUp size={19} /></button></div>}</div></th>{periods.map(period => <th key={period.id} scope="col" title={periodRange(period)}>{period.label}{granularity === 'weekly' && <span className="rpv-week-dates">{displayDate(period.startDate).slice(0, 5)} – {displayDate(period.endDate).slice(0, 5)}</span>}</th>)}</tr></thead>
        <tbody>{rows.map(row => <Fragment key={row.resource.id}><tr className={`rpv-resource-row${row.resource.active ? '' : ' rpv-inactive-row'}`}>
          <th scope="row" className="rpv-resource-column"><div className="rpv-resource-name">{mode !== 'capacity' && (row.projects.length ? <button type="button" className="rpv-expand" aria-expanded={expanded.has(row.resource.id)} aria-label={`${expanded.has(row.resource.id) ? 'Replier' : 'Déplier'} les projets de ${row.resource.name}`} onClick={() => toggle(row.resource.id)}>{expanded.has(row.resource.id) ? <Minus size={14} /> : <Plus size={14} />}</button> : <span className="rpv-expand-spacer" />)}<span className="avatar rpv-avatar" aria-hidden="true" style={{ background: row.resource.color, color: resourceAvatarTextColor(row.resource.color) }}>{row.resource.initials}</span><div><button type="button" className="rpv-resource-link" aria-label={`Ouvrir la fiche de ${row.resource.name}`} disabled={!openResource} onClick={() => openResource?.(row.resource)} title={`Capacité hebdomadaire : ${formatHours(normalizeResource(row.resource).weeklyCapacityHours.reduce((sum, hours) => sum + hours, 0))}`}>{row.resource.name}</button>{row.resource.jobTitle && <span className="rpv-job-title">{row.resource.jobTitle}</span>}{!row.resource.active && <span className="rpv-inactive-label">Inactive</span>}</div></div></th>
          {row.cells.map((cell, index) => {
            const capacity = amount(cell.capacityHours, row.resource, unit);
            const load = amount(cell.loadHours, row.resource, unit);
            const rate = cell.occupancyRate;
            const description = `${row.resource.name} · ${periodRange(periods[index])} · Charge ${load} ${unitSymbol}, capacité ${capacity} ${unitSymbol}${rate === null ? ' · Capacité nulle : taux non calculable' : ` · Occupation ${percentage.format(rate)} %`}`;
            return <td key={periods[index].id} className={`${mode === 'occupancy' ? `rpv-heat rpv-heat-${resourceOccupancyBand(rate)}` : ''}${mode === 'load' && cell.loadHours > cell.capacityHours ? ' rpv-overload-text' : ''}`} title={description} aria-label={description}>{mode === 'capacity' ? capacity : mode === 'load' ? `${load} / ${capacity}` : rate === null ? '—' : `${percentage.format(rate)} %`}</td>;
          })}
        </tr>{mode !== 'capacity' && expanded.has(row.resource.id) && row.projects.map(branch => {
          const zone = data.zones.find(item => item.id === branch.project.zoneId);
          return <tr key={`${row.resource.id}-${branch.project.id}`} className="rpv-project-row"><th scope="row" className="rpv-resource-column"><button type="button" className="rpv-project-link" onClick={() => openProject(branch.project)} title={branch.project.name}>{zone && <span className="rpv-zone-dot" style={{ background: zone.color }} aria-hidden="true" />}<Folder size={18} /><span>{branch.project.name}</span></button></th>{branch.loadHours.map((hours, index) => <td key={periods[index].id} title={`${branch.project.name} · Charge prévue : ${amount(hours, row.resource, unit)} ${unitSymbol}`}>{amount(hours, row.resource, unit)}</td>)}</tr>;
        })}</Fragment>)}{!rows.length && <tr><td className="rpv-empty" colSpan={totalColumns}>Aucune ressource ne correspond à ces filtres.</td></tr>}</tbody>
      </table>
    </div>
    <div className="rpv-notes">{mode === 'load' && <p>Charge / capacité en {unit === 'hours' ? 'heures' : 'jours'}. Les lignes de projet affichent uniquement la charge prévue.</p>}{mode === 'occupancy' && <p><span className="rpv-legend-dot rpv-heat-normal" />≤ 100 %<span className="rpv-legend-dot rpv-heat-warning" />&gt; 100 % à 120 %<span className="rpv-legend-dot rpv-heat-overload" />&gt; 120 %<span className="rpv-legend-dot rpv-heat-unavailable" />— : capacité nulle. Les lignes de projet affichent la charge en {unit === 'hours' ? 'heures' : 'jours'}.</p>}{mode === 'capacity' && <p>Capacité disponible calculée depuis la semaine de chaque ressource, ses jours fériés et ses indisponibilités.</p>}{unit === 'days' && <p>1 jour = les heures par jour définies dans la fiche de la ressource.</p>}{undated > 0 && mode !== 'capacity' && <p>{undated} tâche{undated > 1 ? 's' : ''} allouée{undated > 1 ? 's' : ''} sans dates complètes {undated > 1 ? 'ne sont pas réparties' : 'n’est pas répartie'} dans le calendrier.</p>}{granularity === 'weekly' && <p>Les semaines aux limites de l’année ne comptent que les jours de l’année sélectionnée.</p>}</div>
  </section>;
}
