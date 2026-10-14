import { AccessApiError } from "./errors";

export interface CsrfSession {
  csrfToken: string;
  csrfHeader: "X-CSRF-TOKEN";
}
export function apiPath(apiBaseUrl: string, origin: string) {
  const root = new URL(apiBaseUrl || "/", origin);
  if (
    root.origin !== origin ||
    root.search ||
    root.hash ||
    root.username ||
    root.password
  )
    throw new Error("The API root must be a same-origin path");
  return root.pathname.replace(/\/$/, "") + "/api/v1";
}

/** The only JSON transport. CSRF stays here, never in a presentation model. */
export class AccessHttpTransport {
  private csrf: CsrfSession | null = null;
  constructor(
    readonly base: string,
    private readonly send: typeof fetch = (input, init) => fetch(input, init),
  ) {}
  setSession(session: CsrfSession | null) {
    this.csrf = session;
  }
  async request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const headers = new Headers({ Accept: "application/json" });
    if (method !== "GET") {
      if (!this.csrf?.csrfToken || this.csrf.csrfHeader !== "X-CSRF-TOKEN")
        throw new AccessApiError(401, "SESSION_REQUIRED");
      headers.set(this.csrf.csrfHeader, this.csrf.csrfToken);
    }
    if (body !== undefined) headers.set("Content-Type", "application/json");
    const response = await this.send(this.base + path, {
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
      if (response.status === 401) this.csrf = null;
      throw new AccessApiError(
        response.status,
        typeof error.code === "string" ? error.code : "HTTP_ERROR",
        typeof error.message === "string" ? error.message : "",
      );
    }
    return response.status === 204
      ? (undefined as T)
      : (response.json() as Promise<T>);
  }
}
export const part = (id: string) => encodeURIComponent(id);
