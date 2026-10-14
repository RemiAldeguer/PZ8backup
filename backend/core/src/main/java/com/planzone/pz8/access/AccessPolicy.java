package com.planzone.pz8.access;

import java.util.List;
import java.util.Set;

/** Qualified PZ7 capabilities for the authenticated local profile. */
public record AccessPolicy(
    Set<String> permissions,
    Set<String> editableResourceFields,
    List<RoleDefinition> roles,
    boolean canManageRoles) {
  public AccessPolicy {
    permissions = Set.copyOf(permissions);
    editableResourceFields = Set.copyOf(editableResourceFields);
    roles = List.copyOf(roles);
  }
}
