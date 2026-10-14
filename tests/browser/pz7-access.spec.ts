import { test, expect, type Page, type Route } from "@playwright/test";
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type Server } from "node:http";

// This HTTP fixture mounts the exported UI alone. No legacy app, authentication
// implementation or synthetic identity is bundled into the product code.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let javascript = "";
let stylesheet = "";
let oidcProvider: Server;
let oidcProviderUrl = "";
test.beforeAll(async () => {
  const result = await build({
    absWorkingDir: repository,
    stdin: {
      contents: `import React from 'react'; import { createRoot } from 'react-dom/client';
        import { Pz7AccessApp } from './src/pz7-access';
        createRoot(document.getElementById('root')).render(React.createElement(Pz7AccessApp));`,
      resolveDir: repository,
      sourcefile: "pz7-access-test-entry.tsx",
      loader: "tsx",
    },
    bundle: true,
    write: false,
    outfile: "/tmp/pz7-access-browser.js",
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  javascript = result.outputFiles.find((file) =>
    file.path.endsWith(".js"),
  )!.text;
  stylesheet =
    result.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
  // Redirect targets are deliberately served over HTTP: Playwright routes do
  // not intercept the next hop of an already intercepted 302 navigation.
  oidcProvider = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(
      '<!doctype html><html lang="fr"><h1>Fournisseur OIDC</h1></html>',
    );
  });
  await new Promise<void>((done) => oidcProvider.listen(0, "127.0.0.1", done));
  const address = oidcProvider.address();
  if (!address || typeof address === "string")
    throw new Error("Le fournisseur HTTP de test ne peut pas démarrer.");
  oidcProviderUrl = "http://127.0.0.1:" + address.port + "/test-oidc-provider";
});
test.afterAll(async () => {
  if (oidcProvider?.listening)
    await new Promise<void>((done) => oidcProvider.close(() => done()));
});

type Resource = {
  id: string;
  planzoneId: string;
  name: string;
  description: string;
  type: "HUMAN" | "VIRTUAL" | "MATERIAL";
  identityId: string | null;
  deactivated: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  roleId: string | null;
  nonEditableFields?: string[];
};
type Invitation = {
  id: string;
  resourceId: string;
  email: string;
  firstName: string;
  lastName: string;
  roleId: string;
  status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  expiresAt: string;
  createdAt: string;
};
type RequestRecord = {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
};
const allPermissions = [
  "resource:read",
  "resource:create",
  "resource:edit",
  "invitation:manage",
  "resource:manage-access",
];
const csrfToken = "test-only-csrf-token";
const identity = {
  id: "identity-me",
  displayName: "Rémi Test",
  email: "remi@example.test",
};
const planzones = [
  { id: "planzone-alpha", name: "Planzone Alpha", resourceId: "alpha-human" },
  { id: "planzone-beta", name: "Planzone Bêta", resourceId: "beta-human" },
];
const roles = [
  { id: "role-admin", name: "pz_admin", label: "Administrateur" },
  { id: "role-user", name: "pz_user", label: "Usager" },
  { id: "role-visitor", name: "pz_visitor", label: "Visiteur" },
];
function resource(
  id: string,
  planzoneId: string,
  name: string,
  extra: Partial<Resource> = {},
): Resource {
  return {
    id,
    planzoneId,
    name,
    description: "",
    type: "HUMAN",
    identityId: "identity-" + id,
    deactivated: false,
    version: 3,
    createdAt: "2026-10-01T10:00:00Z",
    updatedAt: "2026-10-12T10:00:00Z",
    roleId: "role-user",
    nonEditableFields: [],
    ...extra,
  };
}
function invitation(extra: Partial<Invitation> = {}): Invitation {
  return {
    id: "invite-one",
    resourceId: "invited-human",
    email: "invite@example.test",
    firstName: "Camille",
    lastName: "Invitée",
    roleId: "role-user",
    status: "PENDING",
    expiresAt: "2099-11-01T10:00:00Z",
    createdAt: "2026-10-12T10:00:00Z",
    ...extra,
  };
}
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((done) => {
    release = done;
  });
  return { promise, release };
}

class HttpFixture {
  calls: RequestRecord[] = [];
  authenticated = true;
  sessionPlanzones = [...planzones];
  permissions = new Map<string, string[]>();
  editableFields = new Map<string, string[]>();
  canManageRoles = new Map<string, boolean>();
  resources = new Map<string, Resource[]>([
    [
      "planzone-alpha",
      [resource("alpha-human", "planzone-alpha", "Alice Alpha")],
    ],
    ["planzone-beta", [resource("beta-human", "planzone-beta", "Bruno Bêta")]],
  ]);
  invitations = new Map<string, Invitation[]>([
    ["planzone-alpha", [invitation()]],
    ["planzone-beta", []],
  ]);
  failures = new Map<
    string,
    { status: number; code: string; message: string }
  >();
  beforeResourceResponse?: (planzoneId: string) => Promise<void>;
  onResourceResponse?: (planzoneId: string) => void;
  pageSize = 25;
  preview = {
    planzoneName: "Planzone Alpha",
    email: identity.email,
    firstName: "Rémi",
    lastName: "Test",
    status: "PENDING",
    expiresAt: "2099-11-01T10:00:00Z",
  };
  mutation(method: string, suffix: string) {
    return this.calls.filter(
      (call) => call.method === method && call.path.endsWith(suffix),
    );
  }

  async mount(page: Page, path = "/pz7-access-test") {
    await page.route("**/*", (route) => this.handle(route));
    await page.goto(path);
  }

  private async handle(route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/pz7-access-browser.js")
      return route.fulfill({
        contentType: "text/javascript",
        body: javascript,
      });
    if (url.pathname === "/pz7-access-browser.css")
      return route.fulfill({ contentType: "text/css", body: stylesheet });
    if (url.pathname === "/test-oidc-provider")
      return route.fulfill({
        contentType: "text/html",
        body: "<h1>Fournisseur OIDC</h1>",
      });
    if (!url.pathname.startsWith("/api/v1/"))
      return route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/pz7-access-browser.css"></head><body><div id="root"></div><script src="/pz7-access-browser.js"></script></body></html>',
      });
    const call: RequestRecord = {
      method: request.method(),
      path: url.pathname,
      query: url.searchParams,
      headers: request.headers(),
      body: request.postData() ? JSON.parse(request.postData()!) : null,
    };
    this.calls.push(call);
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    const error = (status: number, code: string, message: string) =>
      json({ code, message }, status);
    const fail = this.failures.get(call.method + " " + call.path);
    if (fail) return error(fail.status, fail.code, fail.message);
    if (call.path === "/api/v1/session")
      return this.authenticated
        ? json({
            identity,
            planzones: this.sessionPlanzones,
            csrfToken,
            csrfHeader: "X-CSRF-TOKEN",
          })
        : error(401, "UNAUTHENTICATED", "Connexion requise.");
    if (call.path === "/api/v1/auth/login")
      return route.fulfill({
        status: 302,
        headers: { location: oidcProviderUrl },
        body: "",
      });
    if (call.path === "/api/v1/auth/logout") {
      this.authenticated = false;
      return route.fulfill({ status: 204, body: "" });
    }
    if (call.path === "/api/v1/invitations/preview") return json(this.preview);
    if (call.path === "/api/v1/invitations/accept") {
      if (!this.authenticated)
        return error(
          401,
          "UNAUTHENTICATED",
          "Connectez-vous avec le compte correspondant à cette invitation.",
        );
      if (!this.sessionPlanzones.some((item) => item.id === "planzone-alpha"))
        this.sessionPlanzones.push(planzones[0]);
      return json({ planzoneId: "planzone-alpha", resourceId: "alpha-human" });
    }
    const scoped = call.path.match(
      /^\/api\/v1\/planzones\/([^/]+)\/(access|resources|invitations)(?:\/([^/]+))?(?:\/(access|revoke))?$/,
    );
    if (!scoped) return error(404, "NOT_FOUND", "Route de fixture inconnue.");
    const [, planzoneId, entity, id, action] = scoped;
    if (entity === "access")
      return json({
        permissions: this.permissions.get(planzoneId) ?? allPermissions,
        editableResourceFields: this.editableFields.get(planzoneId) ?? [
          "name",
          "description",
          "type",
          "deactivated",
          "roleId",
        ],
        roles,
        canManageRoles: this.canManageRoles.get(planzoneId) ?? true,
      });
    if (entity === "resources") {
      if (call.method === "GET") {
        if (id) {
          const profile = this.resources
            .get(planzoneId)
            ?.find((item) => item.id === id);
          return profile
            ? json(profile)
            : error(404, "NOT_FOUND", "Ressource introuvable.");
        }
        const data = [...(this.resources.get(planzoneId) ?? [])];
        const prefix = (call.query.get("namePrefix") ?? "").toLowerCase();
        const type = call.query.get("type");
        const inactive = call.query.get("deactivated");
        const sorted = data
          .filter((item) => item.name.toLowerCase().startsWith(prefix))
          .filter((item) => !type || item.type === type)
          .filter(
            (item) => !inactive || item.deactivated === (inactive === "true"),
          )
          .sort(
            (a, b) =>
              a.name.localeCompare(b.name, "fr") || a.id.localeCompare(b.id),
          );
        const cursorName = call.query.get("afterName");
        const cursorId = call.query.get("afterId");
        const start =
          cursorName && cursorId
            ? sorted.findIndex(
                (item) => item.name === cursorName && item.id === cursorId,
              ) + 1
            : 0;
        const limit = Math.min(
          Number(call.query.get("limit") || 25),
          this.pageSize,
        );
        const items = sorted.slice(start, start + limit);
        const last = items.at(-1);
        const next =
          last && start + items.length < sorted.length
            ? { name: last.name, id: last.id }
            : null;
        await this.beforeResourceResponse?.(planzoneId);
        try {
          await json({ items, next });
        } catch {
          /* An aborted request must not defeat isolation assertions. */
        }
        this.onResourceResponse?.(planzoneId);
        return;
      }
      if (call.method === "POST") {
        const body = call.body!;
        const item = resource(
          "created-" + planzoneId,
          planzoneId,
          String(body.name),
          {
            type: body.type as Resource["type"],
            description: String(body.description ?? ""),
            identityId: null,
            roleId: null,
            version: 1,
          },
        );
        this.resources.set(planzoneId, [
          ...(this.resources.get(planzoneId) ?? []),
          item,
        ]);
        return json(item, 201);
      }
      const item = this.resources
        .get(planzoneId)
        ?.find((resource) => resource.id === id);
      if (!item) return error(404, "NOT_FOUND", "Ressource introuvable.");
      if (call.method === "PATCH") {
        if (call.body!.expectedVersion !== item.version)
          return error(
            409,
            "VERSION_CONFLICT",
            "La ressource a changé. Rechargez ses données.",
          );
        item.name = String(call.body!.name);
        item.version += 1;
        return json(item);
      }
      if (call.method === "PUT" && action === "access") {
        item.roleId = call.body!.roleId as string | null;
        item.nonEditableFields = call.body!.nonEditableFields as string[];
        return route.fulfill({ status: 204, body: "" });
      }
    }
    if (entity === "invitations") {
      if (call.method === "GET")
        return json({ items: this.invitations.get(planzoneId) ?? [] });
      if (action === "revoke") {
        const item = this.invitations
          .get(planzoneId)
          ?.find((invitation) => invitation.id === id);
        if (item) item.status = "REVOKED";
        return route.fulfill({ status: 204, body: "" });
      }
      if (call.method === "POST") {
        const body = call.body!;
        const item = invitation({
          id: "invite-created",
          email: String(body.email),
          firstName: String(body.firstName),
          lastName: String(body.lastName),
          roleId: String(body.roleId),
        });
        this.invitations.set(planzoneId, [
          ...(this.invitations.get(planzoneId) ?? []),
          item,
        ]);
        return json(item, 201);
      }
    }
    return error(
      400,
      "INVALID_INPUT",
      "Requête de fixture non prise en charge.",
    );
  }
}
function row(page: Page, name: string) {
  return page.getByRole("row").filter({ hasText: name });
}
function expectCsrf(call: RequestRecord) {
  expect(call.headers["x-csrf-token"]).toBe(csrfToken);
}
function expectOperationId(call: RequestRecord) {
  expect(call.body?.operationId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
}

test("une session absente conduit au fournisseur OIDC sans mot de passe côté React", async ({
  page,
}) => {
  const fixture = new HttpFixture();
  fixture.authenticated = false;
  await fixture.mount(page);
  await expect(
    page
      .getByRole("button", { name: "Se connecter", exact: true })
      .or(page.getByRole("link", { name: "Se connecter", exact: true })),
  ).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Planzone", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Se connecter", exact: true })
    .or(page.getByRole("link", { name: "Se connecter", exact: true }))
    .click();
  await expect(
    page.getByRole("heading", { name: "Fournisseur OIDC", exact: true }),
  ).toBeVisible();
  expect(
    fixture.calls.filter((call) => call.path === "/api/v1/auth/login"),
  ).toHaveLength(1);
  expect(fixture.calls.some((call) => call.path.includes("/resources"))).toBe(
    false,
  );
  expect(
    fixture.calls
      .find((call) => call.path === "/api/v1/auth/login")
      ?.query.get("returnTo"),
  ).toBe("/pz7-access-test");
});

test("changer de Planzone efface les données et ignore une réponse tardive du client précédent", async ({
  page,
}) => {
  const fixture = new HttpFixture();
  const gate = deferred();
  const settled = deferred();
  fixture.beforeResourceResponse = (id) =>
    id === "planzone-alpha" ? gate.promise : Promise.resolve();
  fixture.onResourceResponse = (id) => {
    if (id === "planzone-alpha") settled.release();
  };
  await fixture.mount(page);
  await expect
    .poll(
      () =>
        fixture.calls.filter(
          (call) => call.path === "/api/v1/planzones/planzone-alpha/resources",
        ).length,
    )
    .toBe(1);
  await page
    .getByRole("combobox", { name: "Planzone", exact: true })
    .selectOption("planzone-beta");
  await expect(row(page, "Bruno Bêta")).toBeVisible();
  await expect(row(page, "Alice Alpha")).toHaveCount(0);
  gate.release();
  await settled.promise;
  await page.evaluate(
    () =>
      new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      ),
  );
  await expect(row(page, "Bruno Bêta")).toBeVisible();
  await expect(row(page, "Alice Alpha")).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Planzone", exact: true }),
  ).toHaveValue("planzone-beta");
});

test("le filtre et le curseur de pagination sont transmis sans mélanger les pages de ressources", async ({
  page,
}) => {
  const fixture = new HttpFixture();
  fixture.pageSize = 1;
  fixture.resources.set("planzone-alpha", [
    resource("alpha-one", "planzone-alpha", "Alice Alpha"),
    resource("alpha-two", "planzone-alpha", "Anna Alpha"),
    resource("alpha-virtual", "planzone-alpha", "Atelier virtuel", {
      type: "VIRTUAL",
      identityId: null,
    }),
    resource("alpha-inactive", "planzone-alpha", "Archive inactive", {
      deactivated: true,
    }),
  ]);
  await fixture.mount(page);
  await expect(row(page, "Alice Alpha")).toBeVisible();
  await page
    .getByRole("button", { name: "Charger la suite", exact: true })
    .click();
  await expect(row(page, "Anna Alpha")).toBeVisible();
  await expect(row(page, "Alice Alpha")).toBeVisible();
  const cursorCall = fixture.calls.find((call) => call.query.has("afterId"))!;
  expect(cursorCall.query.get("afterId")).toBe("alpha-one");
  expect(cursorCall.query.get("afterName")).toBe("Alice Alpha");
  await page
    .getByRole("combobox", { name: "Type de ressource", exact: true })
    .selectOption("VIRTUAL");
  await expect(row(page, "Atelier virtuel")).toBeVisible();
  await expect(row(page, "Alice Alpha")).toHaveCount(0);
  await page.getByLabel("Nom de la ressource", { exact: true }).fill("Atelier");
  await expect
    .poll(
      () =>
        fixture.calls.filter(
          (call) => call.query.get("namePrefix") === "Atelier",
        ).length,
    )
    .toBeGreaterThan(0);
  const filtered = fixture.calls.findLast(
    (call) => call.query.get("namePrefix") === "Atelier",
  )!;
  expect(filtered.query.get("type")).toBe("VIRTUAL");
  expect(filtered.query.has("afterId")).toBe(false);
  await page
    .getByRole("combobox", { name: "Type de ressource", exact: true })
    .selectOption("");
  await page.getByLabel("Nom de la ressource", { exact: true }).fill("Archive");
  await page
    .getByLabel("Afficher les ressources désactivées", { exact: true })
    .check();
  await expect(row(page, "Archive inactive")).toBeVisible();
  expect(
    fixture.calls
      .findLast((call) => call.path.endsWith("/resources"))!
      .query.get("deactivated"),
  ).toBe("true");
});

for (const [type, name] of [
  ["VIRTUAL", "Équipe sans compte"],
  ["MATERIAL", "Machine de test"],
] as const) {
  test(`créer une ressource ${type} ne crée aucun compte et transmet CSRF et operationId`, async ({
    page,
  }) => {
    const fixture = new HttpFixture();
    await fixture.mount(page);
    await expect(row(page, "Alice Alpha")).toBeVisible();
    await page
      .getByRole("button", { name: "Créer une ressource", exact: true })
      .click();
    const form = page.getByRole("dialog", {
      name: "Créer une ressource",
      exact: true,
    });
    await form
      .getByRole("combobox", { name: "Type de ressource", exact: true })
      .selectOption(type);
    expect(
      await form
        .getByRole("combobox", { name: "Type de ressource", exact: true })
        .locator("option")
        .evaluateAll((options) =>
          options.map((option) => (option as HTMLOptionElement).value),
        ),
    ).not.toContain("HUMAN");
    await form.getByLabel("Nom de la ressource", { exact: true }).fill(name);
    await form
      .getByLabel("Description", { exact: true })
      .fill("Capacité de travail sans identité de connexion.");
    await form
      .getByRole("button", { name: "Créer une ressource", exact: true })
      .click();
    await expect(row(page, name)).toBeVisible();
    const calls = fixture.mutation("POST", "/resources");
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({
      type,
      name,
      description: "Capacité de travail sans identité de connexion.",
    });
    expect(Object.keys(calls[0].body!).sort()).toEqual([
      "description",
      "name",
      "operationId",
      "type",
    ]);
    expectCsrf(calls[0]);
    expectOperationId(calls[0]);
    expect(
      fixture.resources
        .get("planzone-alpha")!
        .find((item) => item.name === name)!.identityId,
    ).toBeNull();
    expect(
      fixture.calls.some((call) =>
        /account|password|identities/.test(call.path),
      ),
    ).toBe(false);
  });
}

test("inviter et révoquer un membre passe par le backend et conserve les restrictions de rôle", async ({
  page,
}) => {
  const fixture = new HttpFixture();
  await fixture.mount(page);
  await expect(row(page, "Alice Alpha")).toBeVisible();
  await page.getByRole("button", { name: "Invitations", exact: true }).click();
  await expect(row(page, "invite@example.test")).toBeVisible();
  await page
    .getByRole("button", { name: "Inviter un membre", exact: true })
    .click();
  const form = page.getByRole("dialog", {
    name: "Inviter un membre",
    exact: true,
  });
  await form
    .getByLabel("Adresse e-mail", { exact: true })
    .fill("nouveau@example.test");
  await form.getByLabel("Prénom", { exact: true }).fill("Nora");
  await form.getByLabel("Nom", { exact: true }).fill("Nouvelle");
  await form
    .getByRole("combobox", { name: "Rôle", exact: true })
    .selectOption("role-visitor");
  await form
    .getByLabel("Message", { exact: true })
    .fill("Bienvenue dans notre équipe.");
  await form
    .getByRole("button", { name: "Envoyer l’invitation", exact: true })
    .click();
  await expect(row(page, "nouveau@example.test")).toBeVisible();
  const created = fixture.mutation("POST", "/invitations");
  expect(created).toHaveLength(1);
  expect(created[0].body).toMatchObject({
    email: "nouveau@example.test",
    firstName: "Nora",
    lastName: "Nouvelle",
    roleId: "role-visitor",
    message: "Bienvenue dans notre équipe.",
    language: "fr",
  });
  expectCsrf(created[0]);
  expectOperationId(created[0]);
  expect(created[0].body).not.toHaveProperty("token");
  await page
    .getByRole("button", {
      name: "Révoquer l’invitation de nouveau@example.test",
      exact: true,
    })
    .click();
  await page
    .getByRole("dialog", { name: "Révoquer l’invitation", exact: true })
    .getByRole("button", { name: "Révoquer l’invitation", exact: true })
    .click();
  await expect(row(page, "nouveau@example.test")).toContainText(/Révoqu/);
  const revoked = fixture.mutation("POST", "/invite-created/revoke");
  expect(revoked).toHaveLength(1);
  expectCsrf(revoked[0]);
});

for (const invitationPath of ["/invitations/accept", "/account/validation"]) {
  test(`une invitation publique (${invitationPath}) prévisualise le client et demande une connexion OIDC`, async ({
    page,
  }) => {
    const fixture = new HttpFixture();
    fixture.authenticated = false;
    await fixture.mount(page, invitationPath + "?token=test-token-only");
    await expect(
      page.getByText("Planzone Alpha", { exact: false }).first(),
    ).toBeVisible();
    await expect(
      page.getByText(identity.email, { exact: false }).first(),
    ).toBeVisible();
    const login = page
      .getByRole("button", { name: "Se connecter", exact: true })
      .or(page.getByRole("link", { name: "Se connecter", exact: true }));
    await expect(login).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    expect(
      fixture.calls
        .find((call) => call.path === "/api/v1/invitations/preview")
        ?.query.get("token"),
    ).toBe("test-token-only");
    expect(fixture.mutation("POST", "/invitations/accept")).toHaveLength(0);
    await login.click();
    await expect(
      page.getByRole("heading", { name: "Fournisseur OIDC", exact: true }),
    ).toBeVisible();
    expect(
      fixture.calls
        .find((call) => call.path === "/api/v1/auth/login")
        ?.query.get("returnTo"),
    ).toBe(invitationPath + "?token=test-token-only");
  });
}

test("accepter une invitation authentifiée rafraîchit la session et sélectionne la nouvelle Planzone", async ({
  page,
}) => {
  const fixture = new HttpFixture();
  fixture.sessionPlanzones = [planzones[1]];
  await fixture.mount(page, "/invitations/accept?token=test-token-only");
  await page
    .getByRole("button", { name: "Accepter l’invitation", exact: true })
    .click();
  await expect
    .poll(() => fixture.mutation("POST", "/invitations/accept").length)
    .toBe(1);
  const accepted = fixture.mutation("POST", "/invitations/accept")[0];
  expect(accepted.body).toEqual({ token: "test-token-only" });
  expectCsrf(accepted);
  await expect(
    page
      .getByRole("alert")
      .or(page.getByRole("status"))
      .filter({ hasText: /accept|rejoint/i })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Planzone", exact: true }),
  ).toHaveValue("planzone-alpha");
  await expect(row(page, "Alice Alpha")).toBeVisible();
  await expect(row(page, "Bruno Bêta")).toHaveCount(0);
  expect(
    fixture.calls.filter((call) => call.path === "/api/v1/session"),
  ).toHaveLength(2);
});

test("un compte différent de celui invité reçoit un refus explicite sans acceptation répétée", async ({
  page,
}) => {
  const fixture = new HttpFixture();
  fixture.failures.set("POST /api/v1/invitations/accept", {
    status: 403,
    code: "INVITATION_ACCOUNT_MISMATCH",
    message: "Cette invitation est destinée à un autre compte vérifié.",
  });
  await fixture.mount(page, "/invitations/accept?token=test-token-only");
  await page
    .getByRole("button", { name: "Accepter l’invitation", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    /compte.*adresse e-mail vérifiée/i,
  );
  expect(fixture.mutation("POST", "/invitations/accept")).toHaveLength(1);
});

test("droits absents et champ nom non éditable masquent les mutations", async ({
  page,
}) => {
  const fixture = new HttpFixture();
  fixture.permissions.set("planzone-alpha", ["resource:read", "resource:edit"]);
  fixture.editableFields.set("planzone-alpha", ["description"]);
  await fixture.mount(page);
  await expect(row(page, "Alice Alpha")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Créer une ressource", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Inviter un membre", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Invitations", exact: true }),
  ).toHaveCount(0);
  await expect(
    row(page, "Alice Alpha").getByRole("button", {
      name: "Modifier Alice Alpha",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    row(page, "Alice Alpha").getByRole("button", {
      name: "Permissions de Alice Alpha",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    fixture.calls.filter((call) => !["GET", "HEAD"].includes(call.method)),
  ).toHaveLength(0);
});

test("sans permission de lecture aucune donnée ressource n’est demandée", async ({
  page,
}) => {
  const fixture = new HttpFixture();
  fixture.permissions.set("planzone-alpha", []);
  await fixture.mount(page);
  await expect(
    page.getByText(/accès|autoris|permission/i).first(),
  ).toBeVisible();
  await expect(row(page, "Alice Alpha")).toHaveCount(0);
  expect(fixture.calls.some((call) => call.path.endsWith("/resources"))).toBe(
    false,
  );
  expect(fixture.calls.some((call) => call.path.endsWith("/invitations"))).toBe(
    false,
  );
});

test("le droit de création fonctionne sans lecture et ne déclenche aucune liste de ressources", async ({
  page,
}) => {
  const fixture = new HttpFixture();
  fixture.permissions.set("planzone-alpha", ["resource:create"]);
  await fixture.mount(page);
  await page
    .getByRole("button", { name: "Créer une ressource", exact: true })
    .click();
  const form = page.getByRole("dialog", {
    name: "Créer une ressource",
    exact: true,
  });
  await form
    .getByRole("combobox", { name: "Type de ressource", exact: true })
    .selectOption("VIRTUAL");
  await form
    .getByLabel("Nom de la ressource", { exact: true })
    .fill("Équipe créée sans lecture");
  await form
    .getByRole("button", { name: "Créer une ressource", exact: true })
    .click();
  await expect(form).toHaveCount(0);
  const created = fixture.mutation("POST", "/resources");
  expect(created).toHaveLength(1);
  expect(created[0].body).toMatchObject({
    type: "VIRTUAL",
    name: "Équipe créée sans lecture",
  });
  expectCsrf(created[0]);
  expectOperationId(created[0]);
  expect(
    fixture.calls.filter(
      (call) => call.method === "GET" && call.path.endsWith("/resources"),
    ),
  ).toHaveLength(0);
  await expect(row(page, "Alice Alpha")).toHaveCount(0);
  await expect(row(page, "Équipe créée sans lecture")).toHaveCount(0);
});

test("une réponse contenant une ressource d’une autre Planzone est refusée sans afficher ses données", async ({
  page,
}) => {
  const fixture = new HttpFixture();
  fixture.resources.set("planzone-alpha", [
    resource("foreign-beta", "planzone-beta", "Donnée privée de Bêta"),
  ]);
  await fixture.mount(page);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByText("Donnée privée de Bêta", { exact: false }),
  ).toHaveCount(0);
  await expect(row(page, "Donnée privée de Bêta")).toHaveCount(0);
  expect(
    fixture.calls.some(
      (call) => call.path === "/api/v1/planzones/planzone-alpha/resources",
    ),
  ).toBe(true);
  expect(
    fixture.calls.filter((call) => !["GET", "HEAD"].includes(call.method)),
  ).toHaveLength(0);
});

test("éditer les permissions conserve les champs verrouillés connus et transmet CSRF", async ({
  page,
}) => {
  const fixture = new HttpFixture();
  fixture.resources.get("planzone-alpha")![0].nonEditableFields = [
    "description",
  ];
  await fixture.mount(page);
  await expect(row(page, "Alice Alpha")).toBeVisible();
  await row(page, "Alice Alpha")
    .getByRole("button", { name: "Permissions de Alice Alpha", exact: true })
    .click();
  const form = page.getByRole("dialog");
  await expect(
    form.getByLabel("Verrouiller Description", { exact: true }),
  ).toBeChecked();
  await form.getByLabel("Verrouiller Nom", { exact: true }).check();
  await form.getByLabel("Verrouiller Rôle", { exact: true }).check();
  await form
    .getByRole("combobox", { name: "Rôle", exact: true })
    .selectOption("role-visitor");
  await form
    .getByRole("button", { name: "Enregistrer les permissions", exact: true })
    .click();
  await expect(form).toHaveCount(0);
  const saved = fixture.mutation("PUT", "/alpha-human/access");
  expect(saved).toHaveLength(1);
  expectCsrf(saved[0]);
  expect(saved[0].body?.roleId).toBe("role-visitor");
  expect(saved[0].body?.nonEditableFields).toEqual(
    expect.arrayContaining(["name", "description", "role"]),
  );
  expect(saved[0].body?.nonEditableFields).not.toContain("roleId");
});

test("des restrictions non renvoyées par le serveur ne sont pas effacées par le formulaire", async ({
  page,
}) => {
  const fixture = new HttpFixture();
  delete fixture.resources.get("planzone-alpha")![0].nonEditableFields;
  await fixture.mount(page);
  await expect(row(page, "Alice Alpha")).toBeVisible();
  await row(page, "Alice Alpha")
    .getByRole("button", { name: "Permissions de Alice Alpha", exact: true })
    .click();
  const form = page.getByRole("dialog");
  await expect(
    form.getByRole("button", {
      name: "Enregistrer les permissions",
      exact: true,
    }),
  ).toBeDisabled();
  expect(fixture.mutation("PUT", "/alpha-human/access")).toHaveLength(0);
});

test("un conflit de version conserve le nom actuel sans replay automatique de la mutation", async ({
  page,
}) => {
  const fixture = new HttpFixture();
  fixture.failures.set(
    "PATCH /api/v1/planzones/planzone-alpha/resources/alpha-human",
    {
      status: 409,
      code: "VERSION_CONFLICT",
      message: "La ressource a changé. Rechargez ses données.",
    },
  );
  await fixture.mount(page);
  await expect(row(page, "Alice Alpha")).toBeVisible();
  await row(page, "Alice Alpha")
    .getByRole("button", { name: "Modifier Alice Alpha", exact: true })
    .click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Nouveau nom", { exact: true }).fill("Nom concurrent");
  await form.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText(
    /ressource a changé.*Rechargez/s,
  );
  const edited = fixture.mutation("PATCH", "/alpha-human");
  expect(edited).toHaveLength(1);
  expectCsrf(edited[0]);
  expect(edited[0].body).toEqual({
    expectedVersion: 3,
    name: "Nom concurrent",
  });
  expect(fixture.resources.get("planzone-alpha")![0].name).toBe("Alice Alpha");
  await expect(row(page, "Alice Alpha")).toBeVisible();
  await expect(
    form.getByRole("button", { name: "Enregistrer", exact: true }),
  ).toBeDisabled();
  fixture.failures.clear();
  Object.assign(fixture.resources.get("planzone-alpha")![0], {
    name: "Alice mise à jour",
    version: 4,
  });
  await form
    .getByRole("button", { name: "Recharger le profil", exact: true })
    .click();
  await expect(form.getByLabel("Nouveau nom", { exact: true })).toHaveValue(
    "Alice mise à jour",
  );
  await form.getByLabel("Nouveau nom", { exact: true }).fill("Alice validée");
  await form.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(row(page, "Alice validée")).toBeVisible();
  const afterRefresh = fixture.mutation("PATCH", "/alpha-human");
  expect(afterRefresh).toHaveLength(2);
  expect(afterRefresh[1].body).toEqual({
    expectedVersion: 4,
    name: "Alice validée",
  });
});

test("un refus du serveur reste visible même si les actions étaient initialement autorisées", async ({
  page,
}) => {
  const fixture = new HttpFixture();
  fixture.failures.set(
    "PATCH /api/v1/planzones/planzone-alpha/resources/alpha-human",
    {
      status: 403,
      code: "ACCESS_DENIED",
      message: "Vos droits de modification ont été retirés.",
    },
  );
  await fixture.mount(page);
  await expect(row(page, "Alice Alpha")).toBeVisible();
  await row(page, "Alice Alpha")
    .getByRole("button", { name: "Modifier Alice Alpha", exact: true })
    .click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Nouveau nom", { exact: true }).fill("Nom interdit");
  await form.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText(/droits nécessaires/i);
  expect(fixture.mutation("PATCH", "/alpha-human")).toHaveLength(1);
  await expect(row(page, "Alice Alpha")).toBeVisible();
});

test("un conflit d’opération ne rejoue pas de requête et un corps modifié obtient un nouvel identifiant", async ({
  page,
}) => {
  const fixture = new HttpFixture();
  fixture.failures.set("POST /api/v1/planzones/planzone-alpha/resources", {
    status: 409,
    code: "OPERATION_CONFLICT",
    message: "Cette opération existe avec un autre contenu.",
  });
  await fixture.mount(page);
  await expect(row(page, "Alice Alpha")).toBeVisible();
  await page
    .getByRole("button", { name: "Créer une ressource", exact: true })
    .click();
  const form = page.getByRole("dialog", {
    name: "Créer une ressource",
    exact: true,
  });
  await form
    .getByLabel("Nom de la ressource", { exact: true })
    .fill("Première demande");
  await form
    .getByRole("button", { name: "Créer une ressource", exact: true })
    .click();
  await expect(form.getByRole("alert")).toContainText(
    /conflit.*Rien n’a été renvoyé automatiquement/s,
  );
  const first = fixture.mutation("POST", "/resources");
  expect(first).toHaveLength(1);
  expectOperationId(first[0]);
  fixture.failures.clear();
  await form
    .getByLabel("Nom de la ressource", { exact: true })
    .fill("Demande corrigée");
  await form
    .getByRole("button", { name: "Créer une ressource", exact: true })
    .click();
  await expect(row(page, "Demande corrigée")).toBeVisible();
  const calls = fixture.mutation("POST", "/resources");
  expect(calls).toHaveLength(2);
  expect(calls[1].body?.operationId).not.toBe(calls[0].body?.operationId);
  expectOperationId(calls[1]);
  expectCsrf(calls[1]);
});

test("une restriction du profil bloque l’édition de son nom malgré la permission globale", async ({
  page,
}) => {
  const fixture = new HttpFixture();
  fixture.resources.get("planzone-alpha")![0].nonEditableFields = ["name"];
  await fixture.mount(page);
  await expect(row(page, "Alice Alpha")).toBeVisible();
  await expect(
    row(page, "Alice Alpha").getByRole("button", {
      name: "Modifier Alice Alpha",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(fixture.mutation("PATCH", "/alpha-human")).toHaveLength(0);
});

test("la gestion des restrictions conserve le rôle lorsque sa modification est interdite", async ({
  page,
}) => {
  const fixture = new HttpFixture();
  fixture.canManageRoles.set("planzone-alpha", false);
  await fixture.mount(page);
  await expect(row(page, "Alice Alpha")).toBeVisible();
  await row(page, "Alice Alpha")
    .getByRole("button", { name: "Permissions de Alice Alpha", exact: true })
    .click();
  const form = page.getByRole("dialog");
  await expect(
    form.getByRole("combobox", { name: "Rôle", exact: true }),
  ).toBeDisabled();
  await form.getByLabel("Verrouiller Description", { exact: true }).check();
  await form
    .getByRole("button", { name: "Enregistrer les permissions", exact: true })
    .click();
  await expect(form).toHaveCount(0);
  const call = fixture.mutation("PUT", "/alpha-human/access")[0];
  expect(call.body).toEqual({
    roleId: "role-user",
    nonEditableFields: ["description"],
  });
  expectCsrf(call);
});

test("la déconnexion envoie le CSRF puis retire les données du client courant", async ({
  page,
}) => {
  const fixture = new HttpFixture();
  await fixture.mount(page);
  await expect(row(page, "Alice Alpha")).toBeVisible();
  await page
    .getByRole("button", { name: "Se déconnecter", exact: true })
    .click();
  await expect(
    page
      .getByRole("button", { name: "Se connecter", exact: true })
      .or(page.getByRole("link", { name: "Se connecter", exact: true })),
  ).toBeVisible();
  await expect(row(page, "Alice Alpha")).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Planzone", exact: true }),
  ).toHaveCount(0);
  const calls = fixture.mutation("POST", "/auth/logout");
  expect(calls).toHaveLength(1);
  expectCsrf(calls[0]);
});

test("une invitation indisponible affiche l’erreur sans proposer une acceptation", async ({
  page,
}) => {
  const fixture = new HttpFixture();
  fixture.failures.set("GET /api/v1/invitations/preview", {
    status: 410,
    code: "INVITATION_UNAVAILABLE",
    message: "Cette invitation a expiré ou a été révoquée.",
  });
  await fixture.mount(page, "/invitations/accept?token=expired-test-token");
  await expect(page.getByRole("alert")).toContainText(
    "Cette invitation a expiré ou a été révoquée.",
  );
  await expect(
    page.getByRole("button", { name: "Accepter l’invitation", exact: true }),
  ).toHaveCount(0);
  expect(fixture.mutation("POST", "/invitations/accept")).toHaveLength(0);
});

test("l’interface mobile reste défilante et une modale restitue le focus au clavier", async ({
  page,
}) => {
  const fixture = new HttpFixture();
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture.mount(page);
  await expect(row(page, "Alice Alpha")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const trigger = page.getByRole("button", {
    name: "Créer une ressource",
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", {
    name: "Créer une ressource",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return box.left >= 0 && box.right <= innerWidth;
    }),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.screenshot({
    path: test.info().outputPath("pz7-access-mobile.png"),
    fullPage: true,
  });
});

test("SESSION_EXPIRED invite à se reconnecter sans boucle de renouvellement", async ({
  page,
}) => {
  const fixture = new HttpFixture();
  fixture.failures.set("GET /api/v1/session", {
    status: 401,
    code: "SESSION_EXPIRED",
    message: "Session expired",
  });
  await fixture.mount(page);
  await expect(
    page.getByText("Votre session a expiré. Connectez-vous pour poursuivre.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Se connecter", exact: true }),
  ).toBeVisible();
  await expect(row(page, "Alice Alpha")).toHaveCount(0);
  expect(
    fixture.calls.filter((call) => call.path === "/api/v1/session"),
  ).toHaveLength(1);
  expect(fixture.calls.some((call) => call.path === "/api/v1/auth/login")).toBe(
    false,
  );
});
