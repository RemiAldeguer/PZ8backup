import { useCallback, useState, type FormEvent } from "react";
import type { Candidate, ProjectMember, ProjectRole, ScopeApi } from "../client";
import { allowedRoles, validMemberRole } from "../domain/member-policy";
import { errorDetails, useAction, useRemote } from "./async";
import { Pagination, usePaged } from "./pagination";
import type { ScopeQuery } from "../client";
import { Dialog, ErrorNotice, Loading, resourceLabels } from "./ui";

interface DialogProps {
  api: ScopeApi;
  planzoneId: string;
  scopeId: string;
  project: boolean;
  onUnauthorized: () => void;
  close: () => void;
  saved: () => void;
  reload: () => void;
}

function RoleSelect({ member, roles, value, change, disabled }: { member: Candidate | ProjectMember; roles: ProjectRole[]; value: string; change: (id: string) => void; disabled: boolean }) {
  return <label>Rôle dans le projet<select value={value} onChange={event => change(event.target.value)} disabled={disabled} required={member.type === "HUMAN"}>
    <option value="">{member.type === "HUMAN" ? "Sélectionner un rôle" : "Sans rôle"}</option>
    {allowedRoles(member, roles).map(role => <option key={role.id} value={role.id}>{role.label}</option>)}
  </select></label>;
}

export function AddMemberDialog(props: DialogProps) {
  const { api, planzoneId, scopeId, project, onUnauthorized } = props;
  const load = useCallback((signal: AbortSignal, query: ScopeQuery) => project
    ? api.projectCandidates(planzoneId, scopeId, signal, query)
    : api.zoneCandidates(planzoneId, scopeId, signal, query), [api, planzoneId, scopeId, project]);
  const remote = usePaged(scopeId, load, onUnauthorized);
  const loadRoles = useCallback((signal: AbortSignal) => project ? api.projectRoles(planzoneId, signal) : Promise.resolve([] as ProjectRole[]), [api, planzoneId, project]);
  const roles = useRemote(scopeId, loadRoles, onUnauthorized);
  const action = useAction(onUnauthorized);
  const [resourceId, setResourceId] = useState("");
  const [roleId, setRoleId] = useState("");
  const candidate = remote.data?.items.find(item => item.resourceId === resourceId);
  const valid = candidate && (!project || validMemberRole(candidate, roleId || null));
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    void action.run(signal => project
      ? api.addProjectMember(planzoneId, scopeId, { resourceId, roleId: roleId || null }, signal)
      : api.addZoneMember(planzoneId, scopeId, resourceId, signal), props.saved);
  }
  return <Dialog title={project ? "Ajouter un membre au projet" : "Ajouter un membre à la zone"} busy={action.busy} close={props.close}>
    <label>Rechercher une ressource par début de nom<input type="search" value={remote.prefix} disabled={action.busy} onChange={event => { remote.search(event.target.value); setResourceId(""); setRoleId(""); }} /></label>
    {remote.loading || roles.loading ? <Loading /> : remote.error || roles.error ? <ErrorNotice error={remote.error ?? roles.error} reload={() => { remote.reload(); roles.reload(); }} /> : <form onSubmit={submit}>
      {remote.data?.items.length === 0 && <p>Aucune ressource disponible pour cette recherche.</p>}
      <fieldset disabled={action.busy}><label>Ressource<select value={resourceId} required onChange={event => { setResourceId(event.target.value); setRoleId(""); }}>
        <option value="">Sélectionner une ressource</option>
        {remote.data?.items.map(item => <option key={item.resourceId} value={item.resourceId}>{item.name} · {resourceLabels[item.type]}</option>)}
      </select></label>
      {project && candidate && <RoleSelect member={candidate} roles={roles.data ?? []} value={roleId} change={setRoleId} disabled={action.busy} />}
      {project && candidate?.type === "HUMAN" && allowedRoles(candidate, roles.data ?? []).length === 0 && <p>Aucun rôle autorisé pour cette ressource.</p>}
      <Pagination count={remote.data?.items.length ?? 0} hasNext={!!remote.data?.next} hasPrevious={remote.hasPrevious} next={() => { remote.next(); setResourceId(""); setRoleId(""); }} previous={() => { remote.previous(); setResourceId(""); setRoleId(""); }} />
      </fieldset>
      {!!action.error && <ErrorNotice error={action.error} reload={props.reload} />}
      <footer><button type="button" disabled={action.busy} onClick={props.close}>Annuler</button><button type="submit" disabled={!valid || action.busy}>{action.busy ? "Ajout…" : "Ajouter"}</button></footer>
    </form>}
  </Dialog>;
}

export function EditMemberDialog(props: DialogProps & { member: ProjectMember; roles: ProjectRole[] }) {
  const { member, roles, api, planzoneId, scopeId } = props;
  const [roleId, setRoleId] = useState(member.roleId ?? "");
  const [deactivated, setDeactivated] = useState(member.deactivated);
  const action = useAction(props.onUnauthorized);
  const conflict = errorDetails(action.error).status === 409 || errorDetails(action.error).code === "VERSION_CONFLICT";
  function submit(event: FormEvent) {
    event.preventDefault();
    if (conflict || !validMemberRole(member, roleId || null)) return;
    void action.run(signal => api.updateProjectMember(planzoneId, scopeId, member.resourceId, {
      roleId: roleId || null, deactivated, expectedVersion: member.version,
    }, signal), props.saved);
  }
  return <Dialog title={"Modifier le membre : " + member.name} busy={action.busy} close={props.close}>
    <form onSubmit={submit}><fieldset disabled={action.busy}>
      <RoleSelect member={member} roles={roles} value={roleId} change={setRoleId} disabled={action.busy} />
      <label className="ps-checkbox"><input type="checkbox" checked={!deactivated} onChange={event => setDeactivated(!event.target.checked)} />Actif dans le projet</label>
    </fieldset>
    {!!action.error && <ErrorNotice error={action.error} reload={props.reload} />}
    <footer><button type="button" onClick={props.close} disabled={action.busy}>Annuler</button><button type="submit" disabled={action.busy || conflict || !validMemberRole(member, roleId || null)}>{action.busy ? "Enregistrement…" : "Enregistrer"}</button></footer></form>
  </Dialog>;
}

export function RemoveMemberDialog(props: DialogProps & { resourceId: string; name: string }) {
  const action = useAction(props.onUnauthorized);
  return <Dialog title={"Retirer " + props.name} busy={action.busy} close={props.close}>
    <p>{props.project ? "Ce membre sera retiré de l’équipe du projet. Son accès à la zone sera conservé." : "Ce membre sera retiré de la zone et simultanément de toutes les équipes projet de cette zone."}</p>
    {!!action.error && <ErrorNotice error={action.error} reload={props.reload} />}
    <footer><button type="button" disabled={action.busy} onClick={props.close}>Annuler</button><button type="button" className="ps-danger" disabled={action.busy} onClick={() => void action.run(signal => props.project
      ? props.api.removeProjectMember(props.planzoneId, props.scopeId, props.resourceId, signal)
      : props.api.removeZoneMember(props.planzoneId, props.scopeId, props.resourceId, signal), props.saved)}>{action.busy ? "Retrait…" : "Confirmer le retrait"}</button></footer>
  </Dialog>;
}
