package com.planzone.pz8.people;

import com.planzone.pz8.identity.IdentityId;
import java.util.Objects;
import java.util.UUID;

public record RegisterMemberResource(
    UUID operationId, IdentityId identityId, String name, String description) {
  public RegisterMemberResource {
    Objects.requireNonNull(operationId, "operationId");
    Objects.requireNonNull(identityId, "identityId");
    name = ResourceProfile.validateName(name);
    description = ResourceProfile.validateDescription(description);
  }
}
