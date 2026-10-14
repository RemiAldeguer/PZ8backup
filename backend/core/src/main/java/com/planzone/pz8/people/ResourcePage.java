package com.planzone.pz8.people;

import java.util.List;

public record ResourcePage(List<ResourceProfile> items, ResourceCursor next) {
  public ResourcePage {
    items = List.copyOf(items);
  }
}
