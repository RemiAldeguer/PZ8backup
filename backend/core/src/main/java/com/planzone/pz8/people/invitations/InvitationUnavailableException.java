package com.planzone.pz8.people.invitations;

public final class InvitationUnavailableException extends RuntimeException {
  private static final long serialVersionUID = 1L;

  public InvitationUnavailableException() {
    super("Invitation is unavailable");
  }
}
