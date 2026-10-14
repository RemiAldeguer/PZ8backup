package com.planzone.pz8.platform.jdbc;

import com.planzone.pz8.people.PeopleSession;
import com.planzone.pz8.people.PeopleWork;
import com.planzone.pz8.planzones.PlanzoneContext;
import java.util.Objects;
import java.util.function.Function;

public final class JdbcPeopleWork implements PeopleWork {
  private final PlanzoneUnitOfWork unitOfWork;

  public JdbcPeopleWork(PlanzoneUnitOfWork unitOfWork) {
    this.unitOfWork = Objects.requireNonNull(unitOfWork, "unitOfWork");
  }

  public <T> T execute(PlanzoneContext context, Function<PeopleSession, T> work) {
    Objects.requireNonNull(work, "work");
    return unitOfWork.executeJdbc(context, scope -> work.apply(new JdbcPeopleSession(scope)));
  }
}
