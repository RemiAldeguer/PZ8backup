package com.planzone.pz8.people;

import com.planzone.pz8.planzones.PlanzoneAccessDeniedException;
import com.planzone.pz8.planzones.PlanzoneContext;
import java.util.Objects;
import java.util.function.Function;

/** Public resource operations require the qualified PZ7 capability for each command. */
public final class ResourceService {
  private final PeopleWork unitOfWork;

  public ResourceService(PeopleWork unitOfWork) {
    this.unitOfWork = Objects.requireNonNull(unitOfWork, "unitOfWork");
  }

  public ResourceProfile create(PlanzoneContext context, CreateResource command) {
    Objects.requireNonNull(command, "command");
    return execute(context, "resource:create", session -> session.create(command));
  }

  public ResourceProfile registerMember(PlanzoneContext context, RegisterMemberResource command) {
    Objects.requireNonNull(command, "command");
    return execute(context, "resource:manage-access", session -> session.registerMember(command));
  }

  public ResourceProfile get(PlanzoneContext context, ResourceId id) {
    Objects.requireNonNull(id, "id");
    return execute(context, "resource:read", session -> session.get(id));
  }

  public ResourcePage list(PlanzoneContext context, ResourceQuery query) {
    Objects.requireNonNull(query, "query");
    return execute(context, "resource:read", session -> session.list(query));
  }

  public ResourceProfile rename(
      PlanzoneContext context, ResourceId id, long expectedVersion, String name) {
    Objects.requireNonNull(id, "id");
    if (expectedVersion < 0) {
      throw new IllegalArgumentException("Expected version must be nonnegative");
    }
    String normalizedName = ResourceProfile.validateName(name);
    return execute(
        context,
        "resource:edit",
        session -> {
          if (!session.resourceFieldEditable("name")) {
            throw new PlanzoneAccessDeniedException();
          }
          return session.rename(id, expectedVersion, normalizedName);
        });
  }

  private <T> T execute(
      PlanzoneContext context, String capability, Function<PeopleSession, T> work) {
    return unitOfWork.execute(
        context,
        session -> {
          if (!session.hasCapability(capability)) {
            throw new PlanzoneAccessDeniedException();
          }
          return work.apply(session);
        });
  }
}
