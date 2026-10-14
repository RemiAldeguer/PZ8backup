import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { UserCheck, UserMinus, Coins, Download, Edit3, FileText, FolderKanban, Plus, Printer, Search, Trash2, Users, Wallet, X } from 'lucide-react';
import { STATUS_LABELS, RESOURCE_ROLE_LABELS, type CostProfile, type Resource, type ViewProps } from '../shared/types';
import { GlobalRoleControl } from './RoleSelect';
import { canSeeView, isAdmin } from '../shared/permissions';
import { associatedResourceProjectIds, normalizeResource } from '../shared/resources';
import { ReportDraftPreview, ReportTemplateComposer, type ReportDraft } from './ReportTemplatesView';
import { FlashReportContent } from './FlashReportView';
import { formatHours, formatMoney, resourceCapacity, resourceLoad, taskMetrics } from '../shared/domain';

const RESOURCE_LABELS = { human: 'Humaine', virtual: 'Virtuelle', material: 'Matérielle' };
const number = (form: FormData, key: string) => Number(form.get(key));
const value = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const calendarDate = (date: string) => new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'La modification n’a pas pu être enregistrée.';
function Avatar({ resource }: { resource?: Resource }) {
  return <span className="avatar op-inline-avatar" style={{ background: resource?.color ?? '#e8edf4', color: resource ? '#fff' : '#637086' }} aria-hidden="true">{resource?.initials ?? '—'}</span>;
}
function Metric({ label, value: amount, icon, detail }: { label: string; value: string; icon: ReactNode; detail?: string }) {
  return <div className="card metric-card"><span className="metric-icon">{icon}</span><span className="metric-label">{label}</span><strong className="metric-value">{amount}</strong>{detail && <span className="metric-detail">{detail}</span>}</div>;
}
function Empty({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="empty-state"><FolderKanban size={32} /><h3>{title}</h3><p>{detail}</p>{action}</div>;
}
function FormDialog({ title, children, onClose, onSubmit, submitLabel = 'Enregistrer' }: {
  title: string; children: ReactNode; onClose: () => void; onSubmit: (form: FormData) => Promise<void>; submitLabel?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => { element?.close(); }; }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError('');
    try { await onSubmit(form); onClose(); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="modal op-dialog" aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={submit}>
      <div className="modal-header"><div><span className="eyebrow">PLANZONE 8</span><h2>{title}</h2></div><button className="icon-button" type="button" aria-label="Fermer le formulaire" disabled={busy} onClick={onClose}><X size={20} /></button></div>
      <div className="modal-body">{children}{error && <p className="form-error" role="alert">{error}</p>}</div>
      <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>Annuler</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Enregistrement…' : submitLabel}</button></div>
    </form>
  </dialog>;
}

type ResourceTab = 'directory' | 'profiles' | 'capacity';
export function ResourcesView({ data, mutate, notify, openResource, initialTab = 'directory', onTabChange }: ViewProps & { initialTab?: ResourceTab; onTabChange?: (tab: ResourceTab) => void }) {
  const [tab, setTab] = useState<ResourceTab>(initialTab);
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [showInactive, setShowInactive] = useState(false);
  const [month, setMonth] = useState(data.today.slice(0, 7));
  const [profileEditor, setProfileEditor] = useState<CostProfile | 'new' | null>(null);
  const selected = data.resources.filter(resource => (showInactive || resource.active) && (type === 'all' || resource.type === type) && `${resource.name} ${resource.jobTitle}`.toLocaleLowerCase('fr').includes(query.toLocaleLowerCase('fr')));
  const first = `${month}-01`;
  const [year, monthNumber] = month.split('-').map(Number);
  const last = `${month}-${String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, '0')}`;
  const undated = data.tasks.filter(task => task.kind === 'task' && selected.some(resource => resource.id === task.assigneeId) && (!task.startDate || !task.endDate) && task.allocatedHours > 0).length;
  async function remove(entity: 'profiles', id: string, name: string) {
    if (!window.confirm(`Supprimer « ${name} » ? Les données liées peuvent empêcher cette suppression.`)) return;
    try { await mutate(entity, 'DELETE', undefined, id); notify('Suppression enregistrée.'); }
    catch (error) { notify(errorMessage(error)); }
  }
  async function toggleActive(resource: Resource) {
    if (resource.active && !window.confirm(`Désactiver « ${resource.name} » ? Ses affectations et son historique seront conservés.`)) return;
    try { await mutate('resources', 'PATCH', { active: !resource.active }, resource.id); notify(resource.active ? 'Ressource désactivée, historique conservé.' : 'Ressource réactivée.'); }
    catch (error) { notify(errorMessage(error)); }
  }
  const editedProfile = profileEditor && profileEditor !== 'new' ? profileEditor : null;
  return <section className="operations-view">
    <div className="view-header"><div><span className="eyebrow">GESTION DES RESSOURCES</span><h1>Les bonnes personnes, au bon moment</h1><p>Capacité, allocations et tarifs : une lecture claire de votre équipe.</p></div><div className="header-actions"><button className="button button-secondary" disabled={!isAdmin(data)} onClick={() => setProfileEditor('new')}><Coins size={17} />Nouveau profil</button><button className="button button-primary" disabled={!isAdmin(data)} onClick={() => openResource?.(null)}><Plus size={18} />Nouvelle ressource</button></div></div>
    <div className="metric-grid"><Metric label="Ressources actives" value={String(data.resources.filter(resource => resource.active).length)} icon={<Users size={20} />} detail="Toutes les natures de ressource" /><Metric label="Profils de coûts" value={String(data.profiles.length)} icon={<Coins size={20} />} detail="Tarifs en euros par Eqjt" /><Metric label="Sans profil tarifaire" value={String(data.resources.filter(resource => resource.active && !resource.profileId).length)} icon={<Wallet size={20} />} detail="Le coût reste inconnu" /></div>
    <div className="tabs" aria-label="Vues des ressources">{([['directory', 'Annuaire'], ['capacity', 'Capacité'], ['profiles', 'Profils de coûts']] as const).filter(([key]) => canSeeView(data, key === 'directory' ? 'resources' : key)).map(([key, label]) => <button key={key} className={`tab ${tab === key ? 'active' : ''}`} aria-pressed={tab === key} onClick={() => onTabChange ? onTabChange(key) : setTab(key)}>{label}</button>)}</div>
    {tab !== 'profiles' && <div className="view-toolbar"><label className="search-field"><Search size={17} /><input aria-label="Rechercher une ressource" placeholder="Rechercher une ressource…" value={query} onChange={event => setQuery(event.target.value)} /></label><select aria-label="Nature de ressource" value={type} onChange={event => setType(event.target.value)}><option value="all">Toutes les ressources</option>{Object.entries(RESOURCE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}s</option>)}</select>{tab === 'capacity' && <input type="month" aria-label="Mois de charge et capacité" value={month} onChange={event => { if (event.target.value) setMonth(event.target.value); }} />}<label className="checkbox-field"><input type="checkbox" checked={showInactive} onChange={event => setShowInactive(event.target.checked)} />Inclure les inactives</label></div>}
    {tab === 'directory' && <div className="card table-wrap"><table className="data-table"><thead><tr><th>Ressource</th><th>Nature / classification</th><th>Rôle global</th><th>Profil de coût</th><th>Capacité hebdomadaire</th><th>État</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{selected.map(resource => {
      const profile = data.profiles.find(item => item.id === resource.profileId);
      return <tr key={resource.id}><td><div className="resource-name"><Avatar resource={resource} /><div><button className="text-button" aria-label={`Ouvrir la fiche de ${resource.name}`} onClick={() => openResource?.(resource)}><strong>{resource.name}</strong></button><span className="muted">{resource.jobTitle || 'Fonction non renseignée'}</span></div></div></td><td>{RESOURCE_LABELS[resource.type]}<span className="muted block">{resource.classification === 'internal' ? 'Interne' : 'Externe'}</span></td><td><GlobalRoleControl data={data} resource={resource} mutate={mutate} notify={notify} /></td><td>{profile ? <><strong>{profile.name}</strong><span className="muted block">{formatMoney(profile.dailyRate)} / {formatHours(profile.eqjtHours)}</span></> : <span className="op-cost-note">Coût inconnu</span>}</td><td>{formatHours(normalizeResource(resource).weeklyCapacityHours.reduce((sum, hours) => sum + hours, 0))}<span className="muted block">{resource.holidayCalendarId === 'fr' ? 'Calendrier férié FR' : 'Sans jours fériés'}</span></td><td><span className={`badge ${resource.active ? 'badge-success' : ''}`}>{resource.active ? 'Active' : 'Inactive'}</span></td><td><div className="op-table-actions"><button className="icon-button" aria-label={`Modifier ${resource.name}`} onClick={() => openResource?.(resource)}><Edit3 size={16} /></button><button className="icon-button" aria-label={`${resource.active ? 'Désactiver' : 'Réactiver'} ${resource.name}`} disabled={!isAdmin(data) || resource.id === 'resource-claire'} onClick={() => void toggleActive(resource)}>{resource.active ? <UserMinus size={16} /> : <UserCheck size={16} />}</button></div></td></tr>;
    })}</tbody></table>{!selected.length && <Empty title="Aucune ressource" detail="Ajustez les filtres ou ajoutez une ressource." />}</div>}
    {tab === 'capacity' && <><div className="card op-formula"><strong>Une seule capacité par ressource, tous projets confondus.</strong><p>Charge = allocation répartie sur les jours ouvrés de la tâche. Capacité = somme des heures configurées pour chaque jour, hors jours fériés et indisponibilités. Occupation = charge / capacité. La capacité actuelle s’applique au mois choisi ; une ressource inactive a une capacité nulle, même sur un mois passé. Le calendrier Férié FR comprend les jours fériés nationaux. Les journées d’indisponibilité retirent toute la capacité ; les plages partielles retirent leur durée, sans doubler les heures qui se chevauchent. La charge planifiée ne se déplace pas automatiquement.</p>{undated > 0 && <p className="op-cost-note">{undated} tâche{undated > 1 ? 's' : ''} non datée{undated > 1 ? 's' : ''} exclue{undated > 1 ? 's' : ''} de la répartition.</p>}</div><div className="card table-wrap"><table className="data-table"><thead><tr><th>Ressource</th><th>Charge prévue</th><th>Capacité</th><th>Taux d’occupation</th><th>Disponibilité prévue</th></tr></thead><tbody>{selected.map(resource => {
      const load = resourceLoad(resource, data.tasks, first, last);
      const capacity = resourceCapacity(resource, first, last, data.unavailabilities ?? []);
      const rate = capacity > 0 ? load / capacity * 100 : null;
      const background = rate === null ? '#f1f4f8' : rate > 120 ? '#fde5e8' : rate > 100 ? '#fff1d7' : '#e5f5ee';
      return <tr key={resource.id}><td><div className="resource-name"><Avatar resource={resource} /><button className="text-button" aria-label={`Ouvrir la fiche de ${resource.name}`} onClick={() => openResource?.(resource)}><strong>{resource.name}</strong></button></div></td><td>{formatHours(load)}</td><td>{formatHours(capacity)}</td><td><span className="op-heat-cell" style={{ background }}>{rate === null ? 'Capacité nulle' : `${Math.round(rate)} %`}</span></td><td className={load > capacity ? 'danger-text' : ''}>{formatHours(capacity - load)}</td></tr>;
    })}</tbody></table>{!selected.length && <Empty title="Aucune ressource à comparer" detail="Choisissez une autre nature ou affichez les ressources inactives." />}</div><p className="muted">Vert : ≤ 100 % · Orange : &gt; 100 % · Rouge : &gt; 120 %. Une disponibilité négative indique une surcharge. Si aucune journée disponible ne couvre la tâche, sa charge reste visible afin de signaler la surcharge.</p></>}
    {tab === 'profiles' && <><div className="card op-formula"><strong>Un tarif de référence, un historique conservé.</strong><p>Coût = heures × tarif / heures par Eqjt. Le planifié utilise le profil actuel ; chaque saisie de temps conserve le tarif au moment de sa création. Modifier un profil ne réécrit pas ces coûts passés.</p></div><div className="card table-wrap"><table className="data-table"><thead><tr><th>Profil</th><th>Tarif par Eqjt</th><th>Heures par Eqjt</th><th>Ressources accessibles associées</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{data.profiles.map(profile => <tr key={profile.id}><td><strong>{profile.name}</strong></td><td>{formatMoney(profile.dailyRate)}</td><td>{formatHours(profile.eqjtHours)}</td><td>{data.resources.filter(resource => resource.profileId === profile.id).length}</td><td><div className="op-table-actions"><button className="icon-button" aria-label={`Modifier le profil ${profile.name}`} disabled={!isAdmin(data)} onClick={() => setProfileEditor(profile)}><Edit3 size={16} /></button><button className="icon-button danger" aria-label={`Supprimer le profil ${profile.name}`} disabled={!isAdmin(data)} onClick={() => void remove('profiles', profile.id, profile.name)}><Trash2 size={16} /></button></div></td></tr>)}</tbody></table>{!data.profiles.length && <Empty title="Votre catalogue de tarifs est vide" detail="Créez un profil, puis associez-le à une ressource dans l’annuaire." />}</div></>}
    {profileEditor && <FormDialog title={editedProfile ? 'Modifier le profil de coût' : 'Nouveau profil de coût'} onClose={() => setProfileEditor(null)} onSubmit={async form => {
      await mutate('profiles', editedProfile ? 'PATCH' : 'POST', { name: value(form, 'name'), dailyRate: number(form, 'dailyRate'), eqjtHours: number(form, 'eqjtHours'), currency: 'EUR' }, editedProfile?.id);
      notify(editedProfile ? 'Profil mis à jour ; tarifs historiques conservés.' : 'Profil de coût créé.');
    }}><div className="form-grid"><label className="field full-width"><span>Nom du profil</span><input name="name" required maxLength={120} autoFocus defaultValue={editedProfile?.name ?? ''} placeholder="Ex. Consultant fonctionnel" /></label><label className="field"><span>Tarif par Eqjt (€)</span><input name="dailyRate" type="number" min="0" step="0.01" required defaultValue={editedProfile?.dailyRate ?? 500} /></label><label className="field"><span>Heures par Eqjt</span><input name="eqjtHours" type="number" min="0.25" max="24" step="0.25" required defaultValue={editedProfile?.eqjtHours ?? 8} /></label></div><p className="muted">Eqjt : équivalent d’une journée de travail utilisé pour valoriser les heures. Affectez ce profil depuis la fiche d’une ressource.</p></FormDialog>}
  </section>;
}

function saveCsv(filename: string, headers: string[], rows: (string | number | null)[][]) {
  const cell = (item: string | number | null) => {
    let text = String(item ?? '');
    if (typeof item !== 'number' && /^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const contents = '\uFEFF' + [headers, ...rows].map(row => row.map(cell).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ReportsView({ data, project, notify, createReport, openReport, saveReportDraft }: ViewProps) {
  const tasks = data.tasks.filter(task => task.projectId === project.id);
  const taskIds = new Set(tasks.map(task => task.id));
  const entries = data.timeEntries.filter(entry => taskIds.has(entry.taskId));
  const metrics = taskMetrics(tasks, entries, data.today);
  const writable = project.status !== 'paused' && project.status !== 'closed';
  const savedReports = (data.projectReports ?? []).filter(report => report.projectId === project.id).sort((a, b) => b.reportDate.localeCompare(a.reportDate) || b.createdAt.localeCompare(a.createdAt));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [printedDraft, setPrintedDraft] = useState<ReportDraft | null>(null);
  useEffect(() => {
    setPrintedDraft(null);
    function clearPrint() { if (document.body.dataset.pzPrint === 'report-draft') delete document.body.dataset.pzPrint; }
    clearPrint();
    window.addEventListener('afterprint', clearPrint);
    return () => { clearPrint(); window.removeEventListener('afterprint', clearPrint); };
  }, [project.id]);
  function printReport(draft: ReportDraft | null) {
    flushSync(() => setPrintedDraft(draft));
    if (draft) document.body.dataset.pzPrint = 'report-draft';
    else delete document.body.dataset.pzPrint;
    window.print();
  }
  const periodValid = !from || !to || from <= to;
  function exportTasks() {
    saveCsv('planzone8-taches.csv', ['ID', 'Projet', 'Tâche', 'Type', 'Statut', 'Ressource', 'Début', 'Fin', 'Alloué (heures)', 'Avancement (%)', 'Tags'], tasks.map(task => [task.id, project.name, task.title, task.kind === 'task' ? 'Tâche' : 'Jalon', STATUS_LABELS[task.status], data.resources.find(resource => resource.id === task.assigneeId)?.name ?? '', task.startDate, task.endDate, task.allocatedHours, task.progress, task.tags.join(', ')]));
    notify('Export des tâches téléchargé.');
  }
  function exportResources() {
    saveCsv('planzone8-ressources.csv', ['ID', 'Ressource', 'E-mail', 'Fonction', 'Rôle', 'Nature', 'Classification', 'Active', 'Lundi (h)', 'Mardi (h)', 'Mercredi (h)', 'Jeudi (h)', 'Vendredi (h)', 'Samedi (h)', 'Dimanche (h)', 'Calendrier férié', 'Tags', 'Projets', 'Valide les temps de', 'Profil', 'Tarif (EUR/Eqjt)', 'Eqjt (heures)'], data.resources.map(item => {
      const resource = normalizeResource(item);
      const profile = data.profiles.find(item => item.id === resource.profileId);
      return [resource.id, resource.name, resource.email, resource.jobTitle, RESOURCE_ROLE_LABELS[resource.role], RESOURCE_LABELS[resource.type], resource.classification === 'internal' ? 'Interne' : 'Externe', resource.active ? 'Oui' : 'Non', ...resource.weeklyCapacityHours, resource.holidayCalendarId === 'fr' ? 'Férié FR' : 'Aucun', resource.tags.map(tag => tag.label).join(', '), associatedResourceProjectIds(resource, data.tasks, data.projects).map(id => data.projects.find(project => project.id === id)?.name).filter(Boolean).join(', '), resource.validatesTimeForIds.map(id => data.resources.find(item => item.id === id)?.name).filter(Boolean).join(', '), profile?.name ?? 'Inconnu', profile?.dailyRate ?? null, profile?.eqjtHours ?? null];
    }));
    notify('Export de l’annuaire téléchargé.');
  }
  function exportTimes() {
    if (!periodValid) return;
    const selected = entries.filter(entry => (!from || entry.date >= from) && (!to || entry.date <= to));
    saveCsv('planzone8-temps.csv', ['ID', 'Projet', 'Tâche', 'Ressource', 'Date', 'Temps (heures)', 'Validation', 'Note', 'Tarif historique (EUR/Eqjt)', 'Eqjt historique (heures)', 'Coût (EUR)'], selected.map(entry => [entry.id, project.name, tasks.find(task => task.id === entry.taskId)?.title ?? '', data.resources.find(resource => resource.id === entry.resourceId)?.name ?? '', entry.date, entry.hours, entry.validated ? 'Validé' : 'À valider', entry.note, entry.rateSnapshot, entry.eqjtSnapshot, entry.rateSnapshot !== null && entry.eqjtSnapshot !== null ? entry.hours * entry.rateSnapshot / entry.eqjtSnapshot : null]));
    notify(`${selected.length} saisie${selected.length > 1 ? 's' : ''} exportée${selected.length > 1 ? 's' : ''}.`);
  }
  return <section className="operations-view reports-view">
    <div className="view-header"><div><span className="eyebrow">RAPPORTS & EXPORTS</span><h1>Partagez une vision claire</h1><p>Une synthèse prête à imprimer et des données à emporter.</p></div>{createReport && <button type="button" className="button fr-create-report-button" disabled={!writable} onClick={createReport}><Plus size={18} />Créer un compte rendu</button>}</div>
    <div className="card op-flash-card"><div><span className="eyebrow">FLASH REPORT</span><h2>{project.name}</h2><p>Avancement, jalons, travail et budget réunis dans un rapport de projet.</p><div className="op-project-meta"><span><strong>{Math.round(metrics.progress)} %</strong> d’avancement pondéré</span><span><strong>{metrics.completed}/{metrics.total}</strong> tâches terminées</span><span><strong>{metrics.overdue}</strong> en retard</span></div></div><button className="button button-primary" onClick={() => printReport(null)}><Printer size={18} />Imprimer / enregistrer en PDF</button></div>
    {openReport && <section className="card fr-saved-report-list" aria-label="Comptes rendus enregistrés"><h2>Comptes rendus enregistrés</h2>{savedReports.length ? savedReports.map(report => <div className="fr-saved-report-item" key={report.id}><div><strong>{report.title}</strong><p>{calendarDate(report.reportDate)} · {report.authorName} · {report.templateName}</p></div><button type="button" className="button button-secondary" onClick={() => openReport(report)} aria-label={`Ouvrir le compte rendu ${report.title}`}>Ouvrir</button></div>) : <p className="muted">Aucun compte rendu enregistré pour ce projet.</p>}</section>}
    <ReportTemplateComposer key={project.id} data={data} projectName={project.name} onPrint={printReport} onSave={saveReportDraft} canSave={writable} />
    <div className="op-report-grid"><article className="card op-report-option"><span className="report-option-icon"><FolderKanban size={24} /></span><h2>Tâches du projet</h2><p>Les éléments de <strong>{project.name}</strong>, avec leurs statuts, dates, ressources et allocations.</p><span className="muted">{tasks.length} éléments · CSV UTF-8</span><button className="button button-secondary" onClick={exportTasks}><Download size={17} />Exporter les tâches</button></article><article className="card op-report-option"><span className="report-option-icon"><Users size={24} /></span><h2>Annuaire des ressources</h2><p>Toutes les ressources de l’espace, y compris les inactives, avec capacités et profils de coûts.</p><span className="muted">{data.resources.length} ressources · CSV UTF-8</span><button className="button button-secondary" onClick={exportResources}><Download size={17} />Exporter les ressources</button></article><article className="card op-report-option"><span className="report-option-icon"><FileText size={24} /></span><h2>Temps du projet</h2><p>Chaque saisie du projet, son état de validation et le tarif conservé à sa création.</p><div className="form-grid"><label className="field"><span>Du (facultatif)</span><input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label><label className="field"><span>Au (facultatif)</span><input type="date" value={to} onChange={event => setTo(event.target.value)} /></label></div>{!periodValid && <p className="form-error" role="alert">La date de fin doit suivre la date de début.</p>}<span className="muted">Bornes inclusives · Tous les états de validation</span><button className="button button-secondary" onClick={exportTimes} disabled={!periodValid}><Download size={17} />Exporter les temps</button></article></div>
    <p className="muted">Les montants manquants restent vides dans les exports. Le rapport PDF reprend le projet entier ; les dates ci-dessus filtrent uniquement l’export des temps.</p>
    {createPortal(<article className={`print-report op-print-report${printedDraft ? ' op-draft-print' : ''}`}>{printedDraft ? <div className="rt-print-content"><ReportDraftPreview draft={printedDraft} projectName={project.name} authorName={data.currentUser.name} /><footer>Compte rendu rédigé à partir du modèle « {printedDraft.template.name} ». Rédaction locale exportée pour conservation · Planzone 8.</footer></div> : <FlashReportContent data={data} project={project} />}</article>, document.body)}
  </section>;
}
