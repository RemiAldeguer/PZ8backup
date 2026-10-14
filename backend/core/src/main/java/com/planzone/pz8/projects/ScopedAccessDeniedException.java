package com.planzone.pz8.projects;

public final class ScopedAccessDeniedException extends RuntimeException {
  private static final long serialVersionUID = 1L;

  public ScopedAccessDeniedException() {
    super("Scoped access denied");
  }
}
