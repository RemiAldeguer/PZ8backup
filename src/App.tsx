import { ThemeControl } from './theme/ThemeControl';
import { PlanzoneSettingsView } from './PlanzoneSettingsView';
import { projectTimeEntries } from '../shared/planzone-preferences';
import { ProjectNavigation } from './ProjectNavigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine, ArrowRight, Bell, Building2, CalendarDays, Check, ChevronDown, ChevronRight,
  CircleHelp, Clock3, Coins, FileText, Folder, FolderKanban, LayoutDashboard,
  KeyRound, List, LogOut, Menu, MoreHorizontal, Plus, Search, Settings2, Sun, Users, X, MessageSquare, Files,
} from 'lucide-react';
import { projectViewEnabled, type AppData, type Entity, type Mutation, type Project, type Resource, type Task, type TaskCreationOptions, type ViewProps } from '../shared/types';
import { STATUS_LABELS } from '../shared/types';
import { formatDate, formatHours, isLate, taskMetrics } from '../shared/domain';
import { BoardView, CalendarView, GanttView, ListView, SummaryView, TeamView } from './ProjectViews';
import { OrganizationView } from './OrganizationView';
import { ReportsView, ResourcesView } from './OperationsViews';
import { BudgetView } from './BudgetView';
import { ProjectsView } from './ZoneProjectsView';
import { ZoneWorkspaceView, zoneViewHash, type ZoneView } from './ZoneWorkspaceView';
import { TimeView } from './TimeView';
import { Modal, ProjectDialog, TaskDialog } from './Dialogs';
import { ResourceDialog } from './ResourceDialog';
import { WorkspaceSidebar } from './WorkspaceSidebar';
import { ZoneDialog } from './ZoneDialog';
import { CUSTOMIZATION_PAGES, projectStatusLabel, type CustomizationPage, type ProjectTemplate } from '../shared/customization';
import { ProjectTemplatesView, CustomFieldsView } from './CustomizationCatalogViews';
import { ProjectStatusesView, StrategicAxesView } from './CustomizationGovernanceViews';
import { ReportTemplatesView } from './ReportTemplatesView';
import type { ReportDraft } from '../shared/customization';
import { ProjectReportDialog } from './ProjectReportDialog';
import { FlashReportDialog } from './FlashReportView';
import { DocumentsView, GlobalDocumentsView, DiscussionsView, PersonalDiscussionsView } from './ProjectCollaborationViews';
import { PersonalView } from './PersonalView';
import { PersonalNavigation } from './PersonalNavigation';
import { PermissionsView } from './PermissionsView';
import { canCreateProject, canCustomize, canProject, canSeeView, canUseProjectView, isAdmin } from '../shared/permissions';
import { routeView } from '../shared/view-access';
import { ResourcePlanningView } from './ResourcePlanningView';
import { CapacityPlanView } from './CapacityPlanView';
import { canReadCapacityPlan } from '../shared/capaplan';
import { AuthBoundary, PasswordDialog, type AuthControls, type AuthUser } from './components/Auth';

type Section = 'project' | 'projects' | 'resources' | 'time' | 'reports' | 'personal' | 'discussions' | 'documents' | 'calendar' | 'overview' | 'customization' | 'settings';
type Tab = 'summary' | 'list' | 'board' | 'gantt' | 'calendar' | 'team' | 'budget' | 'time' | 'documents' | 'discussions';
type Route = { section: Section; projectId: string; tab: Tab; timeProjectId?: string; zoneId?: string; zoneView?: ZoneView; customizationPage?: CustomizationPage; documentFolderId?: string };
const tabs: { id: Tab; label: string; icon: typeof List }[] = [
  { id: 'summary', label: 'Synthèse', icon: LayoutDashboard }, { id: 'list', label: 'Liste', icon: List },
  { id: 'board', label: 'Tableau', icon: FolderKanban }, { id: 'gantt', label: 'Gantt', icon: CalendarDays },
  { id: 'calendar', label: 'Calendrier', icon: CalendarDays }, { id: 'team', label: 'Équipe', icon: Users },
  { id: 'budget', label: 'Budget', icon: Coins }, { id: 'time', label: 'Suivi temporel', icon: Clock3 },
  { id: 'documents', label: 'Documents', icon: Files }, { id: 'discussions', label: 'Discussions', icon: MessageSquare },
];
const initialRoute: Route = { section: 'project', projectId: 'project-nova', tab: 'summary' };
function readRoute(): Route {
  const parts = window.location.hash.replace(/^#\/?/, '').split('/');
  if (parts[0] === 'customization') return { ...initialRoute, section: 'customization', customizationPage: CUSTOMIZATION_PAGES.find(page => page.id === parts[1])?.id ?? 'project-templates' };
  if (parts[0] === 'zones' && parts[1]) return { ...initialRoute, section: 'projects', zoneId: decodeURIComponent(parts[1]), zoneView: parts[2] === 'list' || parts[2] === 'gantt' ? parts[2] : 'projects' };
  if (parts[0] === 'projects') return { ...initialRoute, section: 'projects', zoneView: parts[1] === 'list' || parts[1] === 'gantt' ? parts[1] : 'projects' };
  if (parts[0] === 'project') return { section: 'project', projectId: decodeURIComponent(parts[1] || 'project-nova'), tab: tabs.some(t => t.id === parts[2]) ? parts[2] as Tab : 'summary', documentFolderId: parts[2] === 'documents' && parts[3] ? decodeURIComponent(parts[3]) : undefined };
  const section = parts[0] as Section;
  return ['projects', 'resources', 'time', 'reports', 'personal', 'discussions', 'documents', 'calendar', 'overview', 'settings'].includes(section) ? { ...initialRoute, section, projectId: parts[1] ? decodeURIComponent(parts[1]) : initialRoute.projectId, timeProjectId: section === 'time' && parts[1] ? decodeURIComponent(parts[1]) : undefined } : initialRoute;
}

function App() {
  return <AuthBoundary>{controls => <WorkspaceApp {...controls} />}</AuthBoundary>;
}

function WorkspaceApp({ user, onSessionExpired, signOut, onPasswordChanged }: AuthControls) {
  const [data, setData] = useState<AppData | null>(null);
  const [loadError, setLoadError] = useState(''); const [retry, setRetry] = useState(0);
  const [route, setRoute] = useState<Route>(readRoute);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => { try { return localStorage.getItem('planzone8-sidebar-collapsed') === 'true'; } catch { return false; } });
  const [search, setSearch] = useState(''); const [searchFocused, setSearchFocused] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [notifications, setNotifications] = useState(false);
  const [showWorkspace, setShowWorkspace] = useState(false); const [help, setHelp] = useState(false);
  const [accountMenu, setAccountMenu] = useState<'top' | 'sidebar' | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const topAccountRef = useRef<HTMLDivElement>(null); const sidebarAccountRef = useRef<HTMLDivElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [dialog, setDialog] = useState<{ type: 'task' | 'project' | 'resource' | 'zone' | 'report' | 'flash'; id: string | null; projectId?: string; zoneId?: string; templateId?: string; reportDraft?: ReportDraft; taskDefaults?: TaskCreationOptions } | null>(null);
  const [toast, setToast] = useState(''); const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stateSequence = useRef(0);
  const [saving, setSaving] = useState(0);
  const notify = useCallback((message: string) => { setToast(message); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 6000); }, []);
  const refresh = useCallback(async () => {
    const sequence = ++stateSequence.current;
    const response = await fetch('/api/state', { cache: 'no-store' });
    if (response.status === 401) { onSessionExpired(); throw new Error('Votre session a expiré.'); }
    if (!response.ok) throw new Error('Impossible de charger votre espace. Réessayez dans un instant.');
    const next = await response.json() as AppData;
    if (sequence === stateSequence.current) setData(next);
  }, [onSessionExpired]);
  useEffect(() => { let active = true; setLoadError(''); refresh().catch(error => { if (active) setLoadError(error.message); }); return () => { active = false; }; }, [refresh, retry]);
  useEffect(() => { const changed = () => { setRoute(readRoute()); setMenuOpen(false); setNotifications(false); setAccountMenu(null); setSearch(''); }; window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed); }, []);
  useEffect(() => { const keydown = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchRef.current?.focus(); } if (event.key === 'Escape') { setSearch(''); setSearchFocused(false); setNotifications(false); setMenuOpen(false); setAccountMenu(null); } }; document.addEventListener('keydown', keydown); return () => document.removeEventListener('keydown', keydown); }, []);
  useEffect(() => () => { clearTimeout(toastTimer.current); stateSequence.current += 1; }, []);
  useEffect(() => {
    if (!accountMenu) return;
    const container = accountMenu === 'top' ? topAccountRef.current : sidebarAccountRef.current;
    container?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !topAccountRef.current?.contains(event.target) && !sidebarAccountRef.current?.contains(event.target)) setAccountMenu(null);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [accountMenu]);
  const navigate = useCallback((section: Section, projectId?: string, tab: Tab = 'summary') => { const targetProjectId = projectId ?? 'project-nova'; window.location.hash = section === 'project' ? `project/${encodeURIComponent(targetProjectId)}/${tab}` : section === 'documents' ? 'documents' : section === 'time' && !projectId ? 'time' : `${section}/${encodeURIComponent(targetProjectId)}`; setMenuOpen(false); }, []);
  const navigateZone = useCallback((id: string | null) => { window.location.hash = id ? `zones/${encodeURIComponent(id)}/projects` : 'projects'; setMenuOpen(false); }, []);
  const openProject = useCallback((project: Project) => { navigate('project', project.id, projectViewEnabled(project, 'summary') ? 'summary' : (project.enabledViews?.find(view => view !== 'reports') ?? 'team') as Tab); }, [navigate]);
  const openTask = useCallback((task: Task) => { setDialog({ type: 'task', id: task.id, projectId: task.projectId }); setSearch(''); setSearchFocused(false); setNotifications(false); }, []);
  const openResource = useCallback((resource: Resource | null) => { setDialog({ type: 'resource', id: resource?.id ?? null, projectId: !resource && route.section === 'project' ? route.projectId : undefined }); }, [route.section, route.projectId]);
  const closeDialog = useCallback(() => setDialog(null), []);
  const closeHelp = useCallback(() => setHelp(false), []);
  const closeWorkspace = useCallback(() => setShowWorkspace(false), []);
  const closePassword = useCallback(() => { setChangingPassword(false); window.setTimeout(() => accountTriggerRef.current?.focus(), 0); }, []);
  const toggleAccount = (position: 'top' | 'sidebar', button: HTMLButtonElement) => { accountTriggerRef.current = button; setAccountMenu(current => current === position ? null : position); setNotifications(false); };
  const logout = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try { await signOut(); }
    catch (error) { notify(error instanceof Error ? error.message : 'La déconnexion n’a pas pu être terminée. Réessayez.'); }
    finally { setSigningOut(false); }
  };
  const createProjectInZone = (id?: string) => setDialog({ type: 'project', id: null, zoneId: id ?? (route.section === 'projects' ? route.zoneId : undefined) });
  const createProject = () => createProjectInZone();
  const toggleSidebar = () => setSidebarCollapsed(previous => { const next = !previous; try { localStorage.setItem('planzone8-sidebar-collapsed', String(next)); } catch { /* Navigation works without local storage. */ } return next; });
  const mutate: Mutation = useCallback(async (entity: Entity, method, payload, id) => {
    setSaving(count => count + 1);
    try {
      const response = await fetch(`/api/${entity}${id ? `/${encodeURIComponent(id)}` : ''}`, { method, headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
      if (response.status === 401) { onSessionExpired(); throw new Error('Votre session a expiré. Connectez-vous à nouveau.'); }
      if (!response.ok) { const body: unknown = await response.json().catch(() => null); throw new Error(body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : 'L’action n’a pas pu être enregistrée.'); }
      await refresh();
    } finally { setSaving(count => count - 1); }
  }, [refresh, onSessionExpired]);

  if (!data) return <main className="loading-screen"><img className="loading-brand-logo" src="/planzone-logo.png" alt="" width={53} height={53} /><h1>Planzone <span>8</span></h1>{loadError ? <><p role="alert">{loadError}</p><button className="button button-primary" onClick={() => setRetry(r => r + 1)}>Réessayer</button></> : <><div className="loading-spinner" /><p>Votre espace prend forme…</p></>}</main>;

  const requestedProject = data.projects.find(p => p.id === route.projectId);
  const project: Project = requestedProject ?? data.projects[0] ?? { id: '', name: 'Aucun projet', description: '', zoneId: data.zones[0]?.id ?? '', startDate: data.today, endDate: data.today, status: 'open', weather: 0, budget: 0, color: '#ff6b24' };
  const zone = data.zones.find(z => z.id === project.zoneId);
  const zoneId = data.zones.some(z => z.id === route.zoneId) ? route.zoneId! : null;
  const locked = project.status === 'paused' || project.status === 'closed';
  const viewProps: ViewProps = { data, project, mutate, openTask, openProject, openResource, notify,
    editProject: canProject(data, project.id, 'details') ? item => setDialog({ type: 'project', id: item.id }) : undefined,
    createTask: (taskDefaults, targetProjectId) => setDialog({ type: 'task', id: null, projectId: targetProjectId ?? project.id, taskDefaults }),
    createReport: canProject(data, project.id, 'report') ? () => setDialog({ type: 'report', id: null, projectId: project.id }) : undefined,
    openReport: report => setDialog({ type: 'report', id: report.id, projectId: report.projectId }),
    openFlashReport: canProject(data, project.id, 'report') ? () => setDialog({ type: 'flash', id: null, projectId: project.id }) : undefined,
    saveReportDraft: reportDraft => setDialog({ type: 'report', id: null, projectId: project.id, reportDraft }),
  };
  const projectTasks = data.tasks.filter(t => t.projectId === project.id);
  const attention = data.tasks.filter(t => isLate(t, data.today) || t.status === 'validation');
  const searchTerms = search.trim().toLocaleLowerCase('fr');
  const projectResults = searchTerms ? data.projects.filter(p => p.name.toLocaleLowerCase('fr').includes(searchTerms)).slice(0, 4) : [];
  const taskResults = searchTerms ? data.tasks.filter(t => `${t.title} ${t.tags.join(' ')}`.toLocaleLowerCase('fr').includes(searchTerms)).slice(0, 6) : [];
  const isProject = route.section === 'project' && !!requestedProject;
  const projectContext = isProject || route.section === 'reports' && !!requestedProject;
  const heading = { projects: 'Mes projets', resources: 'Ressources', time: 'Suivi temporel', reports: 'Rapports & exports', personal: 'Mon espace', discussions: 'Mes discussions', documents: 'Documents', calendar: 'Calendrier global', overview: 'Pilotage', settings: 'Paramètres de la Planzone', customization: CUSTOMIZATION_PAGES.find(page => page.id === route.customizationPage)?.label ?? 'Personnalisation' };
  const allMetrics = taskMetrics(data.tasks, projectTimeEntries(data), data.today);
  const dialogProject = data.projects.find(p => p.id === dialog?.projectId) ?? project;
  const currentResource = data.resources.find(r => r.id === data.currentUser.id);
  const accountInitials = user.name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toLocaleUpperCase('fr') || 'A';
  const accountOptions = {
    user, signingOut,
    onSettings: isAdmin(data) ? () => { setAccountMenu(null); navigate('settings'); } : undefined,
    onWorkspace: () => { setAccountMenu(null); setShowWorkspace(true); },
    onPassword: () => { setAccountMenu(null); setChangingPassword(true); },
    onLogout: () => { void logout(); },
    onClose: () => { setAccountMenu(null); accountTriggerRef.current?.focus(); },
  };
  const dateLabel = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' }).format(new Date(`${data.today}T12:00:00Z`));

  let view;
  const requiredView = routeView(route);
  if (requiredView && !canSeeView(data, requiredView) || route.section === 'project' && !requestedProject || route.section === 'resources' && (route.projectId === 'permissions' && !isAdmin(data) || route.projectId === 'capaplan' && !canReadCapacityPlan(data)) || route.section === 'reports' && !canProject(data, project.id, 'report') || isProject && !canUseProjectView(data, project, route.tab)) view = <div className="card empty-state" role="region" aria-label="Accès réservé"><h2>Accès réservé</h2><p>Votre rôle ne donne pas accès à cette vue ou à ce projet.</p>{canSeeView(data, 'projects') && <button className="button button-secondary" onClick={() => navigateZone(null)}>Voir mes projets accessibles</button>}</div>;
  else if (isProject) {
    if (!projectViewEnabled(project, route.tab)) view = <div className="card empty-state"><h2>Cette vue est désactivée pour ce projet.</h2><button className="button button-secondary" onClick={() => setDialog({ type: 'project', id: project.id })}>Configurer les vues du projet</button><button className="button button-primary" onClick={() => navigate('project', project.id, (project.enabledViews?.find(id => id !== 'reports') ?? 'team') as Tab)}>Ouvrir une vue active</button></div>;
    else if (route.tab === 'time') view = <TimeView key={`project-time-${project.id}`} {...viewProps} scopeProjectId={project.id} projectContext />;
    else if (route.tab === 'documents') view = <DocumentsView key={`project-documents-${project.id}`} {...viewProps} initialFolderId={route.documentFolderId} />;
    else {
      const Component = { summary: SummaryView, list: ListView, board: BoardView, gantt: GanttView, calendar: CalendarView, team: TeamView, budget: BudgetView, discussions: DiscussionsView }[route.tab];
      view = <Component key={`${project.id}-${route.tab}`} {...viewProps} />;
    }
  } else if (route.section === 'projects') view = <ZoneWorkspaceView key={`${zoneId ?? 'all-zones'}-${route.zoneView ?? 'projects'}`} {...viewProps} view={route.zoneView ?? 'projects'} createProject={() => { if (canCreateProject(data)) createProject(); else notify('Votre rôle ne permet pas de créer un projet.'); }} zoneId={zoneId} onZoneChange={id => { window.location.hash = zoneViewHash(id, route.zoneView ?? 'projects'); setMenuOpen(false); }} editProject={item => setDialog({ type: 'project', id: item.id })} />;
  else if (route.section === 'resources') {
    const mode = route.projectId === 'capacity' || route.projectId === 'load' || route.projectId === 'occupancy' ? route.projectId : undefined;
    view = route.projectId === 'capaplan' ? <CapacityPlanView {...viewProps} /> : route.projectId === 'organization' ? <OrganizationView {...viewProps} /> : route.projectId === 'permissions' ? <PermissionsView data={data} mutate={mutate} notify={notify} /> : mode ? <ResourcePlanningView key={mode} {...viewProps} mode={mode} />
      : <ResourcesView key={route.projectId} {...viewProps} initialTab={route.projectId === 'profiles' ? 'profiles' : 'directory'} onTabChange={tab => navigate('resources', tab)} />;
  }
  else if (route.section === 'time') view = <TimeView {...viewProps} scopeProjectId={route.timeProjectId} />;
  else if (route.section === 'reports') view = <ReportsView {...viewProps} />;
  else if (route.section === 'documents') view = <GlobalDocumentsView {...viewProps} />;
  else if (route.section === 'calendar') view = <CalendarView {...viewProps} data={{ ...data, tasks: data.tasks }} global />;
  else if (route.section === 'personal') view = <PersonalView {...viewProps} />;
  else if (route.section === 'settings') view = <PlanzoneSettingsView data={data} mutate={mutate} notify={notify} reload={refresh} />;
  else if (route.section === 'discussions') view = <><PersonalNavigation active="discussions" data={data} /><PersonalDiscussionsView {...viewProps} /></>;
  else if (route.section === 'customization') {
    const page = route.customizationPage ?? 'project-templates';
    const settingsProps = { data, mutate, notify, readOnly: !canCustomize(data) };
    const createFromTemplate = (template: ProjectTemplate) => setDialog({ type: 'project', id: null, templateId: template.id });
    view = page === 'project-templates' ? <ProjectTemplatesView {...settingsProps} onCreateProject={createFromTemplate} />
      : page === 'custom-fields' ? <CustomFieldsView {...settingsProps} />
      : page === 'report-templates' ? <ReportTemplatesView {...settingsProps} />
      : page === 'project-statuses' ? <ProjectStatusesView {...settingsProps} />
      : <StrategicAxesView {...settingsProps} readOnly={!isAdmin(data)} />;
  }
  else view = <div className="workspace-overview"><div className="welcome-banner"><div><span className="eyebrow">VOTRE ESPACE DE PILOTAGE</span><h1>Bonjour {user.name.split(/\s+/)[0]}<span className="welcome-sun"><Sun size={28} /></span></h1><p>Vos projets avancent. Voici ce qui mérite votre attention aujourd’hui.</p></div><button className="button button-primary" onClick={createProject}><Plus size={17} /> Nouveau projet</button></div><div className="workspace-kpis"><OverviewMetric title="Projets ouverts" value={String(data.projects.filter(p => p.status === 'open').length)} subtitle={`${data.zones.length} zones de travail`} icon={<Folder size={20} />} /><OverviewMetric title="Tâches terminées" value={`${allMetrics.completed} / ${allMetrics.total}`} subtitle="Sur l’ensemble de vos projets" icon={<Check size={20} />} /><OverviewMetric title="Temps déclaré" value={formatHours(allMetrics.spentHours)} subtitle="Toutes les ressources" icon={<Clock3 size={20} />} /><OverviewMetric title="Échéances dépassées" value={String(allMetrics.overdue)} subtitle="Tâches à traiter en priorité" icon={<CalendarDays size={20} />} /></div><ProjectsView {...viewProps} createProject={createProject} zoneId={null} embedded /></div>;

  const projectContent = (<div className={`content-area ${route.section === 'time' || (isProject && route.tab === 'time') ? 'time-content-area' : route.section === 'projects' ? 'zone-content-area' : isProject && route.tab === 'summary' ? 'summary-content-area' : ''}`}>{route.section === 'reports' && <div className="context-toolbar"><label htmlFor="context-project">Projet</label><select id="context-project" className="form-input" value={project.id} onChange={e => navigate(route.section, e.target.value)}>{data.projects.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select><span className={`project-status project-status-${project.status}`}>{projectStatusLabel(project, data)}</span></div>}{view}</div>);

  return <div className={`app-shell pz-sidebar-shell ${isProject && route.tab === 'summary' ? 'pzs-shell' : ''} ${sidebarCollapsed ? 'pz-sidebar-collapsed' : ''} ${menuOpen ? 'menu-open' : ''}`}>
    {menuOpen && <button className="sidebar-scrim" aria-label="Fermer le menu" onClick={() => setMenuOpen(false)} />}
    <WorkspaceSidebar data={data} section={route.section} resourcesSubview={route.section === 'resources' ? ['profiles', 'organization', 'capacity', 'load', 'occupancy', 'permissions', 'capaplan'].includes(route.projectId) ? route.projectId : 'directory' : undefined} customizationPage={route.customizationPage} projectId={project.id} zoneId={zoneId} collapsed={sidebarCollapsed} onCollapse={toggleSidebar}
      onNavigate={(section, subview) => { if (section === 'customization') { window.location.hash = `customization/${subview ?? 'project-templates'}`; setMenuOpen(false); } else if (section === 'projects') navigateZone(null); else navigate(section, section === 'time' ? undefined : subview ?? project.id); }}
      onZone={navigateZone} onProject={openProject} onCreateProject={createProjectInZone} onCreateZone={() => setDialog({ type: 'zone', id: null })}
      onHelp={() => setHelp(true)}
      footer={<div className="auth-account-wrapper" ref={sidebarAccountRef}><button className="account" aria-label={`Ouvrir le menu du compte ${user.name}`} onClick={event => toggleAccount('sidebar', event.currentTarget)} aria-haspopup="menu" aria-expanded={accountMenu === 'sidebar'}><span className="avatar" style={{ backgroundColor: currentResource?.color }}>{accountInitials}</span><span><strong>{user.name}</strong><small>{data.currentUser.role}</small></span><MoreHorizontal size={18} /></button>{accountMenu === 'sidebar' && <AccountMenu {...accountOptions} sidebar />}</div>}
    />

    <main className="app-main">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Ouvrir le menu" onClick={() => setMenuOpen(!menuOpen)}><Menu size={20} /></button><span>Groupe Nova</span><ChevronRight size={14} /><strong>{isProject ? zone?.name : route.section === 'projects' && zoneId ? data.zones.find(z => z.id === zoneId)?.name : heading[route.section as keyof typeof heading]}</strong></div>
        <div className="global-search"><Search size={16} /><input ref={searchRef} aria-label="Recherche globale" placeholder="Rechercher un projet, une tâche…" value={search} onFocus={() => setSearchFocused(true)} onBlur={() => setTimeout(() => setSearchFocused(false), 160)} onChange={e => setSearch(e.target.value)} /><kbd>⌘ K</kbd>
          {searchFocused && searchTerms && <div className="search-results" role="region" aria-label="Résultats de recherche">{projectResults.length > 0 && <span className="search-result-label">PROJETS</span>}{projectResults.map(p => <button key={p.id} onClick={() => { openProject(p); setSearch(''); }}><Folder size={16} /><span>{p.name}</span><ChevronRight size={15} /></button>)}{taskResults.length > 0 && <span className="search-result-label">TÂCHES</span>}{taskResults.map(t => <button key={t.id} onClick={() => openTask(t)}><Check size={16} /><span>{t.title}<small>{data.projects.find(p => p.id === t.projectId)?.name}</small></span></button>)}{!projectResults.length && !taskResults.length && <p>Aucun résultat pour « {search} ».</p>}</div>}
        </div>
        <div className="topbar-actions"><ThemeControl /><span className="topbar-date">{dateLabel}</span><div className="notification-wrapper"><button className={`icon-button ${notifications ? 'active' : ''}`} aria-label="Voir les points d’attention" aria-expanded={notifications} onClick={() => setNotifications(!notifications)}><Bell size={19} />{attention.length > 0 && <span className="notification-dot" />}</button>{notifications && <div className="notification-panel"><div><strong>Points d’attention</strong><span>{attention.length}</span></div>{attention.slice(0, 6).map(t => <button key={t.id} onClick={() => openTask(t)}><span className={`status-dot status-${t.status}`} /><span>{t.title}<small>{isLate(t, data.today) ? `Échéance dépassée · ${formatDate(t.endDate)}` : 'En attente de validation'}</small></span></button>)}{!attention.length && <p>Toutes vos échéances sont à jour.</p>}</div>}</div><div className="auth-account-wrapper" ref={topAccountRef}><button className="avatar avatar-button" onClick={event => toggleAccount('top', event.currentTarget)} aria-label="Votre espace et votre profil" aria-haspopup="menu" aria-expanded={accountMenu === 'top'} style={{ backgroundColor: currentResource?.color }}>{accountInitials}</button>{accountMenu === 'top' && <AccountMenu {...accountOptions} />}</div></div>
      </header>
      {saving > 0 && <div className="saving-indicator" aria-label="Enregistrement en cours" />}
      {projectContext && <div className="project-header"><div className="project-heading"><span className="project-icon" style={{ backgroundColor: `${project.color}14`, color: project.color }}><Folder size={24} /></span><div className="project-name"><div className="project-title-meta"><span>PROJET</span><span>•</span><span>{formatDate(project.startDate)} — {formatDate(project.endDate)}</span></div><h2>{project.name}</h2></div></div><div className="header-actions"><span className={`project-status project-status-${project.status}`}><span className="status-dot" />{projectStatusLabel(project, data)}</span><span className="weather-pill" title="Météo déclarée du projet"><Sun size={18} />{project.weather}/5</span><button className="icon-button" title="Paramètres du projet" aria-label="Paramètres du projet" disabled={!canProject(data, project.id, 'details')} onClick={() => setDialog({ type: 'project', id: project.id })}><Settings2 size={19} /></button></div></div>}
      {projectContext && <nav className="project-tabs" aria-label="Vues du projet">{tabs.filter(tab => !['team', 'documents', 'discussions', 'budget'].includes(tab.id) && projectViewEnabled(project, tab.id) && canUseProjectView(data, project, tab.id)).map(tab => <button key={tab.id} className={`tab ${route.tab === tab.id ? 'active' : ''}`} onClick={() => navigate('project', project.id, tab.id)}><tab.icon size={16} />{tab.label}{tab.id === 'list' && <span>{projectTasks.filter(t => t.kind === 'task').length}</span>}</button>)}</nav>}
      {projectContext ? <div className="project-workspace"><ProjectNavigation data={data} project={project} active={route.section === 'reports' ? 'reports' : route.tab} />{projectContent}</div> : projectContent}
      <footer className="app-footer"><span>Planzone 8</span><span>Données de démonstration · Groupe Nova</span></footer>
    </main>
    {toast && <div className="toast" role="status"><CircleHelp size={18} style={{ color: '#d4e3e8' }} /><span>{toast}</span><button className="icon-button" aria-label="Fermer la notification" onClick={() => setToast('')}><X size={15} /></button></div>}
    {dialog?.type === 'task' && <TaskDialog key={dialog.id ?? 'new-task'} task={data.tasks.find(t => t.id === dialog.id) ?? null} initial={dialog.taskDefaults} project={dialogProject} data={data} mutate={mutate} onClose={closeDialog} notify={notify} />}
    {dialog?.type === 'zone' && <ZoneDialog mutate={mutate} onClose={closeDialog} notify={notify} />}
    {dialog?.type === 'project' && <ProjectDialog key={dialog.id ?? `new-project-${dialog.templateId ?? ''}`} project={data.projects.find(p => p.id === dialog.id) ?? null} data={data} initialZoneId={dialog.zoneId} initialTemplateId={dialog.templateId} mutate={mutate} onClose={closeDialog} notify={notify} />}
    {dialog?.type === 'resource' && <ResourceDialog key={dialog.id ?? 'new-resource'} resource={data.resources.find(r => r.id === dialog.id) ?? null} data={data} initialProjectId={dialog.projectId} mutate={mutate} onClose={closeDialog} notify={notify} openProject={openProject} onAccountCreated={refresh} />}
    {dialog?.type === 'report' && <ProjectReportDialog key={dialog.id ?? `new-report-${dialogProject.id}`} data={data} project={dialogProject} report={data.projectReports?.find(report => report.id === dialog.id) ?? null} initialDraft={dialog.reportDraft} mutate={mutate} notify={notify} onClose={closeDialog} />}
    {dialog?.type === 'flash' && <FlashReportDialog key={dialogProject.id} data={data} project={dialogProject} onClose={closeDialog} />}
    {help && <Modal title="Bienvenue dans Planzone 8" onClose={closeHelp}><div className="modal-body help-content"><p>Un espace commun pour planifier, collaborer et garder le cap.</p><ol><li><strong>Organisez vos projets.</strong> Créez un projet dans une zone, puis ajoutez vos tâches et jalons.</li><li><strong>Choisissez votre vue.</strong> Liste pour le détail, Tableau pour l’avancement, Gantt et Calendrier pour les dates.</li><li><strong>Mobilisez votre équipe.</strong> Définissez les capacités en heures, affectez le travail et consultez la charge.</li><li><strong>Suivez le réalisé.</strong> Saisissez vos temps, vérifiez le budget et partagez un rapport.</li></ol><p className="muted">Cet espace utilise des données fictives. Vos modifications sont conservées pour votre prochaine visite.</p></div><div className="modal-footer"><button className="button button-primary" onClick={closeHelp}>C’est parti</button></div></Modal>}
    {changingPassword && <PasswordDialog onClose={closePassword} onSessionExpired={onSessionExpired} onSuccess={nextUser => { onPasswordChanged(nextUser); closePassword(); notify('Votre mot de passe a été modifié.'); }} />}
    {showWorkspace && <Modal title="Votre espace de travail" onClose={closeWorkspace}><div className="modal-body workspace-info"><img className="workspace-info-logo" src="/planzone-logo.png" alt="Planzone 8" width={53} height={53} /><h3>Groupe Nova</h3><p>Espace de démonstration de Planzone 8</p><div className="workspace-info-profile"><span className="avatar" style={{ backgroundColor: currentResource?.color }}>{accountInitials}</span><div><strong>{user.name}</strong><span>{data.currentUser.role} · {user.username}</span></div><Check size={19} /></div><p className="muted">Cet espace contient des exemples pour découvrir Planzone 8. Créez vos projets et personnalisez votre équipe.</p><p className="auth-workspace-note">Votre compte retrouve le même espace sur vos appareils. Vos modifications sont conservées pour votre prochaine visite.</p></div><div className="modal-footer"><button className="button button-primary" onClick={closeWorkspace}>Retour à mon espace</button></div></Modal>}
  </div>;
}

function OverviewMetric({ title, value, subtitle, icon }: { title: string; value: string; subtitle: string; icon: React.ReactNode }) {
  return <div className="card overview-metric"><span className="overview-metric-icon">{icon}</span><span className="muted">{title}</span><strong>{value}</strong><small>{subtitle}</small></div>;
}

function AccountMenu({ user, signingOut, onWorkspace, onSettings, onPassword, onLogout, onClose, sidebar = false }: {
  user: AuthUser; signingOut: boolean; onWorkspace: () => void; onSettings?: () => void; onPassword: () => void; onLogout: () => void; onClose: () => void; sidebar?: boolean;
}) {
  const keydown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };
  return <div className={`auth-account-menu ${sidebar ? 'auth-account-menu-sidebar' : ''}`} role="menu" aria-label="Mon compte" onKeyDown={keydown}>
    <div className="auth-account-menu-heading"><strong>{user.name}</strong><small>Administrateur · {user.username}</small></div>
    <button role="menuitem" onClick={onWorkspace}><Building2 size={16} /> Mon espace de travail</button>
    {onSettings && <button role="menuitem" onClick={onSettings}><Settings2 size={16} /> Paramètres de la Planzone</button>}
    <button role="menuitem" onClick={onPassword} disabled={signingOut}><KeyRound size={16} /> Changer le mot de passe</button>
    <button role="menuitem" className="auth-signout" onClick={onLogout} disabled={signingOut}><LogOut size={16} />{signingOut ? 'Déconnexion…' : 'Se déconnecter'}</button>
  </div>;
}

export default App;
