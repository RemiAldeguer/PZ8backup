import { useState, type FormEvent } from "react";
import type { AccessResource } from "../domain/models";
import { canRenameResource } from "../domain/resource-policy";
import { AccessError } from "../application/errors";
import { useAction, useOperationId } from "./async";
import { AccessDialog, ErrorNotice } from "./ui";
import type { ResourceDialogProps as Props } from "./resource-dialog-props";
export function CreateResourceDialog(props: Props) {
  const [type, setType] = useState<"VIRTUAL" | "MATERIAL">("VIRTUAL");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const action = useAction(props.onUnauthorized);
  const operation = useOperationId(props.workspace.operationIds);
  function save(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    const body = { type, name: name.trim(), description: description.trim() };
    void action.run(
      (signal) =>
        props.workspace.resources.create(
          { ...body, operationId: operation(body) },
          signal,
        ),
      props.onSaved,
    );
  }
  return (
    <AccessDialog
      title="Créer une ressource"
      onClose={props.onClose}
      busy={action.busy}
    >
      <form onSubmit={save}>
        <div className="pa-dialog-body">
          <p className="pa-hint">
            Les ressources virtuelles et matérielles n’ont pas de compte de
            connexion. Pour ajouter une personne, envoyez-lui une invitation.
          </p>
          <fieldset disabled={action.busy}>
            <label>
              Type de ressource
              <select
                value={type}
                onChange={(event) => setType(event.target.value as typeof type)}
              >
                <option value="VIRTUAL">Ressource virtuelle</option>
                <option value="MATERIAL">Ressource matérielle</option>
              </select>
            </label>
            <label>
              Nom de la ressource
              <input
                required
                autoFocus
                maxLength={256}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              Description
              <textarea
                rows={4}
                maxLength={5000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
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
            onClick={props.onClose}
          >
            Annuler
          </button>
          <button type="submit" disabled={action.busy || !name.trim()}>
            {action.busy ? "Création…" : "Créer une ressource"}
          </button>
        </footer>
      </form>
    </AccessDialog>
  );
}
