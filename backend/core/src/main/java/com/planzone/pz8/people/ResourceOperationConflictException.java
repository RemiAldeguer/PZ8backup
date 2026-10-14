package com.planzone.pz8.people;

public final class ResourceOperationConflictException extends RuntimeException {
  private static final long serialVersionUID = 1L;

  public ResourceOperationConflictException() {
    super("This operation identifier was already used with different content");
  }
}
