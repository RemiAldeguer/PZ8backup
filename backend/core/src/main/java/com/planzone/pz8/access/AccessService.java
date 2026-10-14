package com.planzone.pz8.access;

import com.planzone.pz8.people.ResourceId;
import com.planzone.pz8.planzones.PlanzoneContext;
import java.util.Set;
import java.util.UUID;

/** Small public contract; all operations resolve current authority inside a transaction. */
public interface AccessService {
  AccessPolicy get(PlanzoneContext context);

  void assign(
      PlanzoneContext context, ResourceId resource, UUID roleId, Set<String> nonEditableFields);
}
