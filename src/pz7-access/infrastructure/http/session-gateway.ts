import type { AccessSession, PlanzoneAccess } from "../../domain/models";
import type { SessionGateway, WorkspaceGateway } from "../../application/ports";
import { AccessApiError } from "./errors";
import { AccessHttpTransport, part, type CsrfSession } from "./transport";

export interface SessionDto extends AccessSession, CsrfSession {}
export class HttpSessionGateway implements SessionGateway, WorkspaceGateway {
  constructor(private readonly transport: AccessHttpTransport) {}
  async readDto(signal?: AbortSignal): Promise<SessionDto> {
    const session = await this.transport.request<SessionDto>(
      "/session",
      "GET",
      undefined,
      signal,
    );
    if (signal?.aborted)
      throw new DOMException("Request cancelled", "AbortError");
    if (
      !session.identity?.id ||
      !Array.isArray(session.planzones) ||
      !session.csrfToken ||
      session.csrfHeader !== "X-CSRF-TOKEN"
    )
      throw new AccessApiError(502, "INVALID_SESSION");
    this.transport.setSession(session);
    return session;
  }
  async current(signal?: AbortSignal): Promise<AccessSession> {
    const { identity, planzones } = await this.readDto(signal);
    return { identity, planzones };
  }
  async logout(signal?: AbortSignal) {
    await this.transport.request<void>(
      "/auth/logout",
      "POST",
      undefined,
      signal,
    );
    this.clear();
  }
  clear() {
    this.transport.setSession(null);
  }
  access(id: string, signal?: AbortSignal) {
    return this.transport.request<PlanzoneAccess>(
      `/planzones/${part(id)}/access`,
      "GET",
      undefined,
      signal,
    );
  }
}
