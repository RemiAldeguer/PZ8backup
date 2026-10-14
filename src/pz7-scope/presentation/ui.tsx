import { useEffect, useRef, type ReactNode } from "react";
import type { ResourceType } from "../client";
import { errorDetails } from "./async";

export const resourceLabels: Record<ResourceType, string> = { HUMAN: "Humaine", VIRTUAL: "Virtuelle", MATERIAL: "Matérielle" };

export function ErrorNotice({ error, reload }: { error: unknown; reload?: () => void }) {
  const { status, code } = errorDetails(error);
  let message = "Impossible de terminer cette demande. Veuillez réessayer.";
  if (status === 401 || code === "SESSION_EXPIRED") message = "Votre session a expiré. Reconnectez-vous pour continuer.";
  else if (status === 403 || code === "ACCESS_DENIED") message = "Vous n’avez pas l’autorisation d’effectuer cette action.";
  else if (status === 409 || code === "VERSION_CONFLICT") message = "Les informations ont changé. Rechargez-les avant de modifier ce membre. Aucune modification n’a été renvoyée automatiquement.";
  else if (status === 404 || code === "NOT_FOUND") message = "Cet élément n’est plus disponible.";
  else if (status === 400 || code === "INVALID_INPUT") message = "La demande n’est pas valide. Vérifiez les champs et les rôles autorisés.";
  else if (code === "INVALID_SCOPE") message = "La réponse ne correspond pas à la Planzone sélectionnée.";
  return <div className="ps-error" role="alert"><p>{message}</p>{reload && status !== 401 && code !== "SESSION_EXPIRED" && <button type="button" onClick={reload}>Recharger les informations</button>}</div>;
}

export function Loading() { return <p role="status">Chargement…</p>; }

export function Dialog({ title, busy, close, children }: { title: string; busy: boolean; close: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog className="pz7-scope ps-dialog" ref={dialog} aria-label={title} lang="fr" onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <header><h2>{title}</h2><button type="button" aria-label="Fermer" disabled={busy} onClick={close}>×</button></header>
    {children}
  </dialog>;
}
