package com.planzone.pz8.people.invitations;

public final class InvitationNameAlreadyExistsException extends RuntimeException {
  private static final long serialVersionUID = 1L;

  public InvitationNameAlreadyExistsException() {
    super("A resource with this name already belongs to this Planzone");
  }
}
