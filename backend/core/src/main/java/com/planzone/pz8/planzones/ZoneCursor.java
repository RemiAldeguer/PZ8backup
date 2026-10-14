package com.planzone.pz8.planzones;

import java.util.Objects;

/** Cursor is only a paging position, never proof of access. */
public record ZoneCursor(String name, ZoneId id) {
  public ZoneCursor {
    name = Zone.validateName(name);
    Objects.requireNonNull(id, "id");
  }
}
