package com.planzone.pz8.planzones;

import java.util.Objects;

/** First internal use case; HTTP/idempotency and audit/outbox are a later slice. */
public final class ZoneService {
  private final PlanzoneWork unitOfWork;

  public ZoneService(PlanzoneWork unitOfWork) {
    this.unitOfWork = Objects.requireNonNull(unitOfWork, "unitOfWork");
  }

  public Zone create(PlanzoneContext context, String name) {
    String validatedName = Zone.validateName(name);
    return unitOfWork.execute(
        context,
        transaction -> {
          if (!transaction.zoneCreationAllowed()) {
            throw new PlanzoneAccessDeniedException();
          }
          return transaction.createZone(validatedName);
        });
  }

  public ZonePage list(PlanzoneContext context, ZoneQuery query) {
    Objects.requireNonNull(query, "query");
    return unitOfWork.execute(context, transaction -> transaction.listZones(query));
  }
}
