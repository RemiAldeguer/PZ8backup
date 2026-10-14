import { useCallback, useEffect, useRef, useState } from "react";
import type { AccessApplication } from "../application/contracts";
import { AccessError, isSessionExpired } from "../application/errors";
import type { PlanzoneSummary } from "../domain/models";
import { useAction, useRemote } from "./async";
import { Empty, ErrorNotice, Loading } from "./ui";
import { InvitationAcceptance } from "./InvitationAcceptance";
import { TenantWorkspace } from "./TenantWorkspace";
export function AccessAppSession({
  client,
  onPlanzoneChange,
}: {
  client: AccessApplication;
  onPlanzoneChange?: (planzone: PlanzoneSummary | null) => void;
}) {
  const load = useCallback(
    (signal: AbortSignal) => client.session.current(signal),
    [client],
  );
  const session = useRemote("session", load);
  const [selectedId, setSelectedId] = useState("");
  const [expired, setExpired] = useState(false);
  const [invitationToken, setInvitationToken] = useState(
    client.navigation.invitationToken,
  );
  const [notice, setNotice] = useState("");
  const onUnauthorized = useCallback(() => {
    client.session.clear();
    setExpired(true);
    setSelectedId("");
  }, [client]);
  const logout = useAction(onUnauthorized);
  const authenticated =
    !expired && session.data && !session.loading && session.error === undefined
      ? session.data
      : undefined;
  const sessionExpired =
    expired ||
    (session.error instanceof AccessError &&
      session.error.code === "SESSION_EXPIRED");
  const selected =
    authenticated?.planzones.find((item) => item.id === selectedId) ??
    authenticated?.planzones[0] ??
    null;
  const onChange = useRef(onPlanzoneChange);
  onChange.current = onPlanzoneChange;
  useEffect(() => {
    onChange.current?.(selected);
    return () => onChange.current?.(null);
  }, [
    selected?.id,
    selected?.resourceId,
    selected?.name,
    authenticated?.identity.id,
  ]);
  useEffect(() => {
    const unsubscribe = client.navigation.subscribe(() =>
      setInvitationToken(client.navigation.invitationToken()),
    );
    return () => {
      unsubscribe();
      client.session.clear();
    };
  }, [client]);
  function leaveInvitation() {
    client.navigation.leaveInvitation();
    setInvitationToken(null);
  }
  function accepted(id: string) {
    leaveInvitation();
    setSelectedId(id);
    setNotice("Invitation acceptée.");
    setExpired(false);
    session.reload();
  }
  return (
    <div className="pz7-access" lang="fr">
      <header className="pa-topbar">
        <a className="pa-brand" href="/access" aria-label="Planzone, accueil">
          <strong>planzone</strong>
          <span>Accès & ressources</span>
        </a>
        {authenticated && (
          <div className="pa-account">
            <span>
              {authenticated.identity.displayName}
              <small>{authenticated.identity.email}</small>
            </span>
            <button
              type="button"
              className="pa-secondary"
              disabled={logout.busy}
              onClick={() =>
                void logout.run(
                  (signal) => client.session.logout(signal),
                  () => {
                    client.session.clear();
                    setExpired(true);
                    setSelectedId("");
                    setNotice("");
                  },
                )
              }
            >
              {logout.busy ? "Déconnexion…" : "Se déconnecter"}
            </button>
          </div>
        )}
      </header>
      {logout.error !== undefined && <ErrorNotice error={logout.error} />}
      {logout.busy ? (
        <Loading>Déconnexion…</Loading>
      ) : invitationToken !== null ? (
        <main className="pa-entry">
          <InvitationAcceptance
            key={invitationToken}
            token={invitationToken}
            client={client}
            session={authenticated}
            sessionLoading={session.loading}
            onAccepted={accepted}
            onUnauthorized={onUnauthorized}
            onLeave={leaveInvitation}
          />
        </main>
      ) : session.loading && !expired ? (
        <main className="pa-entry">
          <Loading>Vérification de votre session…</Loading>
        </main>
      ) : !authenticated ? (
        session.error !== undefined &&
        !isSessionExpired(session.error) &&
        !expired ? (
          <main className="pa-entry">
            <ErrorNotice error={session.error} retry={session.reload} />
          </main>
        ) : (
          <main className="pa-entry">
            <section className="pa-login">
              <span className="pa-eyebrow">VOTRE ESPACE DE TRAVAIL</span>
              <h1>Connexion à Planzone</h1>
              <p>Retrouvez vos Planzones, vos équipes et leurs ressources.</p>
              {sessionExpired && (
                <p className="pa-notice">
                  Votre session a expiré. Connectez-vous pour poursuivre.
                </p>
              )}
              <a className="pa-button" href={client.navigation.loginUrl()}>
                Se connecter
              </a>
              <p className="pa-hint">
                La connexion et la création de votre compte sont gérées par
                votre fournisseur d’identité.
              </p>
            </section>
          </main>
        )
      ) : (
        <>
          {notice && (
            <p className="pa-success" role="status">
              {notice}
            </p>
          )}
          <div className="pa-selection">
            <label>
              Planzone
              <select
                value={selected?.id ?? ""}
                onChange={(event) => {
                  setNotice("");
                  setSelectedId(event.target.value);
                }}
              >
                {authenticated.planzones.length ? (
                  authenticated.planzones.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))
                ) : (
                  <option value="">Aucune Planzone</option>
                )}
              </select>
            </label>
            <span>
              Votre compte est connecté. Les accès dépendent de la Planzone
              choisie.
            </span>
          </div>
          {selected ? (
            <TenantWorkspace
              key={`${authenticated.identity.id}:${selected.id}`}
              client={client}
              planzone={selected}
              onUnauthorized={onUnauthorized}
            />
          ) : (
            <main className="pa-entry">
              <Empty title="Aucune Planzone accessible">
                Acceptez une invitation reçue par e-mail ou contactez votre
                administrateur.
              </Empty>
            </main>
          )}
        </>
      )}
    </div>
  );
}
