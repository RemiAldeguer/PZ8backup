package com.planzone.pz8.platform.jdbc;

import static org.junit.jupiter.api.Assertions.*;

import com.planzone.pz8.identity.IdentityId;
import com.planzone.pz8.people.CreateResource;
import com.planzone.pz8.people.MemberNotAvailableException;
import com.planzone.pz8.people.MemberResourceAlreadyExistsException;
import com.planzone.pz8.people.PeopleSession;
import com.planzone.pz8.people.RegisterMemberResource;
import com.planzone.pz8.people.ResourceCursor;
import com.planzone.pz8.people.ResourceId;
import com.planzone.pz8.people.ResourceNotFoundException;
import com.planzone.pz8.people.ResourceOperationConflictException;
import com.planzone.pz8.people.ResourceProfile;
import com.planzone.pz8.people.ResourceQuery;
import com.planzone.pz8.people.ResourceService;
import com.planzone.pz8.people.ResourceType;
import com.planzone.pz8.people.ResourceVersionConflictException;
import com.planzone.pz8.planzones.PlanzoneAccessDeniedException;
import com.planzone.pz8.planzones.PlanzoneContext;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;

class PeopleIntegrationTest {
  private static PostgresFixture database;
  private static PlanzoneUnitOfWork unitOfWork;
  private static JdbcPeopleWork peopleWork;
  private static ResourceService resources;
  private static JdbcTemplate owner;

  @BeforeAll
  static void install() throws Exception {
    database = new PostgresFixture();
    unitOfWork = new PlanzoneUnitOfWork(database.runtime);
    peopleWork = new JdbcPeopleWork(unitOfWork);
    resources = new ResourceService(peopleWork);
    owner = new JdbcTemplate(database.owner);
  }

  @AfterAll
  static void shutdown() {
    if (database != null) {
      database.close();
    }
  }

  @Test
  void accountlessResourcesAndIndependentLocalHumanProfilesPreservePz7Semantics() {
    var a = database.tenant();
    var b = database.tenant();
    var virtual = create(a.administrator(), ResourceType.VIRTUAL, "  Shared name  ");
    var material = create(a.administrator(), ResourceType.MATERIAL, "Shared name");
    assertNull(virtual.identityId());
    assertNull(material.identityId());
    assertEquals("Shared name", virtual.name());
    assertEquals("", virtual.description());
    assertNotEquals(virtual.id(), material.id());

    addMembership(b.administrator(), a.member().identityId(), "user");
    var humanA = register(a.administrator(), a.member().identityId(), "Local A");
    var humanB = register(b.administrator(), a.member().identityId(), "Local B");
    assertNotEquals(humanA.id(), humanB.id());
    assertEquals(ResourceType.HUMAN, humanA.type());
    assertEquals(a.member().identityId(), humanB.identityId());
    resources.rename(a.administrator(), humanA.id(), humanA.version(), "Changed in A");
    assertEquals(humanB, resources.get(b.administrator(), humanB.id()));
    assertEquals(
        "user",
        owner.queryForObject(
            "select role from pz8.memberships where planzone_id = ? and identity_id = ?",
            String.class,
            a.administrator().planzoneId().value(),
            a.member().identityId().value()));
    assertEquals(3, resources.list(a.administrator(), ResourceQuery.firstPage(10)).items().size());
    assertEquals(1, resources.list(b.administrator(), ResourceQuery.firstPage(10)).items().size());
  }

  @Test
  void unknownForeignRevokedAndInactiveIdentitiesAreIndistinguishableAndCreateNothing() {
    var a = database.tenant();
    var b = database.tenant();
    owner.update(
        "update pz8.memberships set active = false where planzone_id = ? and identity_id = ?",
        a.administrator().planzoneId().value(),
        a.member().identityId().value());
    IdentityId inactive = newIdentity();
    addMembership(a.administrator(), inactive, "user");
    owner.update("update pz8.identities set active = false where id = ?", inactive.value());
    var refusalMessages = new ArrayList<String>();
    for (IdentityId target :
        List.of(
            new IdentityId(UUID.randomUUID()),
            b.member().identityId(),
            a.member().identityId(),
            inactive)) {
      var failure =
          assertThrows(
              MemberNotAvailableException.class,
              () -> register(a.administrator(), target, "Unavailable"));
      refusalMessages.add(failure.getMessage());
    }
    assertEquals(1, refusalMessages.stream().distinct().count());
    assertEquals(0, tenantCount("resources", a.administrator()));
    assertEquals(0, tenantCount("resource_operations", a.administrator()));
    assertEquals(0, tenantCount("resource_audit", a.administrator()));
  }

  @Test
  void concurrentRegistrationsAllowOnlyOneHumanResourceForTheLocalIdentity() throws Exception {
    var a = database.tenant();
    var start = new CountDownLatch(1);
    try (var executor = Executors.newFixedThreadPool(2)) {
      var first =
          executor.submit(
              () -> registrationOutcome(start, a.administrator(), a.member().identityId()));
      var second =
          executor.submit(
              () -> registrationOutcome(start, a.administrator(), a.member().identityId()));
      start.countDown();
      var outcomes = List.of(first.get(10, TimeUnit.SECONDS), second.get(10, TimeUnit.SECONDS));
      assertEquals(1, outcomes.stream().filter(ResourceProfile.class::isInstance).count());
      assertEquals(
          1,
          outcomes.stream().filter(MemberResourceAlreadyExistsException.class::isInstance).count());
    }
    assertEquals(1, tenantCount("resources", a.administrator()));
    assertEquals(1, tenantCount("resource_operations", a.administrator()));
    assertEquals(1, tenantCount("resource_audit", a.administrator()));
  }

  @Test
  void foreignResourcesAreHiddenInTheCoreApiAndInDirectRuntimeSql() {
    var a = database.tenant();
    var b = database.tenant();
    var local = create(a.administrator(), ResourceType.VIRTUAL, "A");
    var foreign = create(b.administrator(), ResourceType.MATERIAL, "B");
    assertThrows(
        ResourceNotFoundException.class, () -> resources.get(a.administrator(), foreign.id()));
    assertThrows(
        ResourceNotFoundException.class,
        () -> resources.rename(a.administrator(), foreign.id(), foreign.version(), "Stolen"));
    assertEquals(
        List.of(local), resources.list(a.administrator(), ResourceQuery.firstPage(10)).items());
    unitOfWork.execute(
        a.administrator(),
        transaction -> {
          var jdbc = ((PlanzoneTransaction) transaction).jdbc();
          for (String table : List.of("resources", "resource_operations", "resource_audit")) {
            assertEquals(
                1, jdbc.queryForObject("select count(*) from pz8." + table, Integer.class));
          }
          assertEquals(
              0,
              jdbc.update(
                  "update pz8.resources set name = 'Stolen' where id = ?", foreign.id().value()));
          return null;
        });
    assertThrows(
        DataAccessException.class,
        () ->
            unitOfWork.execute(
                a.administrator(),
                transaction ->
                    ((PlanzoneTransaction) transaction)
                        .jdbc()
                        .update(
                            "insert into pz8.resources(id, planzone_id, name, type) values (?, ?, 'Foreign', 'VIRTUAL')",
                            UUID.randomUUID(),
                            b.administrator().planzoneId().value())));
    assertThrows(
        DataAccessException.class,
        () ->
            unitOfWork.execute(
                a.administrator(),
                transaction ->
                    ((PlanzoneTransaction) transaction)
                        .jdbc()
                        .update(
                            "update pz8.resources set planzone_id = ? where id = ?",
                            b.administrator().planzoneId().value(),
                            local.id().value())));
    assertEquals(foreign, resources.get(b.administrator(), foreign.id()));
  }

  @Test
  void ordinaryMembersCanCreateAndReplayButCannotReadTheResourceScreenOrRename() {
    var a = database.tenant();
    var profile = create(a.administrator(), ResourceType.VIRTUAL, "Private");
    assertThrows(
        PlanzoneAccessDeniedException.class, () -> resources.get(a.member(), profile.id()));
    assertThrows(
        PlanzoneAccessDeniedException.class,
        () -> resources.list(a.member(), ResourceQuery.firstPage(10)));
    var command = new CreateResource(UUID.randomUUID(), ResourceType.VIRTUAL, "Allowed create", "");
    var created = resources.create(a.member(), command);
    assertEquals(created, resources.create(a.member(), command));
    assertThrows(
        PlanzoneAccessDeniedException.class,
        () -> register(a.member(), a.member().identityId(), "Forbidden"));
    assertThrows(
        PlanzoneAccessDeniedException.class,
        () -> resources.rename(a.member(), profile.id(), profile.version(), "Forbidden"));
    assertThrows(NullPointerException.class, () -> resources.get(null, profile.id()));
    assertThrows(
        NullPointerException.class, () -> create(null, ResourceType.VIRTUAL, "No context"));
    var unscoped = new JdbcTemplate(database.runtime);
    for (String table : List.of("resources", "resource_operations", "resource_audit")) {
      assertEquals(0, unscoped.queryForObject("select count(*) from pz8." + table, Integer.class));
      unitOfWork.execute(
          a.member(),
          transaction -> {
            assertEquals(
                table.equals("resources") ? 2 : table.equals("resource_operations") ? 1 : 0,
                ((PlanzoneTransaction) transaction)
                    .jdbc()
                    .queryForObject("select count(*) from pz8." + table, Integer.class));
            return null;
          });
    }
    assertThrows(
        DataAccessException.class,
        () ->
            unscoped.update(
                "insert into pz8.resources(id, planzone_id, name, type) values (?, ?, 'No context', 'VIRTUAL')",
                UUID.randomUUID(),
                a.administrator().planzoneId().value()));
    unitOfWork.execute(
        a.member(),
        transaction -> {
          assertEquals(
              0,
              ((PlanzoneTransaction) transaction)
                  .jdbc()
                  .update(
                      "update pz8.resources set name = 'Forbidden' where id = ?",
                      profile.id().value()));
          return null;
        });
    assertEquals(profile, resources.get(a.administrator(), profile.id()));
    assertEquals(2, tenantCount("resource_audit", a.administrator()));
  }

  @Test
  void boundedPaginationKeepsDuplicateNamesAndCombinesLiteralPrefixAndStateFilters() {
    var a = database.tenant();
    var duplicateA = create(a.administrator(), ResourceType.VIRTUAL, "Equal");
    var duplicateB = create(a.administrator(), ResourceType.VIRTUAL, "Equal");
    create(a.administrator(), ResourceType.MATERIAL, "Equal");
    create(a.administrator(), ResourceType.VIRTUAL, "Eq%_ literal");
    create(a.administrator(), ResourceType.VIRTUAL, "EqXY wildcard decoy");
    var deactivated = create(a.administrator(), ResourceType.VIRTUAL, "Equal old");
    owner.update(
        "update pz8.resources set deactivated = true where id = ?", deactivated.id().value());
    var seen = new ArrayList<ResourceId>();
    ResourceCursor cursor = null;
    do {
      var page =
          resources.list(
              a.administrator(),
              new ResourceQuery("Equal", ResourceType.VIRTUAL, false, 1, cursor));
      assertEquals(1, page.items().size());
      seen.add(page.items().getFirst().id());
      cursor = page.next();
      assertTrue(seen.size() <= 2, "Pagination must advance past equal names");
    } while (cursor != null);
    assertEquals(new HashSet<>(List.of(duplicateA.id(), duplicateB.id())), new HashSet<>(seen));
    assertEquals(2, seen.size());
    assertEquals(
        List.of(deactivated.id()),
        resources
            .list(
                a.administrator(), new ResourceQuery("Equal", ResourceType.VIRTUAL, true, 10, null))
            .items()
            .stream()
            .map(ResourceProfile::id)
            .toList());
    assertEquals(
        List.of("Eq%_ literal"),
        resources
            .list(a.administrator(), new ResourceQuery("Eq%_", null, null, 10, null))
            .items()
            .stream()
            .map(ResourceProfile::name)
            .toList());
    assertEquals(
        1,
        resources
            .list(
                a.administrator(),
                new ResourceQuery("Equal", ResourceType.MATERIAL, null, 10, null))
            .items()
            .size());
  }

  @Test
  void concurrentReplayProducesOneProfileAndAuditAndReturnsTheCurrentProfile() throws Exception {
    var a = database.tenant();
    var command = new CreateResource(UUID.randomUUID(), ResourceType.VIRTUAL, " Replay ", null);
    var normalized = new CreateResource(command.operationId(), ResourceType.VIRTUAL, "Replay", "");
    var start = new CountDownLatch(1);
    ResourceProfile created;
    try (var executor = Executors.newFixedThreadPool(2)) {
      var first =
          executor.submit(
              () -> {
                await(start);
                return resources.create(a.administrator(), command);
              });
      var second =
          executor.submit(
              () -> {
                await(start);
                return resources.create(a.administrator(), normalized);
              });
      start.countDown();
      created = first.get(10, TimeUnit.SECONDS);
      assertEquals(created, second.get(10, TimeUnit.SECONDS));
    }
    assertEquals(1, tenantCount("resources", a.administrator()));
    assertEquals(1, tenantCount("resource_operations", a.administrator()));
    assertEquals(1, tenantCount("resource_audit", a.administrator()));
    var renamed =
        resources.rename(a.administrator(), created.id(), created.version(), "Current name");
    assertEquals(renamed, resources.create(a.administrator(), command));
    assertEquals(2, tenantCount("resource_audit", a.administrator()));
    assertThrows(
        ResourceOperationConflictException.class,
        () ->
            resources.create(
                a.administrator(),
                new CreateResource(command.operationId(), ResourceType.MATERIAL, "Replay", "")));
    assertThrows(
        ResourceOperationConflictException.class,
        () ->
            resources.create(
                a.administrator(),
                new CreateResource(
                    command.operationId(), ResourceType.VIRTUAL, "Replay", "different")));
    assertEquals(renamed, resources.get(a.administrator(), created.id()));
    assertEquals(1, tenantCount("resource_operations", a.administrator()));
  }

  @Test
  void operationKeysAreScopedToTheActorTenantAndCommandKindAndMemberReplayIsSafe() {
    var a = database.tenant();
    var b = database.tenant();
    owner.update(
        "update pz8.memberships set role = 'administrator' where planzone_id = ? and identity_id = ?",
        a.member().planzoneId().value(),
        a.member().identityId().value());
    addMembership(b.administrator(), a.administrator().identityId(), "administrator");
    var sameActorInB =
        new PlanzoneContext(a.administrator().identityId(), b.administrator().planzoneId());
    var command = new CreateResource(UUID.randomUUID(), ResourceType.VIRTUAL, "Same operation", "");
    var first = resources.create(a.administrator(), command);
    var second = resources.create(a.member(), command);
    var third = resources.create(sameActorInB, command);
    assertEquals(3, new HashSet<>(List.of(first.id(), second.id(), third.id())).size());
    var register =
        new RegisterMemberResource(command.operationId(), a.member().identityId(), " Human ", null);
    var human = resources.registerMember(a.administrator(), register);
    assertEquals(
        human,
        resources.registerMember(
            a.administrator(),
            new RegisterMemberResource(
                command.operationId(), a.member().identityId(), "Human", "")));
    assertThrows(
        ResourceOperationConflictException.class,
        () ->
            resources.registerMember(
                a.administrator(),
                new RegisterMemberResource(
                    command.operationId(), a.member().identityId(), "Different", "")));
    assertThrows(
        MemberResourceAlreadyExistsException.class,
        () -> register(a.administrator(), a.member().identityId(), "Second link"));
    assertEquals(3, tenantCount("resource_audit", a.administrator()));
    assertEquals(3, tenantCount("resource_operations", a.administrator()));
    assertEquals(1, tenantCount("resource_audit", b.administrator()));
    unitOfWork.execute(
        a.member(),
        transaction -> {
          assertEquals(
              1,
              ((PlanzoneTransaction) transaction)
                  .jdbc()
                  .queryForObject("select count(*) from pz8.resource_operations", Integer.class));
          return null;
        });
    assertThrows(
        DataAccessException.class,
        () ->
            unitOfWork.execute(
                a.member(),
                transaction ->
                    ((PlanzoneTransaction) transaction)
                        .jdbc()
                        .update(
                            "insert into pz8.resource_audit "
                                + "(id, planzone_id, resource_id, actor_id, operation_id, event_type, resource_type, resource_version) "
                                + "values (?, ?, ?, ?, ?, 'CREATED', 'VIRTUAL', ?)",
                            UUID.randomUUID(),
                            a.administrator().planzoneId().value(),
                            first.id().value(),
                            a.administrator().identityId().value(),
                            UUID.randomUUID(),
                            first.version())));
    assertEquals(3, tenantCount("resource_audit", a.administrator()));
  }

  @Test
  void concurrentRenamesRejectTheStaleVersionWithoutLosingTheWinnerOrDuplicatingAudit()
      throws Exception {
    var a = database.tenant();
    var original = create(a.administrator(), ResourceType.MATERIAL, "Original");
    var start = new CountDownLatch(1);
    ResourceProfile winner;
    try (var executor = Executors.newFixedThreadPool(2)) {
      var first = executor.submit(() -> renameOutcome(start, a.administrator(), original, "First"));
      var second =
          executor.submit(() -> renameOutcome(start, a.administrator(), original, "Second"));
      start.countDown();
      var outcomes = List.of(first.get(10, TimeUnit.SECONDS), second.get(10, TimeUnit.SECONDS));
      winner =
          (ResourceProfile)
              outcomes.stream().filter(ResourceProfile.class::isInstance).findFirst().orElseThrow();
      assertEquals(
          1, outcomes.stream().filter(ResourceVersionConflictException.class::isInstance).count());
    }
    assertEquals(original.version() + 1, winner.version());
    assertEquals(winner, resources.get(a.administrator(), original.id()));
    assertEquals(2, tenantCount("resource_audit", a.administrator()));
    assertEquals(
        1,
        owner.queryForObject(
            "select count(*) from pz8.resource_audit where planzone_id = ? and resource_id = ? "
                + "and actor_id = ? and event_type = 'RENAMED' and resource_version = ?",
            Integer.class,
            a.administrator().planzoneId().value(),
            winner.id().value(),
            a.administrator().identityId().value(),
            winner.version()));
    assertThrows(
        ResourceVersionConflictException.class,
        () ->
            resources.rename(a.administrator(), original.id(), original.version(), "Lost update"));
    assertEquals(winner, resources.get(a.administrator(), original.id()));
    assertEquals(2, tenantCount("resource_audit", a.administrator()));
  }

  @Test
  void auditFailureRollsBackProfileReceiptAndRenameAndLeavesTheOperationRetryable() {
    var a = database.tenant();
    var profile = create(a.administrator(), ResourceType.MATERIAL, "Before failure");
    var command = new CreateResource(UUID.randomUUID(), ResourceType.VIRTUAL, "Retryable", "");
    String suffix = UUID.randomUUID().toString().replace("-", "");
    String function = "pz8.test_audit_failure_" + suffix;
    String trigger = "test_audit_failure_" + suffix;
    owner.execute(
        "create function "
            + function
            + "() returns trigger language plpgsql as $$ begin "
            + "if NEW.planzone_id = '"
            + a.administrator().planzoneId().value()
            + "'::uuid then "
            + "raise exception 'injected audit failure'; end if; return NEW; end $$");
    try {
      owner.execute(
          "create trigger "
              + trigger
              + " before insert on pz8.resource_audit for each row execute function "
              + function
              + "()");
      try {
        assertThrows(DataAccessException.class, () -> resources.create(a.administrator(), command));
        assertThrows(
            DataAccessException.class,
            () ->
                resources.rename(
                    a.administrator(), profile.id(), profile.version(), "Should roll back"));
        assertEquals(profile, resources.get(a.administrator(), profile.id()));
        assertEquals(1, tenantCount("resources", a.administrator()));
        assertEquals(1, tenantCount("resource_operations", a.administrator()));
        assertEquals(1, tenantCount("resource_audit", a.administrator()));
      } finally {
        owner.execute("drop trigger " + trigger + " on pz8.resource_audit");
      }
    } finally {
      owner.execute("drop function " + function + "()");
    }
    var retry = resources.create(a.administrator(), command);
    assertEquals("Retryable", retry.name());
    assertEquals(retry, resources.create(a.administrator(), command));
    assertEquals(2, tenantCount("resources", a.administrator()));
    assertEquals(2, tenantCount("resource_operations", a.administrator()));
    assertEquals(2, tenantCount("resource_audit", a.administrator()));
  }

  @Test
  void auditCannotBeRewrittenOrDeletedEvenByAnAuthorizedRuntimeAdministrator() {
    var a = database.tenant();
    var profile = create(a.administrator(), ResourceType.VIRTUAL, "History");
    assertThrows(
        DataAccessException.class,
        () ->
            unitOfWork.execute(
                a.administrator(),
                transaction ->
                    ((PlanzoneTransaction) transaction)
                        .jdbc()
                        .update(
                            "delete from pz8.resource_audit where resource_id = ?",
                            profile.id().value())));
    assertThrows(
        DataAccessException.class,
        () ->
            unitOfWork.execute(
                a.administrator(),
                transaction ->
                    ((PlanzoneTransaction) transaction)
                        .jdbc()
                        .update(
                            "update pz8.resource_audit set resource_version = 99 where resource_id = ?",
                            profile.id().value())));
    assertEquals(1, tenantCount("resource_audit", a.administrator()));
  }

  @Test
  void invalidResourceValuesDoNotWriteAndThePz7LengthBoundariesAreAccepted() {
    var a = database.tenant();
    for (String name : List.of("", " \t ", "x".repeat(257))) {
      assertThrows(
          IllegalArgumentException.class,
          () -> create(a.administrator(), ResourceType.VIRTUAL, name));
    }
    assertThrows(
        IllegalArgumentException.class,
        () ->
            resources.create(
                a.administrator(),
                new CreateResource(UUID.randomUUID(), ResourceType.HUMAN, "Human", "")));
    assertThrows(
        IllegalArgumentException.class,
        () ->
            resources.create(
                a.administrator(),
                new CreateResource(
                    UUID.randomUUID(), ResourceType.VIRTUAL, "Valid name", "x".repeat(5001))));
    assertThrows(IllegalArgumentException.class, () -> ResourceQuery.firstPage(0));
    assertThrows(IllegalArgumentException.class, () -> ResourceQuery.firstPage(101));
    assertEquals(0, tenantCount("resources", a.administrator()));
    assertEquals(0, tenantCount("resource_operations", a.administrator()));
    assertEquals(0, tenantCount("resource_audit", a.administrator()));
    var boundary =
        resources.create(
            a.administrator(),
            new CreateResource(
                UUID.randomUUID(), ResourceType.VIRTUAL, "x".repeat(256), "d".repeat(5000)));
    assertEquals(256, boundary.name().length());
    assertEquals(5000, boundary.description().length());
    assertThrows(
        IllegalArgumentException.class,
        () -> resources.rename(a.administrator(), boundary.id(), boundary.version(), " "));
    assertEquals(boundary, resources.get(a.administrator(), boundary.id()));
    assertEquals(1, tenantCount("resource_audit", a.administrator()));
  }

  @Test
  void peopleSessionCannotEscapeItsTransactionOrMoveToAnotherThread() throws Exception {
    var a = database.tenant();
    PeopleSession captured = peopleWork.execute(a.administrator(), session -> session);
    assertThrows(IllegalStateException.class, () -> captured.list(ResourceQuery.firstPage(10)));
    try (var executor = Executors.newSingleThreadExecutor()) {
      peopleWork.execute(
          a.administrator(),
          session -> {
            try {
              executor
                  .submit(
                      () ->
                          assertThrows(
                              IllegalStateException.class,
                              () ->
                                  session.create(
                                      new CreateResource(
                                          UUID.randomUUID(),
                                          ResourceType.VIRTUAL,
                                          "Wrong thread",
                                          ""))))
                  .get(5, TimeUnit.SECONDS);
            } catch (Exception failure) {
              throw new IllegalStateException(failure);
            }
            return null;
          });
    }
    assertEquals(0, tenantCount("resources", a.administrator()));
  }

  private static ResourceProfile create(PlanzoneContext context, ResourceType type, String name) {
    return resources.create(context, new CreateResource(UUID.randomUUID(), type, name, null));
  }

  private static ResourceProfile register(
      PlanzoneContext context, IdentityId identity, String name) {
    return resources.registerMember(
        context, new RegisterMemberResource(UUID.randomUUID(), identity, name, null));
  }

  private static Object registrationOutcome(
      CountDownLatch start, PlanzoneContext context, IdentityId identity) {
    await(start);
    try {
      return register(context, identity, "Concurrent member");
    } catch (MemberResourceAlreadyExistsException failure) {
      return failure;
    }
  }

  private static Object renameOutcome(
      CountDownLatch start, PlanzoneContext context, ResourceProfile original, String name) {
    await(start);
    try {
      return resources.rename(context, original.id(), original.version(), name);
    } catch (ResourceVersionConflictException failure) {
      return failure;
    }
  }

  private static IdentityId newIdentity() {
    var identity = new IdentityId(UUID.randomUUID());
    owner.update(
        "insert into pz8.identities(id, oidc_issuer, oidc_subject) values (?, 'https://id.example.test', ?)",
        identity.value(),
        identity.value().toString());
    return identity;
  }

  private static void addMembership(PlanzoneContext tenant, IdentityId identity, String role) {
    owner.update(
        "insert into pz8.memberships(planzone_id, identity_id, role) values (?, ?, ?)",
        tenant.planzoneId().value(),
        identity.value(),
        role);
  }

  private static int tenantCount(String table, PlanzoneContext context) {
    return owner.queryForObject(
        "select count(*) from pz8." + table + " where planzone_id = ?",
        Integer.class,
        context.planzoneId().value());
  }

  private static void await(CountDownLatch latch) {
    try {
      if (!latch.await(5, TimeUnit.SECONDS)) {
        throw new IllegalStateException("Concurrent command did not start");
      }
    } catch (InterruptedException failure) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException(failure);
    }
  }
}
