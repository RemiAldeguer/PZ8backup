package com.planzone.pz8.people;

import java.util.Objects;

/** A paging position never grants authority over a resource. */
public record ResourceCursor(String name, ResourceId id) {
  public ResourceCursor {
    name = ResourceProfile.validateName(name);
    Objects.requireNonNull(id, "id");
  }
}
