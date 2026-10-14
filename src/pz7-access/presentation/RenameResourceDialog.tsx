import { useState, type FormEvent } from "react";
import type { AccessResource } from "../domain/models";
import { canRenameResource } from "../domain/resource-policy";
import { AccessError } from "../application/errors";
import { useAction, useOperationId } from "./async";
import { AccessDialog, ErrorNotice } from "./ui";
import type { ResourceDialogProps as Props } from "./resource-dialog-props";
export function RenameResourceDialog({
  resource,
  ...props
}: Props & { resource: AccessResource }) {
  const access = props.workspace.access;
  const [snapshot, setSnapshot] = useState(resource);
  const [name, setName] = useState(resource.name);
  const action = useAction(props.onUnauthorized);
  const conflict =
    action.error instanceof AccessError &&
    action.error.code === "VERSION_CONFLICT";
  const editable = canRenameResource(access, snapshot);
  function save(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || conflict || !editable) return;
    void action.run(
      (signal) =>
        props.workspace.resources.rename(snapshot, name.trim(), signal),
      props.onSaved,
    );
  }
  return (
    <AccessDialog
      title="Modifier la ressource"
      onClose={props.onClose}
      busy={action.busy}
    >
      <form onSubmit={save}>
        <div className="pa-dialog-body">
          <p>{snapshot.name}</p>
          <label>
            Nouveau nom
            <input
              required
              autoFocus
              value={name}
              maxLength={256}
              disabled={action.busy || !editable}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {!editable && (
            <p className="pa-notice">
              Ce champ n’est plus modifiable avec vos accès actuels.
            </p>
          )}
          {action.error !== undefined && <ErrorNotice error={action.error} />}
          {conflict && (
            <button
              type="button"
              className="pa-secondary"
              disabled={action.busy}
              onClick={() =>
                void action.run(
                  (signal) =>
                    props.workspace.resources.get(snapshot.id, signal),
                  (updated) => {
                    setSnapshot(updated);
                    setName(updated.name);
                  },
                )
              }
            >
              Recharger le profil
            </button>
          )}
        </div>
        <footer>
          <button
            type="button"
            className="pa-secondary"
            disabled={action.busy}
            onClick={props.onClose}
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={action.busy || conflict || !editable || !name.trim()}
          >
            {action.busy ? "Enregistrement…" : "Enregistrer"}
          </button>
        </footer>
      </form>
    </AccessDialog>
  );
}
