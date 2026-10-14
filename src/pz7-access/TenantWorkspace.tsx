import { useCallback, useMemo, useState } from "react";
import { Pz7ScopePanels } from "../pz7-scope";
import { createScopeApi } from "../pz7-scope-adapter";
import type {
  PlanzoneAccess,
  PlanzoneSummary,
  Pz7AccessClient,
} from "./client";
import { useRemote } from "./async";
import { ErrorNotice, Loading } from "./ui";
import { Resources } from "./Resources";
import { Invitations } from "./Invitations";
export function TenantWorkspace({
  client,
  planzone,
  onUnauthorized,
}: {
  client: Pz7AccessClient;
  planzone: PlanzoneSummary;
  onUnauthorized: () => void;
}) {
  const load = useCallback(
    (signal: AbortSignal) => client.access(planzone.id, signal),
    [client, planzone.id],
  );
  const access = useRemote("access:" + planzone.id, load, onUnauthorized);
  return (
    <main className="pa-main" aria-busy={access.loading}>
      <header className="pa-workspace-heading">
        <span className="pa-eyebrow">VOTRE PLANZONE</span>
        <h1>{planzone.name}</h1>
        <p>Gérez les membres, leurs accès et les ressources.</p>
      </header>
      {access.loading ? (
        <Loading>Chargement de l’accès…</Loading>
      ) : access.error !== undefined ? (
        <ErrorNotice error={access.error} retry={access.reload} />
      ) : (
        access.data && (
          <AccessPanels
            client={client}
            planzoneId={planzone.id}
            access={access.data}
            onUnauthorized={onUnauthorized}
          />
        )
      )}
    </main>
  );
}
function AccessPanels(props: {
  client: Pz7AccessClient;
  planzoneId: string;
  access: PlanzoneAccess;
  onUnauthorized: () => void;
}) {
  const canUseResources =
    props.access.permissions.includes("resource:read") ||
    props.access.permissions.includes("resource:create");
  const canInvite = props.access.permissions.includes("invitation:manage");
  const scopes = useMemo(() => createScopeApi(props.client), [props.client]);
  const [tab, setTab] = useState<"resources" | "invitations" | "scopes">(
    canUseResources ? "resources" : canInvite ? "invitations" : "scopes",
  );
  const active =
    tab === "scopes" ? "scopes" : tab === "resources" && canUseResources
      ? "resources"
      : canInvite
        ? "invitations"
        : "scopes";
  return (
    <>
      <nav className="pa-tabs" aria-label="Gestion des accès">
        <button type="button" aria-current={active === "scopes" ? "page" : undefined} onClick={() => setTab("scopes")}>
          Zones et projets
        </button>
        {canUseResources && (
          <button
            type="button"
            aria-current={active === "resources" ? "page" : undefined}
            onClick={() => setTab("resources")}
          >
            Ressources
          </button>
        )}
        {canInvite && (
          <button
            type="button"
            aria-current={active === "invitations" ? "page" : undefined}
            onClick={() => setTab("invitations")}
          >
            Invitations
          </button>
        )}
      </nav>
      <div className="pa-card">
        {active === "scopes" ? (
          <Pz7ScopePanels key={props.planzoneId} api={scopes} planzoneId={props.planzoneId} onUnauthorized={props.onUnauthorized} />
        ) : active === "resources" ? (
          <Resources {...props} />
        ) : (
          <Invitations {...props} />
        )}
      </div>
    </>
  );
}
