import type { AccessResource, PlanzoneAccess } from "./models";

export type AccessPermission =
  | "resource:read"
  | "resource:create"
  | "resource:edit"
  | "resource:manage-access"
  | "invitation:manage";

export const permits = (access: PlanzoneAccess, permission: AccessPermission) =>
  access.permissions.includes(permission);

export const hasKnownRestrictions = (resource: AccessResource) =>
  Array.isArray(resource.nonEditableFields);

/** PZ7 restriction keys. Role assignment uses roleId, its lock is named role. */
export const RESOURCE_RESTRICTION_FIELDS = [
  "name",
  "description",
  "type",
  "deactivated",
  "role",
] as const;

export const canRenameResource = (
  access: PlanzoneAccess,
  resource: AccessResource,
) =>
  permits(access, "resource:edit") &&
  access.editableResourceFields.includes("name") &&
  hasKnownRestrictions(resource) &&
  !resource.nonEditableFields.includes("name");
