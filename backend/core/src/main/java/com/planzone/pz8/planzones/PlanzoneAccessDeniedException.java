package com.planzone.pz8.planzones;

public final class PlanzoneAccessDeniedException extends RuntimeException {
  private static final long serialVersionUID = 1L;

  public PlanzoneAccessDeniedException() {
    super("The authenticated identity cannot perform this action in the selected Planzone");
  }
}
