package com.planzone.pz8.platform.jdbc;

import com.planzone.pz8.access.AccessPolicy;
import com.planzone.pz8.access.AccessService;
import com.planzone.pz8.access.RoleDefinition;
import com.planzone.pz8.access.RoleNotAvailableException;
import com.planzone.pz8.people.ResourceId;
import com.planzone.pz8.people.ResourceNotFoundException;
import com.planzone.pz8.planzones.PlanzoneAccessDeniedException;
import com.planzone.pz8.planzones.PlanzoneContext;
import java.util.Arrays;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

public final class JdbcAccessService implements AccessService {
  private final PlanzoneUnitOfWork unitOfWork;

  public JdbcAccessService(PlanzoneUnitOfWork unitOfWork) {
    this.unitOfWork = Objects.requireNonNull(unitOfWork, "unitOfWork");
  }

  public AccessPolicy get(PlanzoneContext context) {
    return unitOfWork.executeJdbc(context, JdbcAccessService::readPolicy);
  }

  static AccessPolicy readPolicy(PlanzoneTransaction scope) {
    UUID selected = scope.context().planzoneId().value();
    var permissions =
        scope
            .jdbc()
            .queryForObject(
                "select pz8.access_permissions(?)",
                (row, index) -> Set.copyOf(Arrays.asList((String[]) row.getArray(1).getArray())),
                selected);
    var editable =
        scope
            .jdbc()
            .queryForObject(
                "select pz8.editable_resource_fields(?)",
                (row, index) -> Set.copyOf(Arrays.asList((String[]) row.getArray(1).getArray())),
                selected);
    var roles =
        scope
            .jdbc()
            .query(
                "select id, name, label from pz8.access_roles(?)",
                (row, index) ->
                    new RoleDefinition(
                        row.getObject("id", UUID.class),
                        row.getString("name"),
                        row.getString("label")),
                selected);
    return new AccessPolicy(
        permissions, editable, roles, permissions.contains("resource:manage-access"));
  }

  public void assign(
      PlanzoneContext context, ResourceId resource, UUID roleId, Set<String> nonEditableFields) {
    Objects.requireNonNull(resource, "resource");
    Objects.requireNonNull(roleId, "roleId");
    var fields = Set.copyOf(Objects.requireNonNull(nonEditableFields, "nonEditableFields"));
    unitOfWork.executeAuthorityJdbc(
        context,
        scope -> {
          if (!readPolicy(scope).permissions().contains("resource:manage-access")) {
            throw new PlanzoneAccessDeniedException();
          }
          String result =
              scope
                  .jdbc()
                  .queryForObject(
                      "select pz8.assign_resource_access(?, ?, ?::text[])",
                      String.class,
                      resource.value(),
                      roleId,
                      fields.stream().sorted().toArray(String[]::new));
          switch (Objects.requireNonNull(result)) {
            case "ok" -> {}
            case "role_unavailable" -> throw new RoleNotAvailableException();
            case "resource_unavailable" -> throw new ResourceNotFoundException();
            case "invalid_fields" -> throw new IllegalArgumentException("Unknown resource field");
            default -> throw new PlanzoneAccessDeniedException();
          }
          return null;
        });
  }
}
