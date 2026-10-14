import type {
  AccessResource,
  PlanzoneAccess,
  ResourceCursor,
  ResourceFilters,
} from "../domain/models";
import {
  canRenameResource,
  hasKnownRestrictions,
  permits,
  RESOURCE_RESTRICTION_FIELDS,
} from "../domain/resource-policy";
import { AccessError, requireAccess } from "./errors";
import type {
  CreateResourceInput,
  ResourceAccessInput,
  ResourcesGateway,
} from "./ports";

export function createResourceUseCases(
  gateway: ResourcesGateway,
  planzoneId: string,
  access: PlanzoneAccess,
) {
  function scoped(resource: AccessResource, expectedId?: string) {
    if (
      resource.planzoneId !== planzoneId ||
      (expectedId !== undefined && resource.id !== expectedId)
    )
      throw new AccessError("INVALID_SCOPE", "unexpected");
    return resource;
  }
  return {
    async list(
      filters: ResourceFilters,
      after: ResourceCursor | null,
      signal?: AbortSignal,
    ) {
      requireAccess(permits(access, "resource:read"));
      const page = await gateway.list(planzoneId, filters, after, signal);
      page.items.forEach((resource) => scoped(resource));
      return page;
    },
    async get(resourceId: string, signal?: AbortSignal) {
      requireAccess(permits(access, "resource:read"));
      return scoped(
        await gateway.get(planzoneId, resourceId, signal),
        resourceId,
      );
    },
    async create(input: CreateResourceInput, signal?: AbortSignal) {
      requireAccess(permits(access, "resource:create"));
      if (!["VIRTUAL", "MATERIAL"].includes(input.type) || !input.name.trim())
        throw new AccessError("INVALID_INPUT", "invalid");
      return scoped(await gateway.create(planzoneId, input, signal));
    },
    async rename(resource: AccessResource, name: string, signal?: AbortSignal) {
      scoped(resource);
      requireAccess(canRenameResource(access, resource));
      if (!name.trim()) throw new AccessError("INVALID_INPUT", "invalid");
      return scoped(
        await gateway.rename(planzoneId, resource, name, signal),
        resource.id,
      );
    },
    async updateAccess(
      resource: AccessResource,
      input: ResourceAccessInput,
      signal?: AbortSignal,
    ) {
      scoped(resource);
      requireAccess(permits(access, "resource:manage-access"));
      if (!hasKnownRestrictions(resource))
        throw new AccessError("UNKNOWN_RESTRICTIONS", "invalid");
      if (!access.canManageRoles && input.roleId !== resource.roleId)
        throw new AccessError("ACCESS_DENIED", "forbidden");
      if (!input.roleId || !Array.isArray(input.nonEditableFields))
        throw new AccessError("INVALID_INPUT", "invalid");
      if (
        input.roleId !== resource.roleId &&
        !access.roles.some((role) => role.id === input.roleId)
      )
        throw new AccessError("INVALID_INPUT", "invalid");
      const unknownRestrictions = resource.nonEditableFields.filter(
        (field) =>
          !RESOURCE_RESTRICTION_FIELDS.some((known) => known === field),
      );
      return gateway.updateAccess(
        planzoneId,
        resource.id,
        {
          ...input,
          nonEditableFields: [
            ...new Set([...input.nonEditableFields, ...unknownRestrictions]),
          ],
        },
        signal,
      );
    },
  };
}
export type ResourceUseCases = ReturnType<typeof createResourceUseCases>;
