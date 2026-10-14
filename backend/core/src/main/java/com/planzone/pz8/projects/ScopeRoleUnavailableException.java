package com.planzone.pz8.projects;

public final class ScopeRoleUnavailableException extends RuntimeException {
  private static final long serialVersionUID = 1L;

  public ScopeRoleUnavailableException() {
    super("Role is unavailable");
  }
}
