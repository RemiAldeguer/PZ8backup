package com.planzone.pz8.people.invitations;

public final class InvitationAlreadyPendingException extends RuntimeException {
  private static final long serialVersionUID = 1L;

  public InvitationAlreadyPendingException() {
    super("An invitation is already pending for this email");
  }
}
