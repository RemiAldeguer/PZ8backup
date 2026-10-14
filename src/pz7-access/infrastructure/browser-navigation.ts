import type { AccessNavigation, OperationIds } from "../application/ports";

export function createBrowserNavigation(base: string): AccessNavigation {
  return {
    loginUrl: () =>
      base +
      "/auth/login?returnTo=" +
      encodeURIComponent(window.location.pathname + window.location.search),
    invitationToken: () => {
      const path = window.location.pathname.replace(/\/$/, "");
      return ["/invitations/accept", "/account/validation"].includes(path)
        ? (new URLSearchParams(window.location.search).get("token") ?? "")
        : null;
    },
    leaveInvitation: () => {
      const url = new URL(window.location.href);
      url.pathname = "/access";
      url.searchParams.delete("token");
      window.history.replaceState(
        null,
        "",
        url.pathname + url.search + url.hash,
      );
    },
    subscribe: (changed) => {
      window.addEventListener("popstate", changed);
      return () => window.removeEventListener("popstate", changed);
    },
  };
}
export const browserOperationIds: OperationIds = {
  next: () => crypto.randomUUID(),
};
