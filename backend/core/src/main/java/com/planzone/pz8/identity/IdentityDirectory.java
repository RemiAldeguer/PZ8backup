package com.planzone.pz8.identity;

import java.util.Optional;

/** Call only after OIDC verification; lookup never grants Planzone membership. */
public interface IdentityDirectory {
  Optional<IdentityId> findVerifiedOidcIdentity(String issuer, String subject);
}
