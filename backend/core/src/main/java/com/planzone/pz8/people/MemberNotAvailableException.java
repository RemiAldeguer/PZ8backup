package com.planzone.pz8.people;

public final class MemberNotAvailableException extends RuntimeException {
  private static final long serialVersionUID = 1L;

  public MemberNotAvailableException() {
    super("The member is not available in the selected Planzone");
  }
}
