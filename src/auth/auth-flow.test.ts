import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

/**
 * End-to-end test of the auth HTTP surface: a real Express app wired exactly
 * like src/server/server.ts, driven over a real socket with fetch, against a
 * throwaway SQLite database.
 */
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-lab-authflow-"));
process.env.DB_DRIVER = "sqlite";
process.env.SQLITE_DB_PATH = path.join(tempDir, "auth-flow-test.db");
process.env.AUTH_ENABLED = "true";
process.env.AUTH_MAX_FAILED_ATTEMPTS = "3";
process.env.AUTH_LOCKOUT_MINUTES = "15";
delete process.env.API_KEY;
for (const key of ["AUTH_BOOTSTRAP_USERNAME", "AUTH_BOOTSTRAP_PASSWORD", "AUTH_BOOTSTRAP_FULLNAME"]) {
  delete process.env[key];
}

const ADMIN_PASSWORD = "Arranque12345";
const NEW_PASSWORD = "Definitiva6789";

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
  const { attachPrincipal, isPublicPath, requireFullScope, requirePermission } = await import(
    "../server/middleware/auth"
  );
  const { authRouter } = await import("../server/routes/auth");
  const { resolveAuthConfig } = await import("./config");
  const users = await import("../db/user-repository");
  const { hashPassword } = await import("./password");
  const { hashSessionToken } = await import("./auth-service");

  const conn = await sqlConnection.getConnection();

  // --- app wiring, mirroring server.ts ------------------------------------
  const app = express();
  app.use(express.json());
  app.use(attachPrincipal());
  app.use((req, res, next) => {
    if (isPublicPath(req.path)) return next();
    if (req.principal) return next();
    const apiKey = process.env.API_KEY || "";
    if (apiKey && !resolveAuthConfig().enabled) {
      res.status(401).json({ error: "Unauthorized — missing or invalid X-Api-Key header" });
      return;
    }
    res.status(401).json({ ok: false, error: "missing_token" });
  });
  app.use(requireFullScope());
  app.use("/api/auth", authRouter);
  // Stand-in for a protected business route (phase 5 wires the real ones).
  app.get("/api/protegido", (req, res) => {
    res.json({ ok: true, seenAs: req.principal?.username });
  });
  app.get("/api/solo-admin", requirePermission("admin.users"), (_req, res) => {
    res.json({ ok: true });
  });

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  async function call(
    method: string,
    route: string,
    options: { token?: string; apiKey?: string; body?: unknown } = {},
  ): Promise<ApiResponse> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    if (options.apiKey) headers["x-api-key"] = options.apiKey;
    const response = await fetch(`${base}${route}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    let body: any = null;
    const text = await response.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { status: response.status, body };
  }

  console.log(`\n[test] servidor en ${base}`);

  await bootstrapIdentity({ username: "admin", password: ADMIN_PASSWORD });
  const lockUser = await users.createUser({
    username: "bloqueo",
    fullName: "Usuario Bloqueo",
    passwordHash: await hashPassword("Bloqueo123456"),
    mustChangePassword: false,
  });

  // ------------------------------------------------------------------------
  console.log("\nlogin: credenciales inválidas");

  await test("rejects an unknown username without leaking that it is unknown", async () => {
    const res = await call("POST", "/api/auth/login", {
      body: { username: "no.existe", password: "LoQueSea123" },
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, "invalid_credentials");
    assert.strictEqual(res.body.message, "Usuario o contraseña incorrectos");
    assert.strictEqual(res.body.remainingAttempts, undefined, "must not hint at an account");
  });

  await test("rejects a wrong password and reports the remaining attempts", async () => {
    const res = await call("POST", "/api/auth/login", {
      body: { username: "bloqueo", password: "Incorrecta123" },
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, "invalid_credentials");
    assert.strictEqual(res.body.remainingAttempts, 2);
  });

  await test("rejects an empty payload", async () => {
    const res = await call("POST", "/api/auth/login", { body: {} });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, "invalid_credentials");
  });

  await test("locks the account at the configured threshold", async () => {
    await call("POST", "/api/auth/login", {
      body: { username: "bloqueo", password: "Incorrecta123" },
    });
    const third = await call("POST", "/api/auth/login", {
      body: { username: "bloqueo", password: "Incorrecta123" },
    });
    assert.strictEqual(third.status, 423);
    assert.strictEqual(third.body.error, "account_locked");
    assert.ok(third.body.lockedUntil, "the response must say until when");
  });

  await test("a locked account rejects even the correct password", async () => {
    const res = await call("POST", "/api/auth/login", {
      body: { username: "bloqueo", password: "Bloqueo123456" },
    });
    assert.strictEqual(res.status, 423);
    assert.strictEqual(res.body.error, "account_locked");
  });

  await test("clearing the lockout restores access", async () => {
    await users.clearLockout(lockUser.id);
    const res = await call("POST", "/api/auth/login", {
      body: { username: "bloqueo", password: "Bloqueo123456" },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.scope, "full");
  });

  await test("rejects a disabled account after verifying the password", async () => {
    await users.updateUser(lockUser.id, { enabled: false });
    const res = await call("POST", "/api/auth/login", {
      body: { username: "bloqueo", password: "Bloqueo123456" },
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.error, "account_disabled");

    const wrong = await call("POST", "/api/auth/login", {
      body: { username: "bloqueo", password: "Incorrecta123" },
    });
    assert.strictEqual(wrong.body.error, "invalid_credentials", "a wrong password must not reveal the disabled state");
    await users.updateUser(lockUser.id, { enabled: true });
    await users.clearLockout(lockUser.id);
  });

  // ------------------------------------------------------------------------
  console.log("\nprimer login: cambio de contraseña obligatorio");

  let restrictedToken = "";

  await test("issues a restricted token when a password change is pending", async () => {
    const res = await call("POST", "/api/auth/login", {
      body: { username: "admin", password: ADMIN_PASSWORD },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.mustChangePassword, true);
    assert.strictEqual(res.body.scope, "password_change_only");
    assert.ok(res.body.token, "a token is still issued");
    assert.ok(res.body.expiresAt);
    assert.strictEqual(res.body.user.username, "admin");
    assert.ok(!("passwordHash" in res.body.user), "the hash must never be serialized");
    assert.deepStrictEqual(res.body.roles.map((r: any) => r.slug), ["admin"]);
    assert.ok(res.body.permissions.includes("admin.users"));
    restrictedToken = res.body.token;
  });

  await test("the restricted token cannot reach a business route", async () => {
    const res = await call("GET", "/api/protegido", { token: restrictedToken });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.error, "password_change_required");
  });

  await test("the restricted token cannot reach a permissioned route either", async () => {
    const res = await call("GET", "/api/solo-admin", { token: restrictedToken });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.error, "password_change_required");
  });

  await test("the restricted token can still read its own identity", async () => {
    const res = await call("GET", "/api/auth/me", { token: restrictedToken });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.scope, "password_change_only");
    assert.strictEqual(res.body.mustChangePassword, true);
    assert.strictEqual(res.body.user.username, "admin");
    assert.strictEqual(res.body.allProjects, true);
    assert.ok(res.body.session.expiresAt);
  });

  await test("rejects a change with the wrong current password", async () => {
    const res = await call("POST", "/api/auth/change-password", {
      token: restrictedToken,
      body: { currentPassword: "NoEsLaMia123", newPassword: NEW_PASSWORD },
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, "invalid_credentials");
  });

  await test("rejects a new password that violates the policy", async () => {
    const res = await call("POST", "/api/auth/change-password", {
      token: restrictedToken,
      body: { currentPassword: ADMIN_PASSWORD, newPassword: "corta" },
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, "password_policy_violation");
    assert.ok(Array.isArray(res.body.violations) && res.body.violations.length > 0);
  });

  await test("rejects reusing the current password", async () => {
    const res = await call("POST", "/api/auth/change-password", {
      token: restrictedToken,
      body: { currentPassword: ADMIN_PASSWORD, newPassword: ADMIN_PASSWORD },
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, "password_reuse");
  });

  let fullToken = "";

  await test("accepts the change and returns a fresh full-scope token", async () => {
    const res = await call("POST", "/api/auth/change-password", {
      token: restrictedToken,
      body: { currentPassword: ADMIN_PASSWORD, newPassword: NEW_PASSWORD },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.scope, "full");
    assert.strictEqual(res.body.mustChangePassword, false);
    assert.ok(res.body.token);
    assert.notStrictEqual(res.body.token, restrictedToken, "a new token must be issued");
    assert.strictEqual(res.body.revokedSessions, 1, "the restricted session must be revoked");
    fullToken = res.body.token;
  });

  await test("the restricted token stops working immediately", async () => {
    const res = await call("GET", "/api/auth/me", { token: restrictedToken });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, "session_revoked");
  });

  await test("the new token opens the business routes", async () => {
    const protectedRoute = await call("GET", "/api/protegido", { token: fullToken });
    assert.strictEqual(protectedRoute.status, 200);
    assert.strictEqual(protectedRoute.body.seenAs, "admin");

    const adminRoute = await call("GET", "/api/solo-admin", { token: fullToken });
    assert.strictEqual(adminRoute.status, 200);
  });

  await test("the flag is cleared for subsequent logins", async () => {
    const res = await call("POST", "/api/auth/login", {
      body: { username: "admin", password: NEW_PASSWORD },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.mustChangePassword, false);
    assert.strictEqual(res.body.scope, "full");
  });

  await test("the old password no longer works", async () => {
    const res = await call("POST", "/api/auth/login", {
      body: { username: "admin", password: ADMIN_PASSWORD },
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, "invalid_credentials");
  });

  // ------------------------------------------------------------------------
  console.log("\nsesiones");

  await test("rejects a missing token", async () => {
    const res = await call("GET", "/api/protegido");
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, "missing_token");
  });

  await test("rejects a forged token", async () => {
    const res = await call("GET", "/api/protegido", { token: "token-inventado" });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, "invalid_token");
  });

  await test("rejects an expired session separately from a revoked one", async () => {
    const login = await call("POST", "/api/auth/login", {
      body: { username: "admin", password: NEW_PASSWORD },
    });
    const token = login.body.token;
    assert.strictEqual((await call("GET", "/api/protegido", { token })).status, 200);

    // Scoped to this one session: expiring every admin session would invalidate
    // the tokens the later tests rely on.
    await conn.query("UPDATE dbo.UserSessions SET expiresAt = ? WHERE tokenHash = ?", [
      new Date(Date.now() - 60_000).toISOString(),
      hashSessionToken(token),
    ]);

    const res = await call("GET", "/api/protegido", { token });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, "session_expired");
  });

  await test("logout revokes only the session it was called with", async () => {
    const first = await call("POST", "/api/auth/login", {
      body: { username: "admin", password: NEW_PASSWORD },
    });
    const second = await call("POST", "/api/auth/login", {
      body: { username: "admin", password: NEW_PASSWORD },
    });

    const out = await call("POST", "/api/auth/logout", { token: first.body.token });
    assert.strictEqual(out.status, 200);
    assert.strictEqual((await call("GET", "/api/protegido", { token: first.body.token })).status, 401);
    assert.strictEqual(
      (await call("GET", "/api/protegido", { token: second.body.token })).status,
      200,
      "the other device must stay logged in",
    );
  });

  await test("disabling an account kills its live sessions", async () => {
    const login = await call("POST", "/api/auth/login", {
      body: { username: "bloqueo", password: "Bloqueo123456" },
    });
    const token = login.body.token;
    assert.strictEqual((await call("GET", "/api/protegido", { token })).status, 200);

    await users.updateUser(lockUser.id, { enabled: false });

    const res = await call("GET", "/api/protegido", { token });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.error, "account_disabled");

    await users.updateUser(lockUser.id, { enabled: true });
    const afterReenable = await call("GET", "/api/protegido", { token });
    assert.strictEqual(
      afterReenable.status,
      401,
      "re-enabling must not resurrect the revoked session",
    );
  });

  await test("a permission the user lacks yields 403 naming what is missing", async () => {
    const engineerRole = await (await import("../db/role-repository")).getRoleBySlug("qa-engineer");
    await users.replaceUserRoles(lockUser.id, [engineerRole!.id]);
    await users.updateUserPassword(lockUser.id, await hashPassword("Bloqueo123456"), false);

    const login = await call("POST", "/api/auth/login", {
      body: { username: "bloqueo", password: "Bloqueo123456" },
    });
    const res = await call("GET", "/api/solo-admin", { token: login.body.token });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.error, "forbidden");
    assert.deepStrictEqual(res.body.missingPermissions, ["admin.users"]);
  });

  await test("exposes the permission catalogue to an authenticated caller", async () => {
    const res = await call("GET", "/api/auth/permissions", { token: fullToken });
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.modules));
    const keys = res.body.modules.flatMap((m: any) => m.permissions.map((p: any) => p.key));
    assert.ok(keys.includes("recordings.create"));
    assert.ok(keys.includes("admin.roles"));
  });

  await test("login stays reachable without a token", async () => {
    const res = await call("POST", "/api/auth/login", { body: { username: "x", password: "y" } });
    assert.strictEqual(res.status, 401, "reachable, but the credentials are wrong");
    assert.strictEqual(res.body.error, "invalid_credentials");
  });

  // ------------------------------------------------------------------------
  console.log("\ncompatibilidad hacia atrás");

  await test("AUTH_ENABLED=false leaves the API open as before", async () => {
    process.env.AUTH_ENABLED = "false";
    try {
      const res = await call("GET", "/api/protegido");
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.seenAs, "auth-disabled");
    } finally {
      process.env.AUTH_ENABLED = "true";
    }
  });

  await test("a configured API_KEY is still required when auth is off", async () => {
    process.env.AUTH_ENABLED = "false";
    process.env.API_KEY = "clave-secreta";
    try {
      const missing = await call("GET", "/api/protegido");
      assert.strictEqual(missing.status, 401);

      const wrong = await call("GET", "/api/protegido", { apiKey: "clave-incorrecta" });
      assert.strictEqual(wrong.status, 401);

      const right = await call("GET", "/api/protegido", { apiKey: "clave-secreta" });
      assert.strictEqual(right.status, 200);
      assert.strictEqual(right.body.seenAs, "api-key");
    } finally {
      process.env.AUTH_ENABLED = "true";
      delete process.env.API_KEY;
    }
  });

  await test("the API key principal passes any permission check", async () => {
    process.env.API_KEY = "clave-secreta";
    try {
      const res = await call("GET", "/api/solo-admin", { apiKey: "clave-secreta" });
      assert.strictEqual(res.status, 200);
    } finally {
      delete process.env.API_KEY;
    }
  });

  await test("a bearer session still works alongside a configured API key", async () => {
    process.env.API_KEY = "clave-secreta";
    try {
      const res = await call("GET", "/api/protegido", { token: fullToken });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.seenAs, "admin");
    } finally {
      delete process.env.API_KEY;
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
    console.log("All auth flow tests passed.\n");
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
