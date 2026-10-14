package com.planzone.pz8.planzones;

import com.planzone.pz8.identity.IdentityId;
import java.util.Objects;

/** Selected scope and authenticated identity; membership is revalidated in every transaction. */
public record PlanzoneContext(
    IdentityId identityId, PlanzoneId planzoneId, Long expectedSecurityVersion) {
  /** Trusted internal callers without a browser session still undergo current membership checks. */
  public PlanzoneContext(IdentityId identityId, PlanzoneId planzoneId) {
    this(identityId, planzoneId, null);
  }

  public PlanzoneContext {
    Objects.requireNonNull(identityId, "identityId");
    Objects.requireNonNull(planzoneId, "planzoneId");
    if (expectedSecurityVersion != null && expectedSecurityVersion < 0) {
      throw new IllegalArgumentException("Identity version must be nonnegative");
    }
  }
}
