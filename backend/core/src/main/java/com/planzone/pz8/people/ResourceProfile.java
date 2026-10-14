package com.planzone.pz8.people;

import com.planzone.pz8.identity.IdentityId;
import com.planzone.pz8.planzones.PlanzoneId;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/** A local business profile; activation of a login or a membership is a separate state. */
public record ResourceProfile(
    ResourceId id,
    PlanzoneId planzoneId,
    String name,
    String description,
    ResourceType type,
    IdentityId identityId,
    boolean deactivated,
    long version,
    Instant createdAt,
    Instant updatedAt,
    UUID roleId,
    List<String> nonEditableFields) {
  public ResourceProfile {
    Objects.requireNonNull(id, "id");
    Objects.requireNonNull(planzoneId, "planzoneId");
    name = validateName(name);
    description = validateDescription(description);
    Objects.requireNonNull(type, "type");
    if (type != ResourceType.HUMAN && identityId != null) {
      throw new IllegalArgumentException("Only human resources can have a login identity");
    }
    if (version < 0) {
      throw new IllegalArgumentException("Resource version must be nonnegative");
    }
    Objects.requireNonNull(createdAt, "createdAt");
    Objects.requireNonNull(updatedAt, "updatedAt");
    nonEditableFields = List.copyOf(nonEditableFields);
  }

  public static String validateName(String name) {
    Objects.requireNonNull(name, "name");
    if (name.length() > 256 || name.indexOf('\0') >= 0 || name.trim().isEmpty()) {
      throw new IllegalArgumentException("Resource name must contain 1 to 256 characters");
    }
    return name.trim();
  }

  public static String validateDescription(String description) {
    String value = description == null ? "" : description;
    if (value.length() > 5000 || value.indexOf('\0') >= 0) {
      throw new IllegalArgumentException(
          "Resource description must contain at most 5000 characters");
    }
    return value;
  }
}
