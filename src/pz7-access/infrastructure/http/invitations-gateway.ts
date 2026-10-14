import type {
  AccessInvitation,
  InvitationInput,
  InvitationPreview,
} from "../../domain/models";
import type { InvitationsGateway } from "../../application/ports";
import { AccessHttpTransport, part } from "./transport";

export class HttpInvitationsGateway implements InvitationsGateway {
  constructor(private readonly transport: AccessHttpTransport) {}
  list(id: string, signal?: AbortSignal) {
    return this.transport.request<{ items: AccessInvitation[] }>(
      `/planzones/${part(id)}/invitations`,
      "GET",
      undefined,
      signal,
    );
  }
  create(
    id: string,
    input: InvitationInput & { operationId: string },
    signal?: AbortSignal,
  ) {
    return this.transport.request<AccessInvitation>(
      `/planzones/${part(id)}/invitations`,
      "POST",
      input,
      signal,
    );
  }
  revoke(id: string, invitationId: string, signal?: AbortSignal) {
    return this.transport.request<void>(
      `/planzones/${part(id)}/invitations/${part(invitationId)}/revoke`,
      "POST",
      undefined,
      signal,
    );
  }
  preview(token: string, signal?: AbortSignal) {
    return this.transport.request<InvitationPreview>(
      "/invitations/preview?" + new URLSearchParams({ token }),
      "GET",
      undefined,
      signal,
    );
  }
  accept(token: string, signal?: AbortSignal) {
    return this.transport.request<{ planzoneId: string; resourceId: string }>(
      "/invitations/accept",
      "POST",
      { token },
      signal,
    );
  }
}
