package com.planzone.pz8.people.invitations;

import com.planzone.pz8.identity.IdentityId;
import com.planzone.pz8.planzones.PlanzoneContext;
import java.time.Clock;
import java.time.Duration;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

public final class InvitationService {
  private final InvitationWork work;
  private final Clock clock;
  private final Duration lifetime;

  /** The configurable seven-day default is provisional: PZ7 did not enforce token expiry. */
  public InvitationService(InvitationWork work, Clock clock) {
    this(work, clock, Duration.ofDays(7));
  }

  public InvitationService(InvitationWork work, Clock clock, Duration lifetime) {
    this.work = Objects.requireNonNull(work, "work");
    this.clock = Objects.requireNonNull(clock, "clock");
    this.lifetime = Objects.requireNonNull(lifetime, "lifetime");
    if (lifetime.isNegative()
        || lifetime.isZero()
        || lifetime.compareTo(Duration.ofDays(365)) > 0) {
      throw new IllegalArgumentException("Invitation lifetime must be between zero and 365 days");
    }
  }

  public InvitationView create(PlanzoneContext context, InviteCommand command) {
    return work.create(
        Objects.requireNonNull(context, "context"),
        Objects.requireNonNull(command, "command"),
        clock.instant().plus(lifetime));
  }

  public List<InvitationView> list(PlanzoneContext context) {
    return work.list(Objects.requireNonNull(context, "context"));
  }

  public void revoke(PlanzoneContext context, UUID invitationId) {
    work.revoke(
        Objects.requireNonNull(context, "context"),
        Objects.requireNonNull(invitationId, "invitationId"));
  }

  public InvitationPreview preview(String token) {
    return work.preview(token);
  }

  public AcceptedInvitation accept(
      IdentityId identity, long expectedSecurityVersion, String token) {
    if (expectedSecurityVersion < 0) {
      throw new IllegalArgumentException("Expected security version must be nonnegative");
    }
    return work.accept(
        Objects.requireNonNull(identity, "identity"), expectedSecurityVersion, token);
  }
}
