package com.planzone.pz8.api;

import com.planzone.pz8.identity.*;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

final class SessionIdentityFilter extends OncePerRequestFilter {
  static final String CURRENT_IDENTITY = SessionIdentityFilter.class.getName() + ".identity";
  private final IdentitySessions identities;

  SessionIdentityFilter(IdentitySessions identities) {
    this.identities = identities;
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
    if (authentication != null
        && authentication.isAuthenticated()
        && authentication.getPrincipal() instanceof Pz8OidcUser user) {
      var current = identities.current(new IdentityId(user.identityId()), user.securityVersion());
      if (current.isEmpty()) {
        SecurityContextHolder.clearContext();
        HttpSession session = request.getSession(false);
        if (session != null) session.invalidate();
        ApiErrors.write(response, 401, "SESSION_EXPIRED", "La session a expiré. Reconnectez-vous.");
        return;
      }
      request.setAttribute(CURRENT_IDENTITY, current.get());
    }
    chain.doFilter(request, response);
  }
}
