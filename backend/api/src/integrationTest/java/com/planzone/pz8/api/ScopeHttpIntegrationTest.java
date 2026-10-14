package com.planzone.pz8.api;

import static com.planzone.pz8.api.HttpAccessFixture.json;
import static com.planzone.pz8.api.HttpAccessFixture.objects;
import static org.assertj.core.api.Assertions.assertThat;

import com.planzone.pz8.api.HttpAccessFixture.Browser;
import com.planzone.pz8.api.HttpAccessFixture.Tenant;
import java.net.http.HttpResponse;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;

/** Real HTTP scope authority for an OIDC account with a local human profile. */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class ScopeHttpIntegrationTest {
  private HttpAccessFixture fixture;

  @BeforeAll
  void start() throws Exception {
    fixture = new HttpAccessFixture();
  }

  @AfterAll
  void stop() {
    if (fixture != null) fixture.close();
  }

  @Test
  void managerCanAssociateAccountlessResourcesOnlyInHisProjectAndLosesAuthorityWhenDeactivated()
      throws Exception {
    var adminAccount = fixture.oidc.account("scope-admin@example.test", true);
    var admin = new Browser(fixture.api);
    admin.login(fixture.oidc, adminAccount, "/access");
    Tenant tenant = fixture.tenant(fixture.identity(adminAccount), "Scope HTTP client");
    Tenant foreign = fixture.tenant(fixture.identity(adminAccount), "Foreign HTTP client");
    var managerAccount = fixture.oidc.account("scope-manager@example.test", true);
    var manager = new Browser(fixture.api);
    manager.login(fixture.oidc, managerAccount, "/access");
    UUID managerIdentity = fixture.identity(managerAccount);
    fixture.member(tenant.id(), managerIdentity, "user");

    UUID human = resource(tenant, "HUMAN", "Project manager", managerIdentity);
    UUID virtual = resource(tenant, "VIRTUAL", "Virtual specialist", null);
    UUID material = resource(tenant, "MATERIAL", "Project equipment", null);
    UUID unassignedHuman = resource(tenant, "HUMAN", "Unassigned colleague", null);
    UUID foreignResource = resource(foreign, "MATERIAL", "Foreign private equipment", null);
    UUID zone = zone(tenant, "Visible zone");
    UUID projectA = project(tenant, zone, "Managed project A");
    UUID projectB = project(tenant, zone, "Unmanaged project B");
    UUID foreignZone = zone(foreign, "Foreign private zone");
    UUID foreignProject = project(foreign, foreignZone, "Foreign private project");
    UUID managerRole = projectRole(tenant, "pr_manager");
    fixture.owner.update(
        "insert into pz8.zone_members(planzone_id, zone_id, resource_id) values (?, ?, ?)",
        tenant.id(),
        zone,
        human);
    fixture.owner.update(
        "insert into pz8.project_members(planzone_id, project_id, resource_id, role_id) values (?, ?, ?, ?)",
        tenant.id(),
        projectA,
        human,
        managerRole);

    error(manager.get(tenant.path("/resources")), 403, "ACCESS_DENIED");
    assertThat(ids(manager, tenant.path("/zones"), "id")).containsExactly(zone.toString());
    assertThat(ids(manager, tenant.path("/projects?zoneId=" + zone), "id"))
        .containsExactly(projectA.toString());
    error(manager.get(tenant.path("/projects/" + projectB + "/members")), 404, "NOT_FOUND");
    error(
        manager.get(tenant.path("/projects/" + projectB + "/member-candidates")), 404, "NOT_FOUND");
    error(manager.get(foreign.path("/zones")), 403, "ACCESS_DENIED");
    error(
        manager.get(foreign.path("/projects/" + foreignProject + "/members")),
        403,
        "ACCESS_DENIED");
    error(manager.get(tenant.path("/projects/" + foreignProject + "/members")), 404, "NOT_FOUND");

    String team = tenant.path("/projects/" + projectA + "/members");
    String candidates = tenant.path("/projects/" + projectA + "/member-candidates");
    assertThat(ids(manager, candidates, "resourceId"))
        .contains(virtual.toString(), material.toString(), unassignedHuman.toString())
        .doesNotContain(foreignResource.toString(), human.toString());
    error(
        manager.write("POST", team, Map.of("resourceId", foreignResource.toString())),
        404,
        "NOT_FOUND");
    var roles = manager.get(tenant.path("/project-roles"));
    assertThat(roles.statusCode()).as(roles.body()).isEqualTo(200);
    assertThat(roles.body())
        .contains(managerRole.toString(), "pr_worker", "pr_visitor")
        .doesNotContain("pz_admin", projectRole(foreign, "pr_manager").toString());

    for (UUID unavailableRole :
        List.of(fixture.role(tenant, "pz_admin"), projectRole(foreign, "pr_worker"))) {
      error(
          manager.write(
              "POST",
              team,
              Map.of(
                  "resourceId", unassignedHuman.toString(), "roleId", unavailableRole.toString())),
          404,
          "NOT_FOUND");
    }
    assertThat(ids(manager, team, "resourceId")).containsExactly(human.toString());
    assertThat(
            fixture.owner.queryForObject(
                "select count(*) from pz8.project_members where planzone_id = ? and project_id = ? and resource_id = ?",
                Long.class,
                tenant.id(),
                projectA,
                unassignedHuman))
        .isZero();

    var virtualMember = manager.write("POST", team, Map.of("resourceId", virtual.toString()));
    assertThat(virtualMember.statusCode()).as(virtualMember.body()).isEqualTo(201);
    assertThat(json(virtualMember).get("type")).isEqualTo("VIRTUAL");
    assertThat(json(virtualMember).get("roleId")).isNull();
    var materialMember = manager.write("POST", team, Map.of("resourceId", material.toString()));
    assertThat(materialMember.statusCode()).as(materialMember.body()).isEqualTo(201);
    assertThat(json(materialMember).get("type")).isEqualTo("MATERIAL");
    assertThat(json(materialMember).get("roleId")).isNull();
    assertThat(ids(manager, team, "resourceId"))
        .containsExactlyInAnyOrder(human.toString(), virtual.toString(), material.toString());
    assertThat(ids(manager, tenant.path("/zones/" + zone + "/members"), "resourceId"))
        .containsExactlyInAnyOrder(human.toString(), virtual.toString(), material.toString());

    String materialMembership = team + "/" + material;
    error(
        manager.write("PUT", materialMembership, Map.of("deactivated", true, "expectedVersion", 0)),
        400,
        "INVALID_INPUT");
    error(
        manager.write("PUT", materialMembership, update(null, true, 99)), 409, "VERSION_CONFLICT");
    Map<String, Object> unchanged =
        members(manager, team).stream()
            .filter(member -> material.toString().equals(member.get("resourceId")))
            .findFirst()
            .orElseThrow();
    assertThat(unchanged.get("deactivated")).isEqualTo(false);
    assertThat(((Number) unchanged.get("version")).longValue()).isZero();
    var updated = manager.write("PUT", materialMembership, update(null, true, 0));
    assertThat(updated.statusCode()).as(updated.body()).isEqualTo(200);
    assertThat(json(updated).get("deactivated")).isEqualTo(true);
    assertThat(((Number) json(updated).get("version")).longValue()).isEqualTo(1);

    var deactivatedManager = admin.write("PUT", team + "/" + human, update(managerRole, true, 0));
    assertThat(deactivatedManager.statusCode()).as(deactivatedManager.body()).isEqualTo(200);
    assertThat(json(deactivatedManager).get("deactivated")).isEqualTo(true);
    error(manager.get(candidates), 404, "NOT_FOUND");
    error(
        manager.write(
            "POST",
            team,
            Map.of(
                "resourceId",
                unassignedHuman.toString(),
                "roleId",
                projectRole(tenant, "pr_worker").toString())),
        404,
        "NOT_FOUND");
    assertThat(
            fixture.owner.queryForObject(
                "select count(*) from pz8.project_members where planzone_id = ? and project_id = ? and resource_id = ?",
                Long.class,
                tenant.id(),
                projectA,
                unassignedHuman))
        .isZero();
  }

  private UUID resource(Tenant tenant, String type, String name, UUID identity) {
    UUID id = UUID.randomUUID();
    fixture.owner.update(
        "insert into pz8.resources(planzone_id, id, name, type, identity_id, role_id) values (?, ?, ?, ?, ?, ?)",
        tenant.id(),
        id,
        name,
        type,
        identity,
        "HUMAN".equals(type) ? fixture.role(tenant, "pz_user") : null);
    return id;
  }

  private UUID zone(Tenant tenant, String name) {
    UUID id = UUID.randomUUID();
    fixture.owner.update(
        "insert into pz8.zones(planzone_id, id, name) values (?, ?, ?)", tenant.id(), id, name);
    return id;
  }

  private UUID project(Tenant tenant, UUID zone, String name) {
    UUID id = UUID.randomUUID();
    fixture.owner.update(
        "insert into pz8.projects(planzone_id, id, zone_id, name) values (?, ?, ?, ?)",
        tenant.id(),
        id,
        zone,
        name);
    return id;
  }

  private UUID projectRole(Tenant tenant, String name) {
    return fixture.owner.queryForObject(
        "select id from pz8.project_roles where planzone_id = ? and name = ?",
        UUID.class,
        tenant.id(),
        name);
  }

  private static Map<String, Object> update(UUID role, boolean deactivated, long version) {
    Map<String, Object> request = new LinkedHashMap<>();
    request.put("roleId", role == null ? null : role.toString());
    request.put("deactivated", deactivated);
    request.put("expectedVersion", version);
    return request;
  }

  private static List<Map<String, Object>> members(Browser browser, String path) throws Exception {
    var response = browser.get(path);
    assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
    return objects(json(response), "items");
  }

  private static List<String> ids(Browser browser, String path, String key) throws Exception {
    return members(browser, path).stream().map(row -> (String) row.get(key)).toList();
  }

  private static void error(HttpResponse<String> response, int status, String code)
      throws Exception {
    assertThat(response.statusCode()).as(response.body()).isEqualTo(status);
    assertThat(json(response).get("code")).isEqualTo(code);
  }
}
