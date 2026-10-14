/** Port fourni par le client Java d’accès ; aucune implémentation HTTP ici. */
export type ResourceType = "HUMAN" | "VIRTUAL" | "MATERIAL";
export interface Cursor { name: string; id: string }
export interface ScopePage<T> { items: T[]; next: Cursor | null }
export interface ScopeQuery { namePrefix?: string; after?: Cursor; limit?: number }
export interface ZoneSummary {
  id: string;
  planzoneId: string;
  name: string;
  savingTemplates: boolean;
  version: number;
  permissions: string[];
}
export interface ProjectSummary {
  id: string;
  planzoneId: string;
  zoneId: string;
  name: string;
  template: boolean;
  version: number;
  permissions: string[];
  editableFields: string[];
}
export interface ZoneMember { resourceId: string; name: string; type: ResourceType }
export interface ProjectMember extends ZoneMember {
  roleId: string | null;
  deactivated: boolean;
  version: number;
  allowedRoleIds: string[];
}
export interface Candidate extends ZoneMember { allowedRoleIds: string[] }
export interface ProjectRole { id: string; name: string; label: string }
export interface ProjectMemberUpdate {
  roleId: string | null;
  deactivated: boolean;
  expectedVersion: number;
}
export interface ScopeApi {
  listZones(planzoneId: string, signal: AbortSignal, query?: ScopeQuery): Promise<ScopePage<ZoneSummary>>;
  listProjects(planzoneId: string, zoneId: string | null, signal: AbortSignal, query?: ScopeQuery): Promise<ScopePage<ProjectSummary>>;
  zoneMembers(planzoneId: string, zoneId: string, signal: AbortSignal, query?: ScopeQuery): Promise<ScopePage<ZoneMember>>;
  projectMembers(planzoneId: string, projectId: string, signal: AbortSignal, query?: ScopeQuery): Promise<ScopePage<ProjectMember>>;
  zoneCandidates(planzoneId: string, zoneId: string, signal: AbortSignal, query?: ScopeQuery): Promise<ScopePage<Candidate>>;
  projectCandidates(planzoneId: string, projectId: string, signal: AbortSignal, query?: ScopeQuery): Promise<ScopePage<Candidate>>;
  projectRoles(planzoneId: string, signal: AbortSignal): Promise<ProjectRole[]>;
  addZoneMember(planzoneId: string, zoneId: string, resourceId: string, signal: AbortSignal): Promise<ZoneMember>;
  removeZoneMember(planzoneId: string, zoneId: string, resourceId: string, signal: AbortSignal): Promise<void>;
  addProjectMember(planzoneId: string, projectId: string, body: { resourceId: string; roleId: string | null }, signal: AbortSignal): Promise<ProjectMember>;
  updateProjectMember(planzoneId: string, projectId: string, resourceId: string, body: ProjectMemberUpdate, signal: AbortSignal): Promise<ProjectMember>;
  removeProjectMember(planzoneId: string, projectId: string, resourceId: string, signal: AbortSignal): Promise<void>;
}
