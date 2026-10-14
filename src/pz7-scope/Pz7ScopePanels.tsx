import { useCallback, useState } from "react";
import type { ProjectSummary, ScopeApi, ScopeQuery, ZoneSummary } from "./client";
import { checkedScopePage } from "./domain/scope-page";
import { Pagination, usePaged } from "./presentation/pagination";
import { ZoneMembers } from "./presentation/ZoneMembers";
import { ProjectMembers } from "./presentation/ProjectMembers";
import { ErrorNotice, Loading } from "./presentation/ui";
import "./scope.css";

export interface Pz7ScopePanelsProps { api: ScopeApi; planzoneId: string; onUnauthorized: () => void }

/** Remount is deliberate: no previous tenant data, forms or pending writes survive. */
export function Pz7ScopePanels(props: Pz7ScopePanelsProps) {
  return <div className="pz7-scope" lang="fr">{props.planzoneId ? <ScopeWorkspace key={props.planzoneId} {...props} /> : <p>Sélectionnez une Planzone pour consulter ses zones et projets.</p>}</div>;
}

function ScopeWorkspace({ api, planzoneId, onUnauthorized }: Pz7ScopePanelsProps) {
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [zoneFilter, setZoneFilter] = useState<string | null>(null);
  const loadZones = useCallback(async (signal: AbortSignal, query: ScopeQuery) => checkedScopePage(await api.listZones(planzoneId, signal, query), planzoneId), [api, planzoneId]);
  const zones = usePaged("zones", loadZones, onUnauthorized);
  const loadProjects = useCallback(async (signal: AbortSignal, query: ScopeQuery) => checkedScopePage(await api.listProjects(planzoneId, zoneFilter, signal, query), planzoneId, zoneFilter), [api, planzoneId, zoneFilter]);
  const projects = usePaged("projects" + zoneFilter, loadProjects, onUnauthorized);
  const zone = zones.data?.items.find(item => item.id === selectedZone);
  const project = projects.data?.items.find(item => item.id === selectedProject);
  return <div className="ps-panels">
    <section className="ps-panel" aria-label="Zones">
      <header><h2>Zones</h2><button type="button" onClick={zones.reload}>Actualiser les zones</button></header>
      <label>Rechercher une zone par début de nom<input type="search" value={zones.prefix} onChange={event => { zones.search(event.target.value); setSelectedZone(null); }} /></label>
      {zones.loading ? <Loading /> : zones.error ? <ErrorNotice error={zones.error} reload={zones.reload} /> : <>
        {zones.data?.items.length === 0 ? <p>Aucune zone accessible pour cette recherche.</p> : <ScopeList items={zones.data?.items ?? []} selected={selectedZone} select={setSelectedZone} kind="zone" />}
        <Pagination count={zones.data?.items.length ?? 0} hasNext={!!zones.data?.next} hasPrevious={zones.hasPrevious} next={() => { zones.next(); setSelectedZone(null); }} previous={() => { zones.previous(); setSelectedZone(null); }} />
      </>}
      {zone && <>
        <button type="button" onClick={() => { setZoneFilter(zone.id); setSelectedProject(null); }}>Filtrer les projets de cette zone</button>
        <ZoneMembers key={zone.id} api={api} planzoneId={planzoneId} scope={zone} onUnauthorized={onUnauthorized} refreshScopes={zones.reload} />
      </>}
    </section>
    <section className="ps-panel" aria-label="Projets">
      <header><h2>Projets</h2><button type="button" onClick={projects.reload}>Actualiser les projets</button></header>
      <p>{zoneFilter ? "Projets accessibles de la zone sélectionnée" : "Tous les projets auxquels vous avez accès"}</p>
      {zoneFilter && <button type="button" onClick={() => { setZoneFilter(null); setSelectedProject(null); }}>Voir tous les projets accessibles</button>}
      <label>Rechercher un projet par début de nom<input type="search" value={projects.prefix} onChange={event => { projects.search(event.target.value); setSelectedProject(null); }} /></label>
      {projects.loading ? <Loading /> : projects.error ? <ErrorNotice error={projects.error} reload={projects.reload} /> : <>
        {projects.data?.items.length === 0 ? <p>Aucun projet accessible pour cette recherche.</p> : <ScopeList items={projects.data?.items ?? []} selected={selectedProject} select={setSelectedProject} kind="project" />}
        <Pagination count={projects.data?.items.length ?? 0} hasNext={!!projects.data?.next} hasPrevious={projects.hasPrevious} next={() => { projects.next(); setSelectedProject(null); }} previous={() => { projects.previous(); setSelectedProject(null); }} />
      </>}
      {project && <ProjectMembers key={project.id} api={api} planzoneId={planzoneId} scope={project} onUnauthorized={onUnauthorized} refreshScopes={projects.reload} />}
    </section>
  </div>;
}

function ScopeList({ items, selected, select, kind }: { items: (ZoneSummary | ProjectSummary)[]; selected: string | null; select: (id: string) => void; kind: "zone" | "project" }) {
  return <ul className="ps-scope-list">{items.map(item => <li key={item.id}>
    <button type="button" aria-label={"Voir les membres " + (kind === "zone" ? "de la zone " : "du projet ") + item.name} aria-pressed={selected === item.id} onClick={() => select(item.id)}>
      <span>{item.name}</span>{"template" in item && item.template && <small>Modèle de projet</small>}{"savingTemplates" in item && item.savingTemplates && <small>Zone de modèles</small>}
    </button>
  </li>)}</ul>;
}
