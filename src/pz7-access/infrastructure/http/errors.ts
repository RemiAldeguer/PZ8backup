import { AccessError, type AccessFailure } from "../../application/errors";

function failureKind(status: number): AccessFailure {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404 || status === 410) return "not-found";
  if (status === 409) return "conflict";
  if (status === 400 || status === 422) return "invalid";
  if (status >= 500) return "unavailable";
  return "unexpected";
}
/** Legacy public error retains its HTTP status at the adapter boundary. */
export class AccessApiError extends AccessError {
  constructor(
    readonly status: number,
    code: string,
    message = "",
  ) {
    super(code, failureKind(status), message);
    this.name = "AccessApiError";
  }
}
