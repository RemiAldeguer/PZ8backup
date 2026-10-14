package com.planzone.pz8.api;

import com.planzone.pz8.identity.*;
import org.springframework.security.oauth2.client.oidc.userinfo.*;
import org.springframework.security.oauth2.core.*;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;

final class VerifiedOidcUserService extends OidcUserService {
  private final IdentitySessions identities;

  VerifiedOidcUserService(IdentitySessions identities) {
    this.identities = identities;
  }

  @Override
  public OidcUser loadUser(OidcUserRequest request) {
    OidcUser verified = super.loadUser(request);
    VerifiedOidcIdentity claims =
        new VerifiedOidcIdentity(
            verified.getIssuer().toString(),
            verified.getSubject(),
            verified.getEmail(),
            Boolean.TRUE.equals(verified.getEmailVerified()),
            verified.getFullName());
    IdentitySession identity =
        identities
            .resolve(claims)
            .orElseThrow(() -> new OAuth2AuthenticationException(new OAuth2Error("access_denied")));
    return new Pz8OidcUser(verified, identity);
  }
}
