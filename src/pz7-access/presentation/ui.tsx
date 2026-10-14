import { accessErrorMessage } from "./error-messages";
import { AccessError } from "../application/errors";
import { useEffect, useRef, type ReactNode } from "react";
import { type InvitationStatus, type ResourceType } from "../domain/models";
export const RESOURCE_LABELS: Record<ResourceType, string> = {
  HUMAN: "Humaine",
  VIRTUAL: "Virtuelle",
  MATERIAL: "Matérielle",
};
export const INVITATION_LABELS: Record<InvitationStatus, string> = {
  PENDING: "En attente",
  ACCEPTED: "Acceptée",
  REVOKED: "Révoquée",
  EXPIRED: "Expirée",
};
export const displayDate = (date: string) => {
  const value = new Date(date);
  return Number.isNaN(value.getTime())
    ? "Date indisponible"
    : new Intl.DateTimeFormat("fr-FR", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(value);
};
export function Loading({
  children = "Chargement…",
}: {
  children?: ReactNode;
}) {
  return (
    <p className="pa-loading" role="status">
      <span className="pa-spinner" aria-hidden="true" />
      {children}
    </p>
  );
}
export function ErrorNotice({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return (
    <div className="pa-error" role="alert">
      <p>{accessErrorMessage(error)}</p>
      {error instanceof AccessError && error.kind === "conflict" && (
        <p>La demande n’a pas été renvoyée automatiquement.</p>
      )}
      {retry && (
        <button type="button" className="pa-secondary" onClick={retry}>
          Réessayer
        </button>
      )}
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="pa-empty">
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}
export function AccessDialog({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      previousFocus.current?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="pa-dialog pz7-access"
      lang="fr"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button
          type="button"
          className="pa-icon-button"
          aria-label="Fermer"
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
