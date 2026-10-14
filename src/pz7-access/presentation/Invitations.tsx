import { InviteDialog } from "./InviteDialog";
import { useCallback, useState, type FormEvent } from "react";
import type { AccessInvitation, InvitationInput } from "../domain/models";
import { useAction, useOperationId, useRemote } from "./async";
import {
  AccessDialog,
  displayDate,
  Empty,
  ErrorNotice,
  INVITATION_LABELS,
  Loading,
} from "./ui";
import type { ResourcesProps } from "./Resources";
export function Invitations(props: ResourcesProps) {
  const load = useCallback(
    (signal: AbortSignal) => props.workspace.invitations.list(signal),
    [props.workspace],
  );
  const invitations = useRemote(
    "invitations:" + props.workspace.planzoneId,
    load,
    props.onUnauthorized,
  );
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<AccessInvitation | null>(null);
  const [notice, setNotice] = useState("");
  const action = useAction(props.onUnauthorized);
  function created() {
    setCreating(false);
    setNotice("Invitation envoyée.");
    invitations.reload();
  }
  function revoke() {
    if (!revoking) return;
    void action.run(
      (signal) => props.workspace.invitations.revoke(revoking.id, signal),
      () => {
        setRevoking(null);
        setNotice("Invitation révoquée.");
        invitations.reload();
      },
    );
  }
  return (
    <section aria-label="Invitations de la Planzone">
      <header className="pa-section-header">
        <div>
          <h2>Invitations</h2>
          <p>Suivez l’arrivée des membres dans cette Planzone.</p>
        </div>
        <button
          type="button"
          disabled={!props.workspace.access.roles.length}
          onClick={() => setCreating(true)}
        >
          Inviter un membre
        </button>
      </header>
      {!props.workspace.access.roles.length && (
        <p className="pa-hint">
          Aucun rôle attribuable n’a été renvoyé. L’envoi est désactivé.
        </p>
      )}
      {notice && (
        <p className="pa-success" role="status">
          {notice}
        </p>
      )}
      {invitations.loading ? (
        <Loading>Chargement des invitations…</Loading>
      ) : invitations.error !== undefined ? (
        <ErrorNotice error={invitations.error} retry={invitations.reload} />
      ) : invitations.data?.items.length ? (
        <div
          className="pa-table-scroll"
          role="region"
          aria-label="Liste des invitations"
          tabIndex={0}
        >
          <table>
            <caption className="pa-sr-only">Invitations de la Planzone</caption>
            <thead>
              <tr>
                <th scope="col">Destinataire</th>
                <th scope="col">Rôle</th>
                <th scope="col">Statut</th>
                <th scope="col">Expire le</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {invitations.data.items.map((invitation) => (
                <tr key={invitation.id}>
                  <th scope="row">
                    {invitation.firstName} {invitation.lastName}
                    <small>{invitation.email}</small>
                  </th>
                  <td>
                    {props.workspace.access.roles.find(
                      (role) => role.id === invitation.roleId,
                    )?.label ?? "—"}
                  </td>
                  <td>
                    <span
                      className={`pa-status pa-status-${invitation.status}`}
                    >
                      {INVITATION_LABELS[invitation.status]}
                    </span>
                  </td>
                  <td>{displayDate(invitation.expiresAt)}</td>
                  <td>
                    {invitation.status === "PENDING" && (
                      <button
                        type="button"
                        className="pa-secondary"
                        aria-label={`Révoquer l’invitation de ${invitation.email}`}
                        onClick={() => {
                          action.clearError();
                          setRevoking(invitation);
                        }}
                      >
                        Révoquer
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="Aucune invitation">
          Invitez une personne pour lui permettre de rejoindre votre Planzone.
        </Empty>
      )}
      {creating && (
        <InviteDialog
          {...props}
          onClose={() => setCreating(false)}
          onSaved={created}
        />
      )}
      {revoking && (
        <AccessDialog
          title="Révoquer l’invitation"
          onClose={() => setRevoking(null)}
          busy={action.busy}
        >
          <div className="pa-dialog-body">
            <p>
              L’invitation de <strong>{revoking.email}</strong> ne pourra plus
              être acceptée.
            </p>
            {action.error !== undefined && <ErrorNotice error={action.error} />}
          </div>
          <footer>
            <button
              type="button"
              className="pa-secondary"
              disabled={action.busy}
              onClick={() => setRevoking(null)}
            >
              Annuler
            </button>
            <button
              type="button"
              className="pa-danger"
              disabled={action.busy}
              onClick={revoke}
            >
              {action.busy ? "Révocation…" : "Révoquer l’invitation"}
            </button>
          </footer>
        </AccessDialog>
      )}
    </section>
  );
}
