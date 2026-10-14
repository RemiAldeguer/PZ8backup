package com.planzone.pz8.platform.jdbc;

import com.planzone.pz8.identity.IdentitySessionExpiredException;
import com.planzone.pz8.planzones.PlanzoneAccessDeniedException;
import com.planzone.pz8.planzones.PlanzoneContext;
import com.planzone.pz8.planzones.PlanzoneRole;
import com.planzone.pz8.planzones.PlanzoneSession;
import com.planzone.pz8.planzones.PlanzoneWork;
import java.util.Objects;
import java.util.function.Function;
import javax.sql.DataSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

public final class PlanzoneUnitOfWork implements PlanzoneWork {
  private final TransactionTemplate transaction;
  private final JdbcTemplate jdbc;

  public PlanzoneUnitOfWork(DataSource dataSource) {
    Objects.requireNonNull(dataSource, "dataSource");
    transaction = new TransactionTemplate(new DataSourceTransactionManager(dataSource));
    transaction.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
    transaction.setTimeout(30);
    jdbc = new JdbcTemplate(dataSource);
  }

  public <T> T execute(PlanzoneContext context, Function<PlanzoneSession, T> work) {
    Objects.requireNonNull(work, "work");
    return execute(context, scoped -> work.apply(scoped), false);
  }

  /** Acquires the exclusive Planzone authority lock immediately, before any rights modification. */
  public <T> T executeAuthorityChange(PlanzoneContext context, Function<PlanzoneSession, T> work) {
    Objects.requireNonNull(work, "work");
    return execute(context, scoped -> work.apply(scoped), true);
  }

  <T> T executeJdbc(PlanzoneContext context, Function<PlanzoneTransaction, T> work) {
    return execute(context, work, false);
  }

  <T> T executeAuthorityJdbc(PlanzoneContext context, Function<PlanzoneTransaction, T> work) {
    return execute(context, work, true);
  }

  <T> T executeScopedAuthorityJdbc(PlanzoneContext context, Function<PlanzoneTransaction, T> work) {
    return execute(context, work, true, false);
  }

  private <T> T execute(
      PlanzoneContext context, Function<PlanzoneTransaction, T> work, boolean authorityChange) {
    return execute(context, work, authorityChange, authorityChange);
  }

  private <T> T execute(
      PlanzoneContext context,
      Function<PlanzoneTransaction, T> work,
      boolean authorityChange,
      boolean requiresAdministrator) {
    Objects.requireNonNull(context, "An explicit authenticated Planzone context is required");
    Objects.requireNonNull(work, "work");
    if (TransactionSynchronizationManager.isActualTransactionActive()) {
      throw new IllegalStateException("A Planzone unit of work must own its transaction");
    }
    return transaction.execute(
        status -> {
          if (context.expectedSecurityVersion() != null
              && !Boolean.TRUE.equals(
                  jdbc.queryForObject(
                      "select pz8.check_identity_session(?, ?)",
                      Boolean.class,
                      context.identityId().value(),
                      context.expectedSecurityVersion()))) {
            throw new IdentitySessionExpiredException();
          }
          String role =
              jdbc.queryForObject(
                  "select pz8.authorize_planzone(?, ?, ?)",
                  String.class,
                  context.identityId().value(),
                  context.planzoneId().value(),
                  authorityChange);
          if (role == null) {
            throw new PlanzoneAccessDeniedException();
          }
          if (requiresAdministrator && !"administrator".equals(role)) {
            throw new PlanzoneAccessDeniedException();
          }
          jdbc.queryForObject(
              "select set_config('pz8.identity_id', ?, true)",
              String.class,
              context.identityId().value().toString());
          jdbc.queryForObject(
              "select set_config('pz8.planzone_id', ?, true)",
              String.class,
              context.planzoneId().value().toString());
          var scoped =
              new PlanzoneTransaction(
                  context,
                  PlanzoneRole.valueOf(role.toUpperCase(java.util.Locale.ROOT)),
                  jdbc,
                  authorityChange);
          try {
            return work.apply(scoped);
          } finally {
            scoped.close();
          }
        });
  }
}
