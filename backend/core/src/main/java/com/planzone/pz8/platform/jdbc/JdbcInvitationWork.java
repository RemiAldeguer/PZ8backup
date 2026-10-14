package com.planzone.pz8.platform.jdbc;

import com.planzone.pz8.identity.IdentityId;
import com.planzone.pz8.people.ResourceId;
import com.planzone.pz8.people.invitations.*;
import com.planzone.pz8.planzones.PlanzoneAccessDeniedException;
import com.planzone.pz8.planzones.PlanzoneContext;
import com.planzone.pz8.planzones.PlanzoneId;
import java.net.URI;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.SQLException;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.function.Supplier;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.sql.DataSource;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Transactional invitation boundary; bearer tokens leave it only as leased mail deliveries. */
public final class JdbcInvitationWork implements InvitationWork, InvitationMailQueue {
  private final PlanzoneUnitOfWork unitOfWork;
  private final JdbcTemplate jdbc;
  private final TransactionTemplate transaction;
  private final SecretKey encryptionKey;
  private final URI acceptanceBaseUrl;
  private final SecureRandom random = new SecureRandom();

  public JdbcInvitationWork(
      PlanzoneUnitOfWork unitOfWork,
      DataSource dataSource,
      SecretKey encryptionKey,
      URI acceptanceBaseUrl) {
    this.unitOfWork = Objects.requireNonNull(unitOfWork, "unitOfWork");
    this.jdbc = new JdbcTemplate(Objects.requireNonNull(dataSource, "dataSource"));
    this.transaction = new TransactionTemplate(new DataSourceTransactionManager(dataSource));
    transaction.setTimeout(30);
    this.encryptionKey = Objects.requireNonNull(encryptionKey, "encryptionKey");
    if (!"AES".equals(encryptionKey.getAlgorithm()) || encryptionKey.getEncoded().length != 32) {
      throw new IllegalArgumentException("A 256-bit AES invitation encryption key is required");
    }
    this.acceptanceBaseUrl = Objects.requireNonNull(acceptanceBaseUrl, "acceptanceBaseUrl");
    if (!acceptanceBaseUrl.isAbsolute()
        || acceptanceBaseUrl.getHost() == null
        || !List.of("http", "https").contains(acceptanceBaseUrl.getScheme())
        || acceptanceBaseUrl.getRawQuery() != null
        || acceptanceBaseUrl.getRawFragment() != null
        || acceptanceBaseUrl.getUserInfo() != null) {
      throw new IllegalArgumentException(
          "An absolute HTTP invitation URL without query is required");
    }
  }

  public InvitationView create(PlanzoneContext context, InviteCommand command, Instant expiresAt) {
    return translate(
        () ->
            unitOfWork.executeJdbc(
                context,
                scope -> new JdbcInvitationSession(scope, this).create(command, expiresAt)));
  }

  public List<InvitationView> list(PlanzoneContext context) {
    return translate(
        () ->
            unitOfWork.executeJdbc(
                context, scope -> new JdbcInvitationSession(scope, this).list()));
  }

  public void revoke(PlanzoneContext context, UUID invitationId) {
    translate(
        () ->
            unitOfWork.executeJdbc(
                context,
                scope -> {
                  new JdbcInvitationSession(scope, this).revoke(invitationId);
                  return null;
                }));
  }

  public InvitationPreview preview(String token) {
    String hash = tokenHash(token);
    return independent(
        () -> {
          var rows =
              jdbc.query(
                  "select * from pz8.preview_invitation(?)",
                  (row, index) ->
                      new InvitationPreview(
                          row.getString("planzone_name"),
                          row.getString("email"),
                          row.getString("first_name"),
                          row.getString("last_name"),
                          InvitationStatus.PENDING,
                          row.getTimestamp("expires_at").toInstant()),
                  hash);
          if (rows.isEmpty()) throw new InvitationUnavailableException();
          return rows.getFirst();
        });
  }

  public AcceptedInvitation accept(
      IdentityId identity, long expectedSecurityVersion, String token) {
    Objects.requireNonNull(identity, "identity");
    if (expectedSecurityVersion < 0) {
      throw new IllegalArgumentException("Expected security version must be nonnegative");
    }
    String hash = tokenHash(token);
    return independent(
        () -> {
          var rows =
              jdbc.query(
                  "select * from pz8.accept_invitation(?, ?, ?)",
                  (row, index) ->
                      new AcceptedInvitation(
                          new PlanzoneId(row.getObject("planzone_id", UUID.class)),
                          new ResourceId(row.getObject("resource_id", UUID.class))),
                  identity.value(),
                  expectedSecurityVersion,
                  hash);
          if (rows.isEmpty()) throw new InvitationUnavailableException();
          return rows.getFirst();
        });
  }

  public List<Delivery> claim(int limit) {
    if (limit < 1 || limit > 100)
      throw new IllegalArgumentException("Mail batch limit must be 1 to 100");
    return independent(
        () ->
            jdbc.query(
                "select * from pz8.claim_invitation_mail(?)",
                (row, index) -> {
                  UUID invitationId = row.getObject("invitation_id", UUID.class);
                  String token = decrypt(invitationId, row.getBytes("token_encrypted"));
                  return new Delivery(
                      row.getObject("id", UUID.class),
                      row.getObject("lease_id", UUID.class),
                      row.getString("email"),
                      row.getString("language"),
                      row.getString("first_name"),
                      row.getString("last_name"),
                      row.getString("planzone_name"),
                      row.getString("message"),
                      acceptanceBaseUrl.toASCIIString() + "?token=" + token);
                },
                limit));
  }

  public void markDelivered(UUID deliveryId, UUID leaseId) {
    acknowledge(deliveryId, leaseId, true);
  }

  public void markFailed(UUID deliveryId, UUID leaseId) {
    acknowledge(deliveryId, leaseId, false);
  }

  private void acknowledge(UUID id, UUID lease, boolean delivered) {
    Objects.requireNonNull(id, "id");
    Objects.requireNonNull(lease, "lease");
    independent(
        () ->
            jdbc.queryForObject(
                "select pz8.finish_invitation_mail(?, ?, ?)", Boolean.class, id, lease, delivered));
  }

  String newToken() {
    byte[] bytes = new byte[32];
    random.nextBytes(bytes);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
  }

  byte[] encrypt(UUID invitationId, String token) {
    byte[] nonce = new byte[12];
    random.nextBytes(nonce);
    try {
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.ENCRYPT_MODE, encryptionKey, new GCMParameterSpec(128, nonce));
      cipher.updateAAD(invitationId.toString().getBytes(StandardCharsets.US_ASCII));
      byte[] ciphertext = cipher.doFinal(token.getBytes(StandardCharsets.US_ASCII));
      return ByteBuffer.allocate(nonce.length + ciphertext.length)
          .put(nonce)
          .put(ciphertext)
          .array();
    } catch (GeneralSecurityException failure) {
      throw new IllegalStateException("Invitation encryption failed", failure);
    }
  }

  private String decrypt(UUID invitationId, byte[] encrypted) {
    try {
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.DECRYPT_MODE, encryptionKey, new GCMParameterSpec(128, encrypted, 0, 12));
      cipher.updateAAD(invitationId.toString().getBytes(StandardCharsets.US_ASCII));
      return new String(
          cipher.doFinal(encrypted, 12, encrypted.length - 12), StandardCharsets.US_ASCII);
    } catch (GeneralSecurityException failure) {
      throw new IllegalStateException("Invitation delivery cannot be decrypted", failure);
    }
  }

  static String tokenHash(String token) {
    if (token == null || !token.matches("[A-Za-z0-9_-]{43}"))
      throw new InvitationUnavailableException();
    try {
      if (Base64.getUrlDecoder().decode(token).length != 32)
        throw new InvitationUnavailableException();
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256")
                  .digest(token.getBytes(StandardCharsets.US_ASCII)));
    } catch (GeneralSecurityException failure) {
      throw new IllegalStateException("SHA-256 unavailable", failure);
    }
  }

  private <T> T independent(Supplier<T> action) {
    if (TransactionSynchronizationManager.isActualTransactionActive()) {
      throw new IllegalStateException("Invitation work must own its transaction");
    }
    return translate(() -> transaction.execute(status -> action.get()));
  }

  private static <T> T translate(Supplier<T> action) {
    try {
      return action.get();
    } catch (DataAccessException failure) {
      for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
        if (cause instanceof SQLException sql) {
          switch (Objects.toString(sql.getSQLState(), "")) {
            case "PZ001":
              throw new InvitationUnavailableException();
            case "PZ002":
              throw new InvitationAccountMismatchException();
            case "PZ003":
              throw new InvitationAlreadyPendingException();
            case "PZ004":
              throw new InvitationNameAlreadyExistsException();
            case "PZ005":
              throw new InvitationMemberAlreadyExistsException();
            case "PZ006":
              throw new InvitationRoleUnavailableException();
            case "PZ007":
              throw new PlanzoneAccessDeniedException();
            case "PZ008":
              throw new InvitationOperationConflictException();
            case "PZ011":
              throw new InvitationSessionExpiredException();
            default:
              break;
          }
        }
      }
      throw failure;
    }
  }
}
