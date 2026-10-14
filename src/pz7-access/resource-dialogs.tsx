import { useState, type FormEvent } from "react";
import {
  AccessApiError,
  type AccessResource,
  type PlanzoneAccess,
  type Pz7AccessClient,
} from "./client";
import { useAction, useOperationId } from "./async";
import { AccessDialog, ErrorNotice } from "./ui";
interface Props {
  client: Pz7AccessClient;
  planzoneId: string;
  onClose: () => void;
  onSaved: () => void;
  onUnauthorized: () => void;
}
export function CreateResourceDialog(props: Props) {
  const [type, setType] = useState<"VIRTUAL" | "MATERIAL">("VIRTUAL");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const action = useAction(props.onUnauthorized);
  const operation = useOperationId();
  function save(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    const body = { type, name: name.trim(), description: description.trim() };
    void action.run(
      (signal) =>
        props.client.createResource(
          props.planzoneId,
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
export function RenameResourceDialog({
  resource,
  access,
  ...props
}: Props & { resource: AccessResource; access: PlanzoneAccess }) {
  const [snapshot, setSnapshot] = useState(resource);
  const [name, setName] = useState(resource.name);
  const action = useAction(props.onUnauthorized);
  const conflict =
    action.error instanceof AccessApiError &&
    action.error.code === "VERSION_CONFLICT";
  const editable =
    access.permissions.includes("resource:edit") &&
    access.editableResourceFields.includes("name") &&
    Array.isArray(snapshot.nonEditableFields) &&
    !snapshot.nonEditableFields.includes("name");
  function save(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || conflict || !editable) return;
    void action.run(
      (signal) =>
        props.client.renameResource(
          props.planzoneId,
          snapshot,
          name.trim(),
          signal,
        ),
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
                    props.client.resource(
                      props.planzoneId,
                      snapshot.id,
                      signal,
                    ),
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
const fieldLabels: Record<string, string> = {
  name: "Nom",
  description: "Description",
  type: "Type",
  deactivated: "Statut d’activité",
  role: "Rôle",
};
export function ResourcePermissionsDialog({
  resource,
  access,
  ...props
}: Props & { resource: AccessResource; access: PlanzoneAccess }) {
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
        props.client.updateAccess(
          props.planzoneId,
          resource.id,
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
