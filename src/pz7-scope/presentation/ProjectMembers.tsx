import { useCallback, useState } from "react";
import type { ProjectMember, ProjectSummary, ScopeQuery } from "../client";
import { hasPermission } from "../domain/member-policy";
import { useRemote } from "./async";
import { AddMemberDialog, EditMemberDialog, RemoveMemberDialog } from "./member-dialogs";
import { Pagination, usePaged } from "./pagination";
import { ErrorNotice, Loading, resourceLabels } from "./ui";
import type { MembersProps } from "./ZoneMembers";

export function ProjectMembers({ api, planzoneId, scope, onUnauthorized, refreshScopes }: MembersProps<ProjectSummary>) {
  const load = useCallback((signal: AbortSignal, query: ScopeQuery) => api.projectMembers(planzoneId, scope.id, signal, query), [api, planzoneId, scope.id]);
  const remote = usePaged(scope.id, load, onUnauthorized);
  const loadRoles = useCallback((signal: AbortSignal) => api.projectRoles(planzoneId, signal), [api, planzoneId]);
  const roles = useRemote(planzoneId, loadRoles, onUnauthorized);
  const [dialog, setDialog] = useState<{ kind: "add" } | { kind: "edit" | "remove"; member: ProjectMember } | null>(null);
  const canAdd = hasPermission(scope.permissions, "projectmember:create");
  const canEdit = hasPermission(scope.permissions, "projectmember:update");
  const canDelete = hasPermission(scope.permissions, "projectmember:delete");
  function reload() { setDialog(null); remote.reload(); roles.reload(); refreshScopes(); }
  const props = { api, planzoneId, scopeId: scope.id, project: true, onUnauthorized, close: () => setDialog(null), saved: reload, reload };
  return <section className="ps-members" aria-label={"Membres du projet " + scope.name}>
    <header><h3>Membres du projet : {scope.name}</h3><button type="button" onClick={reload}>Actualiser l’équipe</button></header>
    {remote.loading || roles.loading ? <Loading /> : remote.error || roles.error ? <ErrorNotice error={remote.error ?? roles.error} reload={reload} /> : <>
      {canAdd && <button type="button" onClick={() => setDialog({ kind: "add" })}>Ajouter un membre au projet</button>}
      {remote.data?.items.length === 0 ? <p>Aucun membre sur cette page.</p> : <div className="ps-table-wrap"><table><caption className="ps-sr-only">Équipe de {scope.name}</caption><thead><tr><th scope="col">Nom</th><th scope="col">Type</th><th scope="col">Rôle</th><th scope="col">Statut</th>{(canEdit || canDelete) && <th scope="col">Actions</th>}</tr></thead><tbody>
        {remote.data?.items.map(member => <tr key={member.resourceId}>
          <td>{member.name}</td><td>{resourceLabels[member.type]}</td><td>{member.roleId === null ? "Sans rôle" : roles.data?.find(role => role.id === member.roleId)?.label ?? "Rôle indisponible"}</td><td>{member.deactivated ? "Inactif" : "Actif"}</td>
          {(canEdit || canDelete) && <td className="ps-actions">{canEdit && <button type="button" aria-label={"Modifier " + member.name} onClick={() => setDialog({ kind: "edit", member })}>Modifier</button>}{canDelete && <button type="button" aria-label={"Retirer " + member.name + " du projet"} onClick={() => setDialog({ kind: "remove", member })}>Retirer</button>}</td>}
        </tr>)}
      </tbody></table></div>}
      <Pagination count={remote.data?.items.length ?? 0} hasNext={!!remote.data?.next} hasPrevious={remote.hasPrevious} next={remote.next} previous={remote.previous} />
    </>}
    {dialog?.kind === "add" && canAdd && <AddMemberDialog {...props} />}
    {dialog?.kind === "edit" && canEdit && <EditMemberDialog {...props} member={dialog.member} roles={roles.data ?? []} />}
    {dialog?.kind === "remove" && canDelete && <RemoveMemberDialog {...props} resourceId={dialog.member.resourceId} name={dialog.member.name} />}
  </section>;
}
