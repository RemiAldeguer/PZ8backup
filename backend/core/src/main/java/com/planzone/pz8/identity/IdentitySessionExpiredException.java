package com.planzone.pz8.identity;

public final class IdentitySessionExpiredException extends RuntimeException {
  private static final long serialVersionUID = 1L;

  public IdentitySessionExpiredException() {
    super("The authenticated identity session is no longer current");
  }
}
