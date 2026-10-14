package com.planzone.pz8.identity;

import java.util.List;
import java.util.Optional;

public interface IdentitySessions {
  Optional<IdentitySession> resolve(VerifiedOidcIdentity verified);

  Optional<IdentitySession> current(IdentityId identity, long securityVersion);

  List<AccessiblePlanzone> planzones(IdentityId identity, long securityVersion);
}
