package com.planzone.pz8.people;

import java.util.Objects;
import java.util.UUID;

public record ResourceId(UUID value) {
  public ResourceId {
    Objects.requireNonNull(value, "resourceId");
  }
}
