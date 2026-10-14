package com.planzone.pz8.projects;

import java.util.Objects;
import java.util.UUID;

public record ScopeCursor(String name, UUID id) {
  public ScopeCursor {
    Objects.requireNonNull(name, "name");
    Objects.requireNonNull(id, "id");
    if (name.length() > 256 || name.indexOf('\0') >= 0)
      throw new IllegalArgumentException("Invalid scope cursor");
  }
}
