package com.planzone.pz8.api;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.planzone.pz8.people.ResourceId;
import com.planzone.pz8.planzones.*;
import com.planzone.pz8.projects.*;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@ConditionalOnProperty(name = "pz8.access.enabled", havingValue = "true")
@RequestMapping("/api/v1/planzones/{planzoneId}")
class ScopeAccessController {
  private final ScopedAccessService scopes;

  ScopeAccessController(ScopedAccessService scopes) {
    this.scopes = scopes;
  }

  @GetMapping("/zones")
  ScopePage<ScopedZone> zones(HttpServletRequest request, @PathVariable UUID planzoneId) {
    return scopes.listZones(context(request, planzoneId), query(request));
  }

  @GetMapping("/projects")
  ScopePage<ScopedProject> projects(
      HttpServletRequest request,
      @PathVariable UUID planzoneId,
      @RequestParam(required = false) UUID zoneId) {
    return scopes.listProjects(
        context(request, planzoneId), zoneId == null ? null : new ZoneId(zoneId), query(request));
  }

  @GetMapping("/project-roles")
  List<ProjectRoleDto> projectRoles(HttpServletRequest request, @PathVariable UUID planzoneId) {
    return scopes.projectRoles(context(request, planzoneId));
  }

  @GetMapping("/zones/{zoneId}/members")
  ScopePage<ZoneMemberView> zoneMembers(
      HttpServletRequest request, @PathVariable UUID planzoneId, @PathVariable UUID zoneId) {
    return scopes.zoneMembers(context(request, planzoneId), new ZoneId(zoneId), query(request));
  }

  @GetMapping("/zones/{zoneId}/member-candidates")
  ScopePage<ScopeCandidate> zoneCandidates(
      HttpServletRequest request, @PathVariable UUID planzoneId, @PathVariable UUID zoneId) {
    return scopes.zoneCandidates(context(request, planzoneId), new ZoneId(zoneId), query(request));
  }

  @GetMapping("/projects/{projectId}/members")
  ScopePage<ProjectMemberView> projectMembers(
      HttpServletRequest request, @PathVariable UUID planzoneId, @PathVariable UUID projectId) {
    return scopes.projectMembers(context(request, planzoneId), projectId, query(request));
  }

  @GetMapping("/projects/{projectId}/member-candidates")
  ScopePage<ScopeCandidate> projectCandidates(
      HttpServletRequest request, @PathVariable UUID planzoneId, @PathVariable UUID projectId) {
    return scopes.projectCandidates(context(request, planzoneId), projectId, query(request));
  }

  @PostMapping("/zones/{zoneId}/members")
  ResponseEntity<ZoneMemberView> addZoneMember(
      HttpServletRequest request,
      @PathVariable UUID planzoneId,
      @PathVariable UUID zoneId,
      @RequestBody AddZoneMember body) {
    return ResponseEntity.status(201)
        .body(
            scopes.addZoneMember(
                context(request, planzoneId), new ZoneId(zoneId), resource(body.resourceId())));
  }

  @DeleteMapping("/zones/{zoneId}/members/{resourceId}")
  ResponseEntity<Void> removeZoneMember(
      HttpServletRequest request,
      @PathVariable UUID planzoneId,
      @PathVariable UUID zoneId,
      @PathVariable UUID resourceId) {
    scopes.removeZoneMember(
        context(request, planzoneId), new ZoneId(zoneId), new ResourceId(resourceId));
    return ResponseEntity.noContent().build();
  }

  @PostMapping("/projects/{projectId}/members")
  ResponseEntity<ProjectMemberView> addProjectMember(
      HttpServletRequest request,
      @PathVariable UUID planzoneId,
      @PathVariable UUID projectId,
      @RequestBody AddProjectMember body) {
    return ResponseEntity.status(201)
        .body(
            scopes.addProjectMember(
                context(request, planzoneId),
                projectId,
                resource(body.resourceId()),
                body.roleId()));
  }

  @PutMapping("/projects/{projectId}/members/{resourceId}")
  ProjectMemberView updateProjectMember(
      HttpServletRequest request,
      @PathVariable UUID planzoneId,
      @PathVariable UUID projectId,
      @PathVariable UUID resourceId,
      @RequestBody UpdateProjectMember body) {
    if (body.deactivated() == null || body.expectedVersion() == null)
      throw new IllegalArgumentException("Member state and version are required");
    return scopes.updateProjectMember(
        context(request, planzoneId),
        projectId,
        new ResourceId(resourceId),
        body.roleId(),
        body.deactivated(),
        body.expectedVersion());
  }

  @DeleteMapping("/projects/{projectId}/members/{resourceId}")
  ResponseEntity<Void> removeProjectMember(
      HttpServletRequest request,
      @PathVariable UUID planzoneId,
      @PathVariable UUID projectId,
      @PathVariable UUID resourceId) {
    scopes.removeProjectMember(context(request, planzoneId), projectId, new ResourceId(resourceId));
    return ResponseEntity.noContent().build();
  }

  private static ResourceId resource(UUID id) {
    if (id == null) throw new IllegalArgumentException("Resource is required");
    return new ResourceId(id);
  }

  private static PlanzoneContext context(HttpServletRequest request, UUID planzoneId) {
    var identity = SessionController.current(request);
    return new PlanzoneContext(
        identity.id(), new PlanzoneId(planzoneId), identity.securityVersion());
  }

  private static ScopeQuery query(HttpServletRequest request) {
    String prefix = request.getParameter("namePrefix");
    String limit = request.getParameter("limit");
    String afterName = request.getParameter("afterName");
    String afterId = request.getParameter("afterId");
    if ((afterName == null) != (afterId == null))
      throw new IllegalArgumentException("Incomplete cursor");
    var cursor = afterId == null ? null : new ScopeCursor(afterName, UUID.fromString(afterId));
    return new ScopeQuery(
        prefix == null ? "" : prefix, limit == null ? 25 : Integer.parseInt(limit), cursor);
  }

  record AddZoneMember(UUID resourceId) {}

  record AddProjectMember(UUID resourceId, UUID roleId) {}

  record UpdateProjectMember(
      @JsonProperty(required = true) UUID roleId, Boolean deactivated, Long expectedVersion) {}
}
