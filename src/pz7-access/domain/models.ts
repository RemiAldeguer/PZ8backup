export type ResourceType = "HUMAN" | "VIRTUAL" | "MATERIAL";
export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
export interface PlanzoneSummary {
  id: string;
  name: string;
  resourceId: string | null;
}
export interface AccessSession {
  identity: { id: string; displayName: string; email: string | null };
  planzones: PlanzoneSummary[];
}
export interface AccessRole {
  id: string;
  name: string;
  label: string;
}
export interface PlanzoneAccess {
  permissions: string[];
  editableResourceFields: string[];
  roles: AccessRole[];
  canManageRoles: boolean;
}
export interface AccessResource {
  id: string;
  planzoneId: string;
  name: string;
  description: string;
  type: ResourceType;
  identityId: string | null;
  deactivated: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  roleId: string | null;
  nonEditableFields: string[];
}
export interface ResourceCursor {
  name: string;
  id: string;
}
export interface ResourcePage {
  items: AccessResource[];
  next: ResourceCursor | null;
}
export interface ResourceFilters {
  namePrefix: string;
  type: ResourceType | "";
  deactivated: boolean;
}
export interface AccessInvitation {
  id: string;
  resourceId: string;
  email: string;
  firstName: string;
  lastName: string;
  roleId: string;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
}
export interface InvitationPreview {
  planzoneName: string;
  email: string;
  firstName: string;
  lastName: string;
  status: InvitationStatus;
  expiresAt: string;
}
export interface InvitationInput {
  email: string;
  firstName: string;
  lastName: string;
  roleId: string;
  message: string;
  language: "fr";
}
