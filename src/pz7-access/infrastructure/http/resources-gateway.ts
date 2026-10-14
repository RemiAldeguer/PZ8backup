import type {
  AccessResource,
  ResourcePage,
  ResourceFilters,
  ResourceCursor,
} from "../../domain/models";
import type {
  CreateResourceInput,
  ResourceAccessInput,
  ResourcesGateway,
} from "../../application/ports";
import { AccessHttpTransport, part } from "./transport";

export class HttpResourcesGateway implements ResourcesGateway {
  constructor(private readonly transport: AccessHttpTransport) {}
  list(
    id: string,
    filters: ResourceFilters,
    after: ResourceCursor | null,
    signal?: AbortSignal,
  ) {
    const query = new URLSearchParams({
      limit: "25",
      namePrefix: filters.namePrefix,
      deactivated: String(filters.deactivated),
    });
    if (filters.type) query.set("type", filters.type);
    if (after) {
      query.set("afterName", after.name);
      query.set("afterId", after.id);
    }
    return this.transport.request<ResourcePage>(
      `/planzones/${part(id)}/resources?${query}`,
      "GET",
      undefined,
      signal,
    );
  }
  get(id: string, resourceId: string, signal?: AbortSignal) {
    return this.transport.request<AccessResource>(
      `/planzones/${part(id)}/resources/${part(resourceId)}`,
      "GET",
      undefined,
      signal,
    );
  }
  create(id: string, input: CreateResourceInput, signal?: AbortSignal) {
    return this.transport.request<AccessResource>(
      `/planzones/${part(id)}/resources`,
      "POST",
      input,
      signal,
    );
  }
  rename(
    id: string,
    resource: AccessResource,
    name: string,
    signal?: AbortSignal,
  ) {
    return this.transport.request<AccessResource>(
      `/planzones/${part(id)}/resources/${part(resource.id)}`,
      "PATCH",
      { expectedVersion: resource.version, name },
      signal,
    );
  }
  updateAccess(
    id: string,
    resourceId: string,
    input: ResourceAccessInput,
    signal?: AbortSignal,
  ) {
    return this.transport.request<void>(
      `/planzones/${part(id)}/resources/${part(resourceId)}/access`,
      "PUT",
      input,
      signal,
    );
  }
}
