import { useCallback, useState } from "react";
import type { ScopeApi, ScopeQuery, ZoneMember, ZoneSummary } from "../client";
import { hasPermission } from "../domain/member-policy";
import { AddMemberDialog, RemoveMemberDialog } from "./member-dialogs";
import { Pagination, usePaged } from "./pagination";
import { ErrorNotice, Loading, resourceLabels } from "./ui";

export interface MembersProps<T> { api: ScopeApi; planzoneId: string; scope: T; onUnauthorized: () => void; refreshScopes: () => void }

export function ZoneMembers({ api, planzoneId, scope, onUnauthorized, refreshScopes }: MembersProps<ZoneSummary>) {
  const load = useCallback((signal: AbortSignal, query: ScopeQuery) => api.zoneMembers(planzoneId, scope.id, signal, query), [api, planzoneId, scope.id]);
  const remote = usePaged(scope.id, load, onUnauthorized);
  const [dialog, setDialog] = useState<"add" | ZoneMember | null>(null);
  const canAdd = hasPermission(scope.permissions, "zonemember:create");
  const canDelete = hasPermission(scope.permissions, "zonemember:delete");
  function reload() { setDialog(null); remote.reload(); refreshScopes(); }
  const props = { api, planzoneId, scopeId: scope.id, project: false, onUnauthorized, close: () => setDialog(null), saved: reload, reload };
  return <section className="ps-members" aria-label={"Membres de la zone " + scope.name}>
    <header><h3>Membres de la zone : {scope.name}</h3><button type="button" onClick={reload}>Actualiser l’équipe</button></header>
    {remote.loading ? <Loading /> : remote.error ? <ErrorNotice error={remote.error} reload={reload} /> : <>
      {canAdd && <button type="button" onClick={() => setDialog("add")}>Ajouter un membre à la zone</button>}
      {remote.data?.items.length === 0 ? <p>Aucun membre sur cette page.</p> : <div className="ps-table-wrap"><table><caption className="ps-sr-only">Équipe de {scope.name}</caption><thead><tr><th scope="col">Nom</th><th scope="col">Type</th>{canDelete && <th scope="col">Actions</th>}</tr></thead><tbody>
        {remote.data?.items.map(member => <tr key={member.resourceId}><td>{member.name}</td><td>{resourceLabels[member.type]}</td>{canDelete && <td><button type="button" onClick={() => setDialog(member)} aria-label={"Retirer " + member.name + " de la zone"}>Retirer</button></td>}</tr>)}
      </tbody></table></div>}
      <Pagination count={remote.data?.items.length ?? 0} hasNext={!!remote.data?.next} hasPrevious={remote.hasPrevious} next={remote.next} previous={remote.previous} />
    </>}
    {dialog === "add" && canAdd && <AddMemberDialog {...props} />}
    {dialog && dialog !== "add" && canDelete && <RemoveMemberDialog {...props} resourceId={dialog.resourceId} name={dialog.name} />}
  </section>;
}
