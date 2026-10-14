package com.planzone.pz8.api;

import com.planzone.pz8.access.RoleNotAvailableException;
import com.planzone.pz8.identity.IdentitySessionExpiredException;
import com.planzone.pz8.people.*;
import com.planzone.pz8.people.invitations.*;
import com.planzone.pz8.planzones.PlanzoneAccessDeniedException;
import com.planzone.pz8.projects.*;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.*;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.*;
import org.springframework.web.bind.annotation.*;

@RestControllerAdvice
class ApiExceptionHandler {
  @ExceptionHandler({
    IdentitySessionExpiredException.class,
    InvitationSessionExpiredException.class
  })
  ResponseEntity<ErrorResponse> expired(HttpServletRequest request) {
    SecurityContextHolder.clearContext();
    var session = request.getSession(false);
    if (session != null) session.invalidate();
    return error(401, "SESSION_EXPIRED", "La session a expiré. Reconnectez-vous.");
  }

  record ErrorResponse(String code, String message) {}

  @ExceptionHandler({
    PlanzoneAccessDeniedException.class,
    AccessDeniedException.class,
    ScopedAccessDeniedException.class
  })
  ResponseEntity<ErrorResponse> denied() {
    return error(403, "ACCESS_DENIED", "Vous ne disposez pas des droits nécessaires.");
  }

  @ExceptionHandler({
    ResourceNotFoundException.class,
    ScopeNotFoundException.class,
    ScopeRoleUnavailableException.class
  })
  ResponseEntity<ErrorResponse> missing() {
    return error(404, "NOT_FOUND", "La ressource est introuvable.");
  }

  @ExceptionHandler({ResourceVersionConflictException.class, ScopeVersionConflictException.class})
  ResponseEntity<ErrorResponse> version() {
    return error(
        409, "VERSION_CONFLICT", "La ressource a été modifiée. Rechargez-la avant de réessayer.");
  }

  @ExceptionHandler(ScopeMemberConflictException.class)
  ResponseEntity<ErrorResponse> memberConflict() {
    return error(
        409,
        "MEMBER_CONFLICT",
        "Cette appartenance a changé. Rechargez les membres avant de réessayer.");
  }

  @ExceptionHandler({
    ResourceOperationConflictException.class,
    InvitationOperationConflictException.class
  })
  ResponseEntity<ErrorResponse> operation() {
    return error(
        409,
        "OPERATION_CONFLICT",
        "Cette clé d’opération a déjà été utilisée avec d’autres données.");
  }

  @ExceptionHandler({
    MemberResourceAlreadyExistsException.class,
    InvitationAlreadyPendingException.class,
    InvitationNameAlreadyExistsException.class,
    InvitationMemberAlreadyExistsException.class
  })
  ResponseEntity<ErrorResponse> duplicate() {
    return error(
        409, "INVITATION_CONFLICT", "Un profil ou une invitation existe déjà pour cette personne.");
  }

  @ExceptionHandler(InvitationUnavailableException.class)
  ResponseEntity<ErrorResponse> unavailable() {
    return error(
        410, "INVITATION_UNAVAILABLE", "Cette invitation est indisponible, expirée ou révoquée.");
  }

  @ExceptionHandler(InvitationAccountMismatchException.class)
  ResponseEntity<ErrorResponse> mismatch() {
    return error(
        403,
        "INVITATION_ACCOUNT_MISMATCH",
        "Connectez-vous avec l’adresse vérifiée à laquelle cette invitation a été envoyée.");
  }

  @ExceptionHandler({
    MemberNotAvailableException.class,
    InvitationRoleUnavailableException.class,
    RoleNotAvailableException.class
  })
  ResponseEntity<ErrorResponse> member() {
    return error(404, "NOT_FOUND", "Ce membre ou ce rôle est indisponible.");
  }

  @ExceptionHandler({
    IllegalArgumentException.class,
    HttpMessageNotReadableException.class,
    MissingServletRequestParameterException.class
  })
  ResponseEntity<ErrorResponse> invalid() {
    return error(400, "INVALID_INPUT", "Vérifiez les champs et les paramètres de la demande.");
  }

  private ResponseEntity<ErrorResponse> error(int status, String code, String message) {
    return ResponseEntity.status(status)
        .header("Cache-Control", "no-store")
        .body(new ErrorResponse(code, message));
  }
}
