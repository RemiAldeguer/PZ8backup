package com.planzone.pz8.planzones;

import com.planzone.pz8.identity.IdentityId;

/** Scoped operations are available only inside PlanzoneWork's callback. */
public interface PlanzoneSession {
  PlanzoneContext context();

  PlanzoneRole role();

  boolean zoneCreationAllowed();

  Zone createZone(String name);

  ZonePage listZones(ZoneQuery query);

  boolean revokeMembership(IdentityId member);
}
