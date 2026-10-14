package com.planzone.pz8.people;

public final class MemberResourceAlreadyExistsException extends RuntimeException {
  private static final long serialVersionUID = 1L;

  public MemberResourceAlreadyExistsException() {
    super("The member already has a resource in the selected Planzone");
  }
}
