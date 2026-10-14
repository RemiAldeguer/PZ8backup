package com.planzone.pz8.planzones;

import java.time.Instant;
import java.util.Objects;

public record Zone(ZoneId id, PlanzoneId planzoneId, String name, Instant createdAt) {
  public Zone {
    Objects.requireNonNull(id, "id");
    Objects.requireNonNull(planzoneId, "planzoneId");
    name = validateName(name);
    Objects.requireNonNull(createdAt, "createdAt");
  }

  public static String validateName(String name) {
    Objects.requireNonNull(name, "name");
    String normalized = name.strip();
    if (normalized.isEmpty() || normalized.length() > 256 || normalized.indexOf('\0') >= 0) {
      throw new IllegalArgumentException("Zone name must contain 1 to 256 characters");
    }
    return normalized;
  }
}
