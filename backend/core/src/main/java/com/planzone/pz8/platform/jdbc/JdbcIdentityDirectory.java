package com.planzone.pz8.platform.jdbc;

import com.planzone.pz8.identity.IdentityDirectory;
import com.planzone.pz8.identity.IdentityId;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import javax.sql.DataSource;
import org.springframework.jdbc.core.JdbcTemplate;

public final class JdbcIdentityDirectory implements IdentityDirectory {
  private final JdbcTemplate jdbc;

  public JdbcIdentityDirectory(DataSource dataSource) {
    jdbc = new JdbcTemplate(Objects.requireNonNull(dataSource, "dataSource"));
  }

  public Optional<IdentityId> findVerifiedOidcIdentity(String issuer, String subject) {
    if (issuer == null
        || issuer.isBlank()
        || issuer.length() > 2048
        || subject == null
        || subject.isBlank()
        || subject.length() > 255) {
      throw new IllegalArgumentException("A verified OIDC issuer and subject are required");
    }
    UUID id =
        jdbc.queryForObject("select pz8.identity_for_oidc(?, ?)", UUID.class, issuer, subject);
    return Optional.ofNullable(id).map(IdentityId::new);
  }
}
