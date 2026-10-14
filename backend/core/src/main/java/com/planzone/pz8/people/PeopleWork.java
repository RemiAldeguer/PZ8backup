package com.planzone.pz8.people;

import com.planzone.pz8.planzones.PlanzoneContext;
import java.util.function.Function;

/** Validates current authority and owns the complete scoped atomic transaction. */
public interface PeopleWork {
  <T> T execute(PlanzoneContext context, Function<PeopleSession, T> work);
}
