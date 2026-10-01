import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

/**
 * Tests the declarative route policy: permission mapping, project scoping and
 * list narrowing.
 *
 * The app mounts the real middleware chain but ends in an echo handler instead
 * of the business routers — the point is what the policy allows, not what the
 * handlers do (several of them launch browsers).
 */
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-lab-policy-"));
process.env.DB_DRIVER = "sqlite";
process.env.SQLITE_DB_PATH = path.join(tempDir, "policy-test.db");
process.env.AUTH_ENABLED = "true";
delete process.env.API_KEY;
for (const key of ["AUTH_BOOTSTRAP_USERNAME", "AUTH_BOOTSTRAP_PASSWORD", "AUTH_BOOTSTRAP_FULLNAME"]) {
  delete process.env[key];
}

const failures: string[] = [];

async function test(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failures.push(label);
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main(): Promise<void> {
  const express = (await import("express")).default;
  const sqlConnection = await import("../db/sql-connection");
  const { bootstrapIdentity } = await import("./bootstrap");
  const { attachPrincipal, isPublicPath, requireFullScope } = await import(
    "../server/middleware/auth"
  );
  const { enforceRoutePolicy, filterByProjectAccess, findRoutePolicy, extractProjectReference } =
    await import("../server/middleware/route-policy");
  const { authRouter } = await import("../server/routes/auth");
  const { usersRouter } = await import("../server/routes/users");
  const { jobStore } = await import("../server/jobs/job-store");
  const { createServicePrincipal } = await import("./principal");

  const conn = await sqlConnection.getConnection();

  const app = express();
  app.use(express.json());
  app.use(attachPrincipal());
  app.use((req, res, next) => {
    if (isPublicPath(req.path)) return next();
    if (req.principal) return next();
    res.status(401).json({ ok: false, error: "missing_token" });
  });
  app.use(requireFullScope());
  app.use(enforceRoutePolicy());
  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  // Stands in for every business router: reaching here means the policy allowed it.
  app.use((req, res) => {
    res.json({ ok: true, reached: `${req.method} ${req.path}` });
  });

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function call(
    method: string,
    route: string,
    token?: string,
    body?: unknown,
  ): Promise<{ status: number; body: any }> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetch(`${base}${route}`, {
      method,
      headers,
      body: body === undefined || method === "GET" || method === "HEAD" ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: any = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: response.status, body: parsed };
  }

  async function activate(username: string, temp: string, next: string): Promise<string> {
    const first = await call("POST", "/api/auth/login", undefined, { username, password: temp });
    const changed = await call("POST", "/api/auth/change-password", first.body.token, {
      currentPassword: temp,
      newPassword: next,
    });
    assert.strictEqual(changed.status, 200, JSON.stringify(changed.body));
    return changed.body.token;
  }

  console.log(`\n[test] servidor en ${base}`);

  // --- fixtures -----------------------------------------------------------
  await bootstrapIdentity({ username: "admin", password: "Arranque12345" });
  const adminToken = await activate("admin", "Arranque12345", "ClaveMaestra12345");

  const projectIds: Record<string, string> = {};
  for (const slug of ["kiosko", "portal-comercial"]) {
    const inserted = await conn.query<{ id: string }>(
      `INSERT INTO dbo.Projects (slug, name, projectType, status, enabled)
       OUTPUT INSERTED.id VALUES (?, ?, 1, 1, 1)`,
      [slug, slug],
    );
    projectIds[slug] = inserted[0].id;
  }

  // A qa-engineer scoped to "kiosko" only.
  const engineerCreated = await call("POST", "/api/users", adminToken, {
    username: "ana.qa",
    fullName: "Ana Quintero",
    roles: ["qa-engineer"],
    projects: [{ slug: "kiosko", accessLevel: 2 }],
  });
  assert.strictEqual(engineerCreated.status, 201, JSON.stringify(engineerCreated.body));
  const engineerToken = await activate(
    "ana.qa",
    engineerCreated.body.temporaryPassword,
    "AnaSegura12345",
  );

  // A read-only viewer scoped to "portal-comercial".
  const viewerCreated = await call("POST", "/api/users", adminToken, {
    username: "beto.view",
    fullName: "Beto Consulta",
    roles: ["viewer"],
    projects: [{ slug: "portal-comercial", accessLevel: 1 }],
  });
  const viewerToken = await activate(
    "beto.view",
    viewerCreated.body.temporaryPassword,
    "BetoSeguro12345",
  );

  // ------------------------------------------------------------------------
  console.log("\nmapeo de permisos por ruta");

  await test("resolves the policy table in Express order", async () => {
    // The literal path must win over the parameterized one.
    assert.strictEqual(
      findRoutePolicy("GET", "/api/projects/shared-connections")?.path,
      "/api/projects/shared-connections",
    );
    assert.strictEqual(findRoutePolicy("GET", "/api/projects/kiosko")?.path, "/api/projects/:slug");
    assert.strictEqual(
      findRoutePolicy("GET", "/api/runs/abc/logs")?.path,
      "/api/runs/:jobId/logs",
    );
    assert.strictEqual(findRoutePolicy("GET", "/api/runs/abc")?.path, "/api/runs/:jobId");
    assert.strictEqual(findRoutePolicy("GET", "/api/runs")?.path, "/api/runs");
  });

  await test("an admin reaches every module", async () => {
    for (const [method, route] of [
      ["GET", "/api/projects"],
      ["POST", "/api/projects/web"],
      ["DELETE", "/api/projects/kiosko"],
      ["POST", "/api/runs/discovery-batch"],
      ["GET", "/api/executions"],
      ["POST", "/api/recordings/start"],
      ["GET", "/api/jira/projects"],
      ["GET", "/api/testrail/status"],
    ] as const) {
      const res = await call(method, route, adminToken, { appSlug: "kiosko", projectSlug: "kiosko" });
      assert.strictEqual(res.status, 200, `${method} ${route} -> ${JSON.stringify(res.body)}`);
    }
  });

  await test("a qa-engineer cannot create or delete projects", async () => {
    const create = await call("POST", "/api/projects/web", engineerToken, { slug: "nuevo" });
    assert.strictEqual(create.status, 403);
    assert.strictEqual(create.body.error, "forbidden");
    assert.deepStrictEqual(create.body.missingPermissions, ["projects.create"]);

    const remove = await call("DELETE", "/api/projects/kiosko", engineerToken);
    assert.strictEqual(remove.status, 403);
    assert.deepStrictEqual(remove.body.missingPermissions, ["projects.delete"]);
  });

  await test("a qa-engineer may launch, record and derive", async () => {
    for (const [method, route] of [
      ["POST", "/api/runs/discovery-batch"],
      ["POST", "/api/recordings/start"],
      ["POST", "/api/recordings/rec-1/derive"],
      ["GET", "/api/executions"],
    ] as const) {
      const res = await call(method, route, engineerToken, {
        appSlug: "kiosko",
        projectSlug: "kiosko",
      });
      assert.strictEqual(res.status, 200, `${method} ${route} -> ${JSON.stringify(res.body)}`);
    }
  });

  await test("a qa-engineer cannot promote recordings to TestRail", async () => {
    const res = await call("POST", "/api/recordings/rec-1/testrail", engineerToken, {
      projectSlug: "kiosko",
    });
    assert.strictEqual(res.status, 403);
    assert.deepStrictEqual(res.body.missingPermissions, ["recordings.promote"]);
  });

  await test("a viewer cannot launch tests or record", async () => {
    const launch = await call("POST", "/api/runs/discovery-batch", viewerToken, {
      appSlug: "portal-comercial",
    });
    assert.strictEqual(launch.status, 403);
    assert.deepStrictEqual(launch.body.missingPermissions, ["tests.launch"]);

    const record = await call("POST", "/api/recordings/start", viewerToken, {
      projectSlug: "portal-comercial",
    });
    assert.strictEqual(record.status, 403);
    assert.deepStrictEqual(record.body.missingPermissions, ["recordings.create"]);
  });

  await test("a viewer may read what its role allows", async () => {
    for (const route of ["/api/executions", "/api/recordings?projectSlug=portal-comercial"]) {
      const res = await call("GET", route, viewerToken);
      assert.strictEqual(res.status, 200, `${route} -> ${JSON.stringify(res.body)}`);
    }
  });

  await test("nobody but an admin reaches the debug routes", async () => {
    assert.strictEqual((await call("GET", "/api/debug/testrail/status", engineerToken)).status, 403);
    assert.strictEqual((await call("GET", "/api/debug/testrail/status", adminToken)).status, 200);
  });

  // ------------------------------------------------------------------------
  console.log("\nalcance por proyecto");

  await test("allows a granted project and refuses the others", async () => {
    const granted = await call("GET", "/api/projects/kiosko", engineerToken);
    assert.strictEqual(granted.status, 200);

    const denied = await call("GET", "/api/projects/portal-comercial", engineerToken);
    assert.strictEqual(denied.status, 403);
    assert.strictEqual(denied.body.error, "project_forbidden");
    assert.strictEqual(denied.body.project, "portal-comercial");
  });

  await test("scopes a run launch by the appSlug in the body", async () => {
    const ok = await call("POST", "/api/runs/scenario-preview", engineerToken, {
      appSlug: "kiosko",
    });
    assert.strictEqual(ok.status, 200);

    const denied = await call("POST", "/api/runs/scenario-preview", engineerToken, {
      appSlug: "portal-comercial",
    });
    assert.strictEqual(denied.status, 403);
    assert.strictEqual(denied.body.error, "project_forbidden");
  });

  await test("scopes recordings by the projectSlug in the query", async () => {
    assert.strictEqual(
      (await call("GET", "/api/recordings?projectSlug=kiosko", engineerToken)).status,
      200,
    );
    const denied = await call("GET", "/api/recordings?projectSlug=portal-comercial", engineerToken);
    assert.strictEqual(denied.status, 403);
    assert.strictEqual(denied.body.error, "project_forbidden");
  });

  await test("refuses a scoped user who names no project on a project route", async () => {
    const res = await call("POST", "/api/runs/discovery-batch", engineerToken, {});
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.error, "project_scope_required");
  });

  await test("an allProjects user is never asked to name a project", async () => {
    assert.strictEqual((await call("POST", "/api/runs/discovery-batch", adminToken, {})).status, 200);
    assert.strictEqual((await call("GET", "/api/projects/portal-comercial", adminToken)).status, 200);
  });

  await test("derives a job's project from the params it was created with", async () => {
    const mine = jobStore.create("discovery-batch", { appSlug: "kiosko" });
    const theirs = jobStore.create("discovery-batch", { appSlug: "portal-comercial" });

    assert.strictEqual((await call("GET", `/api/runs/${mine.id}`, engineerToken)).status, 200);
    assert.strictEqual((await call("GET", `/api/runs/${mine.id}/logs`, engineerToken)).status, 200);

    const denied = await call("GET", `/api/runs/${theirs.id}`, engineerToken);
    assert.strictEqual(denied.status, 403);
    assert.strictEqual(denied.body.error, "project_forbidden");

    const rerun = await call("POST", `/api/runs/${theirs.id}/rerun`, engineerToken, {});
    assert.strictEqual(rerun.status, 403);
  });

  await test("an unknown job id falls through to the handler's 404", async () => {
    // The policy cannot resolve a project, so it defers rather than masking the
    // real answer with a 403.
    const res = await call("GET", "/api/runs/no-existe", engineerToken);
    assert.strictEqual(res.status, 200, "reaches the handler (the echo stands in for its 404)");
  });

  await test("extracts the project reference from every spelling in use", async () => {
    const make = (over: any) => ({ params: {}, body: {}, query: {}, ...over }) as any;
    assert.strictEqual(extractProjectReference(make({ params: { slug: "a" } })), "a");
    assert.strictEqual(extractProjectReference(make({ body: { appSlug: "b" } })), "b");
    assert.strictEqual(extractProjectReference(make({ body: { projectSlug: "c" } })), "c");
    assert.strictEqual(extractProjectReference(make({ body: { targetAppSlug: "d" } })), "d");
    assert.strictEqual(extractProjectReference(make({ query: { appSlug: "e" } })), "e");
    assert.strictEqual(extractProjectReference(make({})), null);
    assert.strictEqual(extractProjectReference(make({ body: { appSlug: "  " } })), null);
  });

  // ------------------------------------------------------------------------
  console.log("\nrutas sin política declarada");

  await test("refuses an /api route that is not in the table", async () => {
    const res = await call("GET", "/api/ruta-inventada", adminToken);
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.error, "route_not_authorized");
  });

  await test("leaves non-/api paths alone", async () => {
    assert.strictEqual((await call("GET", "/algo-estatico", adminToken)).status, 200);
  });

  // ------------------------------------------------------------------------
  console.log("\nfiltrado de listados");

  await test("narrows a list to the granted projects", async () => {
    const principal = {
      allProjects: false,
      projectIds: new Set<string>(),
      projectSlugs: new Set(["kiosko"]),
    } as any;
    const items = [{ slug: "kiosko" }, { slug: "portal-comercial" }, { slug: null }];
    const visible = filterByProjectAccess(principal, items, (item) => item.slug);
    assert.deepStrictEqual(visible, [{ slug: "kiosko" }]);
  });

  await test("leaves the list untouched for an allProjects principal", async () => {
    const items = [{ slug: "kiosko" }, { slug: "portal-comercial" }];
    assert.deepStrictEqual(
      filterByProjectAccess(createServicePrincipal(), items, (item) => item.slug),
      items,
    );
  });

  await test("matches a project by id as well as by slug", async () => {
    const principal = {
      allProjects: false,
      projectIds: new Set([projectIds.kiosko.toLowerCase()]),
      projectSlugs: new Set<string>(),
    } as any;
    const items = [{ ref: projectIds.kiosko }, { ref: projectIds["portal-comercial"] }];
    const visible = filterByProjectAccess(principal, items, (item) => item.ref);
    assert.deepStrictEqual(visible, [{ ref: projectIds.kiosko }]);
  });

  // ------------------------------------------------------------------------
  console.log("\ncompatibilidad");

  await test("the API key principal bypasses every check", async () => {
    process.env.API_KEY = "clave-secreta";
    try {
      const response = await fetch(`${base}/api/projects/portal-comercial`, {
        headers: { "x-api-key": "clave-secreta" },
      });
      assert.strictEqual(response.status, 200);
    } finally {
      delete process.env.API_KEY;
    }
  });

  await test("AUTH_ENABLED=false leaves every route open", async () => {
    process.env.AUTH_ENABLED = "false";
    try {
      assert.strictEqual((await call("DELETE", "/api/projects/kiosko")).status, 200);
      assert.strictEqual((await call("POST", "/api/runs/discovery-batch", undefined, {})).status, 200);
    } finally {
      process.env.AUTH_ENABLED = "true";
    }
  });

  // ------------------------------------------------------------------------
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await sqlConnection.closeConnection();
  fs.rmSync(tempDir, { recursive: true, force: true });

  console.log("");
  if (failures.length > 0) {
    console.error(`${failures.length} test(s) failed:\n  - ${failures.join("\n  - ")}\n`);
    process.exitCode = 1;
  } else {
    console.log("All route policy tests passed.\n");
  }
}

main().catch((err) => {
  console.error(err);
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // best effort
  }
  process.exitCode = 1;
});
