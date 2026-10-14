import type { AccessApplication } from "../application/contracts";
import { useCallback, useMemo, useState } from "react";
import type { PlanzoneAccess, PlanzoneSummary } from "../domain/models";
import { useRemote } from "./async";
import { Empty, ErrorNotice, Loading } from "./ui";
import { Resources } from "./Resources";
import { Invitations } from "./Invitations";
export function TenantWorkspace({
  client,
  planzone,
  onUnauthorized,
}: {
  client: AccessApplication;
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
  client: AccessApplication;
  planzoneId: string;
  access: PlanzoneAccess;
  onUnauthorized: () => void;
}) {
  const workspace = useMemo(
    () => props.client.workspace(props.planzoneId, props.access),
    [props.client, props.planzoneId, props.access],
  );
  const panelProps = { workspace, onUnauthorized: props.onUnauthorized };
  const canUseResources =
    props.access.permissions.includes("resource:read") ||
    props.access.permissions.includes("resource:create");
  const canInvite = props.access.permissions.includes("invitation:manage");
  const [tab, setTab] = useState<"resources" | "invitations">(
    canUseResources ? "resources" : "invitations",
  );
  if (!canUseResources && !canInvite)
    return (
      <Empty title="Accès non autorisé">
        Vous n’avez pas les droits nécessaires pour consulter les ressources ou
        gérer les invitations de cette Planzone.
      </Empty>
    );
  const active =
    tab === "resources" && canUseResources
      ? "resources"
      : canInvite
        ? "invitations"
        : "resources";
  return (
    <>
      <nav className="pa-tabs" aria-label="Gestion des accès">
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
        {active === "resources" ? (
          <Resources {...panelProps} />
        ) : (
          <Invitations {...panelProps} />
        )}
      </div>
    </>
  );
}
