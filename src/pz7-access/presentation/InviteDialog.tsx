import { useState, type FormEvent } from "react";
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
export function InviteDialog({
  onClose,
  onSaved,
  ...props
}: ResourcesProps & { onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<InvitationInput>({
    email: "",
    firstName: "",
    lastName: "",
    roleId: "",
    message: "",
    language: "fr",
  });
  const action = useAction(props.onUnauthorized);
  const operation = useOperationId(props.workspace.operationIds);
  function save(event: FormEvent) {
    event.preventDefault();
    const body = {
      ...draft,
      email: draft.email.trim(),
      firstName: draft.firstName.trim(),
      lastName: draft.lastName.trim(),
      message: draft.message.trim(),
    };
    if (!body.email || !body.firstName || !body.lastName || !body.roleId)
      return;
    void action.run(
      (signal) =>
        props.workspace.invitations.create(
          { ...body, operationId: operation(body) },
          signal,
        ),
      onSaved,
    );
  }
  return (
    <AccessDialog
      title="Inviter un membre"
      onClose={onClose}
      busy={action.busy}
    >
      <form onSubmit={save}>
        <div className="pa-dialog-body">
          <p className="pa-hint">
            Le backend envoie l’invitation par e-mail. Le destinataire utilisera
            son compte auprès du fournisseur de connexion pour l’accepter.
          </p>
          <fieldset disabled={action.busy}>
            <label>
              Adresse e-mail
              <input
                autoFocus
                type="email"
                required
                autoComplete="email"
                value={draft.email}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    email: event.target.value,
                  }))
                }
              />
            </label>
            <div className="pa-form-grid">
              <label>
                Prénom
                <input
                  required
                  autoComplete="given-name"
                  value={draft.firstName}
                  onChange={(event) =>
                    setDraft((previous) => ({
                      ...previous,
                      firstName: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Nom
                <input
                  required
                  autoComplete="family-name"
                  value={draft.lastName}
                  onChange={(event) =>
                    setDraft((previous) => ({
                      ...previous,
                      lastName: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <label>
              Rôle
              <select
                required
                value={draft.roleId}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    roleId: event.target.value,
                  }))
                }
              >
                <option value="">Choisir un rôle</option>
                {props.workspace.access.roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Message
              <textarea
                rows={4}
                maxLength={5000}
                value={draft.message}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    message: event.target.value,
                  }))
                }
              />
            </label>
          </fieldset>
          {action.error !== undefined && <ErrorNotice error={action.error} />}
        </div>
        <footer>
          <button
            type="button"
            className="pa-secondary"
            disabled={action.busy}
            onClick={onClose}
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={
              action.busy ||
              !draft.email.trim() ||
              !draft.firstName.trim() ||
              !draft.lastName.trim() ||
              !draft.roleId
            }
          >
            {action.busy ? "Envoi…" : "Envoyer l’invitation"}
          </button>
        </footer>
      </form>
    </AccessDialog>
  );
}
