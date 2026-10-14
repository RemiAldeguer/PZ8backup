package com.planzone.pz8.platform.jdbc;

import com.planzone.pz8.identity.IdentityId;
import com.planzone.pz8.people.CreateResource;
import com.planzone.pz8.people.MemberNotAvailableException;
import com.planzone.pz8.people.MemberResourceAlreadyExistsException;
import com.planzone.pz8.people.PeopleSession;
import com.planzone.pz8.people.RegisterMemberResource;
import com.planzone.pz8.people.ResourceCursor;
import com.planzone.pz8.people.ResourceId;
import com.planzone.pz8.people.ResourceNotFoundException;
import com.planzone.pz8.people.ResourceOperationConflictException;
import com.planzone.pz8.people.ResourcePage;
import com.planzone.pz8.people.ResourceProfile;
import com.planzone.pz8.people.ResourceQuery;
import com.planzone.pz8.people.ResourceType;
import com.planzone.pz8.people.ResourceVersionConflictException;
import com.planzone.pz8.planzones.PlanzoneAccessDeniedException;
import com.planzone.pz8.planzones.PlanzoneContext;
import com.planzone.pz8.planzones.PlanzoneId;
import com.planzone.pz8.planzones.PlanzoneRole;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.UUID;
import org.springframework.jdbc.core.RowMapper;

/** Keeps only the guarded scope; a raw JDBC capability never escapes its lifetime. */
final class JdbcPeopleSession implements PeopleSession {
  private static final String COLUMNS =
      "id, planzone_id, name, description, type, identity_id, deactivated, version, created_at, updated_at, role_id, non_editable_fields";
  private static final RowMapper<ResourceProfile> MAPPER =
      (row, index) -> {
        UUID identity = row.getObject("identity_id", UUID.class);
        return new ResourceProfile(
            new ResourceId(row.getObject("id", UUID.class)),
            new PlanzoneId(row.getObject("planzone_id", UUID.class)),
            row.getString("name"),
            row.getString("description"),
            ResourceType.valueOf(row.getString("type")),
            identity == null ? null : new IdentityId(identity),
            row.getBoolean("deactivated"),
            row.getLong("version"),
            row.getTimestamp("created_at").toInstant(),
            row.getTimestamp("updated_at").toInstant(),
            row.getObject("role_id", UUID.class),
            Arrays.asList((String[]) row.getArray("non_editable_fields").getArray()));
      };
  private final PlanzoneTransaction scope;

  JdbcPeopleSession(PlanzoneTransaction scope) {
    this.scope = scope;
  }

  public PlanzoneContext context() {
    return scope.context();
  }

  public PlanzoneRole role() {
    return scope.role();
  }

  public boolean hasCapability(String capability) {
    return Boolean.TRUE.equals(
        scope
            .jdbc()
            .queryForObject(
                "select pz8.has_capability(?, ?)",
                Boolean.class,
                context().planzoneId().value(),
                capability));
  }

  public boolean resourceFieldEditable(String field) {
    return Boolean.TRUE.equals(
        scope
            .jdbc()
            .queryForObject(
                "select pz8.resource_field_editable(?, ?)",
                Boolean.class,
                context().planzoneId().value(),
                field));
  }

  public ResourceProfile create(CreateResource command) {
    requireCapability("resource:create");
    return create(
        command.operationId(),
        "CREATE",
        command.type(),
        command.name(),
        command.description(),
        null);
  }

  public ResourceProfile registerMember(RegisterMemberResource command) {
    requireCapability("resource:manage-access");
    return create(
        command.operationId(),
        "REGISTER_MEMBER",
        ResourceType.HUMAN,
        command.name(),
        command.description(),
        command.identityId());
  }

  private ResourceProfile create(
      UUID operationId,
      String operationKind,
      ResourceType type,
      String name,
      String description,
      IdentityId identityId) {
    String fingerprint = fingerprint(type, name, description, identityId);
    UUID resourceId = UUID.randomUUID();
    int claimed =
        scope
            .jdbc()
            .update(
                "insert into pz8.resource_operations "
                    + "(planzone_id, actor_id, operation_kind, operation_id, fingerprint, resource_id) "
                    + "values (?, ?, ?, ?, ?, ?) on conflict "
                    + "(planzone_id, actor_id, operation_kind, operation_id) do nothing",
                context().planzoneId().value(),
                context().identityId().value(),
                operationKind,
                operationId,
                fingerprint,
                resourceId);
    if (claimed == 0) {
      Receipt receipt =
          scope
              .jdbc()
              .queryForObject(
                  "select fingerprint, resource_id from pz8.resource_operations "
                      + "where planzone_id = ? and actor_id = ? and operation_kind = ? and operation_id = ?",
                  (row, index) ->
                      new Receipt(
                          row.getString("fingerprint"),
                          new ResourceId(row.getObject("resource_id", UUID.class))),
                  context().planzoneId().value(),
                  context().identityId().value(),
                  operationKind,
                  operationId);
      if (receipt == null || !receipt.fingerprint().equals(fingerprint)) {
        throw new ResourceOperationConflictException();
      }
      return getAfterAuthorizedCommand(receipt.resourceId());
    }
    if (identityId != null
        && !Boolean.TRUE.equals(
            scope
                .jdbc()
                .queryForObject(
                    "select pz8.member_available_for_resource(?)",
                    Boolean.class,
                    identityId.value()))) {
      throw new MemberNotAvailableException();
    }
    String sql =
        "insert into pz8.resources (planzone_id, id, type, name, description, identity_id) "
            + "values (?, ?, ?, ?, ?, ?)";
    if (identityId != null) {
      // Only the scoped member uniqueness is converted into this business error.
      sql += " on conflict (planzone_id, identity_id) do nothing";
    }
    var rows =
        scope
            .jdbc()
            .query(
                sql + " returning " + COLUMNS,
                MAPPER,
                context().planzoneId().value(),
                resourceId,
                type.name(),
                name,
                description,
                identityId == null ? null : identityId.value());
    if (rows.isEmpty()) {
      throw new MemberResourceAlreadyExistsException();
    }
    ResourceProfile resource = rows.getFirst();
    audit(resource, operationId, identityId == null ? "CREATED" : "REGISTERED_MEMBER");
    return resource;
  }

  public ResourceProfile get(ResourceId id) {
    requireCapability("resource:read");
    return getAfterAuthorizedCommand(id);
  }

  private ResourceProfile getAfterAuthorizedCommand(ResourceId id) {
    var rows =
        scope
            .jdbc()
            .query(
                "select " + COLUMNS + " from pz8.resources where planzone_id = ? and id = ?",
                MAPPER,
                context().planzoneId().value(),
                id.value());
    if (rows.isEmpty()) {
      throw new ResourceNotFoundException();
    }
    return rows.getFirst();
  }

  public ResourcePage list(ResourceQuery query) {
    requireCapability("resource:read");
    String sql =
        "select "
            + COLUMNS
            + " from pz8.resources where planzone_id = ? and name ilike ? escape '\\'";
    var parameters = new ArrayList<Object>();
    parameters.add(context().planzoneId().value());
    parameters.add(
        query.namePrefix().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%");
    if (query.type() != null) {
      sql += " and type = ?";
      parameters.add(query.type().name());
    }
    if (query.deactivated() != null) {
      sql += " and deactivated = ?";
      parameters.add(query.deactivated());
    }
    if (query.after() != null) {
      sql += " and (name collate \"C\", id) > (? collate \"C\", ?)";
      parameters.add(query.after().name());
      parameters.add(query.after().id().value());
    }
    sql += " order by name collate \"C\", id limit ?";
    parameters.add(query.limit() + 1);
    var rows = scope.jdbc().query(sql, MAPPER, parameters.toArray());
    boolean more = rows.size() > query.limit();
    var items = rows.subList(0, Math.min(rows.size(), query.limit()));
    ResourceCursor next =
        more ? new ResourceCursor(items.getLast().name(), items.getLast().id()) : null;
    return new ResourcePage(items, next);
  }

  public ResourceProfile rename(ResourceId id, long expectedVersion, String name) {
    requireCapability("resource:edit");
    if (!resourceFieldEditable("name")) {
      throw new PlanzoneAccessDeniedException();
    }
    if (expectedVersion < 0) {
      throw new IllegalArgumentException("Expected version must be nonnegative");
    }
    String normalizedName = ResourceProfile.validateName(name);
    var rows =
        scope
            .jdbc()
            .query(
                "update pz8.resources set name = ?, version = version + 1, updated_at = clock_timestamp() "
                    + "where planzone_id = ? and id = ? and version = ? returning "
                    + COLUMNS,
                MAPPER,
                normalizedName,
                context().planzoneId().value(),
                id.value(),
                expectedVersion);
    if (rows.isEmpty()) {
      ResourceProfile current = getAfterAuthorizedCommand(id);
      if (current.nonEditableFields().contains("name")) {
        throw new PlanzoneAccessDeniedException();
      }
      throw new ResourceVersionConflictException();
    }
    ResourceProfile resource = rows.getFirst();
    audit(resource, UUID.randomUUID(), "RENAMED");
    return resource;
  }

  private void audit(ResourceProfile resource, UUID operationId, String eventType) {
    scope
        .jdbc()
        .update(
            "insert into pz8.resource_audit "
                + "(id, planzone_id, resource_id, actor_id, operation_id, event_type, resource_type, resource_version) "
                + "values (?, ?, ?, ?, ?, ?, ?, ?)",
            UUID.randomUUID(),
            context().planzoneId().value(),
            resource.id().value(),
            context().identityId().value(),
            operationId,
            eventType,
            resource.type().name(),
            resource.version());
  }

  private void requireCapability(String capability) {
    if (!hasCapability(capability)) {
      throw new PlanzoneAccessDeniedException();
    }
  }

  private static String fingerprint(
      ResourceType type, String name, String description, IdentityId identityId) {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      for (String field :
          new String[] {
            type.name(), name, description, identityId == null ? "" : identityId.value().toString()
          }) {
        byte[] bytes = field.getBytes(StandardCharsets.UTF_8);
        digest.update(ByteBuffer.allocate(Integer.BYTES).putInt(bytes.length).array());
        digest.update(bytes);
      }
      return HexFormat.of().formatHex(digest.digest());
    } catch (NoSuchAlgorithmException exception) {
      throw new IllegalStateException("SHA-256 is required by the Java runtime", exception);
    }
  }

  private record Receipt(String fingerprint, ResourceId resourceId) {}
}
