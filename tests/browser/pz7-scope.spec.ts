import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Candidate, ProjectMember, ProjectSummary, ScopeQuery, ZoneSummary } from "../../src/pz7-scope/client";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let javascript = "", stylesheet = "";
test.beforeAll(async () => {
  const result = await build({ absWorkingDir: repository, stdin: {
    sourcefile: "scope-fixture.tsx", resolveDir: repository, loader: "tsx", contents: `
      import React, {useState, useCallback} from 'react';
      import {createRoot} from 'react-dom/client';
      import {Pz7ScopePanels, type ScopeApi} from './src/pz7-scope';
      window.fixtureAbortCount = 0;
      window.fixtureCompletedZonesAlpha = 0;
      async function call(method, id, scopeId, signal, query, body) {
        signal.addEventListener('abort', () => window.fixtureAbortCount++, {once:true});
        // Ignore cancellation on purpose: the UI must also ignore late results.
        const response = await fetch('/scope-fixture/'+method, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,scopeId,query,body})});
        if (!response.ok) throw Object.assign(new Error('Fixture error'), await response.json(), {status:response.status});
        const result = response.status === 204 ? undefined : await response.json();
        if(method === 'listZones' && id === 'alpha') window.fixtureCompletedZonesAlpha++;
        return result;
      }
      const api: ScopeApi = {
        listZones:(id,s,q)=>call('listZones',id,null,s,q),
        listProjects:(id,z,s,q)=>call('listProjects',id,z,s,q),
        zoneMembers:(id,z,s,q)=>call('zoneMembers',id,z,s,q),
        projectMembers:(id,p,s,q)=>call('projectMembers',id,p,s,q),
        zoneCandidates:(id,z,s,q)=>call('zoneCandidates',id,z,s,q),
        projectCandidates:(id,p,s,q)=>call('projectCandidates',id,p,s,q),
        projectRoles:(id,s)=>call('projectRoles',id,null,s),
        addZoneMember:(id,z,r,s)=>call('addZoneMember',id,z,s,null,{resourceId:r}),
        removeZoneMember:(id,z,r,s)=>call('removeZoneMember',id,z,s,null,{resourceId:r}),
        addProjectMember:(id,p,b,s)=>call('addProjectMember',id,p,s,null,b),
        updateProjectMember:(id,p,r,b,s)=>call('updateProjectMember',id,p,s,null,{resourceId:r,...b}),
        removeProjectMember:(id,p,r,s)=>call('removeProjectMember',id,p,s,null,{resourceId:r})
      };
      function FixtureHost(){
        const [id,setId]=useState('alpha'), [expired,setExpired]=useState(false);
        window.switchTenant=()=>setId('beta');
        const unauthorized=useCallback(()=>setExpired(true),[]);
        return <><Pz7ScopePanels api={api} planzoneId={id} onUnauthorized={unauthorized}/>{expired&&<p>Session à renouveler</p>}</>;
      }
      createRoot(document.getElementById('root')).render(<FixtureHost/>);
    ` }, bundle: true, write: false, outfile: "/tmp/pz7-scope-fixture.js", platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
  javascript = result.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  stylesheet = result.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
});

interface Call { method: string; id: string; scopeId: string | null; query?: ScopeQuery; body?: Record<string, unknown> }
const roles = [
  { id: "manager", name: "pr_manager", label: "Chef de projet" },
  { id: "worker", name: "pr_worker", label: "Collaborateur" },
  { id: "visitor", name: "pr_visitor", label: "Observateur" },
];
const zone: ZoneSummary = { id: "zone-alpha", planzoneId: "alpha", name: "Zone Alpha", savingTemplates: false, version: 1, permissions: ["zonemember:delete"] };
const readonlyProject: ProjectSummary = { id: "readonly", planzoneId: "alpha", zoneId: zone.id, name: "Projet consultation", template: false, version: 1, permissions: [], editableFields: [] };
const project: ProjectSummary = { ...readonlyProject, id: "managed", zoneId: "zone-not-listed", name: "Projet autonome", permissions: ["projectmember:create", "projectmember:update", "projectmember:delete"] };
const member: ProjectMember = { resourceId: "camille", name: "Camille", type: "HUMAN", roleId: "worker", deactivated: false, version: 7, allowedRoleIds: ["worker", "manager"] };
const candidate: Candidate = { resourceId: "invited-visitor", name: "Visiteur autorisé", type: "HUMAN", allowedRoleIds: ["visitor"] };

class Fixture {
  calls: Call[] = [];
  conflict = false;
  delayZones = false;
  private releaseLate!: () => void;
  private lateStarted!: () => void;
  readonly started = new Promise<void>(done => { this.lateStarted = done; });
  readonly delayed = new Promise<void>(done => { this.releaseLate = done; });
  release() { this.releaseLate(); }
  mutations(method: string) { return this.calls.filter(call => call.method === method); }
  async mount(page: Page) {
    await page.route("**/scope-test", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="fr"><link rel="stylesheet" href="/scope-fixture.css"><div id="root"></div><script src="/scope-fixture.js"></script></html>' }));
    await page.route("**/scope-fixture.js", route => route.fulfill({ contentType: "application/javascript", body: javascript }));
    await page.route("**/scope-fixture.css", route => route.fulfill({ contentType: "text/css", body: stylesheet }));
    await page.route("**/scope-fixture/*", async route => {
      const call = { ...route.request().postDataJSON(), method: new URL(route.request().url()).pathname.split("/").at(-1)! } as Call;
      this.calls.push(call);
      const send = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (call.method === "projectRoles") return send(roles);
      if (call.method === "listZones") {
        if (call.id === "alpha" && this.delayZones) { this.lateStarted(); await this.delayed; }
        return send({ items: call.id === "alpha" ? [zone] : [{ ...zone, id: "zone-beta", planzoneId: "beta", name: "Zone Bêta", permissions: [] }], next: null });
      }
      if (call.method === "listProjects") return send({ items: call.id === "alpha" ? [readonlyProject, project] : [{ ...readonlyProject, id: "beta-project", planzoneId: "beta", zoneId: "zone-beta", name: "Projet Bêta" }], next: null });
      if (call.method === "zoneMembers") return send({ items: [{ resourceId: "zone-member", name: "Membre de zone", type: "VIRTUAL" }], next: null });
      if (call.method === "projectMembers") {
        if (call.id === "beta") return send({ code: "SESSION_EXPIRED" }, 401);
        const current = { ...member, version: this.conflict ? 8 : 7 };
        return send(call.query?.after ? { items: [{ ...current, resourceId: "next", name: "Membre suivant", type: "MATERIAL", roleId: null }], next: null } : { items: [current], next: { name: member.name, id: member.resourceId } });
      }
      if (call.method === "projectCandidates") {
        if (call.query?.namePrefix) return send({ items: [candidate], next: null });
        return send(call.query?.after ? { items: [candidate], next: null } : { items: [{ resourceId: "machine", name: "Machine", type: "MATERIAL", allowedRoleIds: [] }], next: { name: "Machine", id: "machine" } });
      }
      if (call.method === "addProjectMember") return send({ code: "ACCESS_DENIED" }, 403);
      if (call.method === "updateProjectMember") { this.conflict = true; return send({ code: "VERSION_CONFLICT" }, 409); }
      if (call.method === "removeZoneMember") return route.fulfill({ status: 204 });
      return send({ code: "NOT_FOUND" }, 404);
    });
    await page.goto("/scope-test");
  }
}

test("droits par objet, pagination, refus et conflit sans rejeu, puis isolation après changement de Planzone", async ({ page }) => {
  const fixture = new Fixture();
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await fixture.mount(page);
  await page.getByRole("button", { name: "Voir les membres du projet Projet consultation", exact: true }).click();
  let team = page.getByRole("region", { name: "Membres du projet Projet consultation", exact: true });
  await expect(team.getByText("Camille", { exact: true })).toBeVisible();
  await expect(team.getByRole("button", { name: /Ajouter|Modifier|Retirer/ })).toHaveCount(0);
  // This project's zone is not visible; project access is nevertheless authoritative.
  await page.getByRole("button", { name: "Voir les membres du projet Projet autonome", exact: true }).click();
  team = page.getByRole("region", { name: "Membres du projet Projet autonome", exact: true });
  await team.getByRole("button", { name: "Charger la suite" }).click();
  await expect(team.getByText("Membre suivant", { exact: true })).toBeVisible();
  expect(fixture.calls.filter(call => call.method === "projectMembers").at(-1)?.query).toMatchObject({ after: { name: "Camille", id: "camille" }, limit: 25 });
  await team.getByRole("button", { name: "Page précédente" }).click();
  await team.getByRole("button", { name: "Ajouter un membre au projet", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Ressource", exact: true }).selectOption("machine");
  await expect(dialog.getByRole("button", { name: "Ajouter", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Charger la suite" }).click();
  await dialog.getByRole("searchbox").fill("Vi");
  await expect(dialog.getByRole("combobox", { name: "Ressource", exact: true }).getByRole("option", { name: /Visiteur autorisé/ })).toHaveCount(1);
  await dialog.getByRole("combobox", { name: "Ressource", exact: true }).selectOption(candidate.resourceId);
  const role = dialog.getByRole("combobox", { name: "Rôle dans le projet" });
  await expect(role.getByRole("option", { name: "Chef de projet" })).toHaveCount(0);
  await role.selectOption("visitor");
  await dialog.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("pas l’autorisation");
  expect(fixture.mutations("addProjectMember")).toHaveLength(1);
  expect(fixture.mutations("addProjectMember")[0].body).toEqual({ resourceId: candidate.resourceId, roleId: "visitor" });
  expect(fixture.calls.some(call => call.method === "projectCandidates" && call.query?.namePrefix === "Vi")).toBe(true);
  await dialog.getByRole("button", { name: "Annuler" }).click();
  await team.getByRole("button", { name: "Modifier Camille", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox", { name: "Actif dans le projet" }).uncheck();
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Aucune modification n’a été renvoyée automatiquement");
  await expect(dialog.getByRole("button", { name: "Enregistrer", exact: true })).toBeDisabled();
  expect(fixture.mutations("updateProjectMember")).toHaveLength(1);
  expect(fixture.mutations("updateProjectMember")[0].body).toMatchObject({ expectedVersion: 7, roleId: "worker", deactivated: true });
  await dialog.getByRole("button", { name: "Recharger les informations" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(team.getByText("Camille", { exact: true })).toBeVisible();
  expect(fixture.mutations("updateProjectMember")).toHaveLength(1);
  await page.getByRole("button", { name: "Voir les membres de la zone Zone Alpha", exact: true }).click();
  await page.getByRole("button", { name: "Retirer Membre de zone de la zone", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("simultanément de toutes les équipes projet de cette zone");
  expect(fixture.mutations("removeZoneMember")).toHaveLength(0);
  await dialog.getByRole("button", { name: "Annuler" }).click();
  fixture.delayZones = true;
  const completedBefore = await page.evaluate(() => (window as unknown as { fixtureCompletedZonesAlpha: number }).fixtureCompletedZonesAlpha);
  await page.getByRole("button", { name: "Actualiser les zones" }).click();
  await fixture.started;
  await page.evaluate(() => (window as unknown as { switchTenant: () => void }).switchTenant());
  await expect(page.getByRole("button", { name: "Voir les membres de la zone Zone Bêta", exact: true })).toBeVisible();
  await expect(page.getByText("Projet autonome", { exact: true })).toHaveCount(0);
  fixture.release();
  await expect.poll(() => page.evaluate(() => (window as unknown as { fixtureCompletedZonesAlpha: number }).fixtureCompletedZonesAlpha)).toBeGreaterThan(completedBefore);
  await expect(page.getByText("Zone Alpha", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Voir les membres du projet Projet Bêta", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Reconnectez-vous");
  await expect(page.getByText("Session à renouveler", { exact: true })).toBeVisible();
  expect(fixture.calls.filter(call => call.method === "projectMembers" && call.id === "beta")).toHaveLength(1);
  expect(await page.evaluate(() => (window as unknown as { fixtureAbortCount: number }).fixtureAbortCount)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
