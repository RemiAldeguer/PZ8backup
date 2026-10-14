package com.planzone.pz8.api;

import com.planzone.pz8.people.invitations.*;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@ConditionalOnProperty(name = "pz8.access.enabled", havingValue = "true")
@RequestMapping("/api/v1")
class InvitationController {
  private final InvitationService invitations;

  InvitationController(InvitationService invitations) {
    this.invitations = invitations;
  }

  @GetMapping("/planzones/{planzoneId}/invitations")
  InvitationList list(HttpServletRequest req, @PathVariable UUID planzoneId) {
    return new InvitationList(
        invitations.list(ResourceAccessController.context(req, planzoneId)).stream()
            .map(InvitationResponse::from)
            .toList());
  }

  @PostMapping("/planzones/{planzoneId}/invitations")
  ResponseEntity<InvitationResponse> create(
      HttpServletRequest req, @PathVariable UUID planzoneId, @RequestBody InvitationBody body) {
    if (body.operationId() == null
        || body.email() == null
        || body.firstName() == null
        || body.lastName() == null
        || body.roleId() == null)
      throw new IllegalArgumentException("Required invitation fields are missing");
    var result =
        invitations.create(
            ResourceAccessController.context(req, planzoneId),
            new InviteCommand(
                body.operationId(),
                body.email(),
                body.firstName(),
                body.lastName(),
                body.roleId(),
                body.message(),
                body.language() == null ? "fr" : body.language()));
    return ResponseEntity.status(201)
        .header("Cache-Control", "no-store")
        .body(InvitationResponse.from(result));
  }

  @PostMapping("/planzones/{planzoneId}/invitations/{invitationId}/revoke")
  ResponseEntity<Void> revoke(
      HttpServletRequest req, @PathVariable UUID planzoneId, @PathVariable UUID invitationId) {
    invitations.revoke(ResourceAccessController.context(req, planzoneId), invitationId);
    return ResponseEntity.noContent().build();
  }

  @GetMapping("/invitations/preview")
  ResponseEntity<InvitationPreview> preview(@RequestParam String token) {
    return ResponseEntity.ok()
        .header("Cache-Control", "no-store")
        .header("Referrer-Policy", "no-referrer")
        .body(invitations.preview(token));
  }

  @PostMapping("/invitations/accept")
  AcceptedResponse accept(HttpServletRequest req, @RequestBody AcceptBody body) {
    if (body.token() == null) throw new IllegalArgumentException("Invitation token required");
    var identity = SessionController.current(req);
    var result = invitations.accept(identity.id(), identity.securityVersion(), body.token());
    return new AcceptedResponse(result.planzoneId().value(), result.resourceId().value());
  }

  record InvitationBody(
      UUID operationId,
      String email,
      String firstName,
      String lastName,
      UUID roleId,
      String message,
      String language) {}

  record AcceptBody(String token) {}

  record AcceptedResponse(UUID planzoneId, UUID resourceId) {}

  record InvitationList(List<InvitationResponse> items) {}

  record InvitationResponse(
      UUID id,
      UUID resourceId,
      String email,
      String firstName,
      String lastName,
      UUID roleId,
      InvitationStatus status,
      Instant expiresAt,
      Instant createdAt) {
    static InvitationResponse from(InvitationView i) {
      return new InvitationResponse(
          i.id(),
          i.resourceId().value(),
          i.email(),
          i.firstName(),
          i.lastName(),
          i.roleId(),
          i.status(),
          i.expiresAt(),
          i.createdAt());
    }
  }
}
