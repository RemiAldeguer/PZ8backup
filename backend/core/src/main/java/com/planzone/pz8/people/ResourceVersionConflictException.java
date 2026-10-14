package com.planzone.pz8.people;

public final class ResourceVersionConflictException extends RuntimeException {
  private static final long serialVersionUID = 1L;

  public ResourceVersionConflictException() {
    super("The resource changed since the supplied version");
  }
}
