package com.planzone.pz8.people;

import java.util.Objects;
import java.util.UUID;

public record CreateResource(UUID operationId, ResourceType type, String name, String description) {
  public CreateResource {
    Objects.requireNonNull(operationId, "operationId");
    Objects.requireNonNull(type, "type");
    if (type == ResourceType.HUMAN) {
      throw new IllegalArgumentException(
          "Human resources must be registered from an active member");
    }
    name = ResourceProfile.validateName(name);
    description = ResourceProfile.validateDescription(description);
  }
}
