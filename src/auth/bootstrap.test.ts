import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Integration test for the identity bootstrap against a throwaway SQLite file.
 * The datasource is pinned before the db modules load — see the note in
 * src/db/identity-repository.test.ts.
 */
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-lab-bootstrap-"));
process.env.DB_DRIVER = "sqlite";
process.env.SQLITE_DB_PATH = path.join(tempDir, "bootstrap-test.db");
for (const key of [
  "AUTH_BOOTSTRAP_USERNAME",
  "AUTH_BOOTSTRAP_USER",
  "AUTH_BOOTSTRAP_PASSWORD",
  "AUTH_BOOTSTRAP_FULLNAME",
  "AUTH_BOOTSTRAP_EMAIL",
]) {
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
  const sqlConnection = await import("../db/sql-connection");
  const { bootstrapIdentity } = await import("./bootstrap");
  const roles = await import("../db/role-repository");
  const users = await import("../db/user-repository");
  const { verifyPassword, PasswordPolicyError } = await import("./password");
  const { ALL_PERMISSION_KEYS, SYSTEM_ROLES } = await import("./permissions");

  const conn = await sqlConnection.getConnection();
  console.log(`\n[test] datasource: ${sqlConnection.describeDatasource()}`);

  console.log("\nfirst run");

  let firstPassword = "";
  let adminUserId = "";

  await test("seeds every system role with its permissions", async () => {
    const report = await bootstrapIdentity();
    assert.deepStrictEqual(
      [...report.roles.created].sort(),
      SYSTEM_ROLES.map((r) => r.slug).sort(),
    );
    assert.deepStrictEqual(report.roles.synced, []);
    assert.deepStrictEqual(report.roles.toppedUp, []);

    const stored = await roles.listRolesWithPermissions();
    assert.strictEqual(stored.length, SYSTEM_ROLES.length);
    assert.ok(stored.every((r) => r.isSystem), "seeded roles must be marked isSystem");
    for (const definition of SYSTEM_ROLES) {
      const found = stored.find((r) => r.slug === definition.slug);
      assert.deepStrictEqual(
        [...(found?.permissions ?? [])].sort(),
        [...definition.permissions].sort(),
        `permissions mismatch for ${definition.slug}`,
      );
    }
  });

  await test("creates the admin with a generated temporary password", async () => {
    // The previous run already created it, so start from a clean database.
    await conn.query("DELETE FROM dbo.Users");
    const report = await bootstrapIdentity();

    assert.strictEqual(report.admin.status, "created");
    assert.strictEqual(report.admin.username, "admin");
    assert.strictEqual(report.admin.mustChangePassword, true);
    assert.ok(report.admin.generatedPassword, "a password must be generated when none is given");
    firstPassword = report.admin.generatedPassword!;
    adminUserId = report.admin.userId;

    const stored = await users.getUserWithSecretById(adminUserId);
    assert.ok(stored);
    assert.strictEqual(await verifyPassword(firstPassword, stored.passwordHash), true);
    assert.strictEqual(stored.mustChangePassword, true);
    assert.strictEqual(stored.enabled, true);
    assert.strictEqual(stored.allProjects, true, "the bootstrap admin must reach every project");
  });

  await test("grants the admin role and therefore every permission", async () => {
    const assigned = await users.getUserRoles(adminUserId);
    assert.deepStrictEqual(
      assigned.map((r) => r.slug),
      ["admin"],
    );
    const effective = await users.getEffectivePermissions(adminUserId);
    assert.deepStrictEqual([...effective].sort(), [...ALL_PERMISSION_KEYS].sort());
  });

  await test("records the creation in the audit trail", async () => {
    const entries = await users.listAuditLog(adminUserId);
    const created = entries.find((e) => e.action === "user.bootstrap_created");
    assert.ok(created, "a bootstrap audit entry must exist");
    assert.strictEqual(created.actorUserId, null, "there is no actor at bootstrap time");
    assert.deepStrictEqual(created.details, {
      username: "admin",
      passwordSource: "generated",
    });
  });

  console.log("\nidempotency");

  await test("a second run changes nothing", async () => {
    const report = await bootstrapIdentity();
    assert.deepStrictEqual(report.roles.created, []);
    assert.deepStrictEqual(report.roles.synced, []);
    assert.deepStrictEqual(report.roles.toppedUp, []);
    assert.strictEqual(report.admin.status, "already_exists");
    assert.strictEqual(report.admin.generatedPassword, undefined);

    const stored = await users.getUserWithSecretById(adminUserId);
    assert.strictEqual(
      await verifyPassword(firstPassword, stored!.passwordHash),
      true,
      "re-running must not rotate the existing password",
    );
    assert.strictEqual((await users.listUsers()).length, 1, "no duplicate admin");
  });

  await test("does not create a second admin under a different username", async () => {
    const report = await bootstrapIdentity({ username: "otro.admin" });
    assert.strictEqual(report.admin.status, "already_exists");
    assert.strictEqual((await users.listUsers()).length, 1);
  });

  console.log("\ncatalogue upgrades");

  await test("tops the admin role up with permissions added after the fact", async () => {
    const adminRole = await roles.getRoleBySlug("admin");
    await roles.replaceRolePermissions(adminRole!.id, ["dashboard.view"]);

    const report = await bootstrapIdentity();
    assert.strictEqual(report.roles.toppedUp.length, 1);
    assert.strictEqual(report.roles.toppedUp[0].slug, "admin");
    assert.ok(report.roles.toppedUp[0].added.includes("admin.users"));

    const after = await roles.getRolePermissions(adminRole!.id);
    assert.deepStrictEqual([...after].sort(), [...ALL_PERMISSION_KEYS].sort());
  });

  await test("leaves a deliberately narrowed non-admin role alone", async () => {
    const engineer = await roles.getRoleBySlug("qa-engineer");
    await roles.replaceRolePermissions(engineer!.id, ["dashboard.view"]);

    await bootstrapIdentity();
    assert.deepStrictEqual(
      await roles.getRolePermissions(engineer!.id),
      ["dashboard.view"],
      "an operator's narrowing must survive a bootstrap run",
    );
  });

  await test("--sync-roles rewrites every system role from the catalogue", async () => {
    const report = await bootstrapIdentity({ syncSystemRoles: true });
    assert.deepStrictEqual(
      [...report.roles.synced].sort(),
      SYSTEM_ROLES.map((r) => r.slug).sort(),
    );
    const engineer = await roles.getRoleBySlug("qa-engineer");
    const definition = SYSTEM_ROLES.find((r) => r.slug === "qa-engineer")!;
    assert.deepStrictEqual(
      [...(await roles.getRolePermissions(engineer!.id))].sort(),
      [...definition.permissions].sort(),
    );
  });

  await test("reports stored keys that are no longer in the catalogue", async () => {
    const viewer = await roles.getRoleBySlug("viewer");
    await conn.query(
      "INSERT INTO dbo.RolePermissions (roleId, permissionKey) VALUES (?, ?)",
      [viewer!.id, "modulo.eliminado"],
    );

    const report = await bootstrapIdentity();
    const warning = report.roles.unknownKeys.find((e) => e.slug === "viewer");
    assert.ok(warning, "a stale key must be reported");
    assert.deepStrictEqual(warning.keys, ["modulo.eliminado"]);

    // ...and --sync-roles cleans it up.
    await bootstrapIdentity({ syncSystemRoles: true });
    const cleaned = await roles.getRolePermissions(viewer!.id);
    assert.ok(!cleaned.includes("modulo.eliminado" as never));
  });

  console.log("\nrecovery paths");

  await test("attaches the admin role to an orphaned username", async () => {
    await conn.query("DELETE FROM dbo.UserRoles");
    assert.strictEqual(await users.countActiveAdmins(), 0, "precondition: nobody is admin");

    const report = await bootstrapIdentity({ username: "admin" });
    assert.strictEqual(report.admin.status, "role_assigned");
    assert.strictEqual(report.admin.userId, adminUserId);
    assert.deepStrictEqual(
      (await users.getUserRoles(adminUserId)).map((r) => r.slug),
      ["admin"],
    );

    const entries = await users.listAuditLog(adminUserId);
    assert.ok(entries.some((e) => e.action === "user.bootstrap_admin_role_assigned"));
  });

  await test("re-enables a disabled account when it is the only admin candidate", async () => {
    await conn.query("DELETE FROM dbo.UserRoles");
    await users.updateUser(adminUserId, { enabled: false });

    const report = await bootstrapIdentity({ username: "admin" });
    assert.strictEqual(report.admin.status, "role_assigned");
    assert.strictEqual((await users.getUserById(adminUserId))?.enabled, true);
  });

  await test("a disabled admin does not count as an active one", async () => {
    await users.updateUser(adminUserId, { enabled: false });
    const report = await bootstrapIdentity({ username: "rescate" });
    assert.strictEqual(report.admin.status, "created", "a locked-out install must recover");
    assert.strictEqual(report.admin.username, "rescate");
    await conn.query("DELETE FROM dbo.Users WHERE username = ?", ["rescate"]);
    await users.updateUser(adminUserId, { enabled: true });
  });

  console.log("\nsupplied credentials");

  await test("accepts an explicit password and reports no generated one", async () => {
    await conn.query("DELETE FROM dbo.Users");
    const report = await bootstrapIdentity({
      username: "kevin.admin",
      password: "Arranque12345",
      fullName: "Kevin Rosario",
      email: "kevin@example.com",
    });

    assert.strictEqual(report.admin.status, "created");
    assert.strictEqual(report.admin.generatedPassword, undefined);
    assert.strictEqual(report.admin.mustChangePassword, true, "supplied passwords are temporary too");

    const stored = await users.getUserWithSecretByUsername("kevin.admin");
    assert.strictEqual(await verifyPassword("Arranque12345", stored!.passwordHash), true);
    assert.strictEqual(stored!.fullName, "Kevin Rosario");
    assert.strictEqual(stored!.email, "kevin@example.com");

    const audit = await users.listAuditLog(stored!.id);
    assert.deepStrictEqual(audit[audit.length - 1].details, {
      username: "kevin.admin",
      passwordSource: "provided",
    });
  });

  await test("--keep-password skips the forced first-login change", async () => {
    await conn.query("DELETE FROM dbo.Users");
    const report = await bootstrapIdentity({
      password: "Permanente12345",
      forcePasswordChange: false,
    });
    assert.strictEqual(report.admin.mustChangePassword, false);
    assert.strictEqual((await users.getUserById(report.admin.userId))?.mustChangePassword, false);
  });

  await test("rejects a supplied password that violates the policy", async () => {
    await conn.query("DELETE FROM dbo.Users");
    await assert.rejects(
      () => bootstrapIdentity({ password: "corta" }),
      (err: unknown) => {
        assert.ok(err instanceof PasswordPolicyError);
        assert.ok(err.violations.length > 0);
        return true;
      },
    );
    assert.strictEqual((await users.listUsers()).length, 0, "nothing must be created on rejection");
  });

  await test("rejects a password containing the username", async () => {
    await assert.rejects(
      () => bootstrapIdentity({ username: "kevin", password: "kevin1234567" }),
      PasswordPolicyError,
    );
  });

  await test("reads the credentials from the environment", async () => {
    await conn.query("DELETE FROM dbo.Users");
    process.env.AUTH_BOOTSTRAP_USERNAME = "desde.env";
    process.env.AUTH_BOOTSTRAP_PASSWORD = "DesdeEntorno123";
    process.env.AUTH_BOOTSTRAP_FULLNAME = "Usuario Env";
    try {
      const report = await bootstrapIdentity();
      assert.strictEqual(report.admin.username, "desde.env");
      const stored = await users.getUserWithSecretByUsername("desde.env");
      assert.strictEqual(stored!.fullName, "Usuario Env");
      assert.strictEqual(await verifyPassword("DesdeEntorno123", stored!.passwordHash), true);
    } finally {
      delete process.env.AUTH_BOOTSTRAP_USERNAME;
      delete process.env.AUTH_BOOTSTRAP_PASSWORD;
      delete process.env.AUTH_BOOTSTRAP_FULLNAME;
    }
  });

  await test("explicit options win over the environment", async () => {
    await conn.query("DELETE FROM dbo.Users");
    process.env.AUTH_BOOTSTRAP_USERNAME = "ignorado";
    try {
      const report = await bootstrapIdentity({ username: "explicito", password: "Directo12345" });
      assert.strictEqual(report.admin.username, "explicito");
    } finally {
      delete process.env.AUTH_BOOTSTRAP_USERNAME;
    }
  });

  await sqlConnection.closeConnection();
  fs.rmSync(tempDir, { recursive: true, force: true });

  console.log("");
  if (failures.length > 0) {
    console.error(`${failures.length} test(s) failed:\n  - ${failures.join("\n  - ")}\n`);
    process.exitCode = 1;
  } else {
    console.log("All bootstrap tests passed.\n");
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
