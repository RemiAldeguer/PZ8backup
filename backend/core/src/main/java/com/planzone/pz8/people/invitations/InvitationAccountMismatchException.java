package com.planzone.pz8.people.invitations;

public final class InvitationAccountMismatchException extends RuntimeException {
  private static final long serialVersionUID = 1L;

  public InvitationAccountMismatchException() {
    super("Authenticated account does not match this invitation");
  }
}
