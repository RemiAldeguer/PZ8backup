export type AccessFailure =
  | "unauthenticated"
  | "forbidden"
  | "conflict"
  | "invalid"
  | "unavailable"
  | "not-found"
  | "unexpected";

/** Application failures have no HTTP or rendering semantics. */
export class AccessError extends Error {
  constructor(
    readonly code: string,
    readonly kind: AccessFailure,
    message = "",
  ) {
    super(message);
    this.name = "AccessError";
  }
}
export const isSessionExpired = (error: unknown) =>
  error instanceof AccessError && error.kind === "unauthenticated";

export function requireAccess(allowed: boolean): void {
  if (!allowed) throw new AccessError("ACCESS_DENIED", "forbidden");
}
