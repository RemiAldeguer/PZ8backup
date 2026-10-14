import { Coins, FileDown, Files, MessageSquare, Users } from 'lucide-react';
import { projectViewEnabled, type AppData, type Project } from '../shared/types';
import { canUseProjectView, projectMemberIds } from '../shared/permissions';
import './project-navigation.css';

export function ProjectNavigation({ data, project, active }: { data: AppData; project: Project; active: string }) {
  const items = [
    { id: 'team', label: 'Équipe', icon: Users }, { id: 'discussions', label: 'Discussions', icon: MessageSquare },
    { id: 'documents', label: 'Documents', icon: Files }, { id: 'budget', label: 'Budget', icon: Coins },
    { id: 'reports', label: 'Rapports', icon: FileDown },
  ];
  return <nav className="pzs-project-rail project-navigation" aria-label="Accès du projet">{items.filter(item => projectViewEnabled(project, item.id) && canUseProjectView(data, project, item.id)).map(item => <a key={item.id} aria-current={active === item.id ? 'page' : undefined} href={item.id === 'reports' ? `#reports/${encodeURIComponent(project.id)}` : `#project/${encodeURIComponent(project.id)}/${item.id}`}><item.icon size={23} /><span>{item.label}</span>{item.id === 'team' && <small>{projectMemberIds(data, project).size}</small>}</a>)}</nav>;
}
