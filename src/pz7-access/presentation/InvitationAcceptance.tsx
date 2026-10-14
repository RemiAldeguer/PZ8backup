import type { AccessApplication } from "../application/contracts";
import { useCallback } from "react";
import type { AccessSession } from "../domain/models";
import { useAction, useRemote } from "./async";
import {
  displayDate,
  Empty,
  ErrorNotice,
  INVITATION_LABELS,
  Loading,
} from "./ui";
export function InvitationAcceptance({
  token,
  client,
  session,
  sessionLoading,
  onAccepted,
  onUnauthorized,
  onLeave,
}: {
  token: string;
  client: AccessApplication;
  session?: AccessSession;
  sessionLoading: boolean;
  onAccepted: (id: string) => void;
  onUnauthorized: () => void;
  onLeave: () => void;
}) {
  const load = useCallback(
    (signal: AbortSignal) => client.invitations.preview(token, signal),
    [client, token],
  );
  const preview = useRemote("preview:" + token, load);
  const action = useAction(onUnauthorized);
  if (!token)
    return (
      <Empty title="Lien d’invitation incomplet">
        Demandez à l’administrateur de vous renvoyer le lien reçu par e-mail.
      </Empty>
    );
  return (
    <section className="pa-acceptance" aria-label="Accepter une invitation">
      <span className="pa-eyebrow">REJOINDRE UNE PLANZONE</span>
      <h1>Vous êtes invité</h1>
      {preview.loading ? (
        <Loading>Vérification de l’invitation…</Loading>
      ) : preview.error !== undefined ? (
        <ErrorNotice error={preview.error} retry={preview.reload} />
      ) : (
        preview.data && (
          <>
            <h2>{preview.data.planzoneName}</h2>
            <p>
              Invitation pour{" "}
              <strong>
                {preview.data.firstName} {preview.data.lastName}
              </strong>
            </p>
            <p>{preview.data.email}</p>
            <p className="pa-hint">
              {INVITATION_LABELS[preview.data.status]} · Expire le{" "}
              {displayDate(preview.data.expiresAt)}
            </p>
            {preview.data.status !== "PENDING" ? (
              <div className="pa-notice">
                <p>
                  {preview.data.status === "ACCEPTED"
                    ? "Cette invitation a déjà été acceptée."
                    : "Cette invitation ne peut plus être acceptée. Contactez l’administrateur pour en recevoir une nouvelle."}
                </p>
                <button
                  type="button"
                  className="pa-secondary"
                  onClick={onLeave}
                >
                  Mes Planzones
                </button>
              </div>
            ) : sessionLoading ? (
              <Loading>Vérification de votre session…</Loading>
            ) : !session ? (
              <div className="pa-notice">
                <p>
                  Connectez-vous ou créez votre compte chez le fournisseur de
                  connexion avec l’adresse e-mail de l’invitation.
                </p>
                <a className="pa-button" href={client.navigation.loginUrl()}>
                  Se connecter
                </a>
              </div>
            ) : (
              <>
                <p className="pa-hint">
                  Compte connecté : {session.identity.email}. Le serveur vérifie
                  que l’adresse du compte correspond à l’invitation.
                </p>
                <button
                  type="button"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(
                      (signal) => client.invitations.accept(token, signal),
                      (result) => onAccepted(result.planzoneId),
                    )
                  }
                >
                  {action.busy ? "Acceptation…" : "Accepter l’invitation"}
                </button>
                {action.error !== undefined && (
                  <ErrorNotice error={action.error} />
                )}
              </>
            )}
          </>
        )
      )}
    </section>
  );
}
