package com.planzone.pz8.api;

import static com.planzone.pz8.api.HttpAccessFixture.json;
import static com.planzone.pz8.api.HttpAccessFixture.object;
import static com.planzone.pz8.api.HttpAccessFixture.objects;
import static org.assertj.core.api.Assertions.assertThat;

import com.planzone.pz8.api.HttpAccessFixture.Browser;
import com.planzone.pz8.api.HttpAccessFixture.Tenant;
import java.net.URI;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.TestMethodOrder;

/** HTTP acceptance evidence: no injected principal, development credentials or mocked authority. */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class AccessHttpIntegrationTest {
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
  @Order(1)
  void signedLoginRotatesCookieAndSharedSessionsExposeOnlyActiveMemberships() throws Exception {
    var browser = new Browser(fixture.api);
    error(browser.get("/api/v1/session"), 401, "AUTHENTICATION_REQUIRED");
    var account = fixture.oidc.account(email("session"), true);
    browser.login(fixture.oidc, account, "/invitations/accept?token=preserved-return-path");
    Map<String, Object> empty = browser.session();
    UUID identity = fixture.identity(account);
    assertThat(object(empty, "identity").get("id")).isEqualTo(identity.toString());
    assertThat(object(empty, "identity").get("email")).isEqualTo(account.email());
    assertThat(objects(empty, "planzones")).isEmpty();

    Tenant active = fixture.tenant(identity, "Active membership");
    Tenant revoked = fixture.tenant(identity, "Inactive membership");
    Tenant suspended = fixture.tenant(identity, "Suspended Planzone");
    fixture.owner.update(
        "update pz8.memberships set active = false where planzone_id = ? and identity_id = ?",
        revoked.id(),
        identity);
    fixture.owner.update(
        "update pz8.planzone_security_state set suspended = true where planzone_id = ?",
        suspended.id());
    assertThat(objects(browser.session(), "planzones"))
        .extracting(row -> row.get("id"))
        .containsExactly(active.id().toString());

    URI secondInstance = fixture.startInstance();
    browser.instance(secondInstance);
    assertThat(object(browser.session(), "identity").get("id")).isEqualTo(identity.toString());
    assertThat(objects(browser.session(), "planzones"))
        .extracting(row -> row.get("id"))
        .containsExactly(active.id().toString());
    error(
        browser.writeWithCsrf("POST", "/api/v1/auth/logout", Map.of(), null), 403, "ACCESS_DENIED");
    assertThat(browser.write("POST", "/api/v1/auth/logout", Map.of()).statusCode()).isEqualTo(204);
    browser.instance(fixture.api);
    error(browser.get("/api/v1/session"), 401, "AUTHENTICATION_REQUIRED");
  }

  @Test
  @Order(2)
  void callbackRejectsTamperedStateAndSignedTokensWithWrongNonceIssuerOrAudience()
      throws Exception {
    var account = fixture.oidc.account(email("state"), true);
    var browser = new Browser(fixture.api);
    var attempt =
        browser.beginLogin(fixture.oidc, account, OidcProviderFixture.TokenFault.NONE, "/access");
    var query = OidcProviderFixture.parameters(attempt.callback().getRawQuery());
    URI tampered =
        URI.create(
            attempt.callback().getScheme()
                + "://"
                + attempt.callback().getAuthority()
                + attempt.callback().getPath()
                + "?code="
                + query.get("code")
                + "&state=attacker-state");
    error(browser.get(tampered), 401, "AUTHENTICATION_FAILED");
    error(browser.get("/api/v1/session"), 401, "AUTHENTICATION_REQUIRED");
    assertNotEnrolled(account);

    for (var fault :
        List.of(
            OidcProviderFixture.TokenFault.NONCE,
            OidcProviderFixture.TokenFault.ISSUER,
            OidcProviderFixture.TokenFault.AUDIENCE)) {
      var invalidAccount = fixture.oidc.account(email("invalid"), true);
      var invalidBrowser = new Browser(fixture.api);
      var invalid = invalidBrowser.beginLogin(fixture.oidc, invalidAccount, fault, "/access");
      error(invalidBrowser.get(invalid.callback()), 401, "AUTHENTICATION_FAILED");
      error(invalidBrowser.get("/api/v1/session"), 401, "AUTHENTICATION_REQUIRED");
      assertNotEnrolled(invalidAccount);
    }
    fixture.oidc.assertHealthy();
  }

  @Test
  @Order(3)
  void csrfProtectsWritesAndResourceRetriesAndVersionsHaveObservableOutcomes() throws Exception {
    var administrator = administrator("csrf");
    Browser browser = administrator.browser();
    Tenant tenant = administrator.tenant();
    Map<String, Object> create = resourceBody("VIRTUAL", "Technical consultant");
    error(
        browser.writeWithCsrf("POST", tenant.path("/resources"), create, null),
        403,
        "ACCESS_DENIED");
    error(
        browser.writeWithCsrf("POST", tenant.path("/resources"), create, "invalid-token"),
        403,
        "ACCESS_DENIED");
    assertThat(resourceCount(tenant)).isZero();
    var created = browser.write("POST", tenant.path("/resources"), create);
    assertThat(created.statusCode()).as(created.body()).isEqualTo(201);
    String resource = (String) json(created).get("id");
    assertThat(json(created).get("type")).isEqualTo("VIRTUAL");
    assertThat(json(created).get("planzoneId")).isEqualTo(tenant.id().toString());
    var replay = browser.write("POST", tenant.path("/resources"), create);
    assertThat(replay.statusCode()).as(replay.body()).isEqualTo(201);
    assertThat(json(replay).get("id")).isEqualTo(resource);
    assertThat(resourceCount(tenant)).isEqualTo(1);
    var changedOperation =
        Map.of(
            "operationId",
            create.get("operationId"),
            "type",
            "VIRTUAL",
            "name",
            "Different request");
    error(
        browser.write("POST", tenant.path("/resources"), changedOperation),
        409,
        "OPERATION_CONFLICT");
    error(
        browser.write(
            "PATCH",
            tenant.path("/resources/" + resource),
            Map.of("expectedVersion", 9, "name", "Stale change")),
        409,
        "VERSION_CONFLICT");
    var renamed =
        browser.write(
            "PATCH",
            tenant.path("/resources/" + resource),
            Map.of("expectedVersion", 0, "name", "Renamed consultant"));
    assertThat(renamed.statusCode()).as(renamed.body()).isEqualTo(200);
    assertThat(json(renamed).get("name")).isEqualTo("Renamed consultant");
    assertThat(((Number) json(renamed).get("version")).longValue()).isEqualTo(1);
    error(
        browser.write("POST", tenant.path("/resources"), resourceBody("HUMAN", "Account bypass")),
        400,
        "INVALID_INPUT");
    assertThat(resourceCount(tenant)).isEqualTo(1);
  }

  @Test
  @Order(4)
  void invitationRequiresMatchingVerifiedOidcAccountAndAcceptanceReplayKeepsOneMembership()
      throws Exception {
    var administrator = administrator("invite");
    String recipient = email("recipient");
    var request = invitationBody(administrator.tenant(), recipient, "Invited", "Colleague");
    var created =
        administrator.browser().write("POST", administrator.tenant().path("/invitations"), request);
    assertThat(created.statusCode()).as(created.body()).isEqualTo(201);
    Map<String, Object> invitation = json(created);
    assertThat(invitation)
        .doesNotContainKeys("token", "acceptanceUrl", "tokenHash", "tokenEncrypted");
    var replayCreation =
        administrator.browser().write("POST", administrator.tenant().path("/invitations"), request);
    assertThat(json(replayCreation).get("id")).isEqualTo(invitation.get("id"));
    assertThat(
            objects(
                json(administrator.browser().get(administrator.tenant().path("/invitations"))),
                "items"))
        .extracting(row -> row.get("id"))
        .containsExactly(invitation.get("id"));
    String token = fixture.invitationToken(recipient);
    fixture.assertApiCannotReadGlobalMailQueue();
    assertThat(created.body()).doesNotContain(token);
    assertThat(
            fixture.owner.queryForObject(
                "select token_hash from pz8.invitations where id = ?",
                String.class,
                UUID.fromString((String) invitation.get("id"))))
        .hasSize(64)
        .isNotEqualTo(token);

    var anonymous = new Browser(fixture.api);
    var preview =
        anonymous.get("/api/v1/invitations/preview?token=" + OidcProviderFixture.encode(token));
    assertThat(preview.statusCode()).as(preview.body()).isEqualTo(200);
    assertThat(json(preview).get("email")).isEqualTo(recipient);
    error(
        anonymous.write("POST", "/api/v1/invitations/accept", Map.of("token", token)),
        403,
        "ACCESS_DENIED");

    var wrongAccount = fixture.oidc.account(email("wrong-recipient"), true);
    var wrong = new Browser(fixture.api);
    wrong.login(fixture.oidc, wrongAccount, "/access");
    error(
        wrong.write("POST", "/api/v1/invitations/accept", Map.of("token", token)),
        403,
        "INVITATION_ACCOUNT_MISMATCH");
    var unverifiedAccount = fixture.oidc.account(recipient, false);
    var unverified = new Browser(fixture.api);
    unverified.login(fixture.oidc, unverifiedAccount, "/access");
    error(
        unverified.write("POST", "/api/v1/invitations/accept", Map.of("token", token)),
        403,
        "INVITATION_ACCOUNT_MISMATCH");
    assertThat(memberCount(administrator.tenant())).isEqualTo(1);

    var invitedAccount = fixture.oidc.account(recipient, true);
    var invited = new Browser(fixture.api);
    invited.login(fixture.oidc, invitedAccount, "/invitations/accept?token=" + token);
    assertThat(objects(invited.session(), "planzones")).isEmpty();
    var accepted = invited.write("POST", "/api/v1/invitations/accept", Map.of("token", token));
    assertThat(accepted.statusCode()).as(accepted.body()).isEqualTo(200);
    assertThat(json(accepted).get("planzoneId")).isEqualTo(administrator.tenant().id().toString());
    assertThat(json(accepted).get("resourceId")).isEqualTo(invitation.get("resourceId"));
    var replay = invited.write("POST", "/api/v1/invitations/accept", Map.of("token", token));
    assertThat(replay.statusCode()).as(replay.body()).isEqualTo(200);
    assertThat(json(replay)).isEqualTo(json(accepted));
    assertThat(memberCount(administrator.tenant())).isEqualTo(2);
    assertThat(objects(invited.session(), "planzones"))
        .extracting(row -> row.get("resourceId"))
        .containsExactly(invitation.get("resourceId"));
    error(
        anonymous.get("/api/v1/invitations/preview?token=" + token), 410, "INVITATION_UNAVAILABLE");
  }

  @Test
  @Order(5)
  void revokedInvitationCannotGrantAccessAndTenantAuthorityCannotCrossClientBoundaries()
      throws Exception {
    var administrator = administrator("revocation");
    var other = administrator("other-client");
    String recipient = email("revoked-invitation");
    var created =
        administrator
            .browser()
            .write(
                "POST",
                administrator.tenant().path("/invitations"),
                invitationBody(administrator.tenant(), recipient, "Revoked", "Invitee"));
    assertThat(created.statusCode()).as(created.body()).isEqualTo(201);
    String invitation = (String) json(created).get("id");
    String token = fixture.invitationToken(recipient);
    error(other.browser().get(administrator.tenant().path("/invitations")), 403, "ACCESS_DENIED");
    error(
        other
            .browser()
            .write(
                "POST",
                administrator.tenant().path("/invitations/" + invitation + "/revoke"),
                Map.of()),
        403,
        "ACCESS_DENIED");
    assertThat(
            administrator
                .browser()
                .write(
                    "POST",
                    administrator.tenant().path("/invitations/" + invitation + "/revoke"),
                    Map.of())
                .statusCode())
        .isEqualTo(204);
    var invited = new Browser(fixture.api);
    invited.login(fixture.oidc, fixture.oidc.account(recipient, true), "/access");
    error(invited.get("/api/v1/invitations/preview?token=" + token), 410, "INVITATION_UNAVAILABLE");
    error(
        invited.write("POST", "/api/v1/invitations/accept", Map.of("token", token)),
        410,
        "INVITATION_UNAVAILABLE");
    assertThat(objects(invited.session(), "planzones")).isEmpty();
    assertThat(memberCount(administrator.tenant())).isEqualTo(1);
    error(administrator.browser().get(other.tenant().path("/access")), 403, "ACCESS_DENIED");
    error(
        administrator
            .browser()
            .write(
                "POST",
                other.tenant().path("/resources"),
                resourceBody("MATERIAL", "Foreign laptop")),
        403,
        "ACCESS_DENIED");
    assertThat(resourceCount(other.tenant())).isZero();
  }

  @Test
  @Order(6)
  void currentPermissionsDenyRenameAndRoleEscalationAndDisabledIdentityLosesItsSession()
      throws Exception {
    var administrator = administrator("permissions");
    var memberAccount = fixture.oidc.account(email("member"), true);
    var member = new Browser(fixture.api);
    member.login(fixture.oidc, memberAccount, "/access");
    UUID memberId = fixture.identity(memberAccount);
    fixture.member(administrator.tenant().id(), memberId, "user");
    fixture.owner.update(
        "update pz8.access_settings set resource_allowed_roles = array['pz_admin','pz_user'] where planzone_id = ?",
        administrator.tenant().id());
    Map<String, Object> policy = json(member.get(administrator.tenant().path("/access")));
    assertThat(policy.get("canManageRoles")).isEqualTo(false);
    assertThat((List<?>) policy.get("editableResourceFields"))
        .extracting(Object::toString)
        .doesNotContain("name");
    Map<String, Object> adminPolicy =
        json(administrator.browser().get(administrator.tenant().path("/access")));
    assertThat(adminPolicy.get("canManageRoles")).isEqualTo(true);
    assertThat(objects(adminPolicy, "roles"))
        .allSatisfy(role -> assertThat(role.get("id")).isInstanceOf(String.class));
    var created =
        administrator
            .browser()
            .write(
                "POST",
                administrator.tenant().path("/resources"),
                resourceBody("MATERIAL", "Shared laptop"));
    assertThat(created.statusCode()).as(created.body()).isEqualTo(201);
    String resource = (String) json(created).get("id");
    assertThat(member.get(administrator.tenant().path("/resources/" + resource)).statusCode())
        .isEqualTo(200);
    error(
        member.write(
            "PATCH",
            administrator.tenant().path("/resources/" + resource),
            Map.of("expectedVersion", 0, "name", "Forbidden rename")),
        403,
        "ACCESS_DENIED");
    error(
        member.write(
            "PUT",
            administrator.tenant().path("/resources/" + resource + "/access"),
            Map.of(
                "roleId",
                fixture.role(administrator.tenant(), "pz_admin").toString(),
                "nonEditableFields",
                List.of())),
        403,
        "ACCESS_DENIED");
    error(
        member.write(
            "POST",
            administrator.tenant().path("/invitations"),
            invitationBody(
                administrator.tenant(), email("denied-invite"), "Forbidden", "Invitation")),
        403,
        "ACCESS_DENIED");
    assertThat(
            json(administrator.browser().get(administrator.tenant().path("/resources/" + resource)))
                .get("name"))
        .isEqualTo("Shared laptop");

    fixture.owner.update(
        "update pz8.identities set active = false, security_version = security_version + 1 where id = ?",
        memberId);
    error(
        member.write(
            "POST",
            administrator.tenant().path("/resources"),
            resourceBody("VIRTUAL", "Disabled account write")),
        401,
        "SESSION_EXPIRED");
    error(member.get("/api/v1/session"), 401, "AUTHENTICATION_REQUIRED");
    assertThat(resourceCount(administrator.tenant())).isEqualTo(1);
  }

  private Administrator administrator(String purpose) throws Exception {
    var account = fixture.oidc.account(email(purpose), true);
    var browser = new Browser(fixture.api);
    browser.login(fixture.oidc, account, "/access");
    return new Administrator(
        browser, fixture.tenant(fixture.identity(account), "Planzone " + purpose));
  }

  private Map<String, Object> invitationBody(
      Tenant tenant, String recipient, String firstName, String lastName) {
    return Map.of(
        "operationId",
        UUID.randomUUID().toString(),
        "email",
        recipient,
        "firstName",
        firstName,
        "lastName",
        lastName,
        "roleId",
        fixture.role(tenant, "pz_user").toString(),
        "message",
        "Please join",
        "language",
        "fr");
  }

  private static Map<String, Object> resourceBody(String type, String name) {
    return Map.of(
        "operationId",
        UUID.randomUUID().toString(),
        "type",
        type,
        "name",
        name,
        "description",
        "HTTP acceptance resource");
  }

  private long resourceCount(Tenant tenant) {
    return fixture.owner.queryForObject(
        "select count(*) from pz8.resources where planzone_id = ?", Long.class, tenant.id());
  }

  private long memberCount(Tenant tenant) {
    return fixture.owner.queryForObject(
        "select count(*) from pz8.memberships where planzone_id = ?", Long.class, tenant.id());
  }

  private void assertNotEnrolled(OidcProviderFixture.Account account) {
    assertThat(
            fixture.owner.queryForObject(
                "select count(*) from pz8.identities where oidc_issuer = ? and oidc_subject = ?",
                Long.class,
                fixture.oidc.issuer.toString(),
                account.subject()))
        .isZero();
  }

  private static String email(String purpose) {
    return purpose + "-" + UUID.randomUUID() + "@example.test";
  }

  private static void error(HttpResponse<String> response, int status, String code)
      throws Exception {
    assertThat(response.statusCode()).as(response.body()).isEqualTo(status);
    Map<String, Object> body = json(response);
    assertThat(body.get("code")).isEqualTo(code);
    assertThat(body.get("message")).isInstanceOf(String.class).asString().isNotBlank();
    assertThat(body).containsOnlyKeys("code", "message");
  }

  private record Administrator(Browser browser, Tenant tenant) {}
}
