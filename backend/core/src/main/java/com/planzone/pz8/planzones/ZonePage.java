package com.planzone.pz8.planzones;

import java.util.List;

public record ZonePage(List<Zone> items, ZoneCursor nextCursor) {
  public ZonePage {
    items = List.copyOf(items);
  }
}
