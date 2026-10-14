package com.planzone.pz8.projects;

import com.planzone.pz8.people.ResourceType;
import java.util.List;
import java.util.UUID;

public record ScopeCandidate(
    UUID resourceId, String name, ResourceType type, List<UUID> allowedRoleIds) {
  public ScopeCandidate {
    allowedRoleIds = List.copyOf(allowedRoleIds);
  }
}
