import type { InvitationInput, PlanzoneAccess } from "../domain/models";
import { permits } from "../domain/resource-policy";
import { AccessError, requireAccess } from "./errors";
import type { InvitationsGateway } from "./ports";

export function createInvitationManagement(
  gateway: InvitationsGateway,
  planzoneId: string,
  access: PlanzoneAccess,
) {
  const allowed = () => requireAccess(permits(access, "invitation:manage"));
  return {
    list(signal?: AbortSignal) {
      allowed();
      return gateway.list(planzoneId, signal);
    },
    create(
      input: InvitationInput & { operationId: string },
      signal?: AbortSignal,
    ) {
      allowed();
      if (
        !input.email.trim() ||
        !input.firstName.trim() ||
        !input.lastName.trim() ||
        !input.roleId
      )
        throw new AccessError("INVALID_INPUT", "invalid");
      return gateway.create(planzoneId, input, signal);
    },
    revoke(invitationId: string, signal?: AbortSignal) {
      allowed();
      return gateway.revoke(planzoneId, invitationId, signal);
    },
  };
}
export function createInvitationAcceptance(gateway: InvitationsGateway) {
  function checkToken(token: string) {
    if (!token) throw new AccessError("INVALID_INPUT", "invalid");
  }
  return {
    preview(token: string, signal?: AbortSignal) {
      checkToken(token);
      return gateway.preview(token, signal);
    },
    accept(token: string, signal?: AbortSignal) {
      checkToken(token);
      return gateway.accept(token, signal);
    },
  };
}
export type InvitationManagement = ReturnType<
  typeof createInvitationManagement
>;
