package com.planzone.pz8.people.invitations;

public final class InvitationRoleUnavailableException extends RuntimeException {
  private static final long serialVersionUID = 1L;

  public InvitationRoleUnavailableException() {
    super("Invitation role is unavailable");
  }
}
