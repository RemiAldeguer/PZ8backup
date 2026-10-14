package com.planzone.pz8.access;

import java.util.Objects;
import java.util.UUID;

public record RoleDefinition(UUID id, String name, String label) {
  public RoleDefinition {
    Objects.requireNonNull(id, "id");
    Objects.requireNonNull(name, "name");
    Objects.requireNonNull(label, "label");
  }
}
