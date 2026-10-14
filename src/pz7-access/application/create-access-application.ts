import type { AccessApplication } from "./contracts";
import type { AccessGateways, AccessNavigation, OperationIds } from "./ports";
import { createResourceUseCases } from "./resource-use-cases";
import {
  createInvitationAcceptance,
  createInvitationManagement,
} from "./invitation-use-cases";

/** Composition uses ports only: it can run without React, HTTP or a browser. */
export function createAccessApplication(
  gateways: AccessGateways,
  navigation: AccessNavigation,
  operationIds: OperationIds,
): AccessApplication {
  return {
    session: gateways.session,
    access: (id, signal) => gateways.workspace.access(id, signal),
    invitations: createInvitationAcceptance(gateways.invitations),
    navigation,
    workspace: (planzoneId, access) => ({
      planzoneId,
      access,
      operationIds,
      resources: createResourceUseCases(gateways.resources, planzoneId, access),
      invitations: createInvitationManagement(
        gateways.invitations,
        planzoneId,
        access,
      ),
    }),
  };
}
