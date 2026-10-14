package com.planzone.pz8.platform.jdbc;

import com.planzone.pz8.identity.IdentityId;
import com.planzone.pz8.planzones.PlanzoneContext;
import com.planzone.pz8.planzones.PlanzoneId;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.sql.Connection;
import java.util.UUID;
import liquibase.Liquibase;
import liquibase.database.DatabaseFactory;
import liquibase.database.jvm.JdbcConnection;
import liquibase.resource.ClassLoaderResourceAccessor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.postgresql.PostgreSQLContainer;

/**
 * External URL must identify a disposable dedicated cluster: installation also creates global
 * roles.
 */
final class PostgresFixture implements AutoCloseable {
  private final PostgreSQLContainer container;
  private final String jdbcUrl;
  private final String runtimeUser;
  private final String runtimePassword;
  final DriverManagerDataSource owner;
  final HikariDataSource runtime;
  private final java.util.List<String> additionalRuntimeUsers = new java.util.ArrayList<>();

  PostgresFixture() throws Exception {
    runtimeUser = "pz8_test_" + UUID.randomUUID().toString().replace("-", "");
    runtimePassword = UUID.randomUUID().toString();
    String externalUrl = System.getenv("PZ8_TEST_JDBC_URL");
    if (externalUrl == null || externalUrl.isBlank()) {
      container = new PostgreSQLContainer("postgres:18");
      try {
        container.start();
      } catch (RuntimeException failure) {
        container.stop();
        throw failure;
      }
      jdbcUrl = container.getJdbcUrl();
      owner =
          new DriverManagerDataSource(jdbcUrl, container.getUsername(), container.getPassword());
    } else {
      container = null;
      jdbcUrl = externalUrl;
      owner =
          new DriverManagerDataSource(
              jdbcUrl,
              requiredEnvironment("PZ8_TEST_JDBC_USER"),
              requiredEnvironment("PZ8_TEST_JDBC_PASSWORD"));
    }
    HikariDataSource startedPool = null;
    boolean loginCreated = false;
    try {
      try (Connection connection = owner.getConnection()) {
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
      // Generated values contain only UUID characters; credentials are never emitted.
      new JdbcTemplate(owner)
          .execute(
              "create role "
                  + runtimeUser
                  + " login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '"
                  + runtimePassword
                  + "' in role pz8_runtime");
      loginCreated = true;
      startedPool = newRuntimePool(4);
      runtime = startedPool;
    } catch (Exception | Error failure) {
      if (startedPool != null) {
        startedPool.close();
      }
      if (loginCreated) {
        try {
          new JdbcTemplate(owner).execute("drop role " + runtimeUser);
        } catch (RuntimeException cleanupFailure) {
          failure.addSuppressed(cleanupFailure);
        }
      }
      if (container != null) {
        container.stop();
      }
      throw failure;
    }
  }

  HikariDataSource newRuntimePool(int maximumSize) {
    var configuration = new HikariConfig();
    configuration.setJdbcUrl(jdbcUrl);
    configuration.setUsername(runtimeUser);
    configuration.setPassword(runtimePassword);
    configuration.setMaximumPoolSize(maximumSize);
    configuration.setMinimumIdle(0);
    configuration.setConnectionTimeout(5000);
    return new HikariDataSource(configuration);
  }

  javax.sql.DataSource newMailerDataSource() {
    String mailerUser = "pz8_mail_" + UUID.randomUUID().toString().replace("-", "");
    String mailerPassword = UUID.randomUUID().toString();
    new JdbcTemplate(owner)
        .execute(
            "create role "
                + mailerUser
                + " login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '"
                + mailerPassword
                + "' in role pz8_mailer");
    additionalRuntimeUsers.add(mailerUser);
    return new DriverManagerDataSource(jdbcUrl, mailerUser, mailerPassword);
  }

  Tenant tenant() {
    UUID planzone = UUID.randomUUID();
    UUID client = UUID.randomUUID();
    UUID admin = UUID.randomUUID();
    UUID member = UUID.randomUUID();
    var transaction =
        new org.springframework.transaction.support.TransactionTemplate(
            new org.springframework.jdbc.datasource.DataSourceTransactionManager(owner));
    transaction.executeWithoutResult(
        status -> {
          var jdbc = new JdbcTemplate(owner);
          jdbc.update(
              "insert into pz8.clients(id, planzone_id, name) values (?, ?, 'Client')",
              client,
              planzone);
          jdbc.update(
              "insert into pz8.planzones(id, client_id, name) values (?, ?, 'Planzone')",
              planzone,
              client);
          jdbc.update("insert into pz8.planzone_security_state(planzone_id) values (?)", planzone);
          for (UUID identity : new UUID[] {admin, member}) {
            jdbc.update(
                "insert into pz8.identities(id, oidc_issuer, oidc_subject) values (?, ?, ?)",
                identity,
                "https://id.example.test",
                identity.toString());
          }
          jdbc.update(
              "insert into pz8.memberships(planzone_id, identity_id, role) values (?, ?, 'administrator')",
              planzone,
              admin);
          jdbc.update(
              "insert into pz8.memberships(planzone_id, identity_id, role) values (?, ?, 'user')",
              planzone,
              member);
        });
    return new Tenant(
        new PlanzoneContext(new IdentityId(admin), new PlanzoneId(planzone)),
        new PlanzoneContext(new IdentityId(member), new PlanzoneId(planzone)));
  }

  private static String requiredEnvironment(String name) {
    String value = System.getenv(name);
    if (value == null || value.isBlank()) {
      throw new IllegalStateException(name + " is required when PZ8_TEST_JDBC_URL is supplied");
    }
    return value;
  }

  @Override
  public void close() {
    try {
      runtime.close();
      new JdbcTemplate(owner).execute("drop role " + runtimeUser);
      for (String additional : additionalRuntimeUsers) {
        new JdbcTemplate(owner).execute("drop role " + additional);
      }
    } finally {
      if (container != null) {
        container.stop();
      }
    }
  }

  record Tenant(PlanzoneContext administrator, PlanzoneContext member) {}
}
