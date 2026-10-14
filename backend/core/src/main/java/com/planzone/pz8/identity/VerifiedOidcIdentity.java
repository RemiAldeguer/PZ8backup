package com.planzone.pz8.identity;

import java.util.Objects;

/** Claims from a successfully verified OIDC authentication, never from a browser request body. */
public record VerifiedOidcIdentity(
    String issuer, String subject, String email, boolean emailVerified, String displayName) {
  public VerifiedOidcIdentity {
    Objects.requireNonNull(issuer, "issuer");
    Objects.requireNonNull(subject, "subject");
    if (issuer.isBlank() || issuer.length() > 2048 || subject.isBlank() || subject.length() > 255) {
      throw new IllegalArgumentException("A verified OIDC issuer and subject are required");
    }
    email = email == null ? null : email.trim();
    if (email != null && (email.isEmpty() || email.length() > 254 || email.indexOf('@') < 1)) {
      throw new IllegalArgumentException("Invalid identity email");
    }
    emailVerified = email != null && emailVerified;
    displayName = displayName == null || displayName.isBlank() ? subject : displayName.trim();
    if (displayName.length() > 256) displayName = displayName.substring(0, 256);
  }
}
