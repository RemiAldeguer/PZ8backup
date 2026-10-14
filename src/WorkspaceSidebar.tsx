import { useEffect, useState, type ReactNode } from 'react';
import {
  CalendarDays, ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, CircleHelp,
  CircleUserRound, Coins, FileText, Files, Folder, FolderClock, FolderPlus,
  Gauge, Network, Orbit, Plus, Users, Wrench, Target, ListPlus, PanelsTopLeft, UserRoundCheck,
} from 'lucide-react';
import type { AppData, Project } from '../shared/types';
import { CUSTOMIZATION_PAGES, type CustomizationPage } from '../shared/customization';
import './workspace-sidebar.css';
import { canCreateProject, canCustomize, canProject, canReadResources, isAdmin } from '../shared/permissions';

type SidebarSection = 'overview' | 'personal' | 'discussions' | 'documents' | 'projects' | 'calendar' | 'resources' | 'time' | 'reports' | 'customization';
export interface WorkspaceSidebarProps {
  data: AppData;
  section: string;
  resourcesSubview?: string;
  customizationPage?: CustomizationPage;
  projectId: string;
  zoneId: string | null;
  collapsed: boolean;
  onCollapse: () => void;
  onNavigate: (section: SidebarSection, subview?: string) => void;
  onZone: (id: string | null) => void;
  onProject: (project: Project) => void;
  onCreateProject: (zoneId?: string) => void;
  onCreateZone: () => void;
  onHelp: () => void;
  footer: ReactNode;
}

const RECENTS_KEY = 'planzone8:recent-projects';
function loadRecents(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]');
    return Array.isArray(saved) ? [...new Set(saved.filter((id): id is string => typeof id === 'string'))].slice(0, 6) : [];
  } catch { return []; }
}
function markerText(color: string): string {
  const match = /^#([a-f\d]{6})$/i.exec(color);
  if (!match) return '#fff';
  const [r, g, b] = [0, 2, 4].map(offset => parseInt(match[1].slice(offset, offset + 2), 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  const luminance = r * .2126 + g * .7152 + b * .0722;
  return luminance > .179 ? '#111' : '#fff';
}

export function WorkspaceSidebar({
  data, section, resourcesSubview, customizationPage, projectId, zoneId, collapsed, onCollapse, onNavigate, onZone,
  onProject, onCreateProject, onCreateZone, onHelp, footer,
}: WorkspaceSidebarProps) {
  const currentProject = section === 'project' ? data.projects.find(project => project.id === projectId) : undefined;
  const [recentIds, setRecentIds] = useState(loadRecents);
  const [managementOpen, setManagementOpen] = useState(section === 'resources');
  const [customizationOpen, setCustomizationOpen] = useState(section === 'customization');
  const [expandedZones, setExpandedZones] = useState(() => new Set([zoneId ?? currentProject?.zoneId ?? data.zones[0]?.id].filter((id): id is string => !!id)));
  const activeZone = section === 'projects' ? zoneId : currentProject?.zoneId;

  useEffect(() => {
    if (!currentProject) return;
    setRecentIds(previous => {
      if (previous[0] === currentProject.id) return previous;
      const next = [currentProject.id, ...previous.filter(id => id !== currentProject.id)].slice(0, 6);
      try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* Navigation remains available when storage is disabled. */ }
      return next;
    });
  }, [currentProject?.id]);
  useEffect(() => {
    if (!activeZone) return;
    setExpandedZones(previous => previous.has(activeZone) ? previous : new Set([...previous, activeZone]));
  }, [activeZone]);
  useEffect(() => {
    if (section === 'resources') setManagementOpen(true);
    if (section === 'customization') setCustomizationOpen(true);
  }, [section]);

  const recentProjects = recentIds.flatMap(id => {
    const project = data.projects.find(candidate => candidate.id === id);
    return project ? [project] : [];
  });
  const otherProjects = data.projects.filter(project => !recentIds.includes(project.id));
  const taskCounts = new Map<string, number>();
  for (const task of data.tasks) taskCounts.set(task.projectId, (taskCounts.get(task.projectId) ?? 0) + 1);
  const toggleZone = (id: string) => setExpandedZones(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return <aside className={`sidebar pz-sidebar${collapsed ? ' pz-sidebar-is-collapsed' : ''}`} aria-label="Navigation principale">
    <div className="pz-sidebar-heading">
      <button className="pz-sidebar-brand" onClick={() => onNavigate('overview')} aria-label="Planzone 8, accueil" title="Vue d’ensemble"><span className="pz-sidebar-label">Démonstration</span><span className="pz-sidebar-compact-brand" aria-hidden="true">P8</span></button>
      <button className="pz-sidebar-collapse" onClick={onCollapse} aria-label={collapsed ? 'Développer la barre latérale' : 'Réduire la barre latérale'} aria-expanded={!collapsed} title={collapsed ? 'Développer la barre latérale' : 'Réduire la barre latérale'}>{collapsed ? <ChevronsRight size={23} /> : <ChevronsLeft size={23} />}</button>
    </div>

    <div className="pz-sidebar-recents">
      <FolderClock size={21} aria-hidden="true" />
      <select aria-label="Projets récents" value="" onChange={event => {
        const project = data.projects.find(candidate => candidate.id === event.target.value);
        if (project) onProject(project);
      }}>
        <option value="" disabled>Projets récents</option>
        {recentProjects.length ? <optgroup label="Projets récemment ouverts">{recentProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</optgroup> : <option disabled>Aucun projet récent</option>}
        {otherProjects.length > 0 && <optgroup label={recentProjects.length ? 'Autres projets' : 'Tous les projets'}>{otherProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</optgroup>}
      </select>
      <ChevronDown size={14} aria-hidden="true" />
    </div>
    <button className="pz-sidebar-compact-recents" title="Tous les projets" aria-label="Projets récents et tous les projets" onClick={() => onZone(null)}><FolderClock size={22} /></button>

    <nav className="sidebar-nav pz-sidebar-nav" aria-label="Espace de travail">
      <button className={`pz-sidebar-nav-item${['personal', 'time', 'discussions'].includes(section) ? ' active' : ''}`} onClick={() => onNavigate('personal')} aria-label="Mon espace" title="Mon espace : synthèse, suivi temporel et discussions" aria-current={['personal', 'time', 'discussions'].includes(section) ? 'page' : undefined}><CircleUserRound size={21} /><span className="pz-sidebar-label">Mon espace</span></button>
      {(isAdmin(data) || canReadResources(data)) && <><button className={`pz-sidebar-nav-item${section === 'resources' ? ' pz-sidebar-group-active' : ''}`} onClick={() => { if (collapsed) { onCollapse(); setManagementOpen(true); } else setManagementOpen(open => !open); }} aria-expanded={managementOpen} aria-controls="pz-sidebar-management" title="Gestion"><Users size={21} /><span className="pz-sidebar-label">Gestion</span><ChevronDown className={`pz-sidebar-disclosure${managementOpen ? ' is-open' : ''}`} size={14} /></button>
      <div id="pz-sidebar-management" className="pz-sidebar-subnav" hidden={!managementOpen}>
        <button className={section === 'resources' && resourcesSubview === 'directory' ? 'active' : ''} onClick={() => onNavigate('resources', 'directory')}><Users size={16} /><span>Ressources</span></button>
        <button className={section === 'resources' && resourcesSubview === 'organization' ? 'org-sidebar-item active' : 'org-sidebar-item'} aria-current={section === 'resources' && resourcesSubview === 'organization' ? 'page' : undefined} aria-label="Ouvrir l’organigramme" onClick={() => onNavigate('resources', 'organization')}><Network size={16} /><span>Organigramme</span></button>
        {isAdmin(data) && <button className={section === 'resources' && resourcesSubview === 'profiles' ? 'active' : ''} aria-label="Ouvrir les profils de coûts" onClick={() => onNavigate('resources', 'profiles')}><Coins size={16} /><span>Profils de coûts</span></button>}
        <button className={section === 'resources' && resourcesSubview === 'capacity' ? 'active' : ''} aria-label="Ouvrir la capacité" onClick={() => onNavigate('resources', 'capacity')}><Users size={16} /><span>Capacité</span></button>
        <button className={section === 'resources' && resourcesSubview === 'load' ? 'active' : ''} aria-label="Ouvrir la charge prévisionnelle" onClick={() => onNavigate('resources', 'load')}><Gauge size={16} /><span>Charge prévisionnelle</span></button>
        <button className={section === 'resources' && resourcesSubview === 'occupancy' ? 'active' : ''} aria-label="Ouvrir le taux d’occupation" onClick={() => onNavigate('resources', 'occupancy')}><UserRoundCheck size={16} /><span>Taux d’occupation</span></button>
        {isAdmin(data) && <button className={section === 'resources' && resourcesSubview === 'permissions' ? 'active' : ''} onClick={() => onNavigate('resources', 'permissions')}><UserRoundCheck size={16} /><span>Droits et rôles</span></button>}
      </div></>}
      {canCustomize(data) && <><button className={`pz-sidebar-nav-item${section === 'customization' ? ' pz-sidebar-group-active' : ''}`} onClick={() => { if (collapsed) { onCollapse(); setCustomizationOpen(true); } else setCustomizationOpen(open => !open); }} aria-expanded={customizationOpen} aria-controls="pz-sidebar-customization" title="Personnalisation"><Wrench size={21} /><span className="pz-sidebar-label">Personnalisation</span><ChevronDown className={`pz-sidebar-disclosure${customizationOpen ? ' is-open' : ''}`} size={14} /></button>
      <div id="pz-sidebar-customization" className="pz-sidebar-subnav" hidden={!customizationOpen}>
        {CUSTOMIZATION_PAGES.map((page, index) => {
          const Icon = [PanelsTopLeft, ListPlus, FileText, Folder, Target][index];
          const active = section === 'customization' && customizationPage === page.id;
          return <button key={page.id} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={() => onNavigate('customization', page.id)}><Icon size={16} /><span>{page.label}</span></button>;
        })}
      </div></>}
      <button className={`pz-sidebar-nav-item${section === 'calendar' ? ' active' : ''}`} onClick={() => onNavigate('calendar')} title="Calendrier" aria-current={section === 'calendar' ? 'page' : undefined}><CalendarDays size={21} /><span className="pz-sidebar-label">Calendrier</span></button>
      <button className={`pz-sidebar-nav-item${section === 'documents' ? ' active' : ''}`} onClick={() => onNavigate('documents')} aria-label="Documents" title="Documents de tous les projets" aria-current={section === 'documents' ? 'page' : undefined}><Files size={21} /><span className="pz-sidebar-label">Documents</span></button>
      {(isAdmin(data) || data.projects.some(project => canProject(data, project.id, 'report'))) && <button className={`pz-sidebar-nav-item${section === 'reports' ? ' active' : ''}`} onClick={() => onNavigate('reports')} title="Rapports & exports" aria-current={section === 'reports' ? 'page' : undefined}><FileText size={21} /><span className="pz-sidebar-label">Rapports / Exports</span></button>}
    </nav>

    <div className="sidebar-zones pz-sidebar-zones">
      <button className="pz-sidebar-add-zone" disabled={!isAdmin(data)} onClick={onCreateZone} aria-label="Créer une zone" title="Créer une zone"><Plus size={14} /><span className="pz-sidebar-label">zone</span></button>
      <button className={`pz-sidebar-all${section === 'projects' && !zoneId ? ' active' : ''}`} onClick={() => onZone(null)} aria-label="Tous les projets, toutes les zones" title="Tous les projets, toutes les zones"><Orbit className="pz-sidebar-all-symbol" size={21} strokeWidth={1.4} aria-hidden="true" /><span className="pz-sidebar-label">Tout</span></button>
      {data.zones.map((zone, index) => {
        const projects = data.projects.filter(project => project.zoneId === zone.id);
        const expanded = expandedZones.has(zone.id);
        return <div className={`pz-sidebar-zone${activeZone === zone.id ? ' pz-sidebar-zone-active' : ''}`} key={zone.id} data-zone-id={zone.id}>
          <div className="pz-sidebar-zone-header">
            <button className="pz-sidebar-zone-link" onClick={() => onZone(zone.id)} title={zone.name} aria-current={section === 'projects' && zoneId === zone.id ? 'page' : undefined}><span className="pz-sidebar-zone-number" style={{ backgroundColor: zone.color, color: markerText(zone.color) }} aria-hidden="true">{index + 1}</span><span className="pz-sidebar-label pz-sidebar-zone-name">{index + 1}. {zone.name}</span><span className="pz-sidebar-zone-count" aria-label={`${projects.length} projets`}>{projects.length}</span></button>
            <button className="pz-sidebar-zone-toggle" onClick={() => toggleZone(zone.id)} aria-label={`${expanded ? 'Réduire' : 'Développer'} les projets de ${zone.name}`} aria-expanded={expanded} aria-controls={`pz-sidebar-projects-${zone.id}`} title={expanded ? 'Réduire les projets' : 'Développer les projets'}>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
            <button className="pz-sidebar-zone-add" aria-label={`Créer un projet dans ${zone.name}`} title={`Créer un projet dans ${zone.name}`} disabled={!canCreateProject(data)} onClick={() => onCreateProject(zone.id)}><FolderPlus size={20} /></button>
          </div>
          <div id={`pz-sidebar-projects-${zone.id}`} className="pz-sidebar-zone-projects" hidden={!expanded}>
            {projects.map(project => <button key={project.id} className={`sidebar-project-item${currentProject?.id === project.id ? ' active' : ''}`} aria-label={project.name} aria-current={currentProject?.id === project.id ? 'page' : undefined} title={project.name} onClick={() => onProject(project)}><Folder size={16} aria-hidden="true" /><span>{project.name}</span><small className="pz-sidebar-task-count" title={`${taskCounts.get(project.id) ?? 0} tâches et jalons`} aria-hidden="true">{taskCounts.get(project.id) ?? 0}</small></button>)}
            {!projects.length && <p className="pz-sidebar-empty">Aucun projet dans cette zone.</p>}
          </div>
        </div>;
      })}
    </div>

    <div className="sidebar-bottom pz-sidebar-bottom">
      <div className="pz-sidebar-help"><span className="pz-sidebar-label">Planzone 8</span><button onClick={onHelp} title="Centre d’aide"><CircleHelp size={15} /><span className="pz-sidebar-label">Centre d’aide</span></button></div>
      {footer}
    </div>
  </aside>;
}
