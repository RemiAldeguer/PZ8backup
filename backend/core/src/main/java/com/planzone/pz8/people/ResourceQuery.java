package com.planzone.pz8.people;

import java.util.Objects;

public record ResourceQuery(
    String namePrefix, ResourceType type, Boolean deactivated, int limit, ResourceCursor after) {
  public ResourceQuery {
    namePrefix = Objects.requireNonNull(namePrefix, "namePrefix");
    if (namePrefix.length() > 256 || namePrefix.indexOf('\0') >= 0) {
      throw new IllegalArgumentException("Resource prefix must contain at most 256 characters");
    }
    if (limit < 1 || limit > 100) {
      throw new IllegalArgumentException("Page limit must be between 1 and 100");
    }
  }

  public static ResourceQuery firstPage(int limit) {
    return new ResourceQuery("", null, null, limit, null);
  }
}
