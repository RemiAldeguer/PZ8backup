import type { PlanzoneAccess } from "../domain/models";
import type {
  AccessNavigation,
  OperationIds,
  SessionGateway,
  WorkspaceGateway,
} from "./ports";
import type { ResourceUseCases } from "./resource-use-cases";
import type {
  createInvitationAcceptance,
  InvitationManagement,
} from "./invitation-use-cases";

export interface PlanzoneWorkspace {
  readonly planzoneId: string;
  readonly access: PlanzoneAccess;
  resources: ResourceUseCases;
  invitations: InvitationManagement;
  operationIds: OperationIds;
}
export interface AccessApplication {
  session: SessionGateway;
  access: WorkspaceGateway["access"];
  invitations: ReturnType<typeof createInvitationAcceptance>;
  navigation: AccessNavigation;
  workspace(id: string, access: PlanzoneAccess): PlanzoneWorkspace;
}
