package com.planzone.pz8.platform.jdbc;

import static org.junit.jupiter.api.Assertions.*;

import com.planzone.pz8.access.RoleNotAvailableException;
import com.planzone.pz8.people.CreateResource;
import com.planzone.pz8.people.RegisterMemberResource;
import com.planzone.pz8.people.ResourceNotFoundException;
import com.planzone.pz8.people.ResourceProfile;
import com.planzone.pz8.people.ResourceQuery;
import com.planzone.pz8.people.ResourceService;
import com.planzone.pz8.people.ResourceType;
import com.planzone.pz8.planzones.PlanzoneAccessDeniedException;
import com.planzone.pz8.planzones.PlanzoneContext;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;

class AccessIntegrationTest {
  private static PostgresFixture database;
  private static PlanzoneUnitOfWork unitOfWork;
  private static ResourceService resources;
  private static JdbcAccessService access;
  private static JdbcTemplate owner;

  @BeforeAll
  static void install() throws Exception {
    database = new PostgresFixture();
    unitOfWork = new PlanzoneUnitOfWork(database.runtime);
    resources = new ResourceService(new JdbcPeopleWork(unitOfWork));
    access = new JdbcAccessService(unitOfWork);
    owner = new JdbcTemplate(database.owner);
  }

  @AfterAll
  static void shutdown() {
    if (database != null) database.close();
  }

  @Test
  void defaultsKeepResourceCreationSeparateFromScreenAccessAndInvitationManagement() {
    var tenant = database.tenant();
    var adminPolicy = access.get(tenant.administrator());
    assertEquals(
        Set.of(
            "resource:read",
            "resource:create",
            "resource:edit",
            "resource:manage-access",
            "invitation:manage"),
        adminPolicy.permissions());
    assertTrue(adminPolicy.canManageRoles());
    assertEquals(
        Set.of("pz_admin", "pz_under_admin", "pz_user", "pz_visitor"),
        adminPolicy.roles().stream()
            .map(role -> role.name())
            .collect(java.util.stream.Collectors.toSet()));
    var memberPolicy = access.get(tenant.member());
    assertEquals(Set.of("resource:create"), memberPolicy.permissions());
    assertFalse(memberPolicy.canManageRoles());
    assertFalse(memberPolicy.editableResourceFields().contains("name"));
    assertTrue(memberPolicy.editableResourceFields().contains("integratedAt"));
    var human = register(tenant);
    assertEquals(role(tenant.administrator(), "pz_user"), human.roleId());
    assertTrue(human.nonEditableFields().isEmpty());

    owner.update(
        "update pz8.memberships set role = 'project_creator' where planzone_id = ? and identity_id = ?",
        tenant.member().planzoneId().value(),
        tenant.member().identityId().value());
    assertEquals(Set.of("resource:create"), access.get(tenant.member()).permissions());
    owner.update(
        "update pz8.memberships set role = 'visitor' where planzone_id = ? and identity_id = ?",
        tenant.member().planzoneId().value(),
        tenant.member().identityId().value());
    assertTrue(access.get(tenant.member()).permissions().isEmpty());
    assertThrows(
        PlanzoneAccessDeniedException.class, () -> create(tenant.member(), "Denied visitor"));
    assertEquals(1, count("resources", tenant.administrator()));
  }

  @Test
  void scopedCustomRoleAndExtraFieldRestrictionsAreEffectiveOnEveryFollowingCommand() {
    var tenant = database.tenant();
    var human = register(tenant);
    UUID customRole = UUID.randomUUID();
    owner.update(
        "insert into pz8.roles(planzone_id,id,name,label,coarse_role,privileges,uneditable_fields) "
            + "values (?, ?, 'local_editor', 'Éditeur local', 'user', "
            + "ARRAY['resource:create','resource:update'], ARRAY['description'])",
        tenant.administrator().planzoneId().value(),
        customRole);
    owner.update(
        "update pz8.access_settings set resource_allowed_roles = ARRAY['pz_admin','local_editor'] "
            + "where planzone_id = ?",
        tenant.administrator().planzoneId().value());
    access.assign(tenant.administrator(), human.id(), customRole, Set.of());
    assertEquals(
        Set.of("resource:read", "resource:create", "resource:edit"),
        access.get(tenant.member()).permissions());
    assertFalse(access.get(tenant.member()).editableResourceFields().contains("description"));
    assertFalse(access.get(tenant.member()).canManageRoles());
    var profile = resources.get(tenant.member(), human.id());
    var renamed =
        resources.rename(tenant.member(), human.id(), profile.version(), "Allowed editor");
    assertEquals("Allowed editor", renamed.name());
    assertEquals(customRole, renamed.roleId());
    assertEquals(
        customRole,
        owner.queryForObject(
            "select role_id from pz8.memberships where planzone_id = ? and identity_id = ?",
            UUID.class,
            tenant.member().planzoneId().value(),
            tenant.member().identityId().value()));
    assertEquals(
        "user",
        owner.queryForObject(
            "select role from pz8.memberships where planzone_id = ? and identity_id = ?",
            String.class,
            tenant.member().planzoneId().value(),
            tenant.member().identityId().value()));

    access.assign(tenant.administrator(), human.id(), customRole, Set.of("name"));
    var restricted = resources.get(tenant.member(), human.id());
    assertEquals(Set.of("name"), Set.copyOf(restricted.nonEditableFields()));
    assertFalse(access.get(tenant.member()).permissions().contains("resource:edit"));
    assertThrows(
        PlanzoneAccessDeniedException.class,
        () ->
            resources.rename(tenant.member(), human.id(), restricted.version(), "Blocked rename"));
    unitOfWork.executeJdbc(
        tenant.member(),
        scope -> {
          assertEquals(
              0,
              scope
                  .jdbc()
                  .update(
                      "update pz8.resources set name = 'SQL bypass' where id = ?",
                      human.id().value()));
          assertEquals(
              Boolean.FALSE,
              scope
                  .jdbc()
                  .queryForObject(
                      "select pz8.resource_field_editable(?, 'unqualifiedFutureField')",
                      Boolean.class,
                      tenant.member().planzoneId().value()));
          return null;
        });
    assertEquals(restricted, resources.get(tenant.administrator(), human.id()));
  }

  @Test
  void foreignRolesForeignProfilesAndUnknownFieldsCannotPartiallyChangeAccess() {
    var local = database.tenant();
    var foreign = database.tenant();
    var profile = register(local);
    var foreignProfile = register(foreign);
    UUID localRole = role(local.administrator(), "pz_visitor");
    UUID foreignRole = role(foreign.administrator(), "pz_admin");
    assertThrows(
        RoleNotAvailableException.class,
        () -> access.assign(local.administrator(), profile.id(), foreignRole, Set.of()));
    assertThrows(
        RoleNotAvailableException.class,
        () -> access.assign(local.administrator(), profile.id(), UUID.randomUUID(), Set.of()));
    assertThrows(
        ResourceNotFoundException.class,
        () -> access.assign(local.administrator(), foreignProfile.id(), localRole, Set.of()));
    assertThrows(
        IllegalArgumentException.class,
        () ->
            access.assign(local.administrator(), profile.id(), localRole, Set.of("unknownField")));
    assertThrows(
        PlanzoneAccessDeniedException.class,
        () ->
            access.assign(
                local.member(), profile.id(), role(local.administrator(), "pz_admin"), Set.of()));
    assertEquals(profile, resources.get(local.administrator(), profile.id()));
    assertEquals(foreignProfile, resources.get(foreign.administrator(), foreignProfile.id()));
    assertEquals(Set.of("resource:create"), access.get(local.member()).permissions());
    assertEquals(1, count("resource_audit", local.administrator()));
  }

  @Test
  void aLockedTargetProfileRejectsAdministratorRenameAndCanBeExplicitlyUnlocked() {
    var tenant = database.tenant();
    var target = create(tenant.administrator(), "Locked target");
    UUID selectedRole = role(tenant.administrator(), "pz_user");
    access.assign(tenant.administrator(), target.id(), selectedRole, Set.of("name"));
    var locked = resources.get(tenant.administrator(), target.id());
    int historyBefore = count("resource_audit", tenant.administrator());
    assertTrue(access.get(tenant.administrator()).permissions().contains("resource:edit"));
    assertThrows(
        PlanzoneAccessDeniedException.class,
        () ->
            resources.rename(tenant.administrator(), target.id(), locked.version(), "API bypass"));
    // Even a stale version reports the actual access refusal instead of an optimistic conflict.
    assertThrows(
        PlanzoneAccessDeniedException.class,
        () ->
            resources.rename(
                tenant.administrator(), target.id(), target.version(), "Stale bypass"));
    unitOfWork.executeJdbc(
        tenant.administrator(),
        scope -> {
          assertEquals(
              0,
              scope
                  .jdbc()
                  .update(
                      "update pz8.resources set name = 'SQL bypass', version = version + 1 where id = ?",
                      target.id().value()));
          return null;
        });
    assertEquals(locked, resources.get(tenant.administrator(), target.id()));
    assertEquals(historyBefore, count("resource_audit", tenant.administrator()));

    access.assign(tenant.administrator(), target.id(), selectedRole, Set.of());
    var unlocked = resources.get(tenant.administrator(), target.id());
    assertTrue(unlocked.nonEditableFields().isEmpty());
    var renamed =
        resources.rename(
            tenant.administrator(), target.id(), unlocked.version(), "Explicitly unlocked");
    assertEquals("Explicitly unlocked", renamed.name());
    assertEquals(unlocked.version() + 1, renamed.version());
    assertEquals(historyBefore + 2, count("resource_audit", tenant.administrator()));
  }

  @Test
  void roleChangesSynchronizeOldAuthorityAndRejectTheAlreadyCapturedContext() {
    var tenant = database.tenant();
    var human = register(tenant);
    access.assign(
        tenant.administrator(), human.id(), role(tenant.administrator(), "pz_admin"), Set.of());
    PlanzoneContext captured = tenant.member();
    assertTrue(access.get(captured).canManageRoles());
    var created = create(captured, "Before downgrade");
    access.assign(
        tenant.administrator(), human.id(), role(tenant.administrator(), "pz_visitor"), Set.of());
    assertEquals(
        "visitor",
        owner.queryForObject(
            "select role from pz8.memberships where planzone_id = ? and identity_id = ?",
            String.class,
            captured.planzoneId().value(),
            captured.identityId().value()));
    assertThrows(PlanzoneAccessDeniedException.class, () -> resources.get(captured, created.id()));
    assertThrows(PlanzoneAccessDeniedException.class, () -> create(captured, "After downgrade"));
    assertThrows(
        PlanzoneAccessDeniedException.class,
        () ->
            access.assign(
                captured, human.id(), role(tenant.administrator(), "pz_admin"), Set.of()));
    assertEquals(2, count("resources", tenant.administrator()));
  }

  @Test
  void anAuditFailureRollsBackProfileMembershipAndAuthorityVersionTogether() {
    var tenant = database.tenant();
    var human = register(tenant);
    UUID administratorRole = role(tenant.administrator(), "pz_admin");
    String suffix = UUID.randomUUID().toString().replace("-", "");
    String function = "pz8.test_access_audit_failure_" + suffix;
    String trigger = "test_access_audit_failure_" + suffix;
    owner.execute(
        "create function "
            + function
            + "() returns trigger language plpgsql as $$ begin "
            + "if NEW.planzone_id = '"
            + tenant.administrator().planzoneId().value()
            + "'::uuid and NEW.event_type = 'ACCESS_CHANGED' then raise exception 'injected audit failure'; "
            + "end if; return NEW; end $$");
    try {
      owner.execute(
          "create trigger "
              + trigger
              + " before insert on pz8.resource_audit "
              + "for each row execute function "
              + function
              + "()");
      try {
        assertThrows(
            DataAccessException.class,
            () -> access.assign(tenant.administrator(), human.id(), administratorRole, Set.of()));
      } finally {
        owner.execute("drop trigger " + trigger + " on pz8.resource_audit");
      }
    } finally {
      owner.execute("drop function " + function + "()");
    }
    assertEquals(human, resources.get(tenant.administrator(), human.id()));
    assertEquals(Set.of("resource:create"), access.get(tenant.member()).permissions());
    assertEquals(
        "user",
        owner.queryForObject(
            "select role from pz8.memberships where planzone_id = ? and identity_id = ?",
            String.class,
            tenant.member().planzoneId().value(),
            tenant.member().identityId().value()));
    assertEquals(
        0L,
        owner.queryForObject(
            "select security_version from pz8.planzone_security_state where planzone_id = ?",
            Long.class,
            tenant.administrator().planzoneId().value()));
    assertEquals(1, count("resource_audit", tenant.administrator()));
    access.assign(tenant.administrator(), human.id(), administratorRole, Set.of());
    assertTrue(access.get(tenant.member()).canManageRoles());
  }

  @Test
  void runtimeCannotMutateThePrivateCatalogOrAssignRolesWithRawResourceStatements() {
    var tenant = database.tenant();
    var human = register(tenant);
    for (String sql :
        new String[] {
          "select * from pz8.roles",
          "select * from pz8.access_settings",
          "update pz8.roles set coarse_role = 'administrator'",
          "update pz8.resources set role_id = null",
          "update pz8.resources set non_editable_fields = '{}'"
        }) {
      assertThrows(
          DataAccessException.class,
          () ->
              unitOfWork.executeJdbc(
                  tenant.administrator(),
                  scope -> {
                    scope.jdbc().execute(sql);
                    return null;
                  }));
    }
    UUID administratorRole = role(tenant.administrator(), "pz_admin");
    assertThrows(
        DataAccessException.class,
        () ->
            unitOfWork.executeJdbc(
                tenant.administrator(),
                scope ->
                    scope
                        .jdbc()
                        .update(
                            "insert into pz8.resources(planzone_id,id,name,type,role_id) "
                                + "values (?, ?, 'Raw authority', 'VIRTUAL', ?)",
                            tenant.administrator().planzoneId().value(),
                            UUID.randomUUID(),
                            administratorRole)));
    assertEquals(human, resources.get(tenant.administrator(), human.id()));
    assertEquals(
        1, resources.list(tenant.administrator(), ResourceQuery.firstPage(10)).items().size());
  }

  private static UUID role(PlanzoneContext context, String name) {
    return access.get(context).roles().stream()
        .filter(role -> role.name().equals(name))
        .findFirst()
        .orElseThrow()
        .id();
  }

  private static ResourceProfile register(PostgresFixture.Tenant tenant) {
    return resources.registerMember(
        tenant.administrator(),
        new RegisterMemberResource(
            UUID.randomUUID(), tenant.member().identityId(), "Local member", ""));
  }

  private static ResourceProfile create(PlanzoneContext context, String name) {
    return resources.create(
        context, new CreateResource(UUID.randomUUID(), ResourceType.VIRTUAL, name, ""));
  }

  private static int count(String table, PlanzoneContext context) {
    return owner.queryForObject(
        "select count(*) from pz8." + table + " where planzone_id = ?",
        Integer.class,
        context.planzoneId().value());
  }
}
