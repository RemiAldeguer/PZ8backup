package com.planzone.pz8.planzones;

import java.util.Objects;

public record ZoneQuery(String namePrefix, int limit, ZoneCursor after) {
  public ZoneQuery {
    namePrefix = Objects.requireNonNull(namePrefix, "namePrefix").strip();
    if (namePrefix.length() > 256 || namePrefix.indexOf('\0') >= 0) {
      throw new IllegalArgumentException("Zone prefix must contain at most 256 characters");
    }
    if (limit < 1 || limit > 100) {
      throw new IllegalArgumentException("Page limit must be between 1 and 100");
    }
  }

  public static ZoneQuery firstPage(int limit) {
    return new ZoneQuery("", limit, null);
  }
}
