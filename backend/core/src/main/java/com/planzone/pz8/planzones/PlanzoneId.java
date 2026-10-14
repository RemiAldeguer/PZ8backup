package com.planzone.pz8.planzones;

import java.util.Objects;
import java.util.UUID;

public record PlanzoneId(UUID value) {
  public PlanzoneId {
    Objects.requireNonNull(value, "planzoneId");
  }
}
