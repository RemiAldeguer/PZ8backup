package com.planzone.pz8.platform.jdbc;

import com.planzone.pz8.identity.*;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import javax.sql.DataSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/** Narrow bootstrap catalogue access; lookup and enrolment never grant membership. */
public final class JdbcIdentitySessions implements IdentitySessions {
  private static final RowMapper<IdentitySession> MAPPER =
      (row, index) ->
          new IdentitySession(
              new IdentityId(row.getObject("identity_id", UUID.class)),
              row.getLong("security_version"),
              row.getString("email"),
              row.getBoolean("email_verified"),
              row.getString("display_name"));
  private final JdbcTemplate jdbc;

  public JdbcIdentitySessions(DataSource dataSource) {
    jdbc = new JdbcTemplate(Objects.requireNonNull(dataSource, "dataSource"));
  }

  public Optional<IdentitySession> resolve(VerifiedOidcIdentity verified) {
    Objects.requireNonNull(verified, "verified");
    return jdbc
        .query(
            "select * from pz8.resolve_oidc_identity(?, ?, ?, ?, ?, ?)",
            MAPPER,
            UUID.randomUUID(),
            verified.issuer(),
            verified.subject(),
            verified.email(),
            verified.emailVerified(),
            verified.displayName())
        .stream()
        .findFirst();
  }

  public Optional<IdentitySession> current(IdentityId identity, long securityVersion) {
    Objects.requireNonNull(identity, "identity");
    return jdbc
        .query(
            "select * from pz8.current_identity_session(?, ?)",
            MAPPER,
            identity.value(),
            securityVersion)
        .stream()
        .findFirst();
  }

  public List<AccessiblePlanzone> planzones(IdentityId identity, long securityVersion) {
    Objects.requireNonNull(identity, "identity");
    return List.copyOf(
        jdbc.query(
            "select * from pz8.accessible_planzones(?, ?)",
            (row, index) ->
                new AccessiblePlanzone(
                    row.getObject("planzone_id", UUID.class),
                    row.getString("name"),
                    row.getObject("resource_id", UUID.class)),
            identity.value(),
            securityVersion));
  }
}
