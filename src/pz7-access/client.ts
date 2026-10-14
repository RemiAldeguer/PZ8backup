/** Compatibility façade for hosts using the first delivery. New UI uses application ports. */
import type {
  AccessResource,
  ResourceCursor,
  ResourceFilters,
  InvitationInput,
} from "./domain/models";
import type {
  CreateResourceInput,
  ResourceAccessInput,
} from "./application/ports";
import { createBrowserNavigation } from "./infrastructure/browser-navigation";
import { AccessHttpTransport, apiPath } from "./infrastructure/http/transport";
import {
  HttpSessionGateway,
  type SessionDto,
} from "./infrastructure/http/session-gateway";
import { HttpResourcesGateway } from "./infrastructure/http/resources-gateway";
import { HttpInvitationsGateway } from "./infrastructure/http/invitations-gateway";
import { AccessApiError } from "./infrastructure/http/errors";
export { AccessApiError } from "./infrastructure/http/errors";
export { isSessionExpired } from "./application/errors";
export { accessErrorMessage } from "./presentation/error-messages";
export type * from "./domain/models";
export type AccessSession = SessionDto;

export class Pz7AccessClient {
  readonly base: string;
  private readonly transport: AccessHttpTransport;
  private readonly session: HttpSessionGateway;
  private readonly resourceGateway: HttpResourcesGateway;
  private readonly invitationGateway: HttpInvitationsGateway;
  constructor(apiBaseUrl = "") {
    this.base = apiPath(apiBaseUrl, window.location.origin);
    this.transport = new AccessHttpTransport(this.base);
    this.session = new HttpSessionGateway(this.transport);
    this.resourceGateway = new HttpResourcesGateway(this.transport);
    this.invitationGateway = new HttpInvitationsGateway(this.transport);
  }
  loginUrl() {
    return createBrowserNavigation(this.base).loginUrl();
  }
  setSession(session: SessionDto | null) {
    this.transport.setSession(session);
  }
  getSession(signal?: AbortSignal) {
    return this.session.readDto(signal);
  }
  logout(signal?: AbortSignal) {
    return this.session.logout(signal);
  }
  access(id: string, signal?: AbortSignal) {
    return this.session.access(id, signal);
  }
  private scoped(id: string, resource: AccessResource, expectedId?: string) {
    if (
      resource.planzoneId !== id ||
      (expectedId !== undefined && resource.id !== expectedId)
    )
      throw new AccessApiError(502, "INVALID_SCOPE");
    return resource;
  }
  async resources(
    id: string,
    filters: ResourceFilters,
    after: ResourceCursor | null,
    signal?: AbortSignal,
  ) {
    const page = await this.resourceGateway.list(id, filters, after, signal);
    page.items.forEach((resource) => this.scoped(id, resource));
    return page;
  }
  async resource(id: string, resourceId: string, signal?: AbortSignal) {
    return this.scoped(
      id,
      await this.resourceGateway.get(id, resourceId, signal),
      resourceId,
    );
  }
  async createResource(
    id: string,
    input: CreateResourceInput,
    signal?: AbortSignal,
  ) {
    return this.scoped(
      id,
      await this.resourceGateway.create(id, input, signal),
    );
  }
  async renameResource(
    id: string,
    resource: AccessResource,
    name: string,
    signal?: AbortSignal,
  ) {
    return this.scoped(
      id,
      await this.resourceGateway.rename(id, resource, name, signal),
      resource.id,
    );
  }
  invitations(id: string, signal?: AbortSignal) {
    return this.invitationGateway.list(id, signal);
  }
  invite(
    id: string,
    input: InvitationInput & { operationId: string },
    signal?: AbortSignal,
  ) {
    return this.invitationGateway.create(id, input, signal);
  }
  revoke(id: string, invitationId: string, signal?: AbortSignal) {
    return this.invitationGateway.revoke(id, invitationId, signal);
  }
  preview(token: string, signal?: AbortSignal) {
    return this.invitationGateway.preview(token, signal);
  }
  accept(token: string, signal?: AbortSignal) {
    return this.invitationGateway.accept(token, signal);
  }
  updateAccess(
    id: string,
    resourceId: string,
    input: ResourceAccessInput,
    signal?: AbortSignal,
  ) {
    return this.resourceGateway.updateAccess(id, resourceId, input, signal);
  }
}
