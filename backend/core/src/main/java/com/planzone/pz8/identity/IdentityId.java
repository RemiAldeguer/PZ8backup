package com.planzone.pz8.identity;

import java.util.Objects;
import java.util.UUID;

public record IdentityId(UUID value) {
  public IdentityId {
    Objects.requireNonNull(value, "identityId");
  }
}
