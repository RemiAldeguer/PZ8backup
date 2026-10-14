package com.planzone.pz8.platform.jdbc;

import com.planzone.pz8.identity.IdentityId;
import com.planzone.pz8.planzones.PlanzoneContext;
import com.planzone.pz8.planzones.PlanzoneId;
import com.planzone.pz8.planzones.PlanzoneRole;
import com.planzone.pz8.planzones.PlanzoneSession;
import com.planzone.pz8.planzones.Zone;
import com.planzone.pz8.planzones.ZoneCursor;
import com.planzone.pz8.planzones.ZoneId;
import com.planzone.pz8.planzones.ZonePage;
import com.planzone.pz8.planzones.ZoneQuery;
import java.util.ArrayList;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcOperations;
import org.springframework.jdbc.core.RowMapper;

/** Valid only during the callback, with no public raw JDBC access. */
final class PlanzoneTransaction implements PlanzoneSession {
  private static final RowMapper<Zone> MAPPER =
      (row, index) ->
          new Zone(
              new ZoneId(row.getObject("id", UUID.class)),
              new PlanzoneId(row.getObject("planzone_id", UUID.class)),
              row.getString("name"),
              row.getTimestamp("created_at").toInstant());
  private final PlanzoneContext context;
  private final PlanzoneRole role;
  private final JdbcOperations jdbc;
  private final boolean authorityChange;
  private final Thread ownerThread = Thread.currentThread();
  private boolean open = true;

  PlanzoneTransaction(
      PlanzoneContext context, PlanzoneRole role, JdbcOperations jdbc, boolean authorityChange) {
    this.context = context;
    this.role = role;
    this.jdbc = jdbc;
    this.authorityChange = authorityChange;
  }

  public PlanzoneContext context() {
    ensureOpen();
    return context;
  }

  public PlanzoneRole role() {
    ensureOpen();
    return role;
  }

  JdbcOperations jdbc() {
    ensureOpen();
    return jdbc;
  }

  public Zone createZone(String name) {
    ensureOpen();
    UUID id = UUID.randomUUID();
    jdbc.update(
        "insert into pz8.zones (id, planzone_id, name) values (?, ?, ?)",
        id,
        context.planzoneId().value(),
        Zone.validateName(name));
    // The following statement sees the inserted row and its AFTER INSERT membership.
    // SELECT RLS cannot resolve this new scope during INSERT ... RETURNING.
    return jdbc.queryForObject(
        "select id, planzone_id, name, created_at from pz8.zones where planzone_id=? and id=?",
        MAPPER,
        context.planzoneId().value(),
        id);
  }

  public boolean zoneCreationAllowed() {
    ensureOpen();
    return Boolean.TRUE.equals(
        jdbc.queryForObject(
            "select pz8.has_global_scope_privilege(?,'zone:create')",
            Boolean.class,
            context.planzoneId().value()));
  }

  public ZonePage listZones(ZoneQuery query) {
    ensureOpen();
    String sql =
        "select id, planzone_id, name, created_at from pz8.zones "
            + "where planzone_id = ? and name ilike ? escape '\\'";
    var parameters = new ArrayList<Object>();
    parameters.add(context.planzoneId().value());
    parameters.add(
        query.namePrefix().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%");
    if (query.after() != null) {
      sql += " and (name collate \"C\", id) > (? collate \"C\", ?)";
      parameters.add(query.after().name());
      parameters.add(query.after().id().value());
    }
    sql += " order by name collate \"C\", id limit ?";
    parameters.add(query.limit() + 1);
    var rows = jdbc.query(sql, MAPPER, parameters.toArray());
    boolean more = rows.size() > query.limit();
    var items = rows.subList(0, Math.min(rows.size(), query.limit()));
    ZoneCursor next = more ? new ZoneCursor(items.getLast().name(), items.getLast().id()) : null;
    return new ZonePage(items, next);
  }

  public boolean revokeMembership(IdentityId member) {
    ensureOpen();
    if (!authorityChange) {
      throw new IllegalStateException("Authority changes must acquire the exclusive lock at entry");
    }
    return Boolean.TRUE.equals(
        jdbc.queryForObject("select pz8.revoke_membership(?)", Boolean.class, member.value()));
  }

  void close() {
    open = false;
  }

  private void ensureOpen() {
    if (Thread.currentThread() != ownerThread) {
      throw new IllegalStateException("A new thread must acquire its own Planzone unit of work");
    }
    if (!open) {
      throw new IllegalStateException("Planzone transaction has ended");
    }
  }
}
