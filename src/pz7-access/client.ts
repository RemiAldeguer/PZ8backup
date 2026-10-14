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
  csrfToken: string;
  csrfHeader: "X-CSRF-TOKEN";
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
export class AccessApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AccessApiError";
  }
}
export const isSessionExpired = (error: unknown) =>
  error instanceof AccessApiError && error.status === 401;
export function accessErrorMessage(error: unknown): string {
  if (!(error instanceof AccessApiError))
    return "Le service est indisponible. Vérifiez votre connexion puis réessayez.";
  const messages: Record<string, string> = {
    ACCESS_DENIED: "Vous n’avez pas les droits nécessaires pour cette action.",
    NOT_FOUND: "Cet élément n’est plus disponible.",
    VERSION_CONFLICT:
      "Cette ressource a changé depuis son ouverture. Rechargez son profil avant de modifier à nouveau.",
    OPERATION_CONFLICT:
      "Cette opération est en conflit avec une demande précédente. Rien n’a été renvoyé automatiquement.",
    INVITATION_UNAVAILABLE: "Cette invitation a expiré ou a été révoquée.",
    INVITATION_ACCOUNT_MISMATCH:
      "Connectez-vous avec le compte dont l’adresse e-mail vérifiée correspond à cette invitation.",
    SESSION_REQUIRED: "Votre session a expiré. Connectez-vous à nouveau.",
    SESSION_EXPIRED: "Votre session a expiré. Connectez-vous à nouveau.",
  };
  return (
    (Object.hasOwn(messages, error.code) ? messages[error.code] : undefined) ??
    (error.status === 401
      ? messages.SESSION_REQUIRED
      : error.status === 403
        ? messages.ACCESS_DENIED
        : error.status >= 500
          ? "Le service est indisponible. Réessayez dans quelques instants."
          : error.message || "La demande n’a pas pu être traitée.")
  );
}
const part = (id: string) => encodeURIComponent(id);
export class Pz7AccessClient {
  private session: AccessSession | null = null;
  readonly base: string;
  constructor(apiBaseUrl = "") {
    const root = new URL(apiBaseUrl || "/", window.location.origin);
    if (
      root.origin !== window.location.origin ||
      root.search ||
      root.hash ||
      root.username ||
      root.password
    )
      throw new Error(
        "La racine API doit rester sur la même origine, sans paramètres ni identifiants.",
      );
    this.base = root.pathname.replace(/\/$/, "") + "/api/v1";
  }
  loginUrl() {
    return (
      this.base +
      "/auth/login?returnTo=" +
      encodeURIComponent(window.location.pathname + window.location.search)
    );
  }
  setSession(session: AccessSession | null) {
    this.session = session;
  }
  /** Same-origin transport shared by the access and scoped membership adapters. */
  async request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const headers = new Headers({ Accept: "application/json" });
    if (method !== "GET") {
      if (
        !this.session?.csrfToken ||
        this.session.csrfHeader !== "X-CSRF-TOKEN"
      )
        throw new AccessApiError(401, "SESSION_REQUIRED", "Connexion requise.");
      headers.set(this.session.csrfHeader, this.session.csrfToken);
    }
    if (body !== undefined) headers.set("Content-Type", "application/json");
    const response = await fetch(this.base + path, {
      method,
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.any([
        ...(signal ? [signal] : []),
        AbortSignal.timeout(30_000),
      ]),
    });
    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as {
        code?: string;
        message?: string;
      };
      if (response.status === 401) this.session = null;
      throw new AccessApiError(
        response.status,
        typeof error.code === "string" ? error.code : "HTTP_ERROR",
        typeof error.message === "string"
          ? error.message
          : "La demande n’a pas pu être traitée.",
      );
    }
    return response.status === 204
      ? (undefined as T)
      : (response.json() as Promise<T>);
  }
  async getSession(signal?: AbortSignal) {
    const session = await this.request<AccessSession>(
      "/session",
      "GET",
      undefined,
      signal,
    );
    if (signal?.aborted)
      throw new DOMException("Requête annulée.", "AbortError");
    if (
      !session.identity?.id ||
      !Array.isArray(session.planzones) ||
      !session.csrfToken ||
      session.csrfHeader !== "X-CSRF-TOKEN"
    )
      throw new AccessApiError(
        502,
        "INVALID_SESSION",
        "La session renvoyée est invalide.",
      );
    this.session = session;
    return session;
  }
  logout(signal?: AbortSignal) {
    return this.request<void>("/auth/logout", "POST", undefined, signal);
  }
  access(id: string, signal?: AbortSignal) {
    return this.request<PlanzoneAccess>(
      `/planzones/${part(id)}/access`,
      "GET",
      undefined,
      signal,
    );
  }
  private scopedResource(
    id: string,
    resource: AccessResource,
    expectedId?: string,
  ) {
    if (
      resource.planzoneId !== id ||
      (expectedId !== undefined && resource.id !== expectedId)
    )
      throw new AccessApiError(
        502,
        "INVALID_SCOPE",
        "Le serveur a renvoyé une ressource ne correspondant pas à la requête.",
      );
    return resource;
  }
  async resources(
    id: string,
    filters: ResourceFilters,
    after: ResourceCursor | null,
    signal?: AbortSignal,
  ) {
    const query = new URLSearchParams({
      limit: "25",
      namePrefix: filters.namePrefix,
      deactivated: String(filters.deactivated),
    });
    if (filters.type) query.set("type", filters.type);
    if (after) {
      query.set("afterName", after.name);
      query.set("afterId", after.id);
    }
    const page = await this.request<ResourcePage>(
      `/planzones/${part(id)}/resources?${query}`,
      "GET",
      undefined,
      signal,
    );
    page.items.forEach((resource) => this.scopedResource(id, resource));
    return page;
  }
  async resource(id: string, resourceId: string, signal?: AbortSignal) {
    return this.scopedResource(
      id,
      await this.request<AccessResource>(
        `/planzones/${part(id)}/resources/${part(resourceId)}`,
        "GET",
        undefined,
        signal,
      ),
      resourceId,
    );
  }
  async createResource(
    id: string,
    input: {
      operationId: string;
      type: "VIRTUAL" | "MATERIAL";
      name: string;
      description: string;
    },
    signal?: AbortSignal,
  ) {
    return this.scopedResource(
      id,
      await this.request<AccessResource>(
        `/planzones/${part(id)}/resources`,
        "POST",
        input,
        signal,
      ),
    );
  }
  async renameResource(
    id: string,
    resource: AccessResource,
    name: string,
    signal?: AbortSignal,
  ) {
    return this.scopedResource(
      id,
      await this.request<AccessResource>(
        `/planzones/${part(id)}/resources/${part(resource.id)}`,
        "PATCH",
        { expectedVersion: resource.version, name },
        signal,
      ),
    );
  }
  invitations(id: string, signal?: AbortSignal) {
    return this.request<{ items: AccessInvitation[] }>(
      `/planzones/${part(id)}/invitations`,
      "GET",
      undefined,
      signal,
    );
  }
  invite(
    id: string,
    input: InvitationInput & { operationId: string },
    signal?: AbortSignal,
  ) {
    return this.request<AccessInvitation>(
      `/planzones/${part(id)}/invitations`,
      "POST",
      input,
      signal,
    );
  }
  revoke(id: string, invitationId: string, signal?: AbortSignal) {
    return this.request<void>(
      `/planzones/${part(id)}/invitations/${part(invitationId)}/revoke`,
      "POST",
      undefined,
      signal,
    );
  }
  preview(token: string, signal?: AbortSignal) {
    return this.request<InvitationPreview>(
      "/invitations/preview?" + new URLSearchParams({ token }),
      "GET",
      undefined,
      signal,
    );
  }
  accept(token: string, signal?: AbortSignal) {
    return this.request<{ planzoneId: string; resourceId: string }>(
      "/invitations/accept",
      "POST",
      { token },
      signal,
    );
  }
  updateAccess(
    id: string,
    resourceId: string,
    input: { roleId: string; nonEditableFields: string[] },
    signal?: AbortSignal,
  ) {
    return this.request<void>(
      `/planzones/${part(id)}/resources/${part(resourceId)}/access`,
      "PUT",
      input,
      signal,
    );
  }
}
