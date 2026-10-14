package com.planzone.pz8.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.nimbusds.jose.util.JSONObjectUtils;
import com.planzone.pz8.platform.jdbc.JdbcInvitationWork;
import com.planzone.pz8.platform.jdbc.PlanzoneUnitOfWork;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.SecureRandom;
import java.sql.Connection;
import java.time.Duration;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.crypto.spec.SecretKeySpec;
import liquibase.Liquibase;
import liquibase.database.DatabaseFactory;
import liquibase.database.jvm.JdbcConnection;
import liquibase.resource.ClassLoaderResourceAccessor;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.postgresql.PostgreSQLContainer;

/** Disposable PostgreSQL, a restricted application role and two independent HTTP instances. */
final class HttpAccessFixture implements AutoCloseable {
  static final URI FRONTEND = URI.create("http://127.0.0.1:3000");
  private final PostgreSQLContainer container;
  private final String jdbcUrl;
  private final String runtimeUser = "pz8_http_" + UUID.randomUUID().toString().replace("-", "");
  private final String runtimePassword = UUID.randomUUID().toString();
  private final String mailerUser =
      "pz8_http_mail_" + UUID.randomUUID().toString().replace("-", "");
  private final String mailerPassword = UUID.randomUUID().toString();
  private final byte[] encryptionKey = new byte[32];
  final JdbcTemplate owner;
  private final HikariDataSource runtime;
  private final HikariDataSource mailer;
  private final java.util.ArrayList<ConfigurableApplicationContext> applications =
      new java.util.ArrayList<>();
  final OidcProviderFixture oidc;
  final URI api;

  HttpAccessFixture() throws Exception {
    String externalUrl = System.getenv("PZ8_TEST_JDBC_URL");
    DriverManagerDataSource ownerSource;
    if (externalUrl == null || externalUrl.isBlank()) {
      container = new PostgreSQLContainer("postgres:18");
      try {
        container.start();
      } catch (RuntimeException failure) {
        container.stop();
        throw failure;
      }
      jdbcUrl = container.getJdbcUrl();
      ownerSource =
          new DriverManagerDataSource(jdbcUrl, container.getUsername(), container.getPassword());
    } else {
      container = null;
      jdbcUrl = externalUrl;
      ownerSource =
          new DriverManagerDataSource(
              jdbcUrl,
              requiredEnvironment("PZ8_TEST_JDBC_USER"),
              requiredEnvironment("PZ8_TEST_JDBC_PASSWORD"));
    }
    owner = new JdbcTemplate(ownerSource);
    HikariDataSource startedRuntime = null;
    HikariDataSource startedMailer = null;
    OidcProviderFixture startedOidc = null;
    boolean runtimeRoleCreated = false;
    boolean mailerRoleCreated = false;
    try {
      try (Connection connection = ownerSource.getConnection()) {
        var database =
            DatabaseFactory.getInstance()
                .findCorrectDatabaseImplementation(new JdbcConnection(connection));
        try (var liquibase =
            new Liquibase(
                "db/changelog/db.changelog-master.yaml",
                new ClassLoaderResourceAccessor(),
                database)) {
          liquibase.update(new liquibase.Contexts(), new liquibase.LabelExpression());
        }
      }
      createLogin(runtimeUser, runtimePassword, "pz8_runtime");
      runtimeRoleCreated = true;
      createLogin(mailerUser, mailerPassword, "pz8_mailer");
      mailerRoleCreated = true;
      runtime = startedRuntime = pool(runtimeUser, runtimePassword);
      mailer = startedMailer = pool(mailerUser, mailerPassword);
      new SecureRandom().nextBytes(encryptionKey);
      oidc = startedOidc = new OidcProviderFixture();
      api = startInstance();
    } catch (Exception | Error failure) {
      for (var app : applications.reversed()) cleanup(failure, app::close);
      if (startedOidc != null) cleanup(failure, startedOidc::close);
      if (startedRuntime != null) cleanup(failure, startedRuntime::close);
      if (startedMailer != null) cleanup(failure, startedMailer::close);
      if (runtimeRoleCreated) cleanup(failure, () -> owner.execute("drop role " + runtimeUser));
      if (mailerRoleCreated) cleanup(failure, () -> owner.execute("drop role " + mailerUser));
      if (container != null) cleanup(failure, container::stop);
      throw failure;
    }
  }

  private void createLogin(String user, String password, String role) {
    owner.execute(
        "create role "
            + user
            + " login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '"
            + password
            + "' in role "
            + role);
  }

  private HikariDataSource pool(String user, String password) {
    var configuration = new HikariConfig();
    configuration.setJdbcUrl(jdbcUrl);
    configuration.setUsername(user);
    configuration.setPassword(password);
    configuration.setMaximumPoolSize(2);
    configuration.setMinimumIdle(0);
    return new HikariDataSource(configuration);
  }

  private static void cleanup(Throwable failure, Runnable action) {
    try {
      action.run();
    } catch (RuntimeException | Error cleanupFailure) {
      failure.addSuppressed(cleanupFailure);
    }
  }

  URI startInstance() throws Exception {
    int port;
    try (var socket = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))) {
      port = socket.getLocalPort();
    }
    URI base = URI.create("http://127.0.0.1:" + port);
    Map<String, Object> properties = new LinkedHashMap<>();
    properties.put("server.port", port);
    properties.put("server.address", "127.0.0.1");
    properties.put("spring.main.banner-mode", "off");
    properties.put("pz8.access.enabled", true);
    properties.put("pz8.access.allow-local-http", true);
    properties.put("pz8.access.jdbc-url", jdbcUrl);
    properties.put("pz8.access.jdbc-username", runtimeUser);
    properties.put("pz8.access.jdbc-password", runtimePassword);
    properties.put("pz8.access.oidc-issuer", oidc.issuer);
    properties.put("pz8.access.oidc-client-id", "pz8");
    properties.put("pz8.access.oidc-client-secret", "fixtures");
    properties.put("pz8.access.frontend-url", FRONTEND);
    properties.put("pz8.access.public-api-url", base);
    properties.put(
        "pz8.access.invitation-encryption-key", Base64.getEncoder().encodeToString(encryptionKey));
    properties.put("pz8.access.mail-from", "invitations@example.test");
    properties.put("pz8.access.mail-dispatch-delay-ms", 86400000);
    var application = new SpringApplication(ApiApplication.class);
    application.addInitializers(
        context ->
            context
                .getEnvironment()
                .getPropertySources()
                .addFirst(
                    new org.springframework.core.env.MapPropertySource(
                        "httpAcceptanceFixture", properties)));
    applications.add(application.run());
    return base;
  }

  UUID identity(OidcProviderFixture.Account account) {
    return owner.queryForObject(
        "select id from pz8.identities where oidc_issuer = ? and oidc_subject = ?",
        UUID.class,
        oidc.issuer.toString(),
        account.subject());
  }

  Tenant tenant(UUID administrator, String name) {
    UUID planzone = UUID.randomUUID();
    UUID client = UUID.randomUUID();
    var transaction =
        new TransactionTemplate(new DataSourceTransactionManager(owner.getDataSource()));
    transaction.executeWithoutResult(
        status -> {
          owner.update(
              "insert into pz8.clients(id, planzone_id, name) values (?, ?, ?)",
              client,
              planzone,
              name);
          owner.update(
              "insert into pz8.planzones(id, client_id, name) values (?, ?, ?)",
              planzone,
              client,
              name);
          owner.update("insert into pz8.planzone_security_state(planzone_id) values (?)", planzone);
          member(planzone, administrator, "administrator");
        });
    return new Tenant(planzone);
  }

  void member(UUID planzone, UUID identity, String role) {
    owner.update(
        "insert into pz8.memberships(planzone_id, identity_id, role) values (?, ?, ?)",
        planzone,
        identity,
        role);
  }

  UUID role(Tenant tenant, String name) {
    return owner.queryForObject(
        "select id from pz8.roles where planzone_id = ? and name = ?",
        UUID.class,
        tenant.id(),
        name);
  }

  String invitationToken(String recipient) {
    var queue =
        new JdbcInvitationWork(
            new PlanzoneUnitOfWork(runtime),
            mailer,
            new SecretKeySpec(encryptionKey, "AES"),
            FRONTEND.resolve("/invitations/accept"));
    var matching =
        queue.claim(100).stream()
            .filter(delivery -> recipient.equals(delivery.recipient()))
            .toList();
    assertThat(matching).as("leased encrypted invitation mail for " + recipient).hasSize(1);
    return OidcProviderFixture.parameters(
            URI.create(matching.getFirst().acceptanceUrl()).getRawQuery())
        .get("token");
  }

  void assertApiCannotReadGlobalMailQueue() {
    var apiJdbc = new JdbcTemplate(runtime);
    assertThatThrownBy(() -> apiJdbc.queryForList("select * from pz8.claim_invitation_mail(1)"))
        .isInstanceOf(DataAccessException.class)
        .satisfies(
            failure ->
                assertThat(((java.sql.SQLException) failure.getCause()).getSQLState())
                    .isEqualTo("42501"));
  }

  private static String requiredEnvironment(String name) {
    String value = System.getenv(name);
    if (value == null || value.isBlank())
      throw new IllegalStateException(name + " is required with PZ8_TEST_JDBC_URL");
    return value;
  }

  @Override
  public void close() {
    var failure = new IllegalStateException("HTTP acceptance fixture cleanup failed");
    for (var app : applications.reversed()) cleanup(failure, app::close);
    cleanup(failure, oidc::close);
    cleanup(failure, runtime::close);
    cleanup(failure, mailer::close);
    cleanup(failure, () -> owner.execute("drop role " + runtimeUser));
    cleanup(failure, () -> owner.execute("drop role " + mailerUser));
    if (container != null) cleanup(failure, container::stop);
    if (failure.getSuppressed().length != 0) throw failure;
  }

  record Tenant(UUID id) {
    String path(String suffix) {
      return "/api/v1/planzones/" + id + suffix;
    }
  }

  static final class Browser {
    private final CookieManager cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
    private final HttpClient client =
        HttpClient.newBuilder()
            .cookieHandler(cookies)
            .connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();
    private URI base;
    private String csrfToken;
    private String csrfHeader;

    Browser(URI base) {
      this.base = base;
    }

    void instance(URI next) {
      base = next;
    }

    HttpResponse<String> get(String path) throws Exception {
      return send(base.resolve(path), "GET", null, null);
    }

    HttpResponse<String> get(URI uri) throws Exception {
      return send(uri, "GET", null, null);
    }

    HttpResponse<String> write(String method, String path, Map<String, ?> body) throws Exception {
      return send(base.resolve(path), method, body, csrfToken);
    }

    HttpResponse<String> writeWithCsrf(
        String method, String path, Map<String, ?> body, String token) throws Exception {
      return send(base.resolve(path), method, body, token);
    }

    private HttpResponse<String> send(URI uri, String method, Map<String, ?> body, String csrf)
        throws Exception {
      var request = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(20));
      if (csrf != null) request.header(csrfHeader == null ? "X-CSRF-TOKEN" : csrfHeader, csrf);
      if (body == null) request.method(method, HttpRequest.BodyPublishers.noBody());
      else
        request
            .header("Content-Type", "application/json")
            .method(
                method, HttpRequest.BodyPublishers.ofString(JSONObjectUtils.toJSONString(body)));
      return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    Map<String, Object> session() throws Exception {
      var response = get("/api/v1/session");
      assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
      Map<String, Object> session = json(response);
      csrfToken = (String) session.get("csrfToken");
      csrfHeader = (String) session.get("csrfHeader");
      assertThat(csrfToken).isNotBlank();
      assertThat(csrfHeader).isNotBlank();
      return session;
    }

    LoginAttempt beginLogin(
        OidcProviderFixture oidc,
        OidcProviderFixture.Account account,
        OidcProviderFixture.TokenFault fault,
        String returnTo)
        throws Exception {
      var login = get("/api/v1/auth/login?returnTo=" + OidcProviderFixture.encode(returnTo));
      assertThat(login.statusCode()).isEqualTo(302);
      assertThat(login.headers().allValues("Set-Cookie"))
          .anySatisfy(
              cookie ->
                  assertThat(cookie).contains("PZ8SESSION=", "HttpOnly", "SameSite=Lax", "Path=/"));
      String preLoginCookie = cookie();
      var authorize = get(base.resolve(login.headers().firstValue("Location").orElseThrow()));
      assertThat(authorize.statusCode()).as(authorize.body()).isEqualTo(302);
      URI authorization = URI.create(authorize.headers().firstValue("Location").orElseThrow());
      assertThat(authorization.getHost()).isEqualTo(oidc.issuer.getHost());
      assertThat(authorization.getPort()).isEqualTo(oidc.issuer.getPort());
      var provider = get(oidc.authorizeAs(authorization, account, fault));
      assertThat(provider.statusCode()).as(provider.body()).isEqualTo(302);
      oidc.assertHealthy();
      return new LoginAttempt(
          URI.create(provider.headers().firstValue("Location").orElseThrow()), preLoginCookie);
    }

    void login(OidcProviderFixture oidc, OidcProviderFixture.Account account, String returnTo)
        throws Exception {
      var attempt = beginLogin(oidc, account, OidcProviderFixture.TokenFault.NONE, returnTo);
      var callback = get(attempt.callback());
      assertThat(callback.statusCode()).as(callback.body()).isEqualTo(302);
      assertThat(callback.headers().firstValue("Location"))
          .contains(FRONTEND.resolve(returnTo).toString());
      assertThat(cookie()).isNotBlank().isNotEqualTo(attempt.preLoginCookie());
      oidc.assertHealthy();
      session();
    }

    String cookie() {
      return cookies.getCookieStore().getCookies().stream()
          .filter(cookie -> "PZ8SESSION".equals(cookie.getName()) && !cookie.hasExpired())
          .map(java.net.HttpCookie::getValue)
          .findFirst()
          .orElse("");
    }
  }

  record LoginAttempt(URI callback, String preLoginCookie) {}

  static Map<String, Object> json(HttpResponse<String> response) throws Exception {
    return JSONObjectUtils.parse(response.body());
  }

  @SuppressWarnings("unchecked")
  static Map<String, Object> object(Map<String, Object> map, String key) {
    return (Map<String, Object>) map.get(key);
  }

  @SuppressWarnings("unchecked")
  static List<Map<String, Object>> objects(Map<String, Object> map, String key) {
    return (List<Map<String, Object>>) map.get(key);
  }
}
