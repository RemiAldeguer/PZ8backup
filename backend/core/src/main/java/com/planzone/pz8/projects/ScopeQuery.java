package com.planzone.pz8.projects;

import java.util.Objects;

public record ScopeQuery(String prefix, int limit, ScopeCursor after) {
  public ScopeQuery {
    prefix = Objects.requireNonNull(prefix, "prefix").strip();
    if (prefix.length() > 256 || prefix.indexOf('\0') >= 0 || limit < 1 || limit > 100)
      throw new IllegalArgumentException("Invalid scope query");
  }

  public static ScopeQuery firstPage(int limit) {
    return new ScopeQuery("", limit, null);
  }
}
