import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  AccessResource,
  PlanzoneAccess,
  ResourceFilters,
} from "../domain/models";
import type {
  ResourcesGateway,
  ResourceAccessInput,
  InvitationsGateway,
} from "../application/ports";
import { AccessError } from "../application/errors";
import { createResourceUseCases } from "../application/resource-use-cases";
import { createInvitationManagement } from "../application/invitation-use-cases";
import { createOperationId } from "../application/operation-id";
import { HttpSessionGateway } from "../infrastructure/http/session-gateway";
import { AccessHttpTransport } from "../infrastructure/http/transport";

const resource: AccessResource = {
  id: "resource-a",
  planzoneId: "a",
  name: "Machine",
  description: "",
  type: "MATERIAL",
  identityId: null,
  deactivated: false,
  version: 7,
  createdAt: "2026-10-14",
  updatedAt: "2026-10-14",
  roleId: "role-1",
  nonEditableFields: [],
};
const access: PlanzoneAccess = {
  permissions: [
    "resource:read",
    "resource:create",
    "resource:edit",
    "resource:manage-access",
    "invitation:manage",
  ],
  editableResourceFields: ["name"],
  roles: [{ id: "role-1", name: "pz_user", label: "Usager" }],
  canManageRoles: false,
};
const filters: ResourceFilters = {
  namePrefix: "",
  type: "",
  deactivated: false,
};
function gateway() {
  const calls: string[] = [];
  let savedAccess: ResourceAccessInput | undefined;
  const port: ResourcesGateway = {
    list: async (id) => {
      calls.push(id + ":list");
      return { items: [resource], next: null };
    },
    get: async () => resource,
    create: async (id) => {
      calls.push(id + ":create");
      return resource;
    },
    rename: async (id, snapshot, name) => {
      calls.push(id + ":rename:" + snapshot.version);
      return { ...resource, name };
    },
    updateAccess: async (id, resourceId, input) => {
      calls.push(id + ":access:" + resourceId);
      savedAccess = input;
    },
  };
  return { port, calls, savedAccess: () => savedAccess };
}
const failure = (code: string) => (error: unknown) =>
  error instanceof AccessError && error.code === code;

test("la création sans lecture reste autorisée ; un appel refusé ne touche pas le port", async () => {
  const stub = gateway();
  const useCases = createResourceUseCases(stub.port, "a", {
    ...access,
    permissions: ["resource:create"],
  });
  await assert.rejects(useCases.list(filters, null), failure("ACCESS_DENIED"));
  await useCases.create({
    operationId: "operation",
    type: "MATERIAL",
    name: "Machine",
    description: "",
  });
  assert.deepEqual(stub.calls, ["a:create"]);
});
test("les réponses hors Planzone et les profils d’une autre ressource sont refusés", async () => {
  const stub = gateway();
  stub.port.list = async () => ({
    items: [{ ...resource, planzoneId: "b" }],
    next: null,
  });
  const useCases = createResourceUseCases(stub.port, "a", access);
  await assert.rejects(useCases.list(filters, null), failure("INVALID_SCOPE"));
  await assert.rejects(
    useCases.get("resource-other"),
    failure("INVALID_SCOPE"),
  );
  await assert.rejects(
    useCases.rename({ ...resource, planzoneId: "b" }, "Renommée"),
    failure("INVALID_SCOPE"),
  );
  assert.deepEqual(stub.calls, []);
});
test("le renommage respecte les restrictions et transmet la version du profil", async () => {
  const stub = gateway();
  const useCases = createResourceUseCases(stub.port, "a", access);
  await assert.rejects(
    useCases.rename({ ...resource, nonEditableFields: ["name"] }, "Renommée"),
    failure("ACCESS_DENIED"),
  );
  await useCases.rename(resource, "Renommée");
  assert.deepEqual(stub.calls, ["a:rename:7"]);
});
test("les restrictions inconnues sont préservées et le rôle ne peut pas changer sans droit", async () => {
  const stub = gateway();
  const useCases = createResourceUseCases(stub.port, "a", access);
  const snapshot = {
    ...resource,
    nonEditableFields: ["future-field", "description"],
  };
  await useCases.updateAccess(snapshot, {
    roleId: "role-1",
    nonEditableFields: ["role"],
  });
  assert.deepEqual(stub.savedAccess(), {
    roleId: "role-1",
    nonEditableFields: ["role", "future-field"],
  });
  await assert.rejects(
    useCases.updateAccess(snapshot, {
      roleId: "role-2",
      nonEditableFields: [],
    }),
    failure("ACCESS_DENIED"),
  );
  await assert.rejects(
    useCases.updateAccess(
      { ...resource, nonEditableFields: undefined as never },
      { roleId: "role-1", nonEditableFields: [] },
    ),
    failure("UNKNOWN_RESTRICTIONS"),
  );
  assert.equal(stub.calls.length, 1);
});
test("les invitations n’appellent pas leur port lorsque leur gestion est refusée", () => {
  let invoked = false;
  const port = {
    list: async () => {
      invoked = true;
      return { items: [] };
    },
  } as unknown as InvitationsGateway;
  const useCases = createInvitationManagement(port, "a", {
    ...access,
    permissions: [],
  });
  assert.throws(() => useCases.list(), failure("ACCESS_DENIED"));
  assert.equal(invoked, false);
});
test("une reprise explicite conserve son ID et un corps changé obtient un nouvel ID", () => {
  let sequence = 0;
  const operation = createOperationId({ next: () => String(++sequence) });
  assert.equal(operation({ name: "A" }), operation({ name: "A" }));
  assert.notEqual(operation({ name: "A" }), operation({ name: "B" }));
  assert.equal(sequence, 2);
});
test("la session présentée ne contient pas le CSRF ; chaque mutation l’envoie puis logout le supprime", async () => {
  const requests: RequestInit[] = [];
  const send: typeof fetch = async (_url, init) => {
    requests.push(init!);
    return init!.method === "GET"
      ? Response.json({
          identity: {
            id: "identity",
            displayName: "Name",
            email: "user@example.test",
          },
          planzones: [],
          csrfToken: "test-only",
          csrfHeader: "X-CSRF-TOKEN",
        })
      : new Response(null, { status: 204 });
  };
  const transport = new AccessHttpTransport("/api/v1", send);
  const session = new HttpSessionGateway(transport);
  const model = await session.current();
  assert.equal("csrfToken" in model, false);
  await session.logout();
  assert.equal(
    new Headers(requests[1].headers).get("X-CSRF-TOKEN"),
    "test-only",
  );
  assert.equal(requests[1].credentials, "include");
  await assert.rejects(
    transport.request("/auth/logout", "POST"),
    failure("SESSION_REQUIRED"),
  );
  assert.equal(requests.length, 2);
});
