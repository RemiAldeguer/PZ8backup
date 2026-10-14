package com.planzone.pz8.api;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** Scoped fixtures only; no organization or account is provisioned by production code. */
final class ScopeBrowserSeed {
  private ScopeBrowserSeed() {}

  static Map<String, Object> install(HttpAccessFixture fixture, HttpAccessFixture.Tenant tenant)
      throws Exception {
    var manager = fixture.oidc.account("manager@example.test", true);
    var session = new HttpAccessFixture.Browser(fixture.api);
    session.login(fixture.oidc, manager, "/access");
    UUID identity = fixture.identity(manager);
    fixture.member(tenant.id(), identity, "user");
    UUID human = UUID.randomUUID();
    UUID virtual = UUID.randomUUID();
    UUID zone = UUID.randomUUID();
    UUID project = UUID.randomUUID();
    UUID privateProject = UUID.randomUUID();
    fixture.owner.update(
        "insert into pz8.resources(planzone_id,id,name,type,identity_id) values (?,?,?,'HUMAN',?)",
        tenant.id(),
        human,
        "Responsable projet",
        identity);
    fixture.owner.update(
        "insert into pz8.resources(planzone_id,id,name,type) values (?,?,?,'VIRTUAL')",
        tenant.id(),
        virtual,
        "Expertise partagée");
    fixture.owner.update(
        "insert into pz8.zones(planzone_id,id,name) values (?,?,?)",
        tenant.id(),
        zone,
        "Zone recette");
    fixture.owner.update(
        "insert into pz8.projects(planzone_id,id,zone_id,name,status_code) values (?,?,?,?,'pz_open')",
        tenant.id(),
        project,
        zone,
        "Projet partagé");
    fixture.owner.update(
        "insert into pz8.projects(planzone_id,id,zone_id,name,status_code) values (?,?,?,?,'pz_open')",
        tenant.id(),
        privateProject,
        zone,
        "Projet confidentiel");
    UUID managerRole = role(fixture, tenant, "pr_manager");
    fixture.owner.update(
        "insert into pz8.zone_members(planzone_id,zone_id,resource_id) values (?,?,?)",
        tenant.id(),
        zone,
        human);
    fixture.owner.update(
        "insert into pz8.project_members(planzone_id,project_id,resource_id,role_id) values (?,?,?,?)",
        tenant.id(),
        project,
        human,
        managerRole);
    var state = new LinkedHashMap<String, Object>();
    state.put("scopeZoneId", zone);
    state.put("scopeProjectId", project);
    state.put("scopePrivateProjectId", privateProject);
    state.put("scopeManagerResourceId", human);
    state.put("scopeCandidateResourceId", virtual);
    state.put("scopeWorkerRoleId", role(fixture, tenant, "pr_worker"));
    state.put("scopeVisitorRoleId", role(fixture, tenant, "pr_visitor"));
    return state;
  }

  private static UUID role(
      HttpAccessFixture fixture, HttpAccessFixture.Tenant tenant, String name) {
    return fixture.owner.queryForObject(
        "select id from pz8.project_roles where planzone_id=? and name=?",
        UUID.class,
        tenant.id(),
        name);
  }
}
