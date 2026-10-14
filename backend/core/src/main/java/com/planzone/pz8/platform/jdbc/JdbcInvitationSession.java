package com.planzone.pz8.platform.jdbc;

import com.planzone.pz8.people.ResourceId;
import com.planzone.pz8.people.invitations.*;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.RowMapper;

final class JdbcInvitationSession {
  private static final RowMapper<InvitationView> MAPPER =
      (row, index) ->
          new InvitationView(
              row.getObject("id", UUID.class),
              new ResourceId(row.getObject("resource_id", UUID.class)),
              row.getString("email"),
              row.getString("first_name"),
              row.getString("last_name"),
              row.getObject("role_id", UUID.class),
              InvitationStatus.valueOf(row.getString("status")),
              row.getTimestamp("expires_at").toInstant(),
              row.getTimestamp("created_at").toInstant());
  private final PlanzoneTransaction scope;
  private final JdbcInvitationWork work;

  JdbcInvitationSession(PlanzoneTransaction scope, JdbcInvitationWork work) {
    this.scope = scope;
    this.work = work;
  }

  InvitationView create(InviteCommand command, Instant expiresAt) {
    String fingerprint = fingerprint(command);
    UUID receipt =
        scope
            .jdbc()
            .queryForObject(
                "select pz8.prepare_invitation(?, ?)",
                UUID.class,
                command.operationId(),
                fingerprint);
    if (receipt != null) return get(receipt);
    UUID invitation = UUID.randomUUID();
    String token = work.newToken();
    scope
        .jdbc()
        .queryForObject(
            "select pz8.create_invitation(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            UUID.class,
            command.operationId(),
            fingerprint,
            invitation,
            UUID.randomUUID(),
            command.email(),
            command.firstName(),
            command.lastName(),
            command.roleId(),
            command.message(),
            command.language(),
            Timestamp.from(expiresAt),
            JdbcInvitationWork.tokenHash(token),
            work.encrypt(invitation, token));
    return get(invitation);
  }

  List<InvitationView> list() {
    return scope.jdbc().query("select * from pz8.list_invitations()", MAPPER);
  }

  private InvitationView get(UUID id) {
    var rows = scope.jdbc().query("select * from pz8.list_invitations() where id = ?", MAPPER, id);
    if (rows.isEmpty()) throw new InvitationUnavailableException();
    return rows.getFirst();
  }

  void revoke(UUID id) {
    if (!Boolean.TRUE.equals(
        scope.jdbc().queryForObject("select pz8.revoke_invitation(?)", Boolean.class, id))) {
      throw new InvitationUnavailableException();
    }
  }

  private static String fingerprint(InviteCommand command) {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      for (String field :
          new String[] {
            command.email(),
            command.firstName(),
            command.lastName(),
            command.roleId().toString(),
            command.message(),
            command.language()
          }) {
        byte[] bytes = field.getBytes(StandardCharsets.UTF_8);
        digest.update(ByteBuffer.allocate(Integer.BYTES).putInt(bytes.length).array());
        digest.update(bytes);
      }
      return HexFormat.of().formatHex(digest.digest());
    } catch (NoSuchAlgorithmException failure) {
      throw new IllegalStateException(failure);
    }
  }
}
