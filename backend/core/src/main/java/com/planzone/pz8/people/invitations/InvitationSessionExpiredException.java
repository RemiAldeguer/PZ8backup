package com.planzone.pz8.people.invitations;

public final class InvitationSessionExpiredException extends RuntimeException {
  private static final long serialVersionUID = 1L;

  public InvitationSessionExpiredException() {
    super("Authenticated session has expired");
  }
}
