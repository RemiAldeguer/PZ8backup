package com.planzone.pz8.access;

public final class RoleNotAvailableException extends RuntimeException {
  private static final long serialVersionUID = 1L;

  public RoleNotAvailableException() {
    super("Role is not available in the selected Planzone");
  }
}
