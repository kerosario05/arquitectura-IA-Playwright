import { withTransaction } from "../db/sql-connection";
import type { DbConnection as Connection } from "../db/db-connection";
import * as roleRepo from "../db/role-repository";
import * as userRepo from "../db/user-repository";
import {
  ALL_PERMISSION_KEYS,
  SYSTEM_ROLES,
  isPermissionKey,
  type PermissionKey,
} from "./permissions";
import { assertPasswordPolicy, generateTemporaryPassword, hashPassword } from "./password";

/**
 * Idempotent bootstrap of the identity tables: seeds the system roles and makes
 * sure exactly one administrator exists so an install can never end up locked
 * out of its own admin module.
 *
 * Re-running is safe and is the supported way to pick up new permission keys
 * after an upgrade.
 */

export const DEFAULT_ADMIN_USERNAME = "admin";
const ADMIN_ROLE_SLUG = "admin";

export type BootstrapOptions = {
  username?: string;
  password?: string;
  fullName?: string;
  email?: string;
  /** Rewrite every system role's permissions back to the catalogue definition. */
  syncSystemRoles?: boolean;
  /** Defaults to true: the bootstrap password is temporary by design. */
  forcePasswordChange?: boolean;
};

export type RoleSeedReport = {
  created: string[];
  /** `admin` gained catalogue keys it was missing (always applied). */
  toppedUp: { slug: string; added: PermissionKey[] }[];
  /** Rewritten because `syncSystemRoles` was requested. */
  synced: string[];
  /** Stored keys no longer present in the catalogue — stale rows worth cleaning. */
  unknownKeys: { slug: string; keys: string[] }[];
};

export type AdminSeedReport = {
  status: "created" | "already_exists" | "role_assigned";
  userId: string;
  username: string;
  /** Present only when this run generated the password; shown once, never stored. */
  generatedPassword?: string;
  mustChangePassword: boolean;
};

export type BootstrapReport = {
  roles: RoleSeedReport;
  admin: AdminSeedReport;
};

function readEnv(name: string, ...fallbacks: string[]): string | undefined {
  for (const key of [name, ...fallbacks]) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * Creates any missing system role and keeps `admin` complete.
 *
 * Existing roles are otherwise left alone: an operator may have deliberately
 * narrowed `qa-engineer`, and a bootstrap run must not silently undo that.
 * `admin` is the exception — if a later release adds a permission key, the
 * administrator has to receive it or the new module becomes unreachable.
 */
export async function seedSystemRoles(
  conn: Connection,
  options: { syncSystemRoles?: boolean } = {},
): Promise<RoleSeedReport> {
  const report: RoleSeedReport = { created: [], toppedUp: [], synced: [], unknownKeys: [] };

  for (const definition of SYSTEM_ROLES) {
    const existing = await roleRepo.getRoleBySlug(definition.slug, conn);

    if (!existing) {
      const role = await roleRepo.createRole(
        {
          slug: definition.slug,
          name: definition.name,
          description: definition.description,
          isSystem: true,
        },
        conn,
      );
      await roleRepo.replaceRolePermissions(role.id, definition.permissions, conn);
      report.created.push(definition.slug);
      continue;
    }

    const stored = await roleRepo.getRolePermissions(existing.id, conn);
    const stale = stored.filter((key) => !isPermissionKey(key));
    if (stale.length > 0) report.unknownKeys.push({ slug: definition.slug, keys: stale });

    if (options.syncSystemRoles) {
      await roleRepo.replaceRolePermissions(existing.id, definition.permissions, conn);
      report.synced.push(definition.slug);
      continue;
    }

    if (definition.slug === ADMIN_ROLE_SLUG) {
      const held = new Set(stored);
      const missing = ALL_PERMISSION_KEYS.filter((key) => !held.has(key));
      if (missing.length > 0) {
        await roleRepo.replaceRolePermissions(
          existing.id,
          [...stored.filter(isPermissionKey), ...missing],
          conn,
        );
        report.toppedUp.push({ slug: definition.slug, added: missing });
      }
    }
  }

  return report;
}

/**
 * Ensures an administrator exists. Three outcomes:
 *  - an enabled user already holds `admin.users` → nothing to do;
 *  - the target username exists but has no admin role → the role is attached;
 *  - otherwise the account is created with a temporary password.
 */
export async function ensureBootstrapAdmin(
  conn: Connection,
  options: BootstrapOptions = {},
): Promise<AdminSeedReport> {
  const username =
    options.username?.trim() ||
    readEnv("AUTH_BOOTSTRAP_USERNAME", "AUTH_BOOTSTRAP_USER") ||
    DEFAULT_ADMIN_USERNAME;
  const fullName =
    options.fullName?.trim() || readEnv("AUTH_BOOTSTRAP_FULLNAME") || "Administrador";
  const email = options.email?.trim() || readEnv("AUTH_BOOTSTRAP_EMAIL") || null;
  const forceChange = options.forcePasswordChange !== false;

  const adminRole = await roleRepo.getRoleBySlug(ADMIN_ROLE_SLUG, conn);
  if (!adminRole) throw new Error("the 'admin' role is missing — run seedSystemRoles first");

  const existingAdmins = await userRepo.countActiveAdmins(undefined, conn);
  const existingUser = await userRepo.getUserWithSecretByUsername(username, conn);

  if (existingAdmins > 0) {
    const holder = existingUser ?? null;
    return {
      status: "already_exists",
      userId: holder?.id ?? "",
      username: holder?.username ?? username,
      mustChangePassword: holder?.mustChangePassword ?? false,
    };
  }

  // The username is taken but nobody holds admin rights: attach the role rather
  // than failing, which is what recovering from a half-finished setup needs.
  if (existingUser) {
    const current = await userRepo.getUserRoles(existingUser.id, conn);
    const roleIds = [...new Set([...current.map((r) => r.id), adminRole.id])];
    await userRepo.replaceUserRoles(existingUser.id, roleIds, conn);
    if (!existingUser.enabled) {
      await userRepo.updateUser(existingUser.id, { enabled: true }, conn);
    }
    await userRepo.appendAuditLog(
      {
        actorUserId: null,
        targetUserId: existingUser.id,
        action: "user.bootstrap_admin_role_assigned",
        details: { username: existingUser.username },
      },
      conn,
    );
    return {
      status: "role_assigned",
      userId: existingUser.id,
      username: existingUser.username,
      mustChangePassword: existingUser.mustChangePassword,
    };
  }

  const suppliedPassword = options.password ?? readEnv("AUTH_BOOTSTRAP_PASSWORD");
  const generated = suppliedPassword ? undefined : generateTemporaryPassword();
  const password = suppliedPassword ?? generated!;
  assertPasswordPolicy(password, { username });

  const created = await userRepo.createUser(
    {
      username,
      fullName,
      email,
      passwordHash: await hashPassword(password),
      mustChangePassword: forceChange,
      enabled: true,
      allProjects: true,
    },
    conn,
  );
  await userRepo.replaceUserRoles(created.id, [adminRole.id], conn);
  await userRepo.appendAuditLog(
    {
      actorUserId: null,
      targetUserId: created.id,
      action: "user.bootstrap_created",
      details: { username: created.username, passwordSource: suppliedPassword ? "provided" : "generated" },
    },
    conn,
  );

  return {
    status: "created",
    userId: created.id,
    username: created.username,
    generatedPassword: generated,
    mustChangePassword: forceChange,
  };
}

/** Runs both steps in a single transaction. */
export async function bootstrapIdentity(options: BootstrapOptions = {}): Promise<BootstrapReport> {
  return withTransaction(async (conn) => {
    const roles = await seedSystemRoles(conn, options);
    const admin = await ensureBootstrapAdmin(conn, options);
    return { roles, admin };
  });
}
