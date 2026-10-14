package com.planzone.pz8.platform.jdbc;

import static org.junit.jupiter.api.Assertions.*;

import com.planzone.pz8.identity.IdentitySessionExpiredException;
import com.planzone.pz8.planzones.MembershipService;
import com.planzone.pz8.planzones.PlanzoneAccessDeniedException;
import com.planzone.pz8.planzones.PlanzoneContext;
import com.planzone.pz8.planzones.PlanzoneSession;
import com.planzone.pz8.planzones.ZoneId;
import com.planzone.pz8.planzones.ZoneQuery;
import com.planzone.pz8.planzones.ZoneService;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;

class PlanzoneIsolationTest {
  private static PostgresFixture database;
  private static PlanzoneUnitOfWork unitOfWork;
  private static ZoneService zones;

  @BeforeAll
  static void install() throws Exception {
    database = new PostgresFixture();
    unitOfWork = new PlanzoneUnitOfWork(database.runtime);
    zones = new ZoneService(unitOfWork);
  }

  @AfterAll
  static void shutdown() {
    if (database != null) {
      database.close();
    }
  }

  @Test
  void sessionRevokedAfterRequestValidationCannotStartANewBusinessMutation() {
    var tenant = database.tenant();
    var oldSession =
        new PlanzoneContext(
            tenant.administrator().identityId(), tenant.administrator().planzoneId(), 0L);
    new JdbcTemplate(database.owner)
        .update(
            "update pz8.identities set security_version=security_version+1 where id=?",
            oldSession.identityId().value());
    assertThrows(IdentitySessionExpiredException.class, () -> zones.create(oldSession, "Rejected"));
    assertEquals(
        0,
        new JdbcTemplate(database.owner)
            .queryForObject(
                "select count(*) from pz8.zones where planzone_id=?",
                Integer.class,
                oldSession.planzoneId().value()));
    var renewed = new PlanzoneContext(oldSession.identityId(), oldSession.planzoneId(), 1L);
    assertEquals("Accepted", zones.create(renewed, "Accepted").name());
  }

  @Test
  void anotherPlanzonesRowsCannotBeReadUpdatedOrInserted() {
    var a = database.tenant();
    var b = database.tenant();
    var zoneA = zones.create(a.administrator(), "A only");
    var zoneB = zones.create(b.administrator(), "B only");
    unitOfWork.execute(
        a.administrator(),
        transaction -> {
          assertEquals(
              1,
              ((PlanzoneTransaction) transaction)
                  .jdbc()
                  .queryForObject("select count(*) from pz8.zones", Integer.class));
          assertEquals(
              0,
              ((PlanzoneTransaction) transaction)
                  .jdbc()
                  .update("update pz8.zones set name = 'stolen' where id = ?", zoneB.id().value()));
          assertEquals(
              0,
              ((PlanzoneTransaction) transaction)
                  .jdbc()
                  .update("delete from pz8.zones where id = ?", zoneB.id().value()));
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
                            "insert into pz8.zones(id, planzone_id, name) values (?, ?, 'foreign')",
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
                            "update pz8.zones set planzone_id = ? where id = ?",
                            b.administrator().planzoneId().value(),
                            zoneA.id().value())));
    associateZone(a.member(), zoneA.id());
    associateZone(b.member(), zoneB.id());
    assertEquals(zoneA, zones.list(a.member(), ZoneQuery.firstPage(10)).items().getFirst());
    assertEquals(zoneB, zones.list(b.member(), ZoneQuery.firstPage(10)).items().getFirst());
  }

  @Test
  void missingContextDeniesBusinessDataAndAuthorityTablesArePrivate() {
    assertThrows(NullPointerException.class, () -> unitOfWork.execute(null, transaction -> null));
    var jdbc = new JdbcTemplate(database.runtime);
    assertEquals(0, jdbc.queryForObject("select count(*) from pz8.zones", Integer.class));
    assertThrows(
        DataAccessException.class,
        () ->
            jdbc.update(
                "insert into pz8.zones(id, planzone_id, name) values (?, ?, 'no context')",
                UUID.randomUUID(),
                UUID.randomUUID()));
    assertThrows(
        DataAccessException.class, () -> jdbc.queryForList("select * from pz8.memberships"));
    assertThrows(
        DataAccessException.class, () -> jdbc.queryForList("select * from pz8.identities"));
    assertFalse(
        jdbc.queryForObject(
            "select rolsuper or rolbypassrls from pg_roles where rolname = current_user",
            Boolean.class));
  }

  @Test
  void invalidMembershipAndOrdinaryMemberCannotCreateZones() {
    var a = database.tenant();
    var b = database.tenant();
    var foreign =
        new PlanzoneContext(a.administrator().identityId(), b.administrator().planzoneId());
    assertThrows(
        PlanzoneAccessDeniedException.class, () -> zones.list(foreign, ZoneQuery.firstPage(10)));
    assertThrows(PlanzoneAccessDeniedException.class, () -> zones.create(a.member(), "Forbidden"));
    assertThrows(
        DataAccessException.class,
        () ->
            unitOfWork.execute(
                a.member(),
                transaction ->
                    ((PlanzoneTransaction) transaction)
                        .jdbc()
                        .update(
                            "insert into pz8.zones(id, planzone_id, name) values (?, ?, 'Forbidden')",
                            UUID.randomUUID(),
                            a.member().planzoneId().value())));
    assertTrue(zones.list(a.administrator(), ZoneQuery.firstPage(10)).items().isEmpty());
    assertTrue(
        new JdbcIdentityDirectory(database.runtime)
            .findVerifiedOidcIdentity(
                "https://id.example.test", a.member().identityId().value().toString())
            .isPresent());
    assertTrue(
        new JdbcIdentityDirectory(database.runtime)
            .findVerifiedOidcIdentity(
                "https://foreign.example.test", a.member().identityId().value().toString())
            .isEmpty());
  }

  @Test
  void rollbackAndCommitNeverLeaveContextOnReusedPhysicalConnection() {
    var a = database.tenant();
    var b = database.tenant();
    try (var pool = database.newRuntimePool(1)) {
      var work = new PlanzoneUnitOfWork(pool);
      var jdbc = new JdbcTemplate(pool);
      int pid = jdbc.queryForObject("select pg_backend_pid()", Integer.class);
      assertThrows(
          IllegalStateException.class,
          () ->
              work.execute(
                  a.administrator(),
                  transaction -> {
                    ((PlanzoneTransaction) transaction)
                        .jdbc()
                        .update(
                            "insert into pz8.zones(id, planzone_id, name) values (?, ?, 'rolled back')",
                            UUID.randomUUID(),
                            a.administrator().planzoneId().value());
                    throw new IllegalStateException("Business invariant failed after first write");
                  }));
      assertEquals(pid, jdbc.queryForObject("select pg_backend_pid()", Integer.class));
      assertEquals(0, jdbc.queryForObject("select count(*) from pz8.zones", Integer.class));
      assertNull(
          jdbc.queryForObject(
              "select nullif(current_setting('pz8.planzone_id', true), '')", String.class));
      var service = new ZoneService(work);
      assertTrue(service.list(a.administrator(), ZoneQuery.firstPage(10)).items().isEmpty());
      service.create(b.administrator(), "B committed");
      assertEquals(0, jdbc.queryForObject("select count(*) from pz8.zones", Integer.class));
      assertThrows(
          DataAccessException.class,
          () ->
              work.execute(
                  a.administrator(),
                  transaction ->
                      ((PlanzoneTransaction) transaction)
                          .jdbc()
                          .update(
                              "insert into pz8.zones(id, planzone_id, name) values (?, ?, 'SQL failure')",
                              UUID.randomUUID(),
                              b.administrator().planzoneId().value())));
      assertNull(
          jdbc.queryForObject(
              "select nullif(current_setting('pz8.identity_id', true), '')", String.class));
      assertEquals(0, jdbc.queryForObject("select count(*) from pz8.zones", Integer.class));
      assertTrue(service.list(a.administrator(), ZoneQuery.firstPage(10)).items().isEmpty());
      assertEquals(1, service.list(b.administrator(), ZoneQuery.firstPage(10)).items().size());
      assertEquals(pid, jdbc.queryForObject("select pg_backend_pid()", Integer.class));
    }
  }

  @Test
  void boundedPagingDoesNotSkipEqualNamesAndPrefixWildcardsAreLiteral() {
    var a = database.tenant();
    zones.create(a.administrator(), "Alpha");
    zones.create(a.administrator(), "Alpha");
    zones.create(a.administrator(), "Al% literal");
    zones.create(a.administrator(), "Beta");
    var first = zones.list(a.administrator(), new ZoneQuery("Alpha", 1, null));
    assertNotNull(first.nextCursor());
    var second = zones.list(a.administrator(), new ZoneQuery("Alpha", 1, first.nextCursor()));
    assertEquals(1, second.items().size());
    assertNotEquals(first.items().getFirst().id(), second.items().getFirst().id());
    assertNull(second.nextCursor());
    assertEquals(1, zones.list(a.administrator(), new ZoneQuery("Al%", 10, null)).items().size());
    assertThrows(IllegalArgumentException.class, () -> ZoneQuery.firstPage(101));
    assertThrows(IllegalArgumentException.class, () -> zones.create(a.administrator(), " "));
  }

  @Test
  void membershipRevocationWaitsForEarlierCommandThenPreventsLaterCommands() throws Exception {
    var a = database.tenant();
    var ownerJdbc = new JdbcTemplate(database.owner);
    ownerJdbc.update(
        "update pz8.memberships set role = 'administrator' where planzone_id = ? and identity_id = ?",
        a.member().planzoneId().value(),
        a.member().identityId().value());
    var commandAuthorized = new CountDownLatch(1);
    var releaseCommand = new CountDownLatch(1);
    var commandPid = new AtomicInteger();
    try (var executor = Executors.newFixedThreadPool(2);
        var revocationPool = database.newRuntimePool(1)) {
      int revocationPid =
          new JdbcTemplate(revocationPool).queryForObject("select pg_backend_pid()", Integer.class);
      var command =
          executor.submit(
              () ->
                  unitOfWork.execute(
                      a.administrator(),
                      transaction -> {
                        commandPid.set(
                            ((PlanzoneTransaction) transaction)
                                .jdbc()
                                .queryForObject("select pg_backend_pid()", Integer.class));
                        commandAuthorized.countDown();
                        await(releaseCommand);
                        return transaction.createZone("Command ordered before revocation");
                      }));
      assertTrue(commandAuthorized.await(5, TimeUnit.SECONDS));
      var revocation =
          executor.submit(
              () ->
                  new MembershipService(new PlanzoneUnitOfWork(revocationPool))
                      .revoke(a.member(), a.administrator().identityId()));
      try {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        boolean blocked = false;
        while (System.nanoTime() < deadline) {
          blocked =
              Boolean.TRUE.equals(
                  ownerJdbc.queryForObject(
                      "select ? = any(pg_blocking_pids(?))",
                      Boolean.class,
                      commandPid.get(),
                      revocationPid));
          if (blocked) {
            break;
          }
          Thread.sleep(20);
        }
        assertTrue(
            blocked, "Revocation must actually wait on the authorized command's PostgreSQL lock");
      } finally {
        releaseCommand.countDown();
      }
      var createdZone = command.get(5, TimeUnit.SECONDS);
      assertEquals("Command ordered before revocation", createdZone.name());
      associateZone(a.member(), createdZone.id());
      assertTrue(revocation.get(5, TimeUnit.SECONDS));
    }
    assertThrows(
        PlanzoneAccessDeniedException.class, () -> zones.create(a.administrator(), "Too late"));
    assertEquals(1, zones.list(a.member(), ZoneQuery.firstPage(10)).items().size());
  }

  private static void associateZone(PlanzoneContext member, ZoneId zone) {
    var owner = new JdbcTemplate(database.owner);
    UUID resource = UUID.randomUUID();
    owner.update(
        "insert into pz8.resources(planzone_id,id,name,type,identity_id) values (?,?,?,'HUMAN',?)",
        member.planzoneId().value(),
        resource,
        "Zone member",
        member.identityId().value());
    owner.update(
        "insert into pz8.zone_members(planzone_id,zone_id,resource_id) values (?,?,?)",
        member.planzoneId().value(),
        zone.value(),
        resource);
  }

  @Test
  void transactionHandleCannotBeReusedAfterCommitOrMovedToAnotherThread() throws Exception {
    var a = database.tenant();
    PlanzoneSession captured = unitOfWork.execute(a.administrator(), transaction -> transaction);
    assertThrows(IllegalStateException.class, () -> captured.createZone("Outside transaction"));
    try (var executor = Executors.newSingleThreadExecutor()) {
      unitOfWork.execute(
          a.administrator(),
          transaction -> {
            try {
              executor
                  .submit(
                      () ->
                          assertThrows(
                              IllegalStateException.class,
                              () -> transaction.createZone("Wrong thread")))
                  .get(5, TimeUnit.SECONDS);
            } catch (Exception failure) {
              throw new IllegalStateException(failure);
            }
            assertThrows(
                IllegalStateException.class,
                () -> transaction.revokeMembership(a.member().identityId()));
            return null;
          });
    }
    assertTrue(zones.list(a.administrator(), ZoneQuery.firstPage(10)).items().isEmpty());
  }

  @Test
  void clientCannotPointAtAnotherClientsPlanzone() {
    var a = database.tenant();
    var b = database.tenant();
    var jdbc = new JdbcTemplate(database.owner);
    assertThrows(
        DataAccessException.class,
        () ->
            jdbc.update(
                "update pz8.clients set planzone_id = ? where planzone_id = ?",
                b.administrator().planzoneId().value(),
                a.administrator().planzoneId().value()));
  }

  private static void await(CountDownLatch latch) {
    try {
      if (!latch.await(5, TimeUnit.SECONDS)) {
        throw new IllegalStateException("Concurrent command was not released");
      }
    } catch (InterruptedException failure) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException(failure);
    }
  }
}
