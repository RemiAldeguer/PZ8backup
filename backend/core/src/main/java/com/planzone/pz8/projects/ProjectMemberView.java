package com.planzone.pz8.projects;

import com.planzone.pz8.people.ResourceType;
import java.util.List;
import java.util.UUID;

public record ProjectMemberView(
    UUID resourceId,
    String name,
    ResourceType type,
    UUID roleId,
    boolean deactivated,
    long version,
    List<UUID> allowedRoleIds) {
  public ProjectMemberView {
    allowedRoleIds = List.copyOf(allowedRoleIds);
  }
}
