package com.planzone.pz8.api;

import com.planzone.pz8.identity.*;
import jakarta.servlet.http.*;
import java.net.URI;
import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.*;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.*;

@RestController
@ConditionalOnProperty(name = "pz8.access.enabled", havingValue = "true")
@RequestMapping("/api/v1")
class SessionController {
  static final String RETURN_TO = SessionController.class.getName() + ".returnTo";
  private final IdentitySessions identities;

  SessionController(IdentitySessions identities) {
    this.identities = identities;
  }

  @GetMapping("/auth/login")
  ResponseEntity<Void> login(
      HttpServletRequest request, @RequestParam(required = false) String returnTo) {
    String destination = "/access";
    if (returnTo != null
        && returnTo.length() <= 2048
        && !returnTo.contains("\\")
        && !returnTo.startsWith("//")) {
      URI candidate = URI.create(returnTo);
      if (!candidate.isAbsolute()
          && ("/access".equals(candidate.getPath())
              || "/".equals(candidate.getPath())
              || "/invitations/accept".equals(candidate.getPath())
              || "/account/validation".equals(candidate.getPath()))) destination = returnTo;
    }
    request.getSession(true).setAttribute(RETURN_TO, destination);
    return ResponseEntity.status(302)
        .header("Cache-Control", "no-store")
        .location(URI.create("/api/v1/auth/authorize/pz8"))
        .build();
  }

  @GetMapping("/session")
  ResponseEntity<SessionResponse> session(HttpServletRequest request, CsrfToken csrf) {
    IdentitySession identity = current(request);
    var planzones = identities.planzones(identity.id(), identity.securityVersion());
    return ResponseEntity.ok()
        .header("Cache-Control", "no-store")
        .body(
            new SessionResponse(
                new IdentityView(identity.id().value(), identity.displayName(), identity.email()),
                planzones,
                csrf.getToken(),
                csrf.getHeaderName()));
  }

  static IdentitySession current(HttpServletRequest request) {
    Object identity = request.getAttribute(SessionIdentityFilter.CURRENT_IDENTITY);
    if (!(identity instanceof IdentitySession current))
      throw new org.springframework.security.access.AccessDeniedException(
          "Verified session required");
    return current;
  }

  record IdentityView(UUID id, String displayName, String email) {}

  record SessionResponse(
      IdentityView identity,
      List<AccessiblePlanzone> planzones,
      String csrfToken,
      String csrfHeader) {}
}
