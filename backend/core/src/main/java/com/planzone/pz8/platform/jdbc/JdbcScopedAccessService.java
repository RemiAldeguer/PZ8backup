package com.planzone.pz8.platform.jdbc;

import com.planzone.pz8.people.ResourceId;
import com.planzone.pz8.people.ResourceType;
import com.planzone.pz8.planzones.PlanzoneContext;
import com.planzone.pz8.planzones.ZoneId;
import com.planzone.pz8.projects.*;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.function.Supplier;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.RowMapper;

/** Every read and team change rechecks the selected client and its live scoped authority. */
public final class JdbcScopedAccessService implements ScopedAccessService {
  private final PlanzoneUnitOfWork work;
  private static final RowMapper<ZoneMemberView> ZONE_MEMBER =
      (row, index) ->
          new ZoneMemberView(
              row.getObject("resource_id", UUID.class),
              row.getString("name"),
              ResourceType.valueOf(row.getString("type")));
  private static final RowMapper<ProjectMemberView> PROJECT_MEMBER =
      (row, index) ->
          new ProjectMemberView(
              row.getObject("resource_id", UUID.class),
              row.getString("name"),
              ResourceType.valueOf(row.getString("type")),
              row.getObject("role_id", UUID.class),
              row.getBoolean("deactivated"),
              row.getLong("version"),
              ids(row, "allowed_role_ids"));
  private static final RowMapper<ScopeCandidate> CANDIDATE =
      (row, index) ->
          new ScopeCandidate(
              row.getObject("resource_id", UUID.class),
              row.getString("name"),
              ResourceType.valueOf(row.getString("type")),
              ids(row, "allowed_role_ids"));

  public JdbcScopedAccessService(PlanzoneUnitOfWork work) {
    this.work = Objects.requireNonNull(work, "work");
  }

  public ScopePage<ScopedZone> listZones(PlanzoneContext context, ScopeQuery query) {
    Objects.requireNonNull(query, "query");
    return read(
        context,
        scope -> {
          var parameters = paging(context, query);
          var rows =
              scope
                  .jdbc()
                  .query(
                      "select id,planzone_id,name,saving_templates,version,pz8.scope_zone_permissions(planzone_id,id) permissions,pz8.scope_zone_fields(planzone_id,id) editable_fields "
                          + "from pz8.zones where planzone_id=? and name ilike ? escape '\\' "
                          + "and (?::uuid is null or (name collate \"C\",id)>(? collate \"C\",?::uuid)) order by name collate \"C\",id limit ?",
                      (row, index) ->
                          new ScopedZone(
                              row.getObject("id", UUID.class),
                              row.getObject("planzone_id", UUID.class),
                              row.getString("name"),
                              row.getBoolean("saving_templates"),
                              row.getLong("version"),
                              strings(row, "permissions"),
                              strings(row, "editable_fields")),
                      parameters.toArray());
          return page(rows, query, item -> new ScopeCursor(item.name(), item.id()));
        });
  }

  public ScopePage<ScopedProject> listProjects(
      PlanzoneContext context, ZoneId zone, ScopeQuery query) {
    Objects.requireNonNull(query, "query");
    return read(
        context,
        scope -> {
          var parameters = paging(context, query);
          String zoneFilter = "";
          if (zone != null) {
            zoneFilter = " and zone_id=?";
            parameters.add(parameters.size() - 1, zone.value());
          }
          var rows =
              scope
                  .jdbc()
                  .query(
                      "select id,planzone_id,zone_id,name,template,version,pz8.scope_project_privileges(planzone_id,id) permissions,"
                          + "pz8.scope_project_fields(planzone_id,id) editable_fields from pz8.projects where planzone_id=? and name ilike ? escape '\\' "
                          + "and (?::uuid is null or (name collate \"C\",id)>(? collate \"C\",?::uuid))"
                          + zoneFilter
                          + " order by name collate \"C\",id limit ?",
                      (row, index) ->
                          new ScopedProject(
                              row.getObject("id", UUID.class),
                              row.getObject("planzone_id", UUID.class),
                              row.getObject("zone_id", UUID.class),
                              row.getString("name"),
                              row.getBoolean("template"),
                              row.getLong("version"),
                              strings(row, "permissions"),
                              strings(row, "editable_fields")),
                      parameters.toArray());
          return page(rows, query, item -> new ScopeCursor(item.name(), item.id()));
        });
  }

  public List<ProjectRoleDto> projectRoles(PlanzoneContext context) {
    return read(
        context,
        scope ->
            scope
                .jdbc()
                .query(
                    "select * from pz8.scope_role_catalogue()",
                    (row, index) ->
                        new ProjectRoleDto(
                            row.getObject("id", UUID.class),
                            row.getString("name"),
                            row.getString("label"))));
  }

  public ScopePage<ZoneMemberView> zoneMembers(
      PlanzoneContext context, ZoneId zone, ScopeQuery query) {
    return members(
        context,
        false,
        Objects.requireNonNull(zone, "zone").value(),
        false,
        query,
        ZONE_MEMBER,
        item -> new ScopeCursor(item.name(), item.resourceId()));
  }

  public ScopePage<ProjectMemberView> projectMembers(
      PlanzoneContext context, UUID project, ScopeQuery query) {
    return members(
        context,
        true,
        project,
        false,
        query,
        PROJECT_MEMBER,
        item -> new ScopeCursor(item.name(), item.resourceId()));
  }

  public ScopePage<ScopeCandidate> zoneCandidates(
      PlanzoneContext context, ZoneId zone, ScopeQuery query) {
    return members(
        context,
        false,
        Objects.requireNonNull(zone, "zone").value(),
        true,
        query,
        CANDIDATE,
        item -> new ScopeCursor(item.name(), item.resourceId()));
  }

  public ScopePage<ScopeCandidate> projectCandidates(
      PlanzoneContext context, UUID project, ScopeQuery query) {
    return members(
        context,
        true,
        project,
        true,
        query,
        CANDIDATE,
        item -> new ScopeCursor(item.name(), item.resourceId()));
  }

  private <T> ScopePage<T> members(
      PlanzoneContext context,
      boolean project,
      UUID scopeId,
      boolean candidates,
      ScopeQuery query,
      RowMapper<T> mapper,
      Function<T, ScopeCursor> cursor) {
    Objects.requireNonNull(scopeId, "scopeId");
    Objects.requireNonNull(query, "query");
    return read(
        context,
        scope ->
            page(
                scope
                    .jdbc()
                    .query(
                        "select * from pz8.list_scoped_members(?,?,?,?,?,?,?)",
                        mapper,
                        project,
                        scopeId,
                        candidates,
                        query.prefix(),
                        query.limit() + 1,
                        query.after() == null ? null : query.after().name(),
                        query.after() == null ? null : query.after().id()),
                query,
                cursor));
  }

  public ZoneMemberView addZoneMember(PlanzoneContext context, ZoneId zone, ResourceId resource) {
    return mutate(context, false, zone.value(), resource, "ADD", null, false, null, ZONE_MEMBER)
        .getFirst();
  }

  public void removeZoneMember(PlanzoneContext context, ZoneId zone, ResourceId resource) {
    mutate(context, false, zone.value(), resource, "REMOVE", null, false, null, ZONE_MEMBER);
  }

  public ProjectMemberView addProjectMember(
      PlanzoneContext context, UUID project, ResourceId resource, UUID roleId) {
    return mutate(context, true, project, resource, "ADD", roleId, false, null, PROJECT_MEMBER)
        .getFirst();
  }

  public ProjectMemberView updateProjectMember(
      PlanzoneContext context,
      UUID project,
      ResourceId resource,
      UUID roleId,
      boolean deactivated,
      long expectedVersion) {
    if (expectedVersion < 0)
      throw new IllegalArgumentException("Expected member version must be nonnegative");
    return mutate(
            context,
            true,
            project,
            resource,
            "UPDATE",
            roleId,
            deactivated,
            expectedVersion,
            PROJECT_MEMBER)
        .getFirst();
  }

  public void removeProjectMember(PlanzoneContext context, UUID project, ResourceId resource) {
    mutate(context, true, project, resource, "REMOVE", null, false, null, PROJECT_MEMBER);
  }

  private <T> List<T> mutate(
      PlanzoneContext context,
      boolean project,
      UUID scopeId,
      ResourceId resource,
      String operation,
      UUID roleId,
      boolean deactivated,
      Long expectedVersion,
      RowMapper<T> mapper) {
    Objects.requireNonNull(scopeId, "scopeId");
    Objects.requireNonNull(resource, "resource");
    return translate(
        () ->
            work.executeScopedAuthorityJdbc(
                context,
                scope ->
                    scope
                        .jdbc()
                        .query(
                            "select * from pz8.change_scope_member(?,?,?,?,?,?,?)",
                            mapper,
                            project,
                            scopeId,
                            resource.value(),
                            operation,
                            roleId,
                            deactivated,
                            expectedVersion)));
  }

  private <T> T read(PlanzoneContext context, Function<PlanzoneTransaction, T> action) {
    return translate(() -> work.executeJdbc(context, action));
  }

  private static ArrayList<Object> paging(PlanzoneContext context, ScopeQuery query) {
    var parameters = new ArrayList<Object>();
    parameters.add(context.planzoneId().value());
    parameters.add(
        query.prefix().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%");
    parameters.add(query.after() == null ? null : query.after().id());
    parameters.add(query.after() == null ? null : query.after().name());
    parameters.add(query.after() == null ? null : query.after().id());
    parameters.add(query.limit() + 1);
    return parameters;
  }

  private static <T> ScopePage<T> page(
      List<T> rows, ScopeQuery query, Function<T, ScopeCursor> cursor) {
    boolean more = rows.size() > query.limit();
    var items = rows.subList(0, Math.min(rows.size(), query.limit()));
    return new ScopePage<>(items, more ? cursor.apply(items.getLast()) : null);
  }

  private static Set<String> strings(ResultSet row, String column) throws SQLException {
    return Set.copyOf(Arrays.asList((String[]) row.getArray(column).getArray()));
  }

  private static List<UUID> ids(ResultSet row, String column) throws SQLException {
    return List.copyOf(Arrays.asList((UUID[]) row.getArray(column).getArray()));
  }

  private static <T> T translate(Supplier<T> action) {
    try {
      return action.get();
    } catch (DataAccessException failure) {
      for (Throwable cause = failure; cause != null; cause = cause.getCause())
        if (cause instanceof SQLException sql) {
          switch (Objects.toString(sql.getSQLState(), "")) {
            case "PZ020":
              throw new ScopeNotFoundException();
            case "PZ021":
              throw new ScopedAccessDeniedException();
            case "PZ022":
              throw new ScopeRoleUnavailableException();
            case "PZ023":
              throw new ScopeVersionConflictException();
            case "PZ024":
              throw new ScopeMemberConflictException();
            default:
              break;
          }
        }
      throw failure;
    }
  }
}
