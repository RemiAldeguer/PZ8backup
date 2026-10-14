import { useState } from "react";
import type {
  AccessResource,
  PlanzoneAccess,
  Pz7AccessClient,
  ResourceFilters,
} from "./client";
import { useResourcePages } from "./resource-pages";
import {
  CreateResourceDialog,
  RenameResourceDialog,
  ResourcePermissionsDialog,
} from "./resource-dialogs";
import { Empty, ErrorNotice, Loading, RESOURCE_LABELS } from "./ui";
export interface ResourcesProps {
  client: Pz7AccessClient;
  planzoneId: string;
  access: PlanzoneAccess;
  onUnauthorized: () => void;
}
export function Resources({
  client,
  planzoneId,
  access,
  onUnauthorized,
}: ResourcesProps) {
  const [filters, setFilters] = useState<ResourceFilters>({
    namePrefix: "",
    type: "",
    deactivated: false,
  });
  const canRead = access.permissions.includes("resource:read");
  const pages = useResourcePages(
    client,
    planzoneId,
    filters,
    canRead,
    onUnauthorized,
  );
  const [editor, setEditor] = useState<{
    kind: "create" | "rename" | "permissions";
    resource?: AccessResource;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const canCreate = access.permissions.includes("resource:create");
  const canManage = access.permissions.includes("resource:manage-access");
  const canRename = (resource: AccessResource) =>
    access.permissions.includes("resource:edit") &&
    access.editableResourceFields.includes("name") &&
    Array.isArray(resource.nonEditableFields) &&
    !resource.nonEditableFields.includes("name");
  function saved() {
    setEditor(null);
    setNotice("Modification enregistrée.");
    pages.reload();
  }
  const dialogProps = {
    client,
    planzoneId,
    onClose: () => setEditor(null),
    onSaved: saved,
    onUnauthorized,
  };
  return (
    <section aria-label="Ressources de la Planzone">
      <header className="pa-section-header">
        <div>
          <h2>Ressources</h2>
          <p>
            Personnes, ressources virtuelles et matérielles de cette Planzone.
          </p>
        </div>
        {canCreate && (
          <button type="button" onClick={() => setEditor({ kind: "create" })}>
            Créer une ressource
          </button>
        )}
      </header>
      {canRead && (
        <div className="pa-filters">
          <label>
            Nom de la ressource
            <input
              type="search"
              placeholder="Commence par…"
              value={filters.namePrefix}
              onChange={(event) => {
                setNotice("");
                setFilters((previous) => ({
                  ...previous,
                  namePrefix: event.target.value,
                }));
              }}
            />
          </label>
          <label>
            Type de ressource
            <select
              value={filters.type}
              onChange={(event) =>
                setFilters((previous) => ({
                  ...previous,
                  type: event.target.value as ResourceFilters["type"],
                }))
              }
            >
              <option value="">Toutes les ressources</option>
              <option value="HUMAN">Humaines</option>
              <option value="VIRTUAL">Virtuelles</option>
              <option value="MATERIAL">Matérielles</option>
            </select>
          </label>
          <label className="pa-checkbox">
            <input
              type="checkbox"
              checked={filters.deactivated}
              onChange={(event) =>
                setFilters((previous) => ({
                  ...previous,
                  deactivated: event.target.checked,
                }))
              }
            />
            Afficher les ressources désactivées
          </label>
        </div>
      )}
      {notice && (
        <p className="pa-success" role="status">
          {notice}
        </p>
      )}
      {!canRead ? (
        <Empty title="Lecture des ressources non autorisée">
          Votre accès permet de créer une ressource, mais pas de consulter le
          catalogue.
        </Empty>
      ) : pages.loading ? (
        <Loading>Chargement des ressources…</Loading>
      ) : (
        <>
          {pages.error !== undefined && (
            <ErrorNotice
              error={pages.error}
              retry={
                pages.items.length ? () => void pages.loadMore() : pages.reload
              }
            />
          )}
          {pages.items.length ? (
            <div
              className="pa-table-scroll"
              role="region"
              aria-label="Liste des ressources"
              tabIndex={0}
            >
              <table>
                <caption className="pa-sr-only">
                  Ressources de la Planzone
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Nom</th>
                    <th scope="col">Type</th>
                    <th scope="col">Compte</th>
                    <th scope="col">Rôle</th>
                    <th scope="col">État</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pages.items.map((resource) => (
                    <tr key={resource.id}>
                      <th scope="row">
                        <span className="pa-resource-name">
                          {resource.name}
                        </span>
                        {resource.description && (
                          <small>{resource.description}</small>
                        )}
                      </th>
                      <td>{RESOURCE_LABELS[resource.type]}</td>
                      <td>
                        {resource.identityId ? "Compte associé" : "Sans compte"}
                      </td>
                      <td>
                        {access.roles.find(
                          (role) => role.id === resource.roleId,
                        )?.label ?? "—"}
                      </td>
                      <td>
                        <span
                          className={`pa-status ${resource.deactivated ? "pa-muted" : "pa-status-ACCEPTED"}`}
                        >
                          {resource.deactivated ? "Désactivée" : "Active"}
                        </span>
                      </td>
                      <td>
                        <div className="pa-row-actions">
                          {canRename(resource) && (
                            <button
                              type="button"
                              className="pa-secondary"
                              aria-label={`Modifier ${resource.name}`}
                              onClick={() =>
                                setEditor({ kind: "rename", resource })
                              }
                            >
                              Modifier
                            </button>
                          )}
                          {canManage && (
                            <button
                              type="button"
                              className="pa-secondary"
                              aria-label={`Permissions de ${resource.name}`}
                              onClick={() =>
                                setEditor({ kind: "permissions", resource })
                              }
                            >
                              Permissions
                            </button>
                          )}
                          {!canRename(resource) && !canManage && (
                            <span className="pa-hint">Lecture seule</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            pages.error === undefined && (
              <Empty title="Aucune ressource">
                Modifiez les filtres ou ajoutez une ressource si votre accès le
                permet.
              </Empty>
            )
          )}
          {pages.next && (
            <div className="pa-pagination">
              <span>{pages.items.length} ressources affichées</span>
              <button
                type="button"
                className="pa-secondary"
                disabled={pages.loadingMore}
                onClick={() => void pages.loadMore()}
              >
                {pages.loadingMore ? "Chargement…" : "Charger la suite"}
              </button>
            </div>
          )}
        </>
      )}
      {editor?.kind === "create" && canCreate && (
        <CreateResourceDialog {...dialogProps} />
      )}
      {editor?.kind === "rename" &&
        editor.resource &&
        canRename(editor.resource) && (
          <RenameResourceDialog
            {...dialogProps}
            resource={editor.resource}
            access={access}
          />
        )}
      {editor?.kind === "permissions" && editor.resource && canManage && (
        <ResourcePermissionsDialog
          {...dialogProps}
          resource={editor.resource}
          access={access}
        />
      )}
    </section>
  );
}
