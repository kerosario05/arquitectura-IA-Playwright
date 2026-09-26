import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Integration test for the identity repositories against a throwaway SQLite file.
 *
 * The datasource is pinned before the db modules load: `resolveDbPath` reads
 * SQLITE_DB_PATH lazily on first connect, and dotenv never overrides variables
 * that are already set, so assigning here keeps the developer's real
 * data/qa-lab.db untouched. The imports below are dynamic for the same reason.
 */
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-lab-identity-"));
const tempDbPath = path.join(tempDir, "identity-test.db");
process.env.DB_DRIVER = "sqlite";
process.env.SQLITE_DB_PATH = tempDbPath;

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
  const sqlConnection = await import("./sql-connection");
  const users = await import("./user-repository");
  const roles = await import("./role-repository");
  const sessions = await import("./session-repository");
  const { hashPassword, verifyPassword } = await import("../auth/password");
  const { SYSTEM_ROLES, ALL_PERMISSION_KEYS } = await import("../auth/permissions");

  const conn = await sqlConnection.getConnection();
  console.log(`\n[test] datasource: ${sqlConnection.describeDatasource()}`);

  // --- schema -------------------------------------------------------------
  console.log("\nschema");

  await test("creates the seven identity tables on connect", async () => {
    const expected = [
      "Users",
      "Roles",
      "RolePermissions",
      "UserRoles",
      "UserProjectAccess",
      "UserSessions",
      "UserAuditLog",
    ];
    for (const table of expected) {
      const rows = await conn.query<{ n: number }>(`SELECT COUNT(*) AS n FROM dbo.${table}`);
      assert.strictEqual(Number(rows[0].n), 0, `${table} should exist and start empty`);
    }
  });

  // --- roles --------------------------------------------------------------
  console.log("\nrole-repository");

  const seeded: Record<string, string> = {};

  await test("creates the system roles with their permissions", async () => {
    for (const definition of SYSTEM_ROLES) {
      const role = await roles.createRole({
        slug: definition.slug,
        name: definition.name,
        description: definition.description,
        isSystem: true,
      });
      await roles.replaceRolePermissions(role.id, definition.permissions);
      seeded[definition.slug] = role.id;
    }
    const listed = await roles.listRoles();
    assert.strictEqual(listed.length, SYSTEM_ROLES.length);
    assert.ok(listed.every((r) => r.isSystem));
  });

  await test("admin holds every permission in the catalogue", async () => {
    const permissions = await roles.getRolePermissions(seeded.admin);
    assert.deepStrictEqual([...permissions].sort(), [...ALL_PERMISSION_KEYS].sort());
  });

  await test("qa-engineer holds no admin permission", async () => {
    const permissions = await roles.getRolePermissions(seeded["qa-engineer"]);
    assert.ok(permissions.length > 0);
    assert.ok(!permissions.some((p) => p.startsWith("admin.")));
  });

  await test("looks roles up by slug case-insensitively", async () => {
    const found = await roles.getRoleBySlug("ADMIN");
    assert.ok(found, "slug lookup must be case-insensitive (COLLATE NOCASE)");
    assert.strictEqual(found.id, seeded.admin);
  });

  await test("replacing permissions is a full rewrite, not a merge", async () => {
    await roles.replaceRolePermissions(seeded.viewer, ["dashboard.view"]);
    assert.deepStrictEqual(await roles.getRolePermissions(seeded.viewer), ["dashboard.view"]);
    await roles.replaceRolePermissions(seeded.viewer, ["dashboard.view", "projects.view"]);
    assert.deepStrictEqual(await roles.getRolePermissions(seeded.viewer), [
      "dashboard.view",
      "projects.view",
    ]);
  });

  await test("resolves role references by slug or id, rejecting unknown ones", async () => {
    const resolved = await roles.resolveRoleIds(["qa-lead", seeded.admin]);
    assert.deepStrictEqual(resolved, [seeded["qa-lead"], seeded.admin]);
    await assert.rejects(() => roles.resolveRoleIds(["no-existe"]), /unknown role: no-existe/);
  });

  // --- users --------------------------------------------------------------
  console.log("\nuser-repository");

  let adminUserId = "";
  let engineerId = "";

  await test("creates a user with mustChangePassword on by default", async () => {
    const created = await users.createUser({
      username: "kevin.admin",
      fullName: "Kevin Administrador",
      email: "kevin.admin@example.com",
      passwordHash: await hashPassword("Temporal12345"),
      allProjects: true,
    });
    adminUserId = created.id;
    assert.strictEqual(created.mustChangePassword, true);
    assert.strictEqual(created.enabled, true);
    assert.strictEqual(created.allProjects, true);
    assert.strictEqual(created.failedLoginCount, 0);
    assert.strictEqual(created.lockedUntil, null);
    assert.strictEqual(created.lastLoginAt, null);
    assert.ok(!Number.isNaN(Date.parse(created.createdAt)));
  });

  await test("never returns the password hash on the public shape", async () => {
    const fetched = await users.getUserById(adminUserId);
    assert.ok(fetched);
    assert.ok(!("passwordHash" in fetched), "getUserById must strip the secret");
    const listed = await users.listUsers();
    assert.ok(listed.every((u) => !("passwordHash" in u)));
  });

  await test("exposes the hash only through the login-path accessor", async () => {
    const withSecret = await users.getUserWithSecretByUsername("KEVIN.ADMIN");
    assert.ok(withSecret, "username lookup must be case-insensitive");
    assert.strictEqual(await verifyPassword("Temporal12345", withSecret.passwordHash), true);
  });

  await test("enforces unique usernames case-insensitively", async () => {
    assert.strictEqual(await users.usernameExists("Kevin.Admin"), true);
    assert.strictEqual(await users.usernameExists("kevin.admin", adminUserId), false);
    await assert.rejects(() =>
      users.createUser({
        username: "KEVIN.ADMIN",
        fullName: "Duplicado",
        passwordHash: "x",
      }),
    );
  });

  await test("creates a second user for the scoping tests", async () => {
    const created = await users.createUser({
      username: "ana.qa",
      fullName: "Ana QA",
      email: "ana.qa@example.com",
      passwordHash: await hashPassword("Temporal67890"),
      createdBy: adminUserId,
    });
    engineerId = created.id;
    assert.strictEqual(created.allProjects, false);
    assert.strictEqual(created.createdBy, adminUserId);
  });

  await test("updates only the fields present in the patch", async () => {
    const before = await users.getUserById(engineerId);
    const updated = await users.updateUser(engineerId, { fullName: "Ana Quintero" });
    assert.ok(updated);
    assert.strictEqual(updated.fullName, "Ana Quintero");
    assert.strictEqual(updated.username, before!.username);
    assert.strictEqual(updated.email, before!.email);
    assert.strictEqual(updated.enabled, true);
  });

  await test("disables a user without deleting the row", async () => {
    const updated = await users.updateUser(engineerId, { enabled: false });
    assert.strictEqual(updated?.enabled, false);
    const stillThere = await users.getUserById(engineerId);
    assert.ok(stillThere, "disabling must be a soft operation");
    await users.updateUser(engineerId, { enabled: true });
  });

  await test("filters the listing by enabled, role and search term", async () => {
    await users.replaceUserRoles(adminUserId, [seeded.admin]);
    await users.replaceUserRoles(engineerId, [seeded["qa-engineer"]]);

    assert.strictEqual((await users.listUsers()).length, 2);
    assert.strictEqual((await users.listUsers({ roleSlug: "admin" })).length, 1);
    assert.strictEqual((await users.listUsers({ roleSlug: "qa-engineer" })).length, 1);
    assert.strictEqual((await users.listUsers({ search: "QUINTERO" })).length, 1);
    assert.strictEqual((await users.listUsers({ search: "example.com" })).length, 2);
    assert.strictEqual((await users.listUsers({ search: "nadie" })).length, 0);

    await users.updateUser(engineerId, { enabled: false });
    assert.strictEqual((await users.listUsers({ enabled: true })).length, 1);
    assert.strictEqual((await users.listUsers({ enabled: false })).length, 1);
    await users.updateUser(engineerId, { enabled: true });
  });

  await test("rotates the password and clears the change flag", async () => {
    const newHash = await hashPassword("Definitiva98765");
    await users.updateUserPassword(adminUserId, newHash, false);
    const after = await users.getUserWithSecretById(adminUserId);
    assert.ok(after);
    assert.strictEqual(after.mustChangePassword, false);
    assert.strictEqual(await verifyPassword("Definitiva98765", after.passwordHash), true);
    assert.strictEqual(await verifyPassword("Temporal12345", after.passwordHash), false);
  });

  await test("counts failed logins and locks the account at the threshold", async () => {
    const lockUntil = new Date(Date.now() + 15 * 60 * 1000);
    for (let attempt = 1; attempt <= 4; attempt++) {
      const result = await users.recordFailedLogin(engineerId, 5, lockUntil);
      assert.strictEqual(result.failedLoginCount, attempt);
      assert.strictEqual(result.lockedUntil, null, `attempt ${attempt} must not lock yet`);
    }
    const fifth = await users.recordFailedLogin(engineerId, 5, lockUntil);
    assert.strictEqual(fifth.failedLoginCount, 5);
    assert.ok(fifth.lockedUntil, "the fifth failure must set lockedUntil");
    const locked = await users.getUserById(engineerId);
    assert.ok(locked?.lockedUntil);
  });

  await test("a successful login clears the counter and the lockout", async () => {
    await users.recordSuccessfulLogin(engineerId);
    const after = await users.getUserById(engineerId);
    assert.strictEqual(after?.failedLoginCount, 0);
    assert.strictEqual(after?.lockedUntil, null);
    assert.ok(after?.lastLoginAt, "lastLoginAt must be stamped");
  });

  // --- roles <-> users ----------------------------------------------------
  console.log("\nrole assignment and effective permissions");

  await test("returns the union of permissions across assigned roles", async () => {
    await users.replaceUserRoles(engineerId, [seeded["qa-engineer"], seeded.viewer]);
    const effective = await users.getEffectivePermissions(engineerId);
    assert.ok(effective.includes("recordings.create"), "from qa-engineer");
    assert.ok(effective.includes("projects.view"), "from viewer");
    assert.strictEqual(new Set(effective).size, effective.length, "must be de-duplicated");
    assert.ok(!effective.some((p) => p.startsWith("admin.")));
  });

  await test("replacing roles removes the ones left out", async () => {
    await users.replaceUserRoles(engineerId, [seeded["qa-engineer"]]);
    const assigned = await users.getUserRoles(engineerId);
    assert.deepStrictEqual(
      assigned.map((r) => r.slug),
      ["qa-engineer"],
    );
  });

  await test("hydrates roles for several users in one call", async () => {
    const map = await users.getRolesForUsers([adminUserId, engineerId]);
    assert.strictEqual(map.get(adminUserId)?.[0]?.slug, "admin");
    assert.strictEqual(map.get(engineerId)?.[0]?.slug, "qa-engineer");
    assert.strictEqual((await users.getRolesForUsers([])).size, 0);
  });

  await test("counts active admins and excludes a candidate", async () => {
    assert.strictEqual(await users.countActiveAdmins(), 1);
    assert.strictEqual(await users.countActiveAdmins(adminUserId), 0);
    await users.updateUser(adminUserId, { enabled: false });
    assert.strictEqual(await users.countActiveAdmins(), 0, "disabled admins must not count");
    await users.updateUser(adminUserId, { enabled: true });
  });

  await test("counts users per role", async () => {
    const counts = await roles.countUsersPerRole();
    assert.strictEqual(counts.get(seeded.admin), 1);
    assert.strictEqual(counts.get(seeded["qa-engineer"]), 1);
    assert.strictEqual(await roles.countUsersWithRole(seeded["qa-lead"]), 0);
  });

  await test("deleting a role cascades its permissions and assignments", async () => {
    const temporary = await roles.createRole({ slug: "temporal", name: "Temporal" });
    await roles.replaceRolePermissions(temporary.id, ["dashboard.view"]);
    await users.replaceUserRoles(engineerId, [seeded["qa-engineer"], temporary.id]);
    assert.strictEqual((await users.getUserRoles(engineerId)).length, 2);

    await roles.deleteRole(temporary.id);
    assert.strictEqual(await roles.getRoleById(temporary.id), null);
    assert.deepStrictEqual(await roles.getRolePermissions(temporary.id), []);
    assert.deepStrictEqual(
      (await users.getUserRoles(engineerId)).map((r) => r.slug),
      ["qa-engineer"],
    );
  });

  // --- per-project scope --------------------------------------------------
  console.log("\nper-project access");

  const projectIds: Record<string, string> = {};

  await test("grants access to specific projects", async () => {
    for (const slug of ["kiosko", "portal-comercial"]) {
      const inserted = await conn.query<{ id: string }>(
        `INSERT INTO dbo.Projects (slug, name, projectType, status, enabled)
         OUTPUT INSERTED.id VALUES (?, ?, 1, 1, 1)`,
        [slug, slug],
      );
      projectIds[slug] = inserted[0].id;
    }

    await users.replaceUserProjectAccess(engineerId, [
      { projectId: projectIds.kiosko, accessLevel: 2 },
      { projectId: projectIds["portal-comercial"], accessLevel: 1 },
    ]);

    const access = await users.getUserProjectAccess(engineerId);
    assert.strictEqual(access.length, 2);
    const kiosko = access.find((a) => a.projectSlug === "kiosko");
    assert.strictEqual(kiosko?.accessLevel, 2);
    assert.strictEqual(kiosko?.projectId, projectIds.kiosko);
    assert.strictEqual(access.find((a) => a.projectSlug === "portal-comercial")?.accessLevel, 1);
  });

  await test("replacing the scope revokes projects left out", async () => {
    await users.replaceUserProjectAccess(engineerId, [
      { projectId: projectIds.kiosko, accessLevel: 1 },
    ]);
    const access = await users.getUserProjectAccess(engineerId);
    assert.deepStrictEqual(
      access.map((a) => a.projectSlug),
      ["kiosko"],
    );
    assert.strictEqual(access[0].accessLevel, 1, "the level must be rewritten too");
  });

  await test("ignores duplicate project entries in one payload", async () => {
    await users.replaceUserProjectAccess(engineerId, [
      { projectId: projectIds.kiosko, accessLevel: 2 },
      { projectId: projectIds.kiosko, accessLevel: 1 },
    ]);
    const access = await users.getUserProjectAccess(engineerId);
    assert.strictEqual(access.length, 1);
    assert.strictEqual(access[0].accessLevel, 2, "the first entry wins");
  });

  await test("deleting a project drops the grants that referenced it", async () => {
    await conn.query("DELETE FROM dbo.Projects WHERE id = ?", [projectIds.kiosko]);
    assert.deepStrictEqual(await users.getUserProjectAccess(engineerId), []);
  });

  // --- sessions -----------------------------------------------------------
  console.log("\nsession-repository");

  let fullSessionId = "";

  await test("creates a session and finds it by token digest", async () => {
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
    const created = await sessions.createSession({
      userId: adminUserId,
      tokenHash: "hash-full-session",
      scope: "full",
      expiresAt,
      userAgent: "test-agent",
      ipAddress: "127.0.0.1",
    });
    fullSessionId = created.id;
    assert.strictEqual(created.scope, "full");
    assert.strictEqual(created.revokedAt, null);
    assert.strictEqual(created.userAgent, "test-agent");
    assert.strictEqual(Date.parse(created.expiresAt), expiresAt.getTime());

    const found = await sessions.getSessionByTokenHash("hash-full-session");
    assert.strictEqual(found?.id, created.id);
    assert.strictEqual(await sessions.getSessionByTokenHash("desconocido"), null);
  });

  await test("stores the restricted scope for a first-login session", async () => {
    const created = await sessions.createSession({
      userId: engineerId,
      tokenHash: "hash-restricted",
      scope: "password_change_only",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    assert.strictEqual(created.scope, "password_change_only");
  });

  await test("rejects a duplicate token digest", async () => {
    await assert.rejects(() =>
      sessions.createSession({
        userId: adminUserId,
        tokenHash: "hash-full-session",
        scope: "full",
        expiresAt: new Date(Date.now() + 1000),
      }),
    );
  });

  await test("lists only live sessions", async () => {
    await sessions.createSession({
      userId: adminUserId,
      tokenHash: "hash-expired",
      scope: "full",
      expiresAt: new Date(Date.now() - 60 * 1000),
    });
    const active = await sessions.listActiveSessions(adminUserId);
    assert.deepStrictEqual(
      active.map((s) => s.id),
      [fullSessionId],
      "an expired session must not be listed as active",
    );
  });

  await test("revokes a single session by token digest", async () => {
    await sessions.createSession({
      userId: adminUserId,
      tokenHash: "hash-logout",
      scope: "full",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    await sessions.revokeSessionByTokenHash("hash-logout");
    const revoked = await sessions.getSessionByTokenHash("hash-logout");
    assert.ok(revoked?.revokedAt, "the row must survive with revokedAt stamped");
    assert.ok(!(await sessions.listActiveSessions(adminUserId)).some((s) => s.id === revoked.id));
  });

  await test("revokes every session except the current one", async () => {
    await sessions.createSession({
      userId: adminUserId,
      tokenHash: "hash-other-device",
      scope: "full",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const revokedCount = await sessions.revokeAllUserSessions(adminUserId, fullSessionId);
    assert.strictEqual(revokedCount, 1);
    const active = await sessions.listActiveSessions(adminUserId);
    assert.deepStrictEqual(
      active.map((s) => s.id),
      [fullSessionId],
    );
  });

  await test("revokes every session on a password change", async () => {
    await sessions.revokeAllUserSessions(adminUserId);
    assert.deepStrictEqual(await sessions.listActiveSessions(adminUserId), []);
  });

  await test("stamps lastSeenAt", async () => {
    await sessions.touchSession(fullSessionId);
    const touched = await sessions.getSessionByTokenHash("hash-full-session");
    assert.ok(touched?.lastSeenAt, "lastSeenAt must be set");
  });

  await test("purges long-expired sessions only", async () => {
    const liveBefore = (await conn.query<{ n: number }>("SELECT COUNT(*) AS n FROM dbo.UserSessions"))[0].n;
    const purged = await sessions.purgeExpiredSessions(7);
    assert.strictEqual(purged, 0, "a session expired a minute ago is inside the retention window");

    const purgedNow = await sessions.purgeExpiredSessions(0);
    assert.strictEqual(purgedNow, 1, "the expired session must be dropped");
    const liveAfter = (await conn.query<{ n: number }>("SELECT COUNT(*) AS n FROM dbo.UserSessions"))[0].n;
    assert.strictEqual(Number(liveAfter), Number(liveBefore) - 1);
  });

  await test("deleting a user cascades their sessions", async () => {
    const victim = await users.createUser({
      username: "temporal.user",
      fullName: "Temporal",
      passwordHash: "x",
    });
    await sessions.createSession({
      userId: victim.id,
      tokenHash: "hash-victim",
      scope: "full",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    await conn.query("DELETE FROM dbo.Users WHERE id = ?", [victim.id]);
    assert.strictEqual(await sessions.getSessionByTokenHash("hash-victim"), null);
  });

  // --- audit --------------------------------------------------------------
  console.log("\naudit trail");

  await test("records who did what to whom", async () => {
    await users.appendAuditLog({
      actorUserId: adminUserId,
      targetUserId: engineerId,
      action: "user.disabled",
      details: { reason: "baja temporal" },
    });
    await users.appendAuditLog({
      actorUserId: adminUserId,
      targetUserId: engineerId,
      action: "user.password_reset",
    });

    const entries = await users.listAuditLog(engineerId);
    assert.strictEqual(entries.length, 2);
    assert.ok(entries.every((e) => e.actorUserId === adminUserId));
    const disabled = entries.find((e) => e.action === "user.disabled");
    assert.deepStrictEqual(disabled?.details, { reason: "baja temporal" });
    assert.strictEqual(entries.find((e) => e.action === "user.password_reset")?.details, null);
  });

  await test("survives the deletion of the user it describes", async () => {
    const before = await users.listAuditLog(engineerId);
    await conn.query("DELETE FROM dbo.Users WHERE id = ?", [engineerId]);
    const after = await users.listAuditLog(engineerId);
    assert.strictEqual(after.length, before.length, "the audit trail must not cascade");
  });

  // ------------------------------------------------------------------------
  await sqlConnection.closeConnection();
  fs.rmSync(tempDir, { recursive: true, force: true });

  console.log("");
  if (failures.length > 0) {
    console.error(`${failures.length} test(s) failed:\n  - ${failures.join("\n  - ")}\n`);
    process.exitCode = 1;
  } else {
    console.log("All identity repository tests passed.\n");
  }
}

main().catch((err) => {
  console.error(err);
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // best effort: the OS temp dir is cleaned up eventually anyway
  }
  process.exitCode = 1;
});
