package com.planzone.pz8.api;

import com.planzone.pz8.access.*;
import com.planzone.pz8.people.*;
import com.planzone.pz8.planzones.*;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
@ConditionalOnProperty(name = "pz8.access.enabled", havingValue = "true")
@RequestMapping("/api/v1/planzones/{planzoneId}")
class ResourceAccessController {
  private final ResourceService resources;
  private final AccessService access;

  ResourceAccessController(ResourceService resources, AccessService access) {
    this.resources = resources;
    this.access = access;
  }

  static PlanzoneContext context(HttpServletRequest req, UUID planzoneId) {
    var identity = SessionController.current(req);
    return new PlanzoneContext(
        identity.id(), new PlanzoneId(planzoneId), identity.securityVersion());
  }

  @GetMapping("/access")
  AccessPolicy access(HttpServletRequest req, @PathVariable UUID planzoneId) {
    return access.get(context(req, planzoneId));
  }

  @GetMapping("/resources")
  ResourcePageResponse list(
      HttpServletRequest req,
      @PathVariable UUID planzoneId,
      @RequestParam(defaultValue = "") String namePrefix,
      @RequestParam(required = false) ResourceType type,
      @RequestParam(required = false) Boolean deactivated,
      @RequestParam(defaultValue = "25") int limit,
      @RequestParam(required = false) String afterName,
      @RequestParam(required = false) UUID afterId) {
    if ((afterName == null) != (afterId == null))
      throw new IllegalArgumentException("Incomplete cursor");
    var cursor = afterId == null ? null : new ResourceCursor(afterName, new ResourceId(afterId));
    var page =
        resources.list(
            context(req, planzoneId),
            new ResourceQuery(namePrefix, type, deactivated, limit, cursor));
    return new ResourcePageResponse(
        page.items().stream().map(ResourceResponse::from).toList(),
        page.next() == null
            ? null
            : new CursorResponse(page.next().name(), page.next().id().value()));
  }

  @GetMapping("/resources/{resourceId}")
  ResourceResponse get(
      HttpServletRequest req, @PathVariable UUID planzoneId, @PathVariable UUID resourceId) {
    return ResourceResponse.from(
        resources.get(context(req, planzoneId), new ResourceId(resourceId)));
  }

  @PostMapping("/resources")
  ResponseEntity<ResourceResponse> create(
      HttpServletRequest req, @PathVariable UUID planzoneId, @RequestBody CreateBody body) {
    if (body.operationId() == null || body.type() == null || body.name() == null)
      throw new IllegalArgumentException("Missing resource inputs");
    var resource =
        resources.create(
            context(req, planzoneId),
            new CreateResource(body.operationId(), body.type(), body.name(), body.description()));
    return ResponseEntity.status(201)
        .header("Cache-Control", "no-store")
        .body(ResourceResponse.from(resource));
  }

  @PatchMapping("/resources/{resourceId}")
  ResourceResponse rename(
      HttpServletRequest req,
      @PathVariable UUID planzoneId,
      @PathVariable UUID resourceId,
      @RequestBody RenameBody body) {
    if (body.expectedVersion() == null || body.name() == null)
      throw new IllegalArgumentException("Missing version or name");
    return ResourceResponse.from(
        resources.rename(
            context(req, planzoneId),
            new ResourceId(resourceId),
            body.expectedVersion(),
            body.name()));
  }

  @PutMapping("/resources/{resourceId}/access")
  ResponseEntity<Void> assign(
      HttpServletRequest req,
      @PathVariable UUID planzoneId,
      @PathVariable UUID resourceId,
      @RequestBody AccessBody body) {
    if (body.roleId() == null || body.nonEditableFields() == null)
      throw new IllegalArgumentException("Role and field restrictions are required");
    access.assign(
        context(req, planzoneId),
        new ResourceId(resourceId),
        body.roleId(),
        body.nonEditableFields());
    return ResponseEntity.noContent().build();
  }

  record CreateBody(UUID operationId, ResourceType type, String name, String description) {}

  record RenameBody(Long expectedVersion, String name) {}

  record AccessBody(UUID roleId, Set<String> nonEditableFields) {}

  record CursorResponse(String name, UUID id) {}

  record ResourcePageResponse(List<ResourceResponse> items, CursorResponse next) {}

  record ResourceResponse(
      UUID id,
      UUID planzoneId,
      String name,
      String description,
      ResourceType type,
      UUID identityId,
      boolean deactivated,
      long version,
      Instant createdAt,
      Instant updatedAt,
      UUID roleId,
      List<String> nonEditableFields) {
    static ResourceResponse from(ResourceProfile r) {
      return new ResourceResponse(
          r.id().value(),
          r.planzoneId().value(),
          r.name(),
          r.description(),
          r.type(),
          r.identityId() == null ? null : r.identityId().value(),
          r.deactivated(),
          r.version(),
          r.createdAt(),
          r.updatedAt(),
          r.roleId(),
          r.nonEditableFields());
    }
  }
}
