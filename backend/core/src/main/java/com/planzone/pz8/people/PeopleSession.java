package com.planzone.pz8.people;

import com.planzone.pz8.planzones.PlanzoneContext;
import com.planzone.pz8.planzones.PlanzoneRole;

/** A persistence capability valid only during its unit-of-work callback. */
public interface PeopleSession {
  PlanzoneContext context();

  PlanzoneRole role();

  boolean hasCapability(String capability);

  boolean resourceFieldEditable(String field);

  ResourceProfile create(CreateResource command);

  ResourceProfile registerMember(RegisterMemberResource command);

  ResourceProfile get(ResourceId id);

  ResourcePage list(ResourceQuery query);

  ResourceProfile rename(ResourceId id, long expectedVersion, String name);
}
