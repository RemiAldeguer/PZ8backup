package com.planzone.pz8.projects;

import com.planzone.pz8.people.ResourceId;
import com.planzone.pz8.planzones.PlanzoneContext;
import com.planzone.pz8.planzones.ZoneId;
import java.util.List;
import java.util.UUID;

public interface ScopedAccessService {
  ScopePage<ScopedZone> listZones(PlanzoneContext context, ScopeQuery query);

  ScopePage<ScopedProject> listProjects(PlanzoneContext context, ZoneId zone, ScopeQuery query);

  List<ProjectRoleDto> projectRoles(PlanzoneContext context);

  ScopePage<ZoneMemberView> zoneMembers(PlanzoneContext context, ZoneId zone, ScopeQuery query);

  ScopePage<ProjectMemberView> projectMembers(
      PlanzoneContext context, UUID project, ScopeQuery query);

  ScopePage<ScopeCandidate> zoneCandidates(PlanzoneContext context, ZoneId zone, ScopeQuery query);

  ScopePage<ScopeCandidate> projectCandidates(
      PlanzoneContext context, UUID project, ScopeQuery query);

  ZoneMemberView addZoneMember(PlanzoneContext context, ZoneId zone, ResourceId resource);

  void removeZoneMember(PlanzoneContext context, ZoneId zone, ResourceId resource);

  ProjectMemberView addProjectMember(
      PlanzoneContext context, UUID project, ResourceId resource, UUID roleId);

  ProjectMemberView updateProjectMember(
      PlanzoneContext context,
      UUID project,
      ResourceId resource,
      UUID roleId,
      boolean deactivated,
      long expectedVersion);

  void removeProjectMember(PlanzoneContext context, UUID project, ResourceId resource);
}
