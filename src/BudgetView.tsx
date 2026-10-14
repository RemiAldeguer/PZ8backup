import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowDownLeft, CalendarDays, Check, Coins, Edit3, Plus, Tags, Trash2, Users, Wallet, X } from 'lucide-react';
import type { Expense, Revenue, ViewProps } from '../shared/types';
import { formatHours, taskMetrics } from '../shared/domain';
import { EXPENSE_TYPE_STYLES, projectBudgetOverview } from '../shared/budget-distributions';
import './budget-view.css';

const REVENUE_LABELS = { sales: 'Ventes', services: 'Prestations', grants: 'Subventions', other: 'Autres' };
const value = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const number = (form: FormData, key: string) => Number(form.get(key));
const money = (amount: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(amount) < 0.005 ? 0 : amount);
const calendarDate = (date: string) => new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'La modification n’a pas pu être enregistrée.';
const percent = (ratio: number) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(ratio * 100)} %`;
function contrastText(color: string): string {
  const values = color.slice(1).match(/../g)!.map(value => parseInt(value, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return values[0] * .2126 + values[1] * .7152 + values[2] * .0722 > .179 ? '#000' : '#fff';
}

function Cost({ amount, missing = 0, upper = false }: { amount: number; missing?: number; upper?: boolean }) {
  return <span title={missing ? `${upper ? 'Maximum' : 'Minimum'} connu : valorisation incomplète` : undefined}>{missing > 0 ? upper ? '≤ ' : '≥ ' : ''}{money(amount)}</span>;
}

function BudgetDialog({ title, children, onClose, onSubmit, submitLabel = 'Enregistrer', writable = true }: {
  title: string; children: ReactNode; onClose: () => void; onSubmit: (form: FormData) => Promise<void>; submitLabel?: string; writable?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => { element?.close(); }; }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || !writable) return;
    const form = new FormData(event.currentTarget);
    busyRef.current = true; setBusy(true); setError('');
    try { await onSubmit(form); onClose(); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="modal budget-dialog" aria-label={title} onCancel={event => { event.preventDefault(); if (!busyRef.current) onClose(); }}>
    <form onSubmit={submit}>
      <div className="modal-header"><h2>{title}</h2><button type="button" className="icon-button" aria-label="Fermer le formulaire" disabled={busy} onClick={onClose}><X size={22} /></button></div>
      <div className="modal-body"><fieldset className="budget-dialog-fields" disabled={busy || !writable}>{children}</fieldset>{!writable && <p className="form-error" role="status">Ce projet est en lecture seule.</p>}{error && <p className="form-error" role="alert">{error}</p>}</div>
      <div className="modal-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>Annuler</button><button type="submit" className="button button-primary" disabled={busy || !writable}>{busy ? 'Enregistrement…' : submitLabel}</button></div>
    </form>
  </dialog>;
}

interface ChartItem { key: string; label: string; color: string; amount: number; missing: number; }
function Distribution({ title, items, kind, basis }: { title: string; items: ChartItem[]; kind: 'expenses' | 'resources'; basis: 'planned' | 'actual' }) {
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  const incomplete = items.some(item => item.missing > 0);
  const visible = items.filter(item => (kind === 'resources' && item.key !== 'unclassified') || item.amount > 0 || item.missing > 0);
  const positive = items.filter(item => item.amount > 0);
  let end = 0;
  const stops = positive.map(item => { const start = end; end += item.amount / total * 100; return `${item.color} ${start}% ${end}%`; }).join(', ');
  const label = `${title} · ${basis === 'planned' ? 'Planifié' : 'Réel'}${incomplete ? ' · coûts connus uniquement' : ''}`;
  return <section className={`card budget-chart budget-${kind === 'expenses' ? 'expense' : 'resource'}-chart`} aria-label={title}>
    <div className="budget-card-heading"><h2>{title}</h2></div>
    <div className={`budget-chart-body ${kind === 'resources' ? 'budget-donut-layout' : ''}`}>
      {kind === 'expenses' ? <div className="budget-stacked-bar" role="img" aria-label={total > 0 ? label : `${label} : aucun coût connu`}>
        {positive.map(item => <span key={item.key} style={{ width: `${item.amount / total * 100}%`, background: item.color, color: contrastText(item.color) }} title={`${item.label} : ${money(item.amount)} (${percent(item.amount / total)})`}>{item.amount / total >= .075 && percent(item.amount / total)}</span>)}
        {total === 0 && <span className="budget-no-chart">{incomplete ? 'Coûts non valorisés' : 'Aucun coût'}</span>}
      </div> : <div className="budget-donut" role="img" aria-label={total > 0 ? label : `${label} : aucun coût connu`} style={{ background: total > 0 ? `conic-gradient(${stops})` : '#e8edf0' }}><div><Users size={29} aria-hidden="true" /><strong>{money(total)}</strong><span>{incomplete ? 'Coûts connus' : basis === 'planned' ? 'Coûts planifiés' : 'Coûts réels'}</span></div></div>}
      <div className="budget-chart-details">
        <ul className="budget-chart-legend">{visible.map(item => <li key={item.key}><span className="budget-legend-label"><i style={{ background: item.color }} aria-hidden="true" />{item.label}</span><strong><Cost amount={item.amount} missing={item.missing} /></strong>{total > 0 && item.amount > 0 && <small>{percent(item.amount / total)}{incomplete && ' des coûts connus'}</small>}{item.missing > 0 && <small className="budget-unknown-cost">{item.missing} valorisation{item.missing > 1 ? 's' : ''} manquante{item.missing > 1 ? 's' : ''}</small>}</li>)}</ul>
        {!visible.length && <p className="budget-chart-empty">{basis === 'planned' ? 'Aucun coût planifié pour ce projet.' : 'Aucun coût réel enregistré pour ce projet.'}</p>}
        {incomplete && <p className="budget-chart-note">Les proportions portent sur les coûts connus. Les tarifs manquants restent à renseigner.</p>}
      </div>
    </div>
  </section>;
}

function Ring({ label, ratio, missing = false }: { label: string; ratio: number | null; missing?: boolean }) {
  const displayed = ratio !== null ? Math.max(0, Math.min(100, ratio * 100)) : 0;
  return <div className="budget-follow-indicator"><div className={`budget-follow-ring ${ratio !== null && ratio > 1 ? 'budget-overrun' : ''}`} style={{ background: `conic-gradient(${ratio !== null && ratio > 1 ? '#d63b41' : '#0098bf'} ${displayed}%, #c1dfeb ${displayed}%)` }}><strong>{ratio === null ? '—' : `${missing ? '≥ ' : ''}${percent(ratio)}`}</strong></div><span>{label}</span>{missing && <small>Valorisation incomplète</small>}</div>;
}

export function BudgetView({ data, project, mutate, notify }: ViewProps) {
  const overview = projectBudgetOverview(data, project.id);
  const { metrics, resourceCosts, expenseCosts, revenues } = overview;
  const tasks = data.tasks.filter(task => task.projectId === project.id);
  const work = taskMetrics(tasks, data.timeEntries, data.today);
  const writable = project.status !== 'paused' && project.status !== 'closed';
  const expenses = data.expenses.filter(expense => expense.projectId === project.id).sort((a, b) => a.plannedDate.localeCompare(b.plannedDate));
  const projectRevenues = data.revenues.filter(revenue => revenue.projectId === project.id).sort((a, b) => a.plannedDate.localeCompare(b.plannedDate));
  const [basis, setBasis] = useState<'planned' | 'actual'>('planned');
  const [expenseEditor, setExpenseEditor] = useState<Expense | 'new' | null>(null);
  const [revenueEditor, setRevenueEditor] = useState<Revenue | 'new' | null>(null);
  const [budgetEditor, setBudgetEditor] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const deletingRef = useRef(false);
  const editedExpense = expenseEditor && expenseEditor !== 'new' ? expenseEditor : null;
  const editedRevenue = revenueEditor && revenueEditor !== 'new' ? revenueEditor : null;
  const expenseItems = overview.expenseTypes.map(item => ({ ...item, amount: item[basis], missing: 0 }));
  const resourceItems = overview.resourceTypes.map(item => ({ ...item, amount: item[basis], missing: basis === 'planned' ? item.plannedMissing : item.actualMissing }));
  const missing = metrics.plannedMissing > 0 || metrics.actualMissing > 0 || metrics.earnedMissing > 0;
  const resultClass = (amount: number, count: number) => Math.abs(amount) < .005 ? count > 0 ? 'budget-partial-result' : '' : amount < 0 ? 'budget-negative' : count > 0 ? 'budget-partial-result' : 'budget-positive';

  async function remove(entity: 'expenses' | 'revenues', item: Expense | Revenue) {
    if (deletingRef.current || !writable) return;
    const label = entity === 'expenses' ? 'dépense' : 'recette';
    if (!window.confirm(`Supprimer la ${label} « ${item.label} » ?`)) return;
    deletingRef.current = true; setDeleting(item.id);
    try { await mutate(entity, 'DELETE', undefined, item.id); notify(`${entity === 'expenses' ? 'Dépense' : 'Recette'} supprimée.`); }
    catch (error) { notify(errorMessage(error)); }
    finally { deletingRef.current = false; setDeleting(null); }
  }

  return <section className="operations-view budget-project-view">
    <div className="budget-heading"><div><span className="eyebrow">{project.name}</span><h1>Budget du projet</h1></div><div className="budget-actions"><button className="button button-secondary" onClick={() => setBudgetEditor(true)}><Edit3 size={15} />Modifier le budget</button><button className="button button-secondary" disabled={!writable} onClick={() => setRevenueEditor('new')}><Plus size={17} />Nouvelle recette</button><button className="button button-primary" disabled={!writable} onClick={() => setExpenseEditor('new')}><Plus size={17} />Nouvelle dépense</button></div></div>
    {!writable && <p className="budget-readonly" role="status">Ce projet est en lecture seule : les dépenses et recettes sont conservées.</p>}
    <div className="budget-kpi-strip">
      <button type="button" className="metric-card budget-allocated-card" aria-label="Modifier le budget alloué" aria-haspopup="dialog" onClick={() => setBudgetEditor(true)}><Wallet size={20} aria-hidden="true" /><div><span>Budget alloué</span><strong>{money(metrics.allocated)}</strong><small>Enveloppe du projet · Modifier</small></div><Edit3 className="budget-allocated-pencil" size={17} aria-hidden="true" /></button>
      <div className="metric-card"><CalendarDays size={20} /><div><span>Coût planifié</span><strong><Cost amount={metrics.planned} missing={metrics.plannedMissing} /></strong><small>Ressources et dépenses prévues</small></div></div>
      <div className="metric-card"><Coins size={20} /><div><span>Coût réel</span><strong><Cost amount={metrics.actual} missing={metrics.actualMissing} /></strong><small>Temps saisis et dépenses réglées</small></div></div>
    </div>

    <div className="budget-summary-grid">
      <section className="card budget-summary" aria-label="Synthèse des coûts"><div className="budget-card-heading"><h2>Synthèse des coûts</h2><span>Montants en euros</span></div><div className="budget-table-scroll" tabIndex={0} aria-label="Tableau de synthèse des coûts"><table className="budget-summary-table"><thead><tr><th scope="col" rowSpan={2}>Type de coût</th><th colSpan={3} scope="colgroup">Total du projet</th></tr><tr><th scope="col">Planifié</th><th scope="col">Réel</th><th scope="col">Acquis</th></tr></thead><tbody><tr><th scope="row"><Users size={17} />Ressources</th><td><Cost amount={resourceCosts.planned} missing={resourceCosts.plannedMissing} /></td><td><Cost amount={resourceCosts.actual} missing={resourceCosts.actualMissing} /></td><td><Cost amount={resourceCosts.earned} missing={resourceCosts.earnedMissing} /></td></tr><tr><th scope="row"><Tags size={17} />Dépenses</th><td>{money(expenseCosts.planned)}</td><td>{money(expenseCosts.actual)}</td><td><span title="Les dépenses ne disposent pas d’un avancement de réalisation">—</span></td></tr></tbody><tfoot><tr><th scope="row">Total financier</th><td><Cost amount={metrics.planned} missing={metrics.plannedMissing} /></td><td><Cost amount={metrics.actual} missing={metrics.actualMissing} /></td><td><Cost amount={metrics.earned} missing={metrics.earnedMissing} /></td></tr></tfoot></table></div><p className="budget-summary-note">Acquis : coût planifié des ressources × avancement des tâches. Les dépenses sont suivies par leur règlement.</p><div className="budget-work-summary"><span>Travail alloué <strong>{formatHours(work.allocatedHours)}</strong></span><span>Temps passé <strong>{formatHours(work.spentHours)}</strong></span><span>Alloué − passé <strong className={work.allocatedHours < work.spentHours ? 'budget-negative' : ''}>{formatHours(work.allocatedHours - work.spentHours)}</strong></span></div></section>
      <section className="card budget-follow" aria-label="Suivi du budget"><div className="budget-card-heading"><h2>Suivi</h2></div><div className="budget-follow-rings"><Ring label="Consommation du budget" ratio={metrics.allocated > 0 ? metrics.actual / metrics.allocated : null} missing={metrics.actualMissing > 0} /><Ring label="Avancement valorisé" ratio={resourceCosts.planned > 0 && resourceCosts.plannedMissing === 0 && resourceCosts.earnedMissing === 0 ? resourceCosts.earned / resourceCosts.planned : null} /></div><p className={`budget-available ${resultClass(metrics.actualMargin, metrics.actualMissing)}`}><span>{metrics.actualMissing > 0 ? 'Disponible au maximum' : 'Disponible'}</span><strong><Cost amount={metrics.actualMargin} missing={metrics.actualMissing} upper /></strong></p>{metrics.allocated === 0 && <p className="budget-chart-note">Renseignez un budget alloué pour mesurer sa consommation.</p>}</section>
    </div>
    {missing && <div className="budget-incomplete" role="status"><strong>La valorisation est incomplète</strong><p>{metrics.plannedMissing} allocation{metrics.plannedMissing > 1 ? 's' : ''}, {metrics.actualMissing} saisie{metrics.actualMissing > 1 ? 's' : ''} de temps et {metrics.earnedMissing} valeur{metrics.earnedMissing > 1 ? 's' : ''} acquise{metrics.earnedMissing > 1 ? 's' : ''} sans tarif connu. Les coûts affichés sont des minimums connus ; les marges et résultats correspondants sont des maximums.</p></div>}

    <div className="budget-distributions-toolbar"><label><span>Répartition des coûts</span><select aria-label="Répartition des coûts" value={basis} onChange={event => setBasis(event.target.value as 'planned' | 'actual')}><option value="planned">Planifié</option><option value="actual">Réel</option></select></label><p>{basis === 'planned' ? 'Allocations aux tarifs actuels et toutes les dépenses prévues.' : 'Temps saisis aux tarifs conservés et dépenses réglées.'}</p></div>
    <div className="budget-distribution-grid"><Distribution title="Répartition des coûts par type de dépenses" items={expenseItems} kind="expenses" basis={basis} /><Distribution title="Répartition des coûts par type de ressources" items={resourceItems} kind="resources" basis={basis} /></div>

    <section className="card budget-revenue-summary" aria-label="Synthèse des recettes"><div className="budget-card-heading"><h2>Recettes et résultats</h2><ArrowDownLeft size={18} /></div><div className="budget-revenue-metrics"><div className="budget-revenue-metric"><span>Recettes prévues</span><strong>{money(revenues.planned)}</strong></div><div className="budget-revenue-metric"><span>Recettes encaissées</span><strong>{money(revenues.received)}</strong></div><div className="budget-revenue-metric"><span>À encaisser</span><strong>{money(revenues.pending)}</strong></div><div className={`budget-revenue-metric ${resultClass(revenues.plannedResult, metrics.plannedMissing)}`}><span>Résultat prévisionnel{metrics.plannedMissing > 0 && ' au maximum'}</span><strong><Cost amount={revenues.plannedResult} missing={metrics.plannedMissing} upper /></strong><small>Recettes prévues − coûts planifiés</small></div><div className={`budget-revenue-metric ${resultClass(revenues.actualResult, metrics.actualMissing)}`}><span>Résultat réel{metrics.actualMissing > 0 && ' au maximum'}</span><strong><Cost amount={revenues.actualResult} missing={metrics.actualMissing} upper /></strong><small>Recettes encaissées − coûts réels</small></div></div><p className="budget-summary-note">Les recettes restent distinctes du budget alloué. Une date d’encaissement marque la recette comme encaissée.</p></section>

    <section className="card budget-record-list" aria-label="Liste des dépenses"><div className="budget-card-heading"><h2>Liste des dépenses</h2><span>{expenses.length} dépense{expenses.length > 1 ? 's' : ''}</span></div><div className="budget-table-scroll" tabIndex={0} aria-label="Tableau des dépenses"><table className="budget-record-table"><thead><tr><th scope="col">Libellé</th><th scope="col">Type</th><th scope="col">Montant</th><th scope="col">Date prévue</th><th scope="col">Règlement</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead><tbody>{expenses.map(expense => <tr key={expense.id}><th scope="row">{expense.label}</th><td><span className="budget-category" style={{ background: EXPENSE_TYPE_STYLES[expense.category].color }}><Tags size={13} />{EXPENSE_TYPE_STYLES[expense.category].label}</span></td><td className="budget-money">{money(expense.amount)}</td><td>{calendarDate(expense.plannedDate)}</td><td>{expense.paidDate ? <span className="budget-record-status budget-record-complete"><Check size={13} />Réglée le {calendarDate(expense.paidDate)}</span> : <span className="budget-record-status">À régler</span>}</td><td><div className="budget-row-actions"><button className="icon-button" aria-label={`Modifier ${expense.label}`} disabled={!writable || deleting !== null} onClick={() => setExpenseEditor(expense)}><Edit3 size={16} /></button><button className="icon-button danger" aria-label={`Supprimer ${expense.label}`} disabled={!writable || deleting !== null} onClick={() => void remove('expenses', expense)}><Trash2 size={16} /></button></div></td></tr>)}</tbody></table></div>{!expenses.length && <div className="budget-empty"><Tags size={24} /><p>Aucune dépense pour ce projet.</p><span>Ajoutez licences, prestations ou autres frais.</span></div>}</section>

    <section className="card budget-record-list" aria-label="Liste des recettes"><div className="budget-card-heading"><h2>Liste des recettes</h2><span>{projectRevenues.length} recette{projectRevenues.length > 1 ? 's' : ''}</span></div><div className="budget-table-scroll" tabIndex={0} aria-label="Tableau des recettes"><table className="budget-record-table"><thead><tr><th scope="col">Libellé</th><th scope="col">Type</th><th scope="col">Montant</th><th scope="col">Date prévue</th><th scope="col">Encaissement</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead><tbody>{projectRevenues.map(revenue => <tr key={revenue.id}><th scope="row">{revenue.label}</th><td><span className="budget-revenue-category">{REVENUE_LABELS[revenue.category]}</span></td><td className="budget-money">{money(revenue.amount)}</td><td>{calendarDate(revenue.plannedDate)}</td><td>{revenue.receivedDate ? <span className="budget-record-status budget-record-complete"><Check size={13} />Encaissée le {calendarDate(revenue.receivedDate)}</span> : <span className="budget-record-status">À encaisser</span>}</td><td><div className="budget-row-actions"><button className="icon-button" aria-label={`Modifier recette ${revenue.label}`} disabled={!writable || deleting !== null} onClick={() => setRevenueEditor(revenue)}><Edit3 size={16} /></button><button className="icon-button danger" aria-label={`Supprimer recette ${revenue.label}`} disabled={!writable || deleting !== null} onClick={() => void remove('revenues', revenue)}><Trash2 size={16} /></button></div></td></tr>)}</tbody></table></div>{!projectRevenues.length && <div className="budget-empty"><ArrowDownLeft size={24} /><p>Aucune recette pour ce projet.</p><span>Enregistrez les recettes prévues et leurs encaissements.</span></div>}</section>

    {budgetEditor && <BudgetDialog title="Modifier le budget alloué" onClose={() => setBudgetEditor(false)} onSubmit={async form => { await mutate('projects', 'PATCH', { budget: number(form, 'budget') }, project.id); notify('Budget mis à jour.'); }}><label className="field"><span>Budget alloué (€)</span><input name="budget" type="number" min="0" max="1000000000000" step="0.01" required autoFocus defaultValue={project.budget} /></label></BudgetDialog>}
    {expenseEditor && <BudgetDialog title={editedExpense ? 'Modifier la dépense' : 'Nouvelle dépense'} writable={writable} onClose={() => setExpenseEditor(null)} onSubmit={async form => {
      const payload = { label: value(form, 'label'), category: value(form, 'category'), amount: number(form, 'amount'), plannedDate: value(form, 'plannedDate'), paidDate: value(form, 'paidDate') || null };
      await mutate('expenses', editedExpense ? 'PATCH' : 'POST', editedExpense ? payload : { ...payload, projectId: project.id }, editedExpense?.id); notify(editedExpense ? 'Dépense mise à jour.' : 'Dépense créée.');
    }}><div className="form-grid"><label className="field full-width"><span>Libellé</span><input name="label" required maxLength={200} autoFocus defaultValue={editedExpense?.label ?? ''} placeholder="Ex. Licences de conception" /></label><label className="field"><span>Catégorie</span><select name="category" defaultValue={editedExpense?.category ?? 'other'}>{Object.entries(EXPENSE_TYPE_STYLES).map(([key, style]) => <option key={key} value={key}>{style.label}</option>)}</select></label><label className="field"><span>Montant (€)</span><input name="amount" type="number" min="0" step="0.01" required defaultValue={editedExpense?.amount ?? ''} /></label><label className="field"><span>Date prévue</span><input name="plannedDate" type="date" required defaultValue={editedExpense?.plannedDate ?? data.today} /></label><label className="field"><span>Date de règlement (facultative)</span><input name="paidDate" type="date" defaultValue={editedExpense?.paidDate ?? ''} /></label></div><p className="budget-form-note">Une date de règlement classe la dépense dans le coût réel. Videz cette date pour la remettre à régler.</p></BudgetDialog>}
    {revenueEditor && <BudgetDialog title={editedRevenue ? 'Modifier la recette' : 'Nouvelle recette'} submitLabel={editedRevenue ? 'Enregistrer' : 'Créer la recette'} writable={writable} onClose={() => setRevenueEditor(null)} onSubmit={async form => {
      const payload = { label: value(form, 'label'), category: value(form, 'category'), amount: number(form, 'amount'), plannedDate: value(form, 'plannedDate'), receivedDate: value(form, 'receivedDate') || null };
      await mutate('revenues', editedRevenue ? 'PATCH' : 'POST', editedRevenue ? payload : { ...payload, projectId: project.id }, editedRevenue?.id); notify(editedRevenue ? 'Recette mise à jour.' : 'Recette créée.');
    }}><div className="form-grid"><label className="field full-width"><span>Libellé</span><input name="label" required maxLength={200} autoFocus defaultValue={editedRevenue?.label ?? ''} placeholder="Ex. Prestation de déploiement" /></label><label className="field"><span>Catégorie</span><select name="category" defaultValue={editedRevenue?.category ?? 'services'}>{Object.entries(REVENUE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="field"><span>Montant (€)</span><input name="amount" type="number" min="0" step="0.01" required defaultValue={editedRevenue?.amount ?? ''} /></label><label className="field"><span>Date prévue</span><input name="plannedDate" type="date" required defaultValue={editedRevenue?.plannedDate ?? data.today} /></label><label className="field"><span>Date d’encaissement (facultative)</span><input name="receivedDate" type="date" defaultValue={editedRevenue?.receivedDate ?? ''} /></label></div><p className="budget-form-note">Renseignez la date d’encaissement pour enregistrer la recette comme encaissée. Videz cette date pour la remettre à encaisser.</p></BudgetDialog>}
  </section>;
}
