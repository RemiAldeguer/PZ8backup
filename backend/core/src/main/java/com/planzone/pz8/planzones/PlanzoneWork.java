package com.planzone.pz8.planzones;

import java.util.function.Function;

/** Persistence boundary that validates authority and owns a scoped atomic transaction. */
public interface PlanzoneWork {
  <T> T execute(PlanzoneContext context, Function<PlanzoneSession, T> work);

  <T> T executeAuthorityChange(PlanzoneContext context, Function<PlanzoneSession, T> work);
}
