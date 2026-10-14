import { GLOBAL_ROLES, type AppData, type ResourceRole } from './types';

export const WORKSPACE_VIEWS = [
  { id: 'personal-summary', label: 'Mon espace > Ma synthèse' },
  { id: 'personal-time', label: 'Mon espace > Suivi temporel' },
  { id: 'personal-discussions', label: 'Mon espace > Mes discussions' },
  { id: 'resources', label: 'Gestion > Ressources' },
  { id: 'organization', label: 'Gestion > Organigramme' },
  { id: 'profiles', label: 'Gestion > Profils de coûts' },
  { id: 'capacity', label: 'Gestion > Capacité' },
  { id: 'load', label: 'Gestion > Charge prévisionnelle' },
  { id: 'occupancy', label: 'Gestion > Taux d’occupation' },
  { id: 'capaplan', label: 'Gestion > CapaPlan' },
  { id: 'project-templates', label: 'Personnalisation > Modèles de projet' },
  { id: 'report-templates', label: 'Personnalisation > Modèles de compte rendu' },
  { id: 'project-statuses', label: 'Personnalisation > Statuts de projet' },
  { id: 'custom-fields', label: 'Personnalisation > Champs personnalisés' },
  { id: 'strategic-axes', label: 'Personnalisation > Axes stratégiques' },
  { id: 'projects', label: 'Zones > Projets, liste et Gantt' },
  { id: 'calendar', label: 'Calendrier' },
  { id: 'documents', label: 'Documents' },
  { id: 'reports', label: 'Rapports / exports' },
  { id: 'document-edit', label: 'Création / édition de document' },
] as const;
export type WorkspaceView = typeof WORKSPACE_VIEWS[number]['id'];
export type ViewRoleAssignments = Partial<Record<WorkspaceView, ResourceRole[]>>;
export const CUSTOMIZATION_VIEWS = ['project-templates', 'report-templates', 'project-statuses', 'custom-fields', 'strategic-axes'] as const;
export const MANAGEMENT_VIEWS = ['resources', 'organization', 'profiles', 'capacity', 'load', 'occupancy', 'capaplan'] as const;
/** Missing assignments preserve existing screen access; explicit [] hides a view. */
export function rolesForView(data: Pick<AppData, 'permissionPolicies' | 'planzonePreferences'>, view: WorkspaceView): readonly ResourceRole[] {
  const configured = data.planzonePreferences?.[0]?.viewRoles?.[view];
  if (configured !== undefined) return configured;
  const policy = data.permissionPolicies?.[0];
  if (['resources', 'organization', 'capacity', 'load', 'occupancy'].includes(view)) return ['administrator', ...policy?.resourcesRead ?? []];
  if (view === 'profiles') return ['administrator'];
  if ((CUSTOMIZATION_VIEWS as readonly string[]).includes(view)) return ['administrator', ...policy?.customizationManage ?? []];
  return GLOBAL_ROLES;
}
export function viewRoleAssignments(data: Pick<AppData, 'permissionPolicies' | 'planzonePreferences'>): Record<WorkspaceView, ResourceRole[]> {
  return Object.fromEntries(WORKSPACE_VIEWS.map(view => [view.id, [...new Set(rolesForView(data, view.id))]])) as Record<WorkspaceView, ResourceRole[]>;
}
export function routeView(route: { section: string; projectId: string; customizationPage?: string }): WorkspaceView | undefined {
  if (route.section === 'personal') return 'personal-summary';
  if (route.section === 'time') return 'personal-time';
  if (route.section === 'discussions') return 'personal-discussions';
  if (route.section === 'customization') return (CUSTOMIZATION_VIEWS as readonly string[]).includes(route.customizationPage ?? '') ? route.customizationPage as WorkspaceView : 'project-templates';
  if (route.section === 'resources') return (MANAGEMENT_VIEWS as readonly string[]).includes(route.projectId) ? route.projectId as WorkspaceView : route.projectId === 'permissions' ? undefined : 'resources';
  return ['projects', 'calendar', 'documents', 'reports'].includes(route.section) ? route.section as WorkspaceView : undefined;
}
