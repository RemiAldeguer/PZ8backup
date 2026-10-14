package com.planzone.pz8.projects;

public final class ScopeVersionConflictException extends RuntimeException {
  private static final long serialVersionUID = 1L;

  public ScopeVersionConflictException() {
    super("Team member version has changed");
  }
}
