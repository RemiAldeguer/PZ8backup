import { projectTimeEntries } from '../shared/planzone-preferences';
import { CustomRichTextPreview, ReadOnlyCustomField } from './CustomFieldInputs';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Cloud, CloudLightning, CloudRain, CloudSun, FileDown, Folder, Printer, Sun, X } from 'lucide-react';
import type { AppData, Project } from '../shared/types';
import { STATUS_LABELS } from '../shared/types';
import { projectStatusLabel, strategicScore } from '../shared/customization';
import { formatHours, taskMetrics } from '../shared/domain';
import { projectBudgetOverview } from '../shared/budget-distributions';
import { projectZoneMetrics } from '../shared/zone-projects';
import { ReportSnapshot } from './ProjectReportDialog';
import './flash-report.css';

const money = (amount: number) => new Intl.NumberFormat('fr-FR', {
  style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(Math.abs(amount) < .005 ? 0 : amount);
const fullDate = (date: string | null) => date ? new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
}).format(new Date(`${date}T12:00:00Z`)) : 'Non planifié';

function Cost({ amount, missing = 0, upper = false }: { amount: number; missing?: number; upper?: boolean }) {
  return <span>{missing > 0 ? upper ? '≤ ' : '≥ ' : ''}{money(amount)}</span>;
}

function marginClass(amount: number, missing: number): string {
  if (Math.abs(amount) < .005) return missing ? 'fr-partial' : '';
  return amount < 0 ? 'fr-negative' : missing ? 'fr-partial' : 'fr-positive';
}

/** Shared by the project summary preview and the existing printable export. */
export function FlashReportContent({ data, project, subject = '', linkedReportId }: { data: AppData; project: Project; subject?: string; linkedReportId?: string | null }) {
  const tasks = data.tasks.filter(task => task.projectId === project.id);
  const work = taskMetrics(tasks, projectTimeEntries(data), data.today);
  const overview = projectBudgetOverview(data, project.id);
  const budget = overview.metrics;
  const milestoneRows = tasks.filter(task => task.kind === 'milestone');
  const workRows = tasks.filter(task => task.kind === 'task' && task.status !== 'done');
  const resourceTypes = overview.resourceTypes.filter(item => item.key !== 'unclassified' || item.planned > 0 || item.actual > 0 || item.plannedMissing || item.actualMissing);
  const financialMetrics = [
    { label: 'Alloué', amount: budget.allocated, missing: 0, upper: false, className: '' },
    { label: 'Planifié', amount: budget.planned, missing: budget.plannedMissing, upper: false, className: '' },
    { label: 'Réel', amount: budget.actual, missing: budget.actualMissing, upper: false, className: '' },
    { label: 'Marge planifiée', amount: budget.plannedMargin, missing: budget.plannedMissing, upper: true, className: marginClass(budget.plannedMargin, budget.plannedMissing) },
    { label: 'Marge réelle', amount: budget.actualMargin, missing: budget.actualMissing, upper: true, className: marginClass(budget.actualMargin, budget.actualMissing) },
    { label: 'Acquis', amount: budget.earned, missing: budget.earnedMissing, upper: false, className: '' },
  ];

  const zone = data.zones.find(zone => zone.id === project.zoneId);
  const reports = (data.projectReports ?? []).filter(report => report.projectId === project.id).sort((a, b) => b.reportDate.localeCompare(a.reportDate) || b.createdAt.localeCompare(a.createdAt));
  const linked = linkedReportId === undefined ? reports[0] : reports.find(report => report.id === linkedReportId);
  const fields = (data.customFieldDefinitions ?? []).filter(field => field.scope === 'project');
  const activity = projectZoneMetrics(data, [project]);
  const axes = (data.strategicAxes ?? []).filter(axis => project.strategicRatings?.[axis.id] !== undefined);
  const Weather = [CloudLightning, CloudRain, Cloud, CloudSun, Sun][Math.max(0, Math.min(4, project.weather - 1))];
  const segments = [{ label: 'Réalisé', percent: activity.realizedPercent, hours: work.realizedHours, color: '#96cd96' }, { label: 'Retard', percent: activity.latePercent, hours: work.lateHours, color: '#e84c58' }, { label: 'Ouvert', percent: activity.openPercent, hours: work.openHours, color: '#9b9ea0' }];
  const shortDate = (date: string) => date.split('-').reverse().join('/');
  return <div className="fr-report-document fr-reference-report">
    <section className="fr-cover" aria-label="Présentation du rapport flash">
      <header className="fr-reference-heading"><div className="fr-reference-brand"><span><FileDown size={25} /></span><strong>Planzone 8</strong></div><div><h1>RAPPORT FLASH</h1><p>Créé le : {shortDate(data.today)}<br />Par : {data.currentUser.name}</p></div></header>
      <div className="fr-project-identity"><div><span>Projet :</span><Folder size={24} /><h2>{project.name}</h2></div><div><span>Dans la zone :</span>{zone && <i style={{ backgroundColor: zone.color }}>{data.zones.indexOf(zone) + 1}</i>}<strong>{zone?.name ?? 'Zone non renseignée'}</strong></div></div>
      <section className="fr-subject"><h2>Objet :</h2><p>{subject.trim() || 'Point d’avancement du projet'}</p></section>
      <div className="fr-project-summary"><div><h2>Météo :</h2><Weather size={39} /><strong>{project.weather >= 1 ? `${project.weather}/5` : '—'}</strong></div><div><h2>Statut :</h2><strong><Folder size={17} />{projectStatusLabel(project, data)}</strong></div><div><h2>Début :</h2><strong>{shortDate(project.startDate)}</strong></div><div><h2>Fin :</h2><strong>{shortDate(project.endDate)}</strong></div><div><h2>Score stratégique :</h2><strong className="fr-strategy-score">{axes.length ? strategicScore(project, data.strategicAxes ?? []) : '—'}</strong></div></div>
      <div className="fr-portfolios"><h2>Portefeuille(s) :</h2>{project.portfolioNames?.length ? project.portfolioNames.map(name => <span key={name}><Folder size={16} />{name}</span>) : <p>Aucun portefeuille associé</p>}</div>
      <section className="fr-description"><h2>Description du projet :</h2>{project.description ? project.descriptionFormat === 'markdown' ? <CustomRichTextPreview value={project.description} /> : <p>{project.description}</p> : <p>Description non renseignée.</p>}</section>
    </section>
    {fields.length > 0 && <section className="fr-report-section fr-custom-page" aria-label="Champs personnalisés du projet"><h2>Champs personnalisés</h2><div className="fr-custom-fields">{fields.map(field => <div className="fr-custom-row" key={field.id}><strong>{field.translations.fr || field.name}</strong><ReadOnlyCustomField field={field} label={field.translations.fr || field.name} value={project.customValues?.[field.id] ?? ''} definitions={data.customFieldDefinitions ?? []} values={project.customValues ?? {}} builtinValues={{ budget: project.budget }} /></div>)}</div></section>}
    <section className="fr-report-section fr-activity-page" aria-label="Suivi de l’activité du projet"><h2>Suivi de l’activité :</h2><div className="fr-activity-segments">{segments.map(segment => <div key={segment.label} style={{ color: segment.color }}><h3>{segment.label}</h3><strong>{activity.activityBasis === 'none' ? '—' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(segment.percent) + ' %'}</strong><span>{formatHours(segment.hours)}</span></div>)}</div><div className="fr-activity-bar" role="img" aria-label="Répartition de l’activité du projet">{segments.map(segment => segment.percent > 0 && <span key={segment.label} style={{ flexGrow: segment.percent, backgroundColor: segment.color }} />)}</div>{activity.activityBasis === 'tasks' && <p className="fr-explanation">Activité calculée par tâche, sans heures allouées.</p>}</section>
    <div className="fr-work-kpis op-print-kpis">
      <div><strong>{work.allocatedHours > 0 ? `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(work.progress)} %` : '—'}</strong><span>Avancement pondéré</span>{work.allocatedHours === 0 && <small>Aucune heure allouée</small>}</div>
      <div><strong>{work.completed} / {work.total}</strong><span>Tâches terminées</span></div>
      <div><strong>{work.completedMilestones} / {work.milestones}</strong><span>Jalons réalisés</span></div>
      <div><strong>{work.overdue}</strong><span>Tâches en retard</span></div>
    </div>
    <section className="fr-report-section"><h2>Dates & travail</h2><p>Du {fullDate(project.startDate)} au {fullDate(project.endDate)}</p><dl className="fr-work-totals"><div><dt>Alloué</dt><dd>{formatHours(work.allocatedHours)}</dd></div><div><dt>Passé</dt><dd>{formatHours(work.spentHours)}</dd></div><div><dt>Alloué − passé</dt><dd>{formatHours(work.allocatedHours - work.spentHours)}</dd></div></dl><p className="fr-explanation">L’avancement est pondéré par les allocations des tâches. Le temps passé reprend toutes les saisies du projet, y compris celles restant à valider.</p></section>
    <section className="fr-report-section"><h2>Jalons</h2>{milestoneRows.length ? <div className="fr-table-wrap"><table className="fr-table fr-task-table"><thead><tr><th>Jalon</th><th>Échéance</th><th>Statut</th></tr></thead><tbody>{milestoneRows.map(task => <tr key={task.id}><th scope="row">{task.title}</th><td>{fullDate(task.endDate)}</td><td>{STATUS_LABELS[task.status]}</td></tr>)}</tbody></table></div> : <p>Aucun jalon planifié.</p>}</section>
    <section className="fr-report-section" aria-label="Budget du projet"><h2>Budget du projet</h2><div className="fr-budget-kpis">{financialMetrics.map(item => <div key={item.label}><span>{item.label}</span><strong className={item.className}><Cost amount={item.amount} missing={item.missing} upper={item.upper} /></strong>{item.missing > 0 && <small>Valorisation incomplète</small>}</div>)}</div><p className="fr-explanation">Le planifié utilise les profils de coûts actuels et les dépenses prévues. Le réel utilise les tarifs historiques des temps saisis et les dépenses réglées. Les marges comparent ces coûts au budget alloué. L’acquis valorise l’avancement des ressources ; les dépenses et les recettes ne sont pas ajoutées à cette valeur.</p>{Boolean(budget.plannedMissing || budget.actualMissing || budget.earnedMissing) && <p className="fr-cost-note">{budget.plannedMissing} allocation(s), {budget.actualMissing} saisie(s) et {budget.earnedMissing} valorisation(s) d’avancement sans tarif connu. Les coûts connus sont des minimums (≥), les marges des maximums (≤).</p>}</section>
    <section className="fr-report-section"><h2>Coûts par type de ressources</h2><div className="fr-table-wrap"><table className="fr-table"><thead><tr><th>Type</th><th>Planifié</th><th>Réel</th><th>Acquis</th></tr></thead><tbody>{resourceTypes.map(item => <tr key={item.key}><th scope="row"><span className="fr-resource-type"><i style={{ background: item.color }} aria-hidden="true" />{item.label}</span></th><td><Cost amount={item.planned} missing={item.plannedMissing} /></td><td><Cost amount={item.actual} missing={item.actualMissing} /></td><td><Cost amount={item.earned} missing={item.earnedMissing} /></td></tr>)}<tr className="fr-total-row"><th scope="row">Total ressources</th><td><Cost amount={overview.resourceCosts.planned} missing={budget.plannedMissing} /></td><td><Cost amount={overview.resourceCosts.actual} missing={budget.actualMissing} /></td><td><Cost amount={overview.resourceCosts.earned} missing={budget.earnedMissing} /></td></tr><tr><th scope="row">Dépenses</th><td>{money(overview.expenseCosts.planned)}</td><td>{money(overview.expenseCosts.actual)}</td><td>—</td></tr></tbody></table></div><p className="fr-explanation">Les coûts réels suivent la ressource qui a saisi le temps, même si la tâche a été réaffectée. Les types reflètent la classification actuelle des ressources.</p></section>

    <section className="fr-report-section"><h2>Tâches à suivre</h2>{workRows.length ? <div className="fr-table-wrap"><table className="fr-table fr-task-table"><thead><tr><th>Tâche</th><th>Ressource</th><th>Statut</th><th>Fin</th><th>Avancement</th></tr></thead><tbody>{workRows.map(task => <tr key={task.id}><th scope="row">{task.title}</th><td>{data.resources.find(resource => resource.id === task.assigneeId)?.name ?? 'Non affectée'}</td><td>{STATUS_LABELS[task.status]}</td><td>{fullDate(task.endDate)}</td><td>{task.progress} %</td></tr>)}</tbody></table></div> : <p>Toutes les tâches du projet sont terminées, ou aucune tâche n’est encore définie.</p>}</section>
    {linked && <section className="fr-report-section fr-linked-report" aria-label="Compte rendu lié"><h2>Compte rendu lié</h2><ReportSnapshot report={linked} projectName={project.name} /></section>}
    <footer className="fr-document-footer">Rapport calculé à partir des données du projet au {fullDate(data.today)} · Planzone 8.</footer>
  </div>;
}

export function FlashReportDialog({ data, project, onClose }: { data: AppData; project: Project; onClose: () => void }) {
  const reports = (data.projectReports ?? []).filter(report => report.projectId === project.id).sort((a, b) => b.reportDate.localeCompare(a.reportDate) || b.createdAt.localeCompare(a.createdAt));
  const [subject, setSubject] = useState(''); const [linkedReportId, setLinkedReportId] = useState<string | null>(reports[0]?.id ?? null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    function markPrint() { document.body.dataset.pzPrint = 'flash-report'; }
    function clearPrint() { if (document.body.dataset.pzPrint === 'flash-report') delete document.body.dataset.pzPrint; }
    window.addEventListener('beforeprint', markPrint);
    window.addEventListener('afterprint', clearPrint);
    return () => { element?.close(); clearPrint(); window.removeEventListener('beforeprint', markPrint); window.removeEventListener('afterprint', clearPrint); };
  }, []);
  function print() { document.body.dataset.pzPrint = 'flash-report'; window.print(); }
  return <><dialog ref={dialog} className="fr-dialog" aria-label="Rapport flash" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="fr-dialog-header"><div><FileDown size={24} aria-hidden="true" /><h2>Rapport flash</h2></div><button className="fr-icon-button" type="button" aria-label="Fermer le rapport flash" onClick={onClose}><X size={24} /></button></div>
    <div className="fr-preparation"><label>Objet du rapport<input value={subject} maxLength={500} placeholder="Point d’avancement du projet" onChange={event => setSubject(event.target.value)} /></label><label>Compte rendu lié<select value={linkedReportId ?? ''} onChange={event => setLinkedReportId(event.target.value || null)}><option value="">Aucun compte rendu</option>{reports.map(report => <option key={report.id} value={report.id}>{report.title}</option>)}</select></label></div>
    <div className="fr-preview" aria-label="Aperçu du rapport flash"><FlashReportContent data={data} project={project} subject={subject} linkedReportId={linkedReportId} /></div>
    <div className="fr-dialog-actions"><p>Choisissez votre imprimante ou « Enregistrer au format PDF » dans la fenêtre d’impression.</p><button className="fr-button fr-button-secondary" type="button" onClick={onClose}>Fermer</button><button className="fr-button fr-button-primary" type="button" onClick={print}><Printer size={18} aria-hidden="true" />Imprimer / enregistrer en PDF</button></div>
  </dialog>{createPortal(<article className="print-report op-print-report fr-print-report"><FlashReportContent data={data} project={project} subject={subject} linkedReportId={linkedReportId} /></article>, document.body)}</>;
}
