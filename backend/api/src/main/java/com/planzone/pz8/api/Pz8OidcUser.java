package com.planzone.pz8.api;

import com.planzone.pz8.identity.IdentitySession;
import java.util.UUID;
import org.springframework.security.oauth2.core.oidc.user.*;

/** Persisted only in the server session; browser authority is never accepted. */
final class Pz8OidcUser extends DefaultOidcUser {
  private static final long serialVersionUID = 1L;
  private final UUID identityId;
  private final long securityVersion;

  Pz8OidcUser(OidcUser source, IdentitySession identity) {
    super(source.getAuthorities(), source.getIdToken(), source.getUserInfo());
    identityId = identity.id().value();
    securityVersion = identity.securityVersion();
  }

  UUID identityId() {
    return identityId;
  }

  long securityVersion() {
    return securityVersion;
  }
}
