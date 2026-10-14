package com.planzone.pz8.projects;

import java.util.Set;
import java.util.UUID;

public record ScopedZone(
    UUID id,
    UUID planzoneId,
    String name,
    boolean savingTemplates,
    long version,
    Set<String> permissions,
    Set<String> editableFields) {
  public ScopedZone {
    permissions = Set.copyOf(permissions);
    editableFields = Set.copyOf(editableFields);
  }
}
