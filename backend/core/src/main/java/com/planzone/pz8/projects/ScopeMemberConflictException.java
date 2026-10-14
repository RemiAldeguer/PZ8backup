package com.planzone.pz8.projects;

public final class ScopeMemberConflictException extends RuntimeException {
  private static final long serialVersionUID = 1L;

  public ScopeMemberConflictException() {
    super("Team member state conflicts with this operation");
  }
}
