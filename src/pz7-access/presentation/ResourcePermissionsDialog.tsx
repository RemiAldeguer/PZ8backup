import { useState, type FormEvent } from "react";
import type { AccessResource } from "../domain/models";
import { canRenameResource } from "../domain/resource-policy";
import { AccessError } from "../application/errors";
import { useAction, useOperationId } from "./async";
import { AccessDialog, ErrorNotice } from "./ui";
import type { ResourceDialogProps as Props } from "./resource-dialog-props";
const fieldLabels: Record<string, string> = {
  name: "Nom",
  description: "Description",
  type: "Type",
  deactivated: "Statut d’activité",
  role: "Rôle",
};
export function ResourcePermissionsDialog({
  resource,
  ...props
}: Props & { resource: AccessResource }) {
  const access = props.workspace.access;
  const [roleId, setRoleId] = useState(resource.roleId ?? "");
  const [lockedFields, setLockedFields] = useState(
    resource.nonEditableFields ?? [],
  );
  const action = useAction(props.onUnauthorized);
  const policyKnown = Array.isArray(resource.nonEditableFields);
  const otherFields = lockedFields.filter(
    (field) => !Object.hasOwn(fieldLabels, field),
  );
  function save(event: FormEvent) {
    event.preventDefault();
    if (!policyKnown || !roleId) return;
    void action.run(
      (signal) =>
        props.workspace.resources.updateAccess(
          resource,
          { roleId, nonEditableFields: lockedFields },
          signal,
        ),
      props.onSaved,
    );
  }
  return (
    <AccessDialog
      title="Permissions de la ressource"
      onClose={props.onClose}
      busy={action.busy}
    >
      <form onSubmit={save}>
        <div className="pa-dialog-body">
          <p>
            Permissions de <strong>{resource.name}</strong>
          </p>
          <fieldset disabled={action.busy || !policyKnown}>
            <label>
              Rôle
              <select
                value={roleId}
                disabled={!access.canManageRoles}
                onChange={(event) => setRoleId(event.target.value)}
              >
                <option value="">Choisir un rôle</option>
                {resource.roleId &&
                  !access.roles.some((role) => role.id === resource.roleId) && (
                    <option value={resource.roleId}>
                      Rôle actuel conservé
                    </option>
                  )}
                {access.roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.label}
                  </option>
                ))}
              </select>
            </label>
            {!access.canManageRoles && (
              <p className="pa-hint">
                Votre accès permet de modifier les restrictions de champs, tout
                en conservant le rôle actuel.
              </p>
            )}
            <fieldset className="pa-checkbox-group">
              <legend>Champs non modifiables</legend>
              {Object.entries(fieldLabels).map(([field, label]) => (
                <label className="pa-checkbox" key={field}>
                  <input
                    type="checkbox"
                    checked={lockedFields.includes(field)}
                    onChange={(event) =>
                      setLockedFields((previous) =>
                        event.target.checked
                          ? [...new Set([...previous, field])]
                          : previous.filter((item) => item !== field),
                      )
                    }
                  />
                  Verrouiller {label}
                </label>
              ))}
            </fieldset>
          </fieldset>
          {otherFields.length > 0 && (
            <p className="pa-hint">
              Autres restrictions conservées : {otherFields.join(", ")}.
            </p>
          )}
          {!policyKnown && (
            <p className="pa-error" role="alert">
              Les restrictions actuelles n’ont pas été renvoyées par le serveur.
              Leur modification est bloquée pour éviter un effacement implicite.
            </p>
          )}
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
          <button
            type="submit"
            disabled={action.busy || !policyKnown || !roleId}
          >
            {action.busy ? "Enregistrement…" : "Enregistrer les permissions"}
          </button>
        </footer>
      </form>
    </AccessDialog>
  );
}
