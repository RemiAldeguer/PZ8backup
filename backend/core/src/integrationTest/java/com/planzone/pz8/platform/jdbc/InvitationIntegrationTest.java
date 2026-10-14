package com.planzone.pz8.platform.jdbc;

import static org.junit.jupiter.api.Assertions.*;

import com.planzone.pz8.identity.IdentityId;
import com.planzone.pz8.people.invitations.*;
import com.planzone.pz8.planzones.PlanzoneAccessDeniedException;
import com.planzone.pz8.planzones.PlanzoneContext;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import javax.crypto.spec.SecretKeySpec;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;

class InvitationIntegrationTest {
  private static PostgresFixture database;
  private static JdbcTemplate owner;
  private static JdbcInvitationWork work;
  private static JdbcInvitationWork mailQueue;
  private static DataSource mailerDataSource;
  private static InvitationService invitations;
  private static final Map<UUID, InvitationMailQueue.Delivery> deliveries = new HashMap<>();

  @BeforeAll
  static void install() throws Exception {
    database = new PostgresFixture();
    owner = new JdbcTemplate(database.owner);
    work =
        new JdbcInvitationWork(
            new PlanzoneUnitOfWork(database.runtime),
            database.runtime,
            new SecretKeySpec(new byte[32], "AES"),
            URI.create("https://app.example.test/invitations/accept"));
    invitations = new InvitationService(work, Clock.systemUTC(), Duration.ofDays(7));
    mailerDataSource = database.newMailerDataSource();
    mailQueue =
        new JdbcInvitationWork(
            new PlanzoneUnitOfWork(database.runtime),
            mailerDataSource,
            new SecretKeySpec(new byte[32], "AES"),
            URI.create("https://app.example.test/invitations/accept"));
  }

  @AfterAll
  static void shutdown() {
    if (database != null) database.close();
  }

  @Test
  void pendingProfileReceiptAndEncryptedMailAreAtomicAndReplayNeverChangesTheSecret() {
    var tenant = database.tenant();
    var command = command(tenant.administrator(), "Alice", "Pending");
    var invite = invitations.create(tenant.administrator(), command);
    assertEquals(InvitationStatus.PENDING, invite.status());
    assertNull(
        owner.queryForObject(
            "select identity_id from pz8.resources where id = ?",
            UUID.class,
            invite.resourceId().value()));
    assertEquals(
        invite,
        invitations.create(
            tenant.administrator(),
            new InviteCommand(
                command.operationId(),
                " " + command.email() + " ",
                " Alice ",
                " Pending ",
                command.roleId(),
                null,
                "fr")));
    assertEquals(1, count("invitation_operations", tenant.administrator()));
    assertEquals(1, count("resources", tenant.administrator()));
    assertEquals(
        1,
        owner.queryForObject(
            "select count(*) from pz8.invitation_mail_outbox where invitation_id = ?",
            Integer.class,
            invite.id()));
    var delivery = delivery(invite);
    String token = token(delivery);
    assertEquals(43, token.length());
    assertEquals(
        JdbcInvitationWork.tokenHash(token),
        owner.queryForObject(
            "select token_hash from pz8.invitations where id = ?", String.class, invite.id()));
    byte[] encrypted =
        owner.queryForObject(
            "select token_encrypted from pz8.invitation_mail_outbox where id = ?",
            byte[].class,
            delivery.id());
    assertFalse(new String(encrypted, StandardCharsets.ISO_8859_1).contains(token));
    assertFalse(invite.toString().contains(token));
    assertFalse(delivery.toString().contains(token));
    assertEquals(command.email(), invitations.preview(token).email());
    assertThrows(
        InvitationOperationConflictException.class,
        () ->
            invitations.create(
                tenant.administrator(),
                new InviteCommand(
                    command.operationId(),
                    command.email(),
                    "Changed",
                    "Name",
                    command.roleId(),
                    "",
                    "fr")));
    mailQueue.markDelivered(delivery.id(), delivery.leaseId());
    assertNull(
        owner.queryForObject(
            "select token_encrypted from pz8.invitation_mail_outbox where id = ?",
            byte[].class,
            delivery.id()));
  }

  @Test
  void tenantPermissionsNamesEmailsAndRolesAreCheckedWithoutExposingOtherClients() {
    var a = database.tenant();
    var b = database.tenant();
    var command = command(a.administrator(), "Scoped", "Invitation");
    var invite = invitations.create(a.administrator(), command);
    assertTrue(invitations.list(b.administrator()).isEmpty());
    assertThrows(PlanzoneAccessDeniedException.class, () -> invitations.list(a.member()));
    assertThrows(
        PlanzoneAccessDeniedException.class, () -> invitations.create(a.member(), command));
    assertThrows(
        InvitationUnavailableException.class,
        () -> invitations.revoke(b.administrator(), invite.id()));
    assertThrows(
        InvitationAlreadyPendingException.class,
        () ->
            invitations.create(
                a.administrator(),
                new InviteCommand(
                    UUID.randomUUID(),
                    command.email(),
                    "Another",
                    "Person",
                    command.roleId(),
                    "",
                    "fr")));
    assertThrows(
        InvitationNameAlreadyExistsException.class,
        () ->
            invitations.create(
                a.administrator(),
                new InviteCommand(
                    UUID.randomUUID(),
                    email(),
                    "Scoped",
                    "Invitation",
                    command.roleId(),
                    "",
                    "fr")));
    assertThrows(
        InvitationRoleUnavailableException.class,
        () ->
            invitations.create(
                a.administrator(),
                new InviteCommand(
                    UUID.randomUUID(),
                    email(),
                    "Foreign",
                    "Role",
                    role(b.administrator(), "pz_user"),
                    "",
                    "fr")));
    var runtime = new JdbcTemplate(database.runtime);
    assertThrows(
        DataAccessException.class, () -> runtime.queryForList("select * from pz8.invitations"));
    assertThrows(
        DataAccessException.class,
        () -> runtime.queryForList("select * from pz8.identity_profiles"));
    assertEquals(1, count("resources", a.administrator()));
  }

  @Test
  void emailVerificationAndExactAddressAreRequiredBeforeAnyAuthorityIsGranted() {
    var tenant = database.tenant();
    var command = command(tenant.administrator(), "Verified", "Account");
    var invite = invitations.create(tenant.administrator(), command);
    String token = token(delivery(invite));
    var unverified = identity(command.email(), false);
    var mismatch = identity("different-" + command.email(), true);
    assertThrows(
        InvitationAccountMismatchException.class, () -> invitations.accept(unverified, 0, token));
    assertThrows(
        InvitationAccountMismatchException.class, () -> invitations.accept(mismatch, 0, token));
    assertEquals(0, membershipCount(tenant.administrator(), unverified));
    assertEquals(
        InvitationStatus.PENDING, invitations.list(tenant.administrator()).getFirst().status());
    owner.update(
        "update pz8.identity_profiles set email_verified = true where identity_id = ?",
        unverified.value());
    var accepted = invitations.accept(unverified, 0, token);
    assertEquals(invite.resourceId(), accepted.resourceId());
    assertEquals(
        unverified.value(),
        owner.queryForObject(
            "select identity_id from pz8.resources where id = ?",
            UUID.class,
            invite.resourceId().value()));
    assertEquals(
        command.roleId(),
        owner.queryForObject(
            "select role_id from pz8.memberships where planzone_id = ? and identity_id = ?",
            UUID.class,
            accepted.planzoneId().value(),
            unverified.value()));
    assertThrows(InvitationUnavailableException.class, () -> invitations.preview(token));
    assertEquals(accepted, invitations.accept(unverified, 0, token));
    assertThrows(
        InvitationUnavailableException.class, () -> invitations.accept(mismatch, 0, token));
  }

  @Test
  void unknownExpiredAndRevokedTokensCannotExposeEmailOrGrantMembership() {
    var tenant = database.tenant();
    var expired =
        invitations.create(
            tenant.administrator(), command(tenant.administrator(), "Expired", "Person"));
    String expiredToken = token(delivery(expired));
    var account = identity(expired.email(), true);
    owner.update(
        "update pz8.invitations set expires_at = clock_timestamp() - interval '1 second' where id = ?",
        expired.id());
    assertThrows(InvitationUnavailableException.class, () -> invitations.preview(expiredToken));
    assertThrows(
        InvitationUnavailableException.class, () -> invitations.accept(account, 0, expiredToken));
    assertEquals(
        InvitationStatus.EXPIRED, invitations.list(tenant.administrator()).getFirst().status());
    var revoked =
        invitations.create(
            tenant.administrator(), command(tenant.administrator(), "Revoked", "Person"));
    String revokedToken = token(delivery(revoked));
    invitations.revoke(tenant.administrator(), revoked.id());
    invitations.revoke(tenant.administrator(), revoked.id());
    assertThrows(InvitationUnavailableException.class, () -> invitations.preview(revokedToken));
    assertThrows(
        InvitationUnavailableException.class,
        () -> invitations.accept(identity(revoked.email(), true), 0, revokedToken));
    for (String invalid : List.of("", "junk", "A".repeat(43), "B".repeat(5000))) {
      assertThrows(InvitationUnavailableException.class, () -> invitations.preview(invalid));
    }
    assertEquals(0, membershipCount(tenant.administrator(), account));
  }

  @Test
  void concurrentAcceptanceIsIdempotentAndRevokedMembershipCannotBeResurrected() throws Exception {
    var tenant = database.tenant();
    var invite =
        invitations.create(
            tenant.administrator(), command(tenant.administrator(), "Concurrent", "Account"));
    String token = token(delivery(invite));
    var account = identity(invite.email(), true);
    var start = new CountDownLatch(1);
    AcceptedInvitation accepted;
    try (var executor = Executors.newFixedThreadPool(2)) {
      var first =
          executor.submit(
              () -> {
                await(start);
                return invitations.accept(account, 0, token);
              });
      var second =
          executor.submit(
              () -> {
                await(start);
                return invitations.accept(account, 0, token);
              });
      start.countDown();
      accepted = first.get(10, TimeUnit.SECONDS);
      assertEquals(accepted, second.get(10, TimeUnit.SECONDS));
    }
    assertEquals(1, membershipCount(tenant.administrator(), account));
    assertEquals(
        1,
        owner.queryForObject(
            "select count(*) from pz8.resource_audit where resource_id = ? and event_type = 'REGISTERED_MEMBER'",
            Integer.class,
            invite.resourceId().value()));
    new PlanzoneUnitOfWork(database.runtime)
        .executeAuthorityChange(
            tenant.administrator(), session -> session.revokeMembership(account));
    assertThrows(InvitationUnavailableException.class, () -> invitations.accept(account, 0, token));
    assertThrows(
        InvitationMemberAlreadyExistsException.class,
        () ->
            invitations.create(
                tenant.administrator(),
                new InviteCommand(
                    UUID.randomUUID(),
                    invite.email(),
                    "Another",
                    "Profile",
                    invite.roleId(),
                    "",
                    "fr")));
    assertFalse(
        owner.queryForObject(
            "select active from pz8.memberships where planzone_id = ? and identity_id = ?",
            Boolean.class,
            accepted.planzoneId().value(),
            account.value()));
  }

  @Test
  void oneGlobalIdentityHasIndependentProfilesAndRolesInTwoClients() {
    var a = database.tenant();
    var b = database.tenant();
    String email = email();
    var account = identity(email, true);
    var inviteA =
        invitations.create(
            a.administrator(),
            new InviteCommand(
                UUID.randomUUID(),
                email,
                "ClientA",
                "Name",
                role(a.administrator(), "pz_user"),
                "",
                "fr"));
    var inviteB =
        invitations.create(
            b.administrator(),
            new InviteCommand(
                UUID.randomUUID(),
                email,
                "ClientB",
                "Name",
                role(b.administrator(), "pz_visitor"),
                "",
                "en"));
    var resultA = invitations.accept(account, 0, token(delivery(inviteA)));
    var resultB = invitations.accept(account, 0, token(delivery(inviteB)));
    assertNotEquals(resultA.resourceId(), resultB.resourceId());
    assertEquals(
        "user",
        owner.queryForObject(
            "select role from pz8.memberships where planzone_id = ? and identity_id = ?",
            String.class,
            resultA.planzoneId().value(),
            account.value()));
    assertEquals(
        "visitor",
        owner.queryForObject(
            "select role from pz8.memberships where planzone_id = ? and identity_id = ?",
            String.class,
            resultB.planzoneId().value(),
            account.value()));
    assertEquals(
        List.of("ClientA Name", "ClientB Name"),
        owner.queryForList(
            "select name from pz8.resources where identity_id = ? order by name",
            String.class,
            account.value()));
  }

  @Test
  void auditFailureRollsBackProfileReceiptInvitationAndOutboxAndAllowsRetry() {
    var tenant = database.tenant();
    var command = command(tenant.administrator(), "Atomic", "Invite");
    String suffix = UUID.randomUUID().toString().replace("-", "");
    String function = "pz8.test_invite_failure_" + suffix;
    String trigger = "test_invite_failure_" + suffix;
    owner.execute(
        "create function "
            + function
            + "() returns trigger language plpgsql as $$ begin if NEW.planzone_id = '"
            + tenant.administrator().planzoneId().value()
            + "'::uuid then raise exception 'injected failure'; end if; return NEW; end $$");
    try {
      owner.execute(
          "create trigger "
              + trigger
              + " before insert on pz8.resource_audit for each row execute function "
              + function
              + "()");
      try {
        assertThrows(
            DataAccessException.class, () -> invitations.create(tenant.administrator(), command));
        for (String table : List.of("resources", "invitation_operations", "invitations"))
          assertEquals(0, count(table, tenant.administrator()));
        assertEquals(
            0,
            owner.queryForObject(
                "select count(*) from pz8.invitation_mail_outbox o join pz8.invitations i on i.id = o.invitation_id where i.planzone_id = ?",
                Integer.class,
                tenant.administrator().planzoneId().value()));
      } finally {
        owner.execute("drop trigger " + trigger + " on pz8.resource_audit");
      }
    } finally {
      owner.execute("drop function " + function + "()");
    }
    assertEquals(
        InvitationStatus.PENDING, invitations.create(tenant.administrator(), command).status());
    assertEquals(1, count("invitations", tenant.administrator()));
  }

  @Test
  void failedDeliveryCanRetryAndStaleAcknowledgementCannotLoseANewLease() {
    var tenant = database.tenant();
    var invite =
        invitations.create(
            tenant.administrator(), command(tenant.administrator(), "Mail", "Retry"));
    var first = delivery(invite);
    mailQueue.markFailed(first.id(), first.leaseId());
    owner.update(
        "update pz8.invitation_mail_outbox set available_at = clock_timestamp() - interval '1 second' where id = ?",
        first.id());
    var second = delivery(invite);
    assertEquals(first.acceptanceUrl(), second.acceptanceUrl());
    assertNotEquals(first.leaseId(), second.leaseId());
    mailQueue.markDelivered(first.id(), first.leaseId());
    assertNull(
        owner.queryForObject(
            "select delivered_at from pz8.invitation_mail_outbox where id = ?",
            java.sql.Timestamp.class,
            first.id()));
    mailQueue.markDelivered(second.id(), second.leaseId());
    assertNotNull(
        owner.queryForObject(
            "select delivered_at from pz8.invitation_mail_outbox where id = ?",
            java.sql.Timestamp.class,
            first.id()));
  }

  @Test
  void simultaneousCreationReplayPersistsOneProfileOneInvitationAndOneMail() throws Exception {
    var tenant = database.tenant();
    var command = command(tenant.administrator(), "Replay", "Concurrent");
    var start = new CountDownLatch(1);
    try (var executor = Executors.newFixedThreadPool(2)) {
      var first =
          executor.submit(
              () -> {
                await(start);
                return invitations.create(tenant.administrator(), command);
              });
      var second =
          executor.submit(
              () -> {
                await(start);
                return invitations.create(tenant.administrator(), command);
              });
      start.countDown();
      var invite = first.get(10, TimeUnit.SECONDS);
      assertEquals(invite, second.get(10, TimeUnit.SECONDS));
      assertEquals(
          1,
          owner.queryForObject(
              "select count(*) from pz8.invitation_mail_outbox where invitation_id = ?",
              Integer.class,
              invite.id()));
    }
    for (String table :
        List.of("resources", "invitation_operations", "invitations", "resource_audit"))
      assertEquals(1, count(table, tenant.administrator()));
  }

  @Test
  void acceptingPreservesTheAdministratorsCurrentPendingProfileRoleAndFieldRestrictions() {
    var tenant = database.tenant();
    var invite =
        invitations.create(
            tenant.administrator(), command(tenant.administrator(), "Adjusted", "Permission"));
    String token = token(delivery(invite));
    UUID visitor = role(tenant.administrator(), "pz_visitor");
    String result =
        new PlanzoneUnitOfWork(database.runtime)
            .executeAuthorityChange(
                tenant.administrator(),
                session ->
                    ((PlanzoneTransaction) session)
                        .jdbc()
                        .queryForObject(
                            "select pz8.assign_resource_access(?, ?, ARRAY['name']::text[])",
                            String.class,
                            invite.resourceId().value(),
                            visitor));
    assertEquals("ok", result);
    assertEquals(visitor, invitations.list(tenant.administrator()).getFirst().roleId());
    var account = identity(invite.email(), true);
    invitations.accept(account, 0, token);
    assertEquals(
        visitor,
        owner.queryForObject(
            "select role_id from pz8.memberships where planzone_id = ? and identity_id = ?",
            UUID.class,
            tenant.administrator().planzoneId().value(),
            account.value()));
    assertEquals(
        visitor,
        owner.queryForObject(
            "select role_id from pz8.resources where id = ?",
            UUID.class,
            invite.resourceId().value()));
    assertTrue(
        owner.queryForObject(
            "select 'name' = ANY(non_editable_fields) from pz8.resources where id = ?",
            Boolean.class,
            invite.resourceId().value()));
  }

  @Test
  void apiCannotReadOrAcknowledgeGlobalMailAndMailerCannotAccessBusinessCatalogues() {
    var runtime = new JdbcTemplate(database.runtime);
    assertThrows(
        DataAccessException.class,
        () -> runtime.queryForList("select * from pz8.claim_invitation_mail(1)"));
    assertThrows(
        DataAccessException.class,
        () ->
            runtime.queryForObject(
                "select pz8.finish_invitation_mail(?, ?, true)",
                Boolean.class,
                UUID.randomUUID(),
                UUID.randomUUID()));
    assertThrows(DataAccessException.class, () -> work.claim(1));
    var mailer = new JdbcTemplate(mailerDataSource);
    assertThrows(
        DataAccessException.class, () -> mailer.queryForList("select * from pz8.invitations"));
    assertThrows(
        DataAccessException.class,
        () -> mailer.queryForList("select * from pz8.identity_profiles"));
    assertThrows(
        DataAccessException.class,
        () -> mailer.queryForList("select * from pz8.list_invitations()"));
  }

  @Test
  void revokedSessionVersionCannotAcceptAnInvitationEvenWhileTheIdentityRemainsActive() {
    var tenant = database.tenant();
    var invite =
        invitations.create(
            tenant.administrator(), command(tenant.administrator(), "Session", "Revocation"));
    String token = token(delivery(invite));
    var account = identity(invite.email(), true);
    owner.update(
        "update pz8.identities set security_version = security_version + 1 where id = ?",
        account.value());
    assertTrue(
        owner.queryForObject(
            "select active from pz8.identities where id = ?", Boolean.class, account.value()));
    assertThrows(
        InvitationSessionExpiredException.class, () -> invitations.accept(account, 0, token));
    assertEquals(0, membershipCount(tenant.administrator(), account));
    assertNull(
        owner.queryForObject(
            "select identity_id from pz8.resources where id = ?",
            UUID.class,
            invite.resourceId().value()));
    assertEquals(
        "PENDING",
        owner.queryForObject(
            "select status from pz8.invitations where id = ?", String.class, invite.id()));
    assertEquals(
        0,
        owner.queryForObject(
            "select count(*) from pz8.resource_audit where resource_id = ? and event_type = 'REGISTERED_MEMBER'",
            Integer.class,
            invite.resourceId().value()));
    var accepted = invitations.accept(account, 1, token);
    assertEquals(invite.resourceId(), accepted.resourceId());
    assertThrows(
        InvitationSessionExpiredException.class, () -> invitations.accept(account, 0, token));
  }

  @Test
  void acceptanceWaitsForAuthorityChangesAndObservesTheCommittedSuspension() throws Exception {
    var tenant = database.tenant();
    var invite =
        invitations.create(
            tenant.administrator(), command(tenant.administrator(), "Authority", "Race"));
    String token = token(delivery(invite));
    var account = identity(invite.email(), true);
    var locked = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var ownerTransaction =
        new org.springframework.transaction.support.TransactionTemplate(
            new org.springframework.jdbc.datasource.DataSourceTransactionManager(database.owner));
    try (var executor = Executors.newFixedThreadPool(2)) {
      var suspension =
          executor.submit(
              () ->
                  ownerTransaction.execute(
                      status -> {
                        owner.update(
                            "update pz8.planzone_security_state set suspended = true where planzone_id = ?",
                            tenant.administrator().planzoneId().value());
                        locked.countDown();
                        await(release);
                        return null;
                      }));
      await(locked);
      var started = new CountDownLatch(1);
      var acceptance =
          executor.submit(
              () -> {
                started.countDown();
                return assertThrows(
                    InvitationUnavailableException.class,
                    () -> invitations.accept(account, 0, token));
              });
      await(started);
      release.countDown();
      suspension.get(10, TimeUnit.SECONDS);
      acceptance.get(10, TimeUnit.SECONDS);
    } finally {
      release.countDown();
    }
    assertEquals(0, membershipCount(tenant.administrator(), account));
    assertEquals(
        "PENDING",
        owner.queryForObject(
            "select status from pz8.invitations where id = ?", String.class, invite.id()));
    assertThrows(InvitationUnavailableException.class, () -> invitations.preview(token));
  }

  private static InviteCommand command(PlanzoneContext context, String first, String last) {
    return new InviteCommand(
        UUID.randomUUID(), email(), first, last, role(context, "pz_user"), "", "fr");
  }

  private static UUID role(PlanzoneContext context, String name) {
    return owner.queryForObject(
        "select id from pz8.roles where planzone_id = ? and name = ?",
        UUID.class,
        context.planzoneId().value(),
        name);
  }

  private static String email() {
    return UUID.randomUUID() + "@example.test";
  }

  private static IdentityId identity(String email, boolean verified) {
    UUID id = UUID.randomUUID();
    owner.update(
        "insert into pz8.identities(id, oidc_issuer, oidc_subject) values (?, 'https://id.example.test', ?)",
        id,
        id.toString());
    owner.update(
        "insert into pz8.identity_profiles(identity_id,email,email_verified,display_name) values (?, ?, ?, 'Invitee')",
        id,
        email,
        verified);
    return new IdentityId(id);
  }

  private static InvitationMailQueue.Delivery delivery(InvitationView invite) {
    UUID deliveryId =
        owner.queryForObject(
            "select id from pz8.invitation_mail_outbox where invitation_id = ?",
            UUID.class,
            invite.id());
    if (!deliveries.containsKey(deliveryId)) {
      for (var mail : mailQueue.claim(100)) deliveries.put(mail.id(), mail);
    }
    var result = deliveries.remove(deliveryId);
    assertNotNull(result);
    return result;
  }

  private static String token(InvitationMailQueue.Delivery delivery) {
    return URI.create(delivery.acceptanceUrl()).getRawQuery().substring("token=".length());
  }

  private static int count(String table, PlanzoneContext context) {
    return owner.queryForObject(
        "select count(*) from pz8." + table + " where planzone_id = ?",
        Integer.class,
        context.planzoneId().value());
  }

  private static int membershipCount(PlanzoneContext context, IdentityId account) {
    return owner.queryForObject(
        "select count(*) from pz8.memberships where planzone_id = ? and identity_id = ?",
        Integer.class,
        context.planzoneId().value(),
        account.value());
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
