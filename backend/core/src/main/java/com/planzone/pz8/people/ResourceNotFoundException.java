package com.planzone.pz8.people;

public final class ResourceNotFoundException extends RuntimeException {
  private static final long serialVersionUID = 1L;

  public ResourceNotFoundException() {
    super("The resource is not available in the selected Planzone");
  }
}
