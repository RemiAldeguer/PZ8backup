package com.planzone.pz8.projects;

import java.util.List;

public record ScopePage<T>(List<T> items, ScopeCursor next) {
  public ScopePage {
    items = List.copyOf(items);
  }
}
