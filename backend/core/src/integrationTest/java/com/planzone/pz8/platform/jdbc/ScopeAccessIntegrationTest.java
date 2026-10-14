package com.planzone.pz8.platform.jdbc;

import static org.junit.jupiter.api.Assertions.*;

import com.planzone.pz8.people.*;
import com.planzone.pz8.planzones.*;
import com.planzone.pz8.projects.*;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

class ScopeAccessIntegrationTest {
  private static PostgresFixture database;
  private static JdbcTemplate owner;
  private static JdbcScopedAccessService access;
  private static ResourceService resources;
  private static ZoneService zones;
  private static final ScopeQuery FIRST = ScopeQuery.firstPage(100);

  @BeforeAll
  static void install() throws Exception {
    database = new PostgresFixture();
    owner = new JdbcTemplate(database.owner);
    var work = new PlanzoneUnitOfWork(database.runtime);
    access = new JdbcScopedAccessService(work);
    resources = new ResourceService(new JdbcPeopleWork(work));
    zones = new ZoneService(work);
  }

  @AfterAll
  static void shutdown() {
    if (database != null) database.close();
  }

  @Test
  void visibilityUsesLocalMembershipAndTemplatesAndKeepsUnderAdministratorWorkerRestrictions() {
    var a = database.tenant();
    var b = database.tenant();
    var joined = zones.create(a.administrator(), "A joined");
    var hidden = zones.create(a.administrator(), "B hidden");
    var templates = zones.create(a.administrator(), "C templates");
    owner.update("update pz8.zones set saving_templates=true where id=?", templates.id().value());
    UUID memberProject = project(a.administrator(), joined.id(), "A member", false);
    UUID hiddenProject = project(a.administrator(), hidden.id(), "B hidden", false);
    UUID templateProject = project(a.administrator(), templates.id(), "C template", true);
    var human = human(a.administrator(), a.member(), "Local user");
    access.addProjectMember(
        a.administrator(), memberProject, human.id(), role(a.administrator(), "pr_visitor"));
    assertEquals(
        Set.of(joined.id().value(), templates.id().value()),
        ids(access.listZones(a.member(), FIRST)));
    assertEquals(
        Set.of(memberProject, templateProject),
        projectIds(access.listProjects(a.member(), null, FIRST)));
    assertEquals(
        Set.of(memberProject, hiddenProject, templateProject),
        projectIds(access.listProjects(a.administrator(), null, FIRST)));
    var first = access.listZones(a.member(), ScopeQuery.firstPage(1));
    assertNotNull(first.next());
    assertEquals(
        1, access.listZones(a.member(), new ScopeQuery("", 1, first.next())).items().size());
    assertEquals(
        Set.of("pr_manager", "pr_worker", "pr_visitor"),
        access.projectRoles(a.member()).stream()
            .map(ProjectRoleDto::name)
            .collect(java.util.stream.Collectors.toSet()));
    var globalAccess = new JdbcAccessService(new PlanzoneUnitOfWork(database.runtime));
    UUID visitor =
        owner.queryForObject(
            "select id from pz8.roles where planzone_id=? and name='pz_visitor'",
            UUID.class,
            a.member().planzoneId().value());
    globalAccess.assign(a.administrator(), human.id(), visitor, Set.of());
    var visitorProject =
        access.listProjects(a.member(), null, FIRST).items().stream()
            .filter(p -> p.id().equals(memberProject))
            .findFirst()
            .orElseThrow();
    assertTrue(
        visitorProject
            .permissions()
            .containsAll(
                Set.of(
                    "comment:create", "discussion:create", "document:create", "document:update")));
    assertFalse(visitorProject.permissions().contains("projectmember:update"));
    UUID underAdmin =
        owner.queryForObject(
            "select id from pz8.roles where planzone_id=? and name='pz_under_admin'",
            UUID.class,
            a.member().planzoneId().value());
    globalAccess.assign(a.administrator(), human.id(), underAdmin, Set.of());
    assertEquals(3, access.listZones(a.member(), FIRST).items().size());
    assertTrue(
        access.listZones(a.member(), FIRST).items().stream()
            .allMatch(
                z ->
                    z.permissions().contains("zone:update")
                        && !z.editableFields().contains("name")));
    assertFalse(projectIds(access.listProjects(a.member(), null, FIRST)).contains(hiddenProject));
    access.updateProjectMember(
        a.administrator(),
        memberProject,
        human.id(),
        role(a.administrator(), "pr_worker"),
        false,
        0);
    var worker =
        access.listProjects(a.member(), null, FIRST).items().stream()
            .filter(p -> p.id().equals(memberProject))
            .findFirst()
            .orElseThrow();
    assertTrue(worker.permissions().contains("project:update"));
    assertTrue(worker.permissions().contains("projectmember:create"));
    assertEquals(Set.of("integratedAt"), worker.editableFields());
    access.updateProjectMember(
        a.administrator(),
        memberProject,
        human.id(),
        role(a.administrator(), "pr_worker"),
        true,
        1);
    assertFalse(projectIds(access.listProjects(a.member(), null, FIRST)).contains(memberProject));
    assertTrue(access.listProjects(b.administrator(), null, FIRST).items().isEmpty());
    var creator = human(a.administrator(), a.administrator(), "Administrator profile");
    access.addProjectMember(
        a.administrator(), hiddenProject, creator.id(), role(a.administrator(), "pr_worker"));
    var administratorProject =
        access.listProjects(a.administrator(), null, FIRST).items().stream()
            .filter(p -> p.id().equals(hiddenProject))
            .findFirst()
            .orElseThrow();
    assertTrue(administratorProject.editableFields().containsAll(Set.of("name", "zone")));
    var created = zones.create(a.administrator(), "x".repeat(256));
    assertEquals(
        List.of(creator.id().value()),
        access.zoneMembers(a.administrator(), created.id(), FIRST).items().stream()
            .map(ZoneMemberView::resourceId)
            .toList());
    owner.update(
        "update pz8.roles set privileges=array_remove(privileges,'zone:create') where planzone_id=? and name='pz_admin'",
        a.administrator().planzoneId().value());
    assertThrows(
        PlanzoneAccessDeniedException.class,
        () -> zones.create(a.administrator(), "Catalog denied"));
  }

  @Test
  void teamChangesValidateScopeRolesVersionsAndPreserveTheZoneProjectRemovalRules() {
    var a = database.tenant();
    var b = database.tenant();
    var zone = zones.create(a.administrator(), "Team");
    var other = zones.create(a.administrator(), "Other");
    UUID first = project(a.administrator(), zone.id(), "First", false);
    UUID second = project(a.administrator(), zone.id(), "Second", false);
    UUID third = project(a.administrator(), other.id(), "Third", false);
    var manager = human(a.administrator(), a.member(), "Manager");
    access.addProjectMember(
        a.administrator(), first, manager.id(), role(a.administrator(), "pr_manager"));
    assertFalse(
        new PlanzoneUnitOfWork(database.runtime)
            .<Boolean>execute(
                a.member(),
                s ->
                    ((PlanzoneTransaction) s)
                        .jdbc()
                        .queryForObject(
                            "select pz8.has_capability(?,'resource:read')",
                            Boolean.class,
                            a.member().planzoneId().value())));
    var target = virtual(a.administrator(), "Virtual target");
    var candidate =
        access.projectCandidates(a.member(), first, FIRST).items().stream()
            .filter(c -> c.resourceId().equals(target.id().value()))
            .findFirst()
            .orElseThrow();
    assertEquals(ResourceType.VIRTUAL, candidate.type());
    var added = access.addProjectMember(a.member(), first, target.id(), null);
    assertNull(added.roleId());
    assertTrue(
        access.zoneMembers(a.member(), zone.id(), FIRST).items().stream()
            .anyMatch(m -> m.resourceId().equals(target.id().value())));
    assertEquals(added, access.addProjectMember(a.member(), first, target.id(), null));
    var updated =
        access.updateProjectMember(
            a.member(), first, target.id(), role(a.administrator(), "pr_visitor"), true, 0);
    assertEquals(1, updated.version());
    assertThrows(
        ScopeVersionConflictException.class,
        () -> access.updateProjectMember(a.member(), first, target.id(), null, false, 0));
    assertThrows(
        ScopeMemberConflictException.class,
        () -> access.addProjectMember(a.member(), first, target.id(), null));
    assertThrows(
        ScopeRoleUnavailableException.class,
        () ->
            access.updateProjectMember(
                a.member(), first, target.id(), role(b.administrator(), "pr_worker"), false, 1));
    var foreign = virtual(b.administrator(), "Foreign");
    assertThrows(
        ScopeNotFoundException.class,
        () -> access.addProjectMember(a.member(), first, foreign.id(), null));
    assertThrows(
        ScopeRoleUnavailableException.class,
        () ->
            access.addProjectMember(
                a.member(),
                first,
                virtual(a.administrator(), "Wrong global role").id(),
                owner.queryForObject(
                    "select id from pz8.roles where planzone_id=? and name='pz_admin'",
                    UUID.class,
                    a.administrator().planzoneId().value())));
    var visitor = new ResourceId(UUID.randomUUID());
    owner.update(
        "insert into pz8.resources(planzone_id,id,name,type,role_id) select ?,?,'Visitor human','HUMAN',r.id from pz8.roles r where r.planzone_id=? and r.name='pz_visitor'",
        a.administrator().planzoneId().value(),
        visitor.value(),
        a.administrator().planzoneId().value());
    assertThrows(
        ScopeRoleUnavailableException.class,
        () ->
            access.addProjectMember(
                a.administrator(), first, visitor, role(a.administrator(), "pr_worker")));
    access.removeProjectMember(a.member(), first, target.id());
    assertTrue(
        access.zoneMembers(a.administrator(), zone.id(), FIRST).items().stream()
            .anyMatch(m -> m.resourceId().equals(target.id().value())));
    access.addProjectMember(a.administrator(), first, target.id(), null);
    access.addProjectMember(a.administrator(), second, target.id(), null);
    access.addProjectMember(a.administrator(), third, target.id(), null);
    access.removeZoneMember(a.administrator(), zone.id(), target.id());
    assertFalse(
        access.projectMembers(a.administrator(), first, FIRST).items().stream()
            .anyMatch(m -> m.resourceId().equals(target.id().value())));
    assertTrue(access.projectMembers(a.administrator(), second, FIRST).items().isEmpty());
    assertEquals(
        List.of(target.id().value()),
        access.projectMembers(a.administrator(), third, FIRST).items().stream()
            .map(ProjectMemberView::resourceId)
            .toList());
    assertThrows(
        ScopedAccessDeniedException.class,
        () -> access.removeZoneMember(a.member(), zone.id(), manager.id()));
    access.addProjectMember(
        a.administrator(), second, manager.id(), role(a.administrator(), "pr_worker"));
    access.updateProjectMember(
        a.administrator(), second, manager.id(), role(a.administrator(), "pr_worker"), true, 0);
    UUID globalVisitor =
        owner.queryForObject(
            "select id from pz8.roles where planzone_id=? and name='pz_visitor'",
            UUID.class,
            a.administrator().planzoneId().value());
    UUID globalUser =
        owner.queryForObject(
            "select id from pz8.roles where planzone_id=? and name='pz_user'",
            UUID.class,
            a.administrator().planzoneId().value());
    var authorityWork = new PlanzoneUnitOfWork(database.runtime);
    assertEquals(
        "ok",
        authorityWork.executeAuthorityChange(
            a.administrator(),
            session ->
                ((PlanzoneTransaction) session)
                    .jdbc()
                    .queryForObject(
                        "select pz8.assign_resource_access(?,?,'{}'::text[])",
                        String.class,
                        manager.id().value(),
                        globalVisitor)));
    var downgradedManager =
        access.projectMembers(a.administrator(), first, FIRST).items().stream()
            .filter(m -> m.resourceId().equals(manager.id().value()))
            .findFirst()
            .orElseThrow();
    var downgradedWorker =
        access.projectMembers(a.administrator(), second, FIRST).items().stream()
            .filter(m -> m.resourceId().equals(manager.id().value()))
            .findFirst()
            .orElseThrow();
    assertEquals(role(a.administrator(), "pr_visitor"), downgradedManager.roleId());
    assertEquals(role(a.administrator(), "pr_visitor"), downgradedWorker.roleId());
    assertEquals(1, downgradedManager.version());
    assertEquals(2, downgradedWorker.version());
    assertFalse(downgradedManager.deactivated());
    assertTrue(downgradedWorker.deactivated());
    assertTrue(
        access.zoneMembers(a.administrator(), zone.id(), FIRST).items().stream()
            .anyMatch(m -> m.resourceId().equals(manager.id().value())));
    assertEquals(
        2,
        owner.queryForObject(
            "select count(*) from pz8.scope_access_audit where planzone_id=? and resource_id=? and event_type='GLOBAL_ROLE_DOWNGRADED'",
            Integer.class,
            a.administrator().planzoneId().value(),
            manager.id().value()));
    assertFalse(
        access.listProjects(a.member(), null, FIRST).items().stream()
            .filter(p -> p.id().equals(first))
            .findFirst()
            .orElseThrow()
            .permissions()
            .contains("projectmember:create"));
    assertThrows(
        ScopeVersionConflictException.class,
        () ->
            access.updateProjectMember(
                a.administrator(),
                first,
                manager.id(),
                role(a.administrator(), "pr_visitor"),
                false,
                0));
    assertEquals(
        "ok",
        authorityWork.executeAuthorityChange(
            a.administrator(),
            session ->
                ((PlanzoneTransaction) session)
                    .jdbc()
                    .queryForObject(
                        "select pz8.assign_resource_access(?,?,'{}'::text[])",
                        String.class,
                        manager.id().value(),
                        globalUser)));
    var promotedManager =
        access.projectMembers(a.administrator(), first, FIRST).items().stream()
            .filter(m -> m.resourceId().equals(manager.id().value()))
            .findFirst()
            .orElseThrow();
    var promotedWorker =
        access.projectMembers(a.administrator(), second, FIRST).items().stream()
            .filter(m -> m.resourceId().equals(manager.id().value()))
            .findFirst()
            .orElseThrow();
    assertEquals(downgradedManager.roleId(), promotedManager.roleId());
    assertEquals(downgradedManager.version(), promotedManager.version());
    assertEquals(downgradedWorker.roleId(), promotedWorker.roleId());
    assertEquals(downgradedWorker.version(), promotedWorker.version());
    assertTrue(promotedWorker.deactivated());
    assertFalse(promotedManager.deactivated());
    assertFalse(
        access.listProjects(a.member(), null, FIRST).items().stream()
            .filter(p -> p.id().equals(first))
            .findFirst()
            .orElseThrow()
            .permissions()
            .contains("projectmember:create"));
  }

  @Test
  void anAuditFailureRollsBackBothTheProjectMemberAndInducedZoneMember() {
    var a = database.tenant();
    var zone = zones.create(a.administrator(), "Atomic team");
    UUID project = project(a.administrator(), zone.id(), "Atomic project", false);
    var target = virtual(a.administrator(), "Atomic target");
    String suffix = UUID.randomUUID().toString().replace("-", "");
    String function = "pz8.scope_fail_" + suffix;
    String trigger = "scope_fail_" + suffix;
    owner.execute(
        "create function "
            + function
            + "() returns trigger language plpgsql as $$ begin if NEW.planzone_id='"
            + a.administrator().planzoneId().value()
            + "'::uuid then raise exception 'audit failure'; end if; return NEW; end $$");
    try {
      owner.execute(
          "create trigger "
              + trigger
              + " before insert on pz8.scope_access_audit for each row execute function "
              + function
              + "()");
      try {
        assertThrows(
            DataAccessException.class,
            () -> access.addProjectMember(a.administrator(), project, target.id(), null));
        assertTrue(access.projectMembers(a.administrator(), project, FIRST).items().isEmpty());
        assertTrue(access.zoneMembers(a.administrator(), zone.id(), FIRST).items().isEmpty());
      } finally {
        owner.execute("drop trigger " + trigger + " on pz8.scope_access_audit");
      }
    } finally {
      owner.execute("drop function " + function + "()");
    }
    access.addProjectMember(a.administrator(), project, target.id(), null);
    access.addProjectMember(a.administrator(), project, target.id(), null);
    assertEquals(
        1,
        owner.queryForObject(
            "select count(*) from pz8.scope_access_audit where planzone_id=?",
            Integer.class,
            a.administrator().planzoneId().value()));
    for (String table :
        List.of("zone_members", "project_members", "project_roles", "scope_access_audit"))
      assertThrows(
          DataAccessException.class,
          () -> new JdbcTemplate(database.runtime).queryForList("select * from pz8." + table));
  }

  @Test
  void teamAuthorityIsRecheckedAfterAConcurrentProjectMembershipRevocation() throws Exception {
    var a = database.tenant();
    var zone = zones.create(a.administrator(), "Concurrent");
    UUID project = project(a.administrator(), zone.id(), "Concurrent project", false);
    var manager = human(a.administrator(), a.member(), "Concurrent manager");
    var target = virtual(a.administrator(), "Concurrent target");
    access.addProjectMember(
        a.administrator(), project, manager.id(), role(a.administrator(), "pr_manager"));
    var locked = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var transaction = new TransactionTemplate(new DataSourceTransactionManager(database.owner));
    try (var executor = Executors.newFixedThreadPool(2)) {
      var revoke =
          executor.submit(
              () ->
                  transaction.execute(
                      status -> {
                        owner.update(
                            "update pz8.planzone_security_state set security_version=security_version+1 where planzone_id=?",
                            a.administrator().planzoneId().value());
                        owner.update(
                            "update pz8.project_members set deactivated=true,version=version+1 where project_id=? and resource_id=?",
                            project,
                            manager.id().value());
                        locked.countDown();
                        await(release);
                        return null;
                      }));
      await(locked);
      var add =
          executor.submit(
              () ->
                  assertThrows(
                      ScopeNotFoundException.class,
                      () -> access.addProjectMember(a.member(), project, target.id(), null)));
      release.countDown();
      revoke.get(10, TimeUnit.SECONDS);
      add.get(10, TimeUnit.SECONDS);
    } finally {
      release.countDown();
    }
    assertEquals(
        0,
        owner.queryForObject(
            "select count(*) from pz8.project_members where project_id=? and resource_id=?",
            Integer.class,
            project,
            target.id().value()));
  }

  private static Set<UUID> ids(ScopePage<ScopedZone> page) {
    return page.items().stream().map(ScopedZone::id).collect(java.util.stream.Collectors.toSet());
  }

  private static Set<UUID> projectIds(ScopePage<ScopedProject> page) {
    return page.items().stream()
        .map(ScopedProject::id)
        .collect(java.util.stream.Collectors.toSet());
  }

  private static ResourceProfile human(PlanzoneContext admin, PlanzoneContext member, String name) {
    return resources.registerMember(
        admin, new RegisterMemberResource(UUID.randomUUID(), member.identityId(), name, ""));
  }

  private static ResourceProfile virtual(PlanzoneContext admin, String name) {
    return resources.create(
        admin, new CreateResource(UUID.randomUUID(), ResourceType.VIRTUAL, name, ""));
  }

  private static UUID project(PlanzoneContext admin, ZoneId zone, String name, boolean template) {
    UUID id = UUID.randomUUID();
    owner.update(
        "insert into pz8.projects(planzone_id,id,zone_id,name,template,status_code) values(?,?,?,?,?,'pz_closed')",
        admin.planzoneId().value(),
        id,
        zone.value(),
        name,
        template);
    return id;
  }

  private static UUID role(PlanzoneContext context, String name) {
    return owner.queryForObject(
        "select id from pz8.project_roles where planzone_id=? and name=?",
        UUID.class,
        context.planzoneId().value(),
        name);
  }

  private static void await(CountDownLatch latch) {
    try {
      assertTrue(latch.await(5, TimeUnit.SECONDS));
    } catch (InterruptedException failure) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException(failure);
    }
  }
}
