package com.planzone.pz8.people.invitations;

import com.planzone.pz8.identity.IdentityId;
import com.planzone.pz8.planzones.PlanzoneContext;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface InvitationWork {
  InvitationView create(PlanzoneContext context, InviteCommand command, Instant expiresAt);

  List<InvitationView> list(PlanzoneContext context);

  void revoke(PlanzoneContext context, UUID invitationId);

  InvitationPreview preview(String token);

  AcceptedInvitation accept(IdentityId identity, long expectedSecurityVersion, String token);
}
