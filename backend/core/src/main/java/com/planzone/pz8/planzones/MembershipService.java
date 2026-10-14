package com.planzone.pz8.planzones;

import com.planzone.pz8.identity.IdentityId;
import java.util.Objects;

/** Authority changes take the exclusive lock at entry; no late lock upgrade. */
public final class MembershipService {
  private final PlanzoneWork unitOfWork;

  public MembershipService(PlanzoneWork unitOfWork) {
    this.unitOfWork = Objects.requireNonNull(unitOfWork, "unitOfWork");
  }

  public boolean revoke(PlanzoneContext administrator, IdentityId member) {
    Objects.requireNonNull(member, "member");
    return unitOfWork.executeAuthorityChange(
        administrator,
        transaction -> {
          if (transaction.role() != PlanzoneRole.ADMINISTRATOR) {
            throw new PlanzoneAccessDeniedException();
          }
          return transaction.revokeMembership(member);
        });
  }
}
