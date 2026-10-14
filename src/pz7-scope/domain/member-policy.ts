import type { Candidate, ProjectMember, ProjectRole } from "../client";

export function allowedRoles(member: Candidate | ProjectMember, catalogue: ProjectRole[]) {
  return catalogue.filter(role => member.allowedRoleIds.includes(role.id));
}

export function validMemberRole(member: Candidate | ProjectMember, roleId: string | null) {
  return roleId === null ? member.type !== "HUMAN" : member.allowedRoleIds.includes(roleId);
}

export const hasPermission = (permissions: string[], permission: string) => permissions.includes(permission);
