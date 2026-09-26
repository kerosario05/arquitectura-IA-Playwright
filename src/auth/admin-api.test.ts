import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

/**
 * End-to-end test of the admin module (/api/users, /api/roles, /api/permissions)
 * over real HTTP against a throwaway SQLite database.
 */
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-lab-adminapi-"));
process.env.DB_DRIVER = "sqlite";
process.env.SQLITE_DB_PATH = path.join(tempDir, "admin-api-test.db");
process.env.AUTH_ENABLED = "true";
delete process.env.API_KEY;
for (const key of ["AUTH_BOOTSTRAP_USERNAME", "AUTH_BOOTSTRAP_PASSWORD", "AUTH_BOOTSTRAP_FULLNAME"]) {
  delete process.env[key];
}

const ADMIN_PASSWORD = "Arranque12345";
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

type ApiResponse = { status: number; body: any };

async function main(): Promise<void> {
  const express = (await import("express")).default;
  const sqlConnection = await import("../db/sql-connection");
  const { bootstrapIdentity } = await import("./bootstrap");
  const { attachPrincipal, isPublicPath, requireFullScope } = await import(
    "../server/middleware/auth"
  );
  const { authRouter } = await import("../server/routes/auth");
  const { usersRouter } = await import("../server/routes/users");
  const { rolesRouter, permissionsRouter } = await import("../server/routes/roles");
  const users = await import("../db/user-repository");

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
  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/roles", rolesRouter);
  app.use("/api/permissions", permissionsRouter);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function call(
    method: string,
    route: string,
    options: { token?: string; body?: unknown } = {},
  ): Promise<ApiResponse> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    const response = await fetch(`${base}${route}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    let body: any = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { status: response.status, body };
  }

  async function loginAs(username: string, password: string): Promise<string> {
    const res = await call("POST", "/api/auth/login", { body: { username, password } });
    assert.strictEqual(res.status, 200, `login failed for ${username}: ${JSON.stringify(res.body)}`);
    return res.body.token;
  }

  /** Logs in with a temporary password and completes the forced change. */
  async function activate(username: string, tempPassword: string, newPassword: string): Promise<string> {
    const first = await call("POST", "/api/auth/login", {
      body: { username, password: tempPassword },
    });
    assert.strictEqual(first.body.scope, "password_change_only");
    const changed = await call("POST", "/api/auth/change-password", {
      token: first.body.token,
      body: { currentPassword: tempPassword, newPassword },
    });
    assert.strictEqual(changed.status, 200, JSON.stringify(changed.body));
    return changed.body.token;
  }

  console.log(`\n[test] servidor en ${base}`);

  // Seed: an admin whose forced change is already done.
  await bootstrapIdentity({ username: "admin", password: ADMIN_PASSWORD });
  const adminToken = await activate("admin", ADMIN_PASSWORD, "ClaveMaestra12345");

  // Two projects to hand out.
  const projectIds: Record<string, string> = {};
  for (const slug of ["kiosko", "portal-comercial"]) {
    const inserted = await conn.query<{ id: string }>(
      `INSERT INTO dbo.Projects (slug, name, projectType, status, enabled)
       OUTPUT INSERTED.id VALUES (?, ?, 1, 1, 1)`,
      [slug, slug],
    );
    projectIds[slug] = inserted[0].id;
  }

  // ------------------------------------------------------------------------
  console.log("\ncreación de usuarios");

  let anaId = "";
  let anaTempPassword = "";

  await test("creates a user with a generated temporary password", async () => {
    const res = await call("POST", "/api/users", {
      token: adminToken,
      body: {
        username: "ana.qa",
        fullName: "Ana Quintero",
        email: "ana@example.com",
        roles: ["qa-engineer"],
        projects: [{ slug: "kiosko", accessLevel: 2 }],
      },
    });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    assert.ok(res.body.temporaryPassword, "a temporary password must be returned");
    assert.strictEqual(res.body.user.mustChangePassword, true);
    assert.strictEqual(res.body.user.enabled, true);
    assert.deepStrictEqual(res.body.user.roles.map((r: any) => r.slug), ["qa-engineer"]);
    assert.deepStrictEqual(res.body.user.projects.map((p: any) => p.projectSlug), ["kiosko"]);
    assert.strictEqual(res.body.user.projects[0].accessLevel, 2);
    assert.ok(!("passwordHash" in res.body.user));
    anaId = res.body.user.id;
    anaTempPassword = res.body.temporaryPassword;
  });

  await test("accepts an explicit password, still marked as temporary", async () => {
    const res = await call("POST", "/api/users", {
      token: adminToken,
      body: { username: "luis.qa", fullName: "Luis Perez", password: "Provisional123", roles: ["viewer"] },
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.temporaryPassword, undefined, "no need to echo a supplied password");
    assert.strictEqual(res.body.user.mustChangePassword, true);
  });

  await test("rejects a duplicate username case-insensitively", async () => {
    const res = await call("POST", "/api/users", {
      token: adminToken,
      body: { username: "ANA.QA", fullName: "Otra Ana" },
    });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, "username_taken");
  });

  await test("validates the username format", async () => {
    for (const username of ["ab", "con espacio", "sim/bolo", "a".repeat(70)]) {
      const res = await call("POST", "/api/users", {
        token: adminToken,
        body: { username, fullName: "Nombre Valido" },
      });
      assert.strictEqual(res.status, 400, `expected 400 for "${username}"`);
      assert.strictEqual(res.body.error, "invalid_username");
    }
  });

  await test("validates the email format", async () => {
    const res = await call("POST", "/api/users", {
      token: adminToken,
      body: { username: "mail.malo", fullName: "Mail Malo", email: "no-es-un-correo" },
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, "invalid_email");
  });

  await test("rejects a supplied password that violates the policy", async () => {
    const res = await call("POST", "/api/users", {
      token: adminToken,
      body: { username: "clave.debil", fullName: "Clave Debil", password: "corta" },
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, "password_policy_violation");
    assert.ok(res.body.violations.length > 0);
  });

  await test("rejects an unknown role and creates nothing", async () => {
    const res = await call("POST", "/api/users", {
      token: adminToken,
      body: { username: "rol.fantasma", fullName: "Rol Fantasma", roles: ["no-existe"] },
    });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.error, "role_not_found");
    assert.strictEqual(await users.usernameExists("rol.fantasma"), false, "must not be created");
  });

  await test("rejects an unknown project and creates nothing", async () => {
    const res = await call("POST", "/api/users", {
      token: adminToken,
      body: { username: "proy.fantasma", fullName: "Proy Fantasma", projects: ["no-existe"] },
    });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.error, "project_not_found");
    assert.strictEqual(await users.usernameExists("proy.fantasma"), false);
  });

  // ------------------------------------------------------------------------
  console.log("\nlistado y consulta");

  await test("lists users with roles, projects and session counts", async () => {
    const res = await call("GET", "/api/users", { token: adminToken });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.total, 3);
    const ana = res.body.users.find((u: any) => u.username === "ana.qa");
    assert.deepStrictEqual(ana.roles.map((r: any) => r.slug), ["qa-engineer"]);
    assert.ok(ana.permissions.includes("recordings.create"));
    assert.strictEqual(typeof ana.activeSessions, "number");
    assert.ok(res.body.users.every((u: any) => !("passwordHash" in u)));
  });

  await test("filters by role, enabled and search term", async () => {
    assert.strictEqual((await call("GET", "/api/users?role=admin", { token: adminToken })).body.total, 1);
    assert.strictEqual((await call("GET", "/api/users?role=viewer", { token: adminToken })).body.total, 1);
    assert.strictEqual((await call("GET", "/api/users?q=quintero", { token: adminToken })).body.total, 1);
    assert.strictEqual((await call("GET", "/api/users?enabled=true", { token: adminToken })).body.total, 3);
  });

  await test("returns 404 for an unknown id", async () => {
    const res = await call("GET", "/api/users/no-existe", { token: adminToken });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.error, "user_not_found");
  });

  // ------------------------------------------------------------------------
  console.log("\nedición");

  await test("patches only the supplied fields", async () => {
    const res = await call("PATCH", `/api/users/${anaId}`, {
      token: adminToken,
      body: { fullName: "Ana Quintero Rodriguez" },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.user.fullName, "Ana Quintero Rodriguez");
    assert.strictEqual(res.body.user.username, "ana.qa", "untouched fields must survive");
    assert.strictEqual(res.body.user.email, "ana@example.com");
  });

  await test("renames a user and refuses a colliding rename", async () => {
    const ok = await call("PATCH", `/api/users/${anaId}`, {
      token: adminToken,
      body: { username: "ana.quintero" },
    });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.body.user.username, "ana.quintero");

    const collision = await call("PATCH", `/api/users/${anaId}`, {
      token: adminToken,
      body: { username: "luis.qa" },
    });
    assert.strictEqual(collision.status, 409);
    assert.strictEqual(collision.body.error, "username_taken");

    await call("PATCH", `/api/users/${anaId}`, { token: adminToken, body: { username: "ana.qa" } });
  });

  await test("clears the email when null is sent", async () => {
    const res = await call("PATCH", `/api/users/${anaId}`, {
      token: adminToken,
      body: { email: null },
    });
    assert.strictEqual(res.body.user.email, null);
    await call("PATCH", `/api/users/${anaId}`, {
      token: adminToken,
      body: { email: "ana@example.com" },
    });
  });

  // ------------------------------------------------------------------------
  console.log("\ndesactivación y sesiones");

  await test("disabling a user kills their live session", async () => {
    const anaToken = await activate("ana.qa", anaTempPassword, "AnaDefinitiva123");
    assert.strictEqual((await call("GET", "/api/auth/me", { token: anaToken })).status, 200);

    const disabled = await call("PATCH", `/api/users/${anaId}`, {
      token: adminToken,
      body: { enabled: false },
    });
    assert.strictEqual(disabled.status, 200);
    assert.strictEqual(disabled.body.user.enabled, false);

    // The admin path revokes sessions up front, so the token dies as revoked
    // rather than falling through to the disabled-account check on next use.
    const after = await call("GET", "/api/auth/me", { token: anaToken });
    assert.strictEqual(after.status, 401);
    assert.strictEqual(after.body.error, "session_revoked");

    const loginAttempt = await call("POST", "/api/auth/login", {
      body: { username: "ana.qa", password: "AnaDefinitiva123" },
    });
    assert.strictEqual(loginAttempt.status, 403);
    assert.strictEqual(loginAttempt.body.error, "account_disabled");
  });

  await test("re-enables a user", async () => {
    const res = await call("PATCH", `/api/users/${anaId}`, {
      token: adminToken,
      body: { enabled: true },
    });
    assert.strictEqual(res.body.user.enabled, true);
    assert.strictEqual((await loginAs("ana.qa", "AnaDefinitiva123")).length > 0, true);
  });

  await test("DELETE deactivates instead of removing the row", async () => {
    const res = await call("DELETE", `/api/users/${anaId}`, { token: adminToken });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.deactivated, true);
    assert.strictEqual(res.body.user.enabled, false);

    const stillThere = await call("GET", `/api/users/${anaId}`, { token: adminToken });
    assert.strictEqual(stillThere.status, 200, "the row must survive a DELETE");
    await call("PATCH", `/api/users/${anaId}`, { token: adminToken, body: { enabled: true } });
  });

  // ------------------------------------------------------------------------
  console.log("\nprotección del último administrador");

  await test("an admin cannot disable their own account", async () => {
    const me = await call("GET", "/api/auth/me", { token: adminToken });
    const res = await call("PATCH", `/api/users/${me.body.user.id}`, {
      token: adminToken,
      body: { enabled: false },
    });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, "cannot_modify_self");
  });

  await test("an admin cannot strip their own admin role", async () => {
    const me = await call("GET", "/api/auth/me", { token: adminToken });
    const res = await call("PUT", `/api/users/${me.body.user.id}/roles`, {
      token: adminToken,
      body: { roles: ["viewer"] },
    });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, "cannot_modify_self");
  });

  let segundoAdminToken = "";
  let segundoAdminId = "";

  await test("a second admin lifts the last-admin restriction", async () => {
    const created = await call("POST", "/api/users", {
      token: adminToken,
      body: {
        username: "admin.dos",
        fullName: "Admin Dos",
        password: "SegundoAdmin123",
        roles: ["admin"],
        allProjects: true,
      },
    });
    assert.strictEqual(created.status, 201);
    segundoAdminId = created.body.user.id;
    segundoAdminToken = await activate("admin.dos", "SegundoAdmin123", "AdminDosFinal123");

    // Now the second admin may disable the first.
    const me = await call("GET", "/api/auth/me", { token: adminToken });
    const res = await call("PATCH", `/api/users/${me.body.user.id}`, {
      token: segundoAdminToken,
      body: { enabled: false },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.user.enabled, false);
  });

  await test("the last remaining admin cannot be disabled", async () => {
    const res = await call("PATCH", `/api/users/${segundoAdminId}`, {
      token: segundoAdminToken,
      body: { enabled: false },
    });
    assert.strictEqual(res.status, 409);
    // Self-protection fires first; both guards point at the same outcome.
    assert.ok(["cannot_modify_self", "last_admin"].includes(res.body.error));
  });

  await test("restores the first admin for the remaining tests", async () => {
    const list = await call("GET", "/api/users?q=admin", { token: segundoAdminToken });
    const first = list.body.users.find((u: any) => u.username === "admin");
    await call("PATCH", `/api/users/${first.id}`, {
      token: segundoAdminToken,
      body: { enabled: true },
    });
    // The session was revoked when the account was disabled: log in again.
    const fresh = await loginAs("admin", "ClaveMaestra12345");
    assert.ok(fresh);
  });

  // ------------------------------------------------------------------------
  console.log("\nreset de contraseña");

  await test("resets a password, forces a change and kills live sessions", async () => {
    const anaToken = await loginAs("ana.qa", "AnaDefinitiva123");
    assert.strictEqual((await call("GET", "/api/auth/me", { token: anaToken })).status, 200);

    const res = await call("POST", `/api/users/${anaId}/reset-password`, {
      token: segundoAdminToken,
      body: {},
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.temporaryPassword);
    assert.strictEqual(res.body.mustChangePassword, true);
    assert.strictEqual(res.body.revokedSessions, 1);

    assert.strictEqual(
      (await call("GET", "/api/auth/me", { token: anaToken })).status,
      401,
      "the old session must be dead",
    );

    const relogin = await call("POST", "/api/auth/login", {
      body: { username: "ana.qa", password: res.body.temporaryPassword },
    });
    assert.strictEqual(relogin.body.scope, "password_change_only", "a reset forces a change again");
    anaTempPassword = res.body.temporaryPassword;
  });

  await test("the old password stops working after a reset", async () => {
    const res = await call("POST", "/api/auth/login", {
      body: { username: "ana.qa", password: "AnaDefinitiva123" },
    });
    assert.strictEqual(res.status, 401);
  });

  // ------------------------------------------------------------------------
  console.log("\nroles y proyectos del usuario");

  await test("replacing roles revokes the sessions built from the old ones", async () => {
    const anaToken = await activate("ana.qa", anaTempPassword, "AnaTercera12345");
    assert.strictEqual((await call("GET", "/api/auth/me", { token: anaToken })).status, 200);

    const res = await call("PUT", `/api/users/${anaId}/roles`, {
      token: segundoAdminToken,
      body: { roles: ["viewer"] },
    });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.user.roles.map((r: any) => r.slug), ["viewer"]);
    assert.ok(!res.body.user.permissions.includes("recordings.create"), "old permissions are gone");

    assert.strictEqual(
      (await call("GET", "/api/auth/me", { token: anaToken })).status,
      401,
      "the stale principal must not survive",
    );
  });

  await test("rejects a non-array roles payload", async () => {
    const res = await call("PUT", `/api/users/${anaId}/roles`, {
      token: segundoAdminToken,
      body: { roles: "viewer" },
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, "invalid_roles");
  });

  await test("grants project scope by slug and by id", async () => {
    const res = await call("PUT", `/api/users/${anaId}/projects`, {
      token: segundoAdminToken,
      body: {
        projects: [
          { slug: "kiosko", accessLevel: 1 },
          { projectId: projectIds["portal-comercial"], accessLevel: 2 },
        ],
      },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.user.allProjects, false);
    const bySlug = Object.fromEntries(
      res.body.user.projects.map((p: any) => [p.projectSlug, p.accessLevel]),
    );
    assert.deepStrictEqual(bySlug, { kiosko: 1, "portal-comercial": 2 });
  });

  await test("switching to allProjects clears the explicit list", async () => {
    const res = await call("PUT", `/api/users/${anaId}/projects`, {
      token: segundoAdminToken,
      body: { allProjects: true },
    });
    assert.strictEqual(res.body.user.allProjects, true);
    assert.deepStrictEqual(res.body.user.projects, []);
  });

  await test("rejects an invalid access level", async () => {
    const res = await call("PUT", `/api/users/${anaId}/projects`, {
      token: segundoAdminToken,
      body: { projects: [{ slug: "kiosko", accessLevel: 7 }] },
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, "invalid_access_level");
  });

  // ------------------------------------------------------------------------
  console.log("\nauditoría");

  await test("records every administrative action on the account", async () => {
    const res = await call("GET", `/api/users/${anaId}/audit`, { token: segundoAdminToken });
    assert.strictEqual(res.status, 200);
    const actions = res.body.entries.map((e: any) => e.action);
    for (const expected of [
      "user.created",
      "user.updated",
      "user.disabled",
      "user.enabled",
      "user.password_reset",
      "user.roles_changed",
      "user.projects_changed",
    ]) {
      assert.ok(actions.includes(expected), `missing audit action: ${expected}`);
    }
    const created = res.body.entries.find((e: any) => e.action === "user.created");
    assert.ok(created.actorUserId, "the acting admin must be recorded");
  });

  // ------------------------------------------------------------------------
  console.log("\nroles");

  let customRoleId = "";

  await test("creates a custom role with validated permissions", async () => {
    const res = await call("POST", "/api/roles", {
      token: segundoAdminToken,
      body: {
        slug: "solo-grabacion",
        name: "Solo Grabación",
        description: "Graba pero no ejecuta",
        permissions: ["dashboard.view", "recordings.view", "recordings.create"],
      },
    });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(res.body.role.isSystem, false);
    assert.strictEqual(res.body.role.userCount, 0);
    // Stored order is not part of the contract — the repository reads them back
    // sorted by key — so compare as sets.
    assert.deepStrictEqual([...res.body.role.permissions].sort(), [
      "dashboard.view",
      "recordings.create",
      "recordings.view",
    ]);
    customRoleId = res.body.role.id;
  });

  await test("rejects an unknown permission key", async () => {
    const res = await call("POST", "/api/roles", {
      token: segundoAdminToken,
      body: { slug: "rol-invalido", name: "Rol Invalido", permissions: ["modulo.inventado"] },
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, "invalid_permissions");
  });

  await test("validates the role slug and rejects duplicates", async () => {
    const bad = await call("POST", "/api/roles", {
      token: segundoAdminToken,
      body: { slug: "Con Mayúsculas", name: "Malo" },
    });
    assert.strictEqual(bad.status, 400);
    assert.strictEqual(bad.body.error, "invalid_role_slug");

    const duplicate = await call("POST", "/api/roles", {
      token: segundoAdminToken,
      body: { slug: "solo-grabacion", name: "Duplicado" },
    });
    assert.strictEqual(duplicate.status, 409);
    assert.strictEqual(duplicate.body.error, "role_slug_taken");
  });

  await test("lists roles with permissions and user counts", async () => {
    const res = await call("GET", "/api/roles", { token: segundoAdminToken });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.total, 5, "4 system roles + the custom one");
    const admin = res.body.roles.find((r: any) => r.slug === "admin");
    assert.strictEqual(admin.isSystem, true);
    assert.ok(admin.userCount >= 1);
  });

  await test("updates a role's permissions and revokes its holders' sessions", async () => {
    await call("PUT", `/api/users/${anaId}/roles`, {
      token: segundoAdminToken,
      body: { roles: ["solo-grabacion"] },
    });
    const anaToken = await loginAs("ana.qa", "AnaTercera12345");
    assert.strictEqual((await call("GET", "/api/auth/me", { token: anaToken })).status, 200);

    const res = await call("PUT", `/api/roles/${customRoleId}/permissions`, {
      token: segundoAdminToken,
      body: { permissions: ["dashboard.view"] },
    });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.role.permissions, ["dashboard.view"]);
    assert.strictEqual(
      (await call("GET", "/api/auth/me", { token: anaToken })).status,
      401,
      "holders of the role must be re-authenticated",
    );
  });

  await test("refuses to delete a role still assigned to someone", async () => {
    const res = await call("DELETE", `/api/roles/${customRoleId}`, { token: segundoAdminToken });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, "role_in_use");
    assert.strictEqual(res.body.userCount, 1);
  });

  await test("deletes a role once nobody holds it", async () => {
    await call("PUT", `/api/users/${anaId}/roles`, {
      token: segundoAdminToken,
      body: { roles: ["viewer"] },
    });
    const res = await call("DELETE", `/api/roles/${customRoleId}`, { token: segundoAdminToken });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await call("GET", `/api/roles/${customRoleId}`, { token: segundoAdminToken })).status, 404);
  });

  await test("refuses to delete a system role", async () => {
    const list = await call("GET", "/api/roles", { token: segundoAdminToken });
    const viewer = list.body.roles.find((r: any) => r.slug === "viewer");
    const res = await call("DELETE", `/api/roles/${viewer.id}`, { token: segundoAdminToken });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, "system_role");
  });

  await test("refuses to strip admin.users from the last admin role", async () => {
    const list = await call("GET", "/api/roles", { token: segundoAdminToken });
    const adminRole = list.body.roles.find((r: any) => r.slug === "admin");
    const res = await call("PUT", `/api/roles/${adminRole.id}/permissions`, {
      token: segundoAdminToken,
      body: { permissions: ["dashboard.view"] },
    });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, "last_admin");

    const unchanged = await call("GET", `/api/roles/${adminRole.id}`, { token: segundoAdminToken });
    assert.ok(
      unchanged.body.role.permissions.includes("admin.users"),
      "the refused write must not have partially applied",
    );
  });

  // ------------------------------------------------------------------------
  console.log("\ncontrol de acceso al propio módulo");

  await test("a non-admin cannot reach the users module", async () => {
    const anaToken = await loginAs("ana.qa", "AnaTercera12345");
    const res = await call("GET", "/api/users", { token: anaToken });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.error, "forbidden");
    assert.deepStrictEqual(res.body.missingPermissions, ["admin.users"]);
  });

  await test("a non-admin cannot create users or roles", async () => {
    const anaToken = await loginAs("ana.qa", "AnaTercera12345");
    const user = await call("POST", "/api/users", {
      token: anaToken,
      body: { username: "colado", fullName: "Colado" },
    });
    assert.strictEqual(user.status, 403);

    const role = await call("POST", "/api/roles", {
      token: anaToken,
      body: { slug: "colado", name: "Colado" },
    });
    assert.strictEqual(role.status, 403);
    assert.deepStrictEqual(role.body.missingPermissions, ["admin.roles"]);
  });

  await test("the admin module is unreachable without a session", async () => {
    assert.strictEqual((await call("GET", "/api/users")).status, 401);
    assert.strictEqual((await call("GET", "/api/roles")).status, 401);
  });

  await test("any authenticated user may read the permission catalogue", async () => {
    const anaToken = await loginAs("ana.qa", "AnaTercera12345");
    const res = await call("GET", "/api/permissions", { token: anaToken });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.modules.length > 0);
    assert.strictEqual((await call("GET", "/api/permissions")).status, 401);
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
    console.log("All admin API tests passed.\n");
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
