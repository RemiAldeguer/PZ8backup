import { useRef, useState } from 'react';
import { PROJECT_ROLE_LABELS, RESOURCE_ROLE_LABELS, type AppData, type Mutation, type Project, type ProjectRole, type Resource, type ResourceRole } from '../shared/types';
import { canProject, isAdmin } from '../shared/permissions';
import { normalizeResource } from '../shared/resources';
import './roles.css';

export const GLOBAL_ROLE_DESCRIPTIONS: Record<ResourceRole, string> = {
  administrator: 'Gère les paramètres globaux, les membres et tous les projets de la Planzone.',
  project_creator: 'Crée des projets dans ses zones accessibles. Consulte ses projets et ceux auxquels il est affecté.',
  user: 'Accède aux projets auxquels il est affecté. Ses actions dépendent de son rôle dans chaque projet.',
  visitor: 'Consulte les projets auxquels il est affecté en tant qu’observateur. Peut consulter les documents et participer aux discussions.',
};
export const PROJECT_ROLE_DESCRIPTIONS: Record<ProjectRole, string> = {
  manager: 'Planifie, gère l’équipe, alloue les ressources et édite les détails, le budget et les temps du projet.',
  collaborator: 'Accède aux vues du projet et réalise les tâches confiées. Ses droits de planification sont configurables.',
  observer: 'Consulte le projet, télécharge les documents et participe aux discussions. Ne modifie pas la planification.',
};
export function GlobalRoleControl({ data, resource, mutate, notify }: { data: AppData; resource: Resource; mutate: Mutation; notify: (message: string) => void }) {
  const [busy, setBusy] = useState(false); const pending = useRef(false); const role = normalizeResource(resource).role;
  if (resource.type !== 'human') return <span className="muted">—</span>;
  const primary = resource.id === 'resource-claire';
  return <div className="role-control"><select aria-label={`Rôle global de ${resource.name}`} value={primary ? 'administrator' : role} disabled={!isAdmin(data) || primary || busy} onChange={async event => {
    if (pending.current) return; pending.current = true; setBusy(true);
    try { await mutate('resources', 'PATCH', { role: event.target.value }, resource.id); notify('Le rôle global a été enregistré.'); }
    catch (error) { notify(error instanceof Error ? error.message : 'Le rôle n’a pas pu être enregistré.'); }
    finally { pending.current = false; setBusy(false); }
  }}>{Object.entries(RESOURCE_ROLE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select><small>{primary ? 'Compte administrateur principal' : GLOBAL_ROLE_DESCRIPTIONS[role]}</small></div>;
}
export function ProjectRoleControl({ data, project, resource, mutate, notify }: { data: AppData; project: Project; resource: Resource; mutate: Mutation; notify: (message: string) => void }) {
  const [busy, setBusy] = useState(false); const pending = useRef(false);
  const visitor = normalizeResource(resource).role === 'visitor'; const role: ProjectRole = visitor ? 'observer' : project.projectRoles?.[resource.id] ?? (project.createdByResourceId === resource.id ? 'manager' : 'collaborator');
  const allowed = canProject(data, project.id, 'team') && !['paused', 'closed'].includes(project.status);
  return <div className="role-control"><select aria-label={`Rôle projet de ${resource.name}`} value={role} disabled={!allowed || visitor || busy} onChange={async event => {
    if (pending.current) return; pending.current = true; setBusy(true);
    try { await mutate('projects', 'PATCH', { projectRoles: { ...project.projectRoles, [resource.id]: event.target.value } }, project.id); notify('Le rôle dans ce projet a été enregistré.'); }
    catch (error) { notify(error instanceof Error ? error.message : 'Le rôle n’a pas pu être enregistré.'); }
    finally { pending.current = false; setBusy(false); }
  }}>{Object.entries(PROJECT_ROLE_LABELS).filter(([id]) => !visitor || id === 'observer').map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select><small>{visitor ? 'Un visiteur est toujours observateur dans les projets.' : PROJECT_ROLE_DESCRIPTIONS[role]}</small></div>;
}
