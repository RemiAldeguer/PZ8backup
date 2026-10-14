package com.planzone.pz8.people.invitations;

public final class InvitationOperationConflictException extends RuntimeException {
  private static final long serialVersionUID = 1L;

  public InvitationOperationConflictException() {
    super("Invitation operation was already used with different parameters");
  }
}
