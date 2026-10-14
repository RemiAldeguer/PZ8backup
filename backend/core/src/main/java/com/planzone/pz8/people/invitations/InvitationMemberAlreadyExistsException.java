package com.planzone.pz8.people.invitations;

public final class InvitationMemberAlreadyExistsException extends RuntimeException {
  private static final long serialVersionUID = 1L;

  public InvitationMemberAlreadyExistsException() {
    super("This account already belongs to this Planzone");
  }
}
