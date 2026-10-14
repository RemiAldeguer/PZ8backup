package com.planzone.pz8.projects;

import java.util.Set;
import java.util.UUID;

public record ScopedProject(
    UUID id,
    UUID planzoneId,
    UUID zoneId,
    String name,
    boolean template,
    long version,
    Set<String> permissions,
    Set<String> editableFields) {
  public ScopedProject {
    permissions = Set.copyOf(permissions);
    editableFields = Set.copyOf(editableFields);
  }
}
