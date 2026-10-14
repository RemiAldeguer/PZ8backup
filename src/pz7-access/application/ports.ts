import type {
  AccessInvitation,
  AccessResource,
  AccessSession,
  InvitationInput,
  InvitationPreview,
  PlanzoneAccess,
  ResourceCursor,
  ResourceFilters,
  ResourcePage,
} from "../domain/models";

export interface CreateResourceInput {
  operationId: string;
  type: "VIRTUAL" | "MATERIAL";
  name: string;
  description: string;
}
export interface ResourceAccessInput {
  roleId: string;
  nonEditableFields: string[];
}
export interface SessionGateway {
  current(signal?: AbortSignal): Promise<AccessSession>;
  logout(signal?: AbortSignal): Promise<void>;
  clear(): void;
}
export interface WorkspaceGateway {
  access(id: string, signal?: AbortSignal): Promise<PlanzoneAccess>;
}
export interface ResourcesGateway {
  list(
    id: string,
    filters: ResourceFilters,
    after: ResourceCursor | null,
    signal?: AbortSignal,
  ): Promise<ResourcePage>;
  get(
    id: string,
    resourceId: string,
    signal?: AbortSignal,
  ): Promise<AccessResource>;
  create(
    id: string,
    input: CreateResourceInput,
    signal?: AbortSignal,
  ): Promise<AccessResource>;
  rename(
    id: string,
    resource: AccessResource,
    name: string,
    signal?: AbortSignal,
  ): Promise<AccessResource>;
  updateAccess(
    id: string,
    resourceId: string,
    input: ResourceAccessInput,
    signal?: AbortSignal,
  ): Promise<void>;
}
export interface InvitationsGateway {
  list(
    id: string,
    signal?: AbortSignal,
  ): Promise<{ items: AccessInvitation[] }>;
  create(
    id: string,
    input: InvitationInput & { operationId: string },
    signal?: AbortSignal,
  ): Promise<AccessInvitation>;
  revoke(id: string, invitationId: string, signal?: AbortSignal): Promise<void>;
  preview(token: string, signal?: AbortSignal): Promise<InvitationPreview>;
  accept(
    token: string,
    signal?: AbortSignal,
  ): Promise<{ planzoneId: string; resourceId: string }>;
}
export interface AccessNavigation {
  loginUrl(): string;
  invitationToken(): string | null;
  leaveInvitation(): void;
  subscribe(changed: () => void): () => void;
}
export interface OperationIds {
  next(): string;
}
export interface AccessGateways {
  session: SessionGateway;
  workspace: WorkspaceGateway;
  resources: ResourcesGateway;
  invitations: InvitationsGateway;
}
