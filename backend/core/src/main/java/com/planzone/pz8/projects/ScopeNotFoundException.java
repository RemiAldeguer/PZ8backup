package com.planzone.pz8.projects;

public final class ScopeNotFoundException extends RuntimeException {
  private static final long serialVersionUID = 1L;

  public ScopeNotFoundException() {
    super("Scope is unavailable");
  }
}
