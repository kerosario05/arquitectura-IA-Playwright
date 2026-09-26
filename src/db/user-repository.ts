import { getConnection } from "./sql-connection";
import type { DbConnection as Connection } from "./db-connection";
import { placeholders, toBool, toIso, toIsoOrNull } from "./row-utils";
import type { PermissionKey } from "../auth/permissions";

/**
 * Persistence for `Users`, their role assignments, their per-project scope and
 * the admin audit trail.
 *
 * Queries stay in the T-SQL flavour used across src/db (`dbo.` prefix,
 * `OUTPUT INSERTED.*`); `translateSql` rewrites them for SQLite.
 */

export type ProjectAccessLevel = 1 | 2;

export type User = {
  id: string;
  username: string;
  email: string | null;
  fullName: string;
  mustChangePassword: boolean;
  enabled: boolean;
  allProjects: boolean;
  failedLoginCount: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  passwordUpdatedAt: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

/** A `User` plus the secret — only ever produced by the login path. */
export type UserWithSecret = User & { passwordHash: string };

export type CreateUserInput = {
  username: string;
  fullName: string;
  email?: string | null;
  passwordHash: string;
  mustChangePassword?: boolean;
  enabled?: boolean;
  allProjects?: boolean;
  createdBy?: string | null;
};

export type UpdateUserInput = {
  username?: string;
  fullName?: string;
  email?: string | null;
  enabled?: boolean;
  allProjects?: boolean;
};

export type ListUsersFilter = {
  enabled?: boolean;
  roleSlug?: string;
  search?: string;
};

export type UserProjectAccess = {
  projectId: string;
  projectSlug: string;
  projectName: string;
  accessLevel: ProjectAccessLevel;
  grantedAt: string;
};

export type UserRoleRef = {
  id: string;
  slug: string;
  name: string;
};

type UserRow = {
  id: string;
  username: string;
  email: string | null;
  fullName: string;
  passwordHash: string;
  mustChangePassword: unknown;
  enabled: unknown;
  allProjects: unknown;
  failedLoginCount: number;
  lockedUntil: unknown;
  lastLoginAt: unknown;
  passwordUpdatedAt: unknown;
  createdBy: string | null;
  createdAt: unknown;
  updatedAt: unknown;
};

const COLUMN_LIST = [
  "id",
  "username",
  "email",
  "fullName",
  "passwordHash",
  "mustChangePassword",
  "enabled",
  "allProjects",
  "failedLoginCount",
  "lockedUntil",
  "lastLoginAt",
  "passwordUpdatedAt",
  "createdBy",
  "createdAt",
  "updatedAt",
];

const COLUMNS = COLUMN_LIST.join(", ");
const OUTPUT_COLUMNS = COLUMN_LIST.map((c) => `INSERTED.${c}`).join(", ");
const ALIASED_COLUMNS = COLUMN_LIST.map((c) => `u.${c}`).join(", ");

function mapRow(row: UserRow): UserWithSecret {
  return {
    id: row.id,
    username: row.username,
    email: row.email ?? null,
    fullName: row.fullName,
    passwordHash: row.passwordHash,
    mustChangePassword: toBool(row.mustChangePassword),
    enabled: toBool(row.enabled),
    allProjects: toBool(row.allProjects),
    failedLoginCount: Number(row.failedLoginCount ?? 0),
    lockedUntil: toIsoOrNull(row.lockedUntil),
    lastLoginAt: toIsoOrNull(row.lastLoginAt),
    passwordUpdatedAt: toIso(row.passwordUpdatedAt),
    createdBy: row.createdBy ?? null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

/** Drops the password hash so a `User` can never be serialized with it attached. */
export function stripSecret(user: UserWithSecret): User {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}

async function resolve(conn?: Connection): Promise<Connection> {
  return conn ?? (await getConnection());
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function createUser(input: CreateUserInput, conn?: Connection): Promise<User> {
  const c = await resolve(conn);
  const rows = await c.query<UserRow>(
    `INSERT INTO dbo.Users (username, email, fullName, passwordHash, mustChangePassword,
                            enabled, allProjects, createdBy)
     OUTPUT ${OUTPUT_COLUMNS}
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.username.trim(),
      input.email?.trim() || null,
      input.fullName.trim(),
      input.passwordHash,
      input.mustChangePassword === false ? 0 : 1,
      input.enabled === false ? 0 : 1,
      input.allProjects === true ? 1 : 0,
      input.createdBy ?? null,
    ],
  );
  return stripSecret(mapRow(rows[0]));
}

export async function getUserById(id: string, conn?: Connection): Promise<User | null> {
  const found = await getUserWithSecretById(id, conn);
  return found ? stripSecret(found) : null;
}

export async function getUserWithSecretById(
  id: string,
  conn?: Connection,
): Promise<UserWithSecret | null> {
  const c = await resolve(conn);
  const rows = await c.query<UserRow>(`SELECT ${COLUMNS} FROM dbo.Users WHERE id = ?`, [id]);
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

/** Login path: the only caller that legitimately needs the stored hash. */
export async function getUserWithSecretByUsername(
  username: string,
  conn?: Connection,
): Promise<UserWithSecret | null> {
  const c = await resolve(conn);
  const rows = await c.query<UserRow>(`SELECT ${COLUMNS} FROM dbo.Users WHERE username = ?`, [
    username.trim(),
  ]);
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

export async function usernameExists(
  username: string,
  excludeUserId?: string,
  conn?: Connection,
): Promise<boolean> {
  const c = await resolve(conn);
  const sql = excludeUserId
    ? "SELECT COUNT(*) AS n FROM dbo.Users WHERE username = ? AND id <> ?"
    : "SELECT COUNT(*) AS n FROM dbo.Users WHERE username = ?";
  const params = excludeUserId ? [username.trim(), excludeUserId] : [username.trim()];
  const rows = await c.query<{ n: number }>(sql, params);
  return Number(rows[0]?.n ?? 0) > 0;
}

export async function listUsers(filter: ListUsersFilter = {}, conn?: Connection): Promise<User[]> {
  const c = await resolve(conn);
  const where: string[] = [];
  const params: unknown[] = [];

  if (filter.enabled !== undefined) {
    where.push("u.enabled = ?");
    params.push(filter.enabled ? 1 : 0);
  }
  if (filter.roleSlug?.trim()) {
    where.push(
      `EXISTS (SELECT 1 FROM dbo.UserRoles ur
                 JOIN dbo.Roles r ON r.id = ur.roleId
                WHERE ur.userId = u.id AND r.slug = ?)`,
    );
    params.push(filter.roleSlug.trim());
  }
  if (filter.search?.trim()) {
    const needle = `%${filter.search.trim().toLowerCase()}%`;
    where.push(
      "(LOWER(u.username) LIKE ? OR LOWER(u.fullName) LIKE ? OR LOWER(COALESCE(u.email, ?)) LIKE ?)",
    );
    params.push(needle, needle, "", needle);
  }

  const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await c.query<UserRow>(
    `SELECT ${ALIASED_COLUMNS} FROM dbo.Users u ${clause} ORDER BY u.username`,
    params,
  );
  return rows.map((row) => stripSecret(mapRow(row)));
}

export async function updateUser(
  id: string,
  patch: UpdateUserInput,
  conn?: Connection,
): Promise<User | null> {
  const c = await resolve(conn);
  const sets: string[] = [];
  const params: unknown[] = [];

  if (patch.username !== undefined) {
    sets.push("username = ?");
    params.push(patch.username.trim());
  }
  if (patch.fullName !== undefined) {
    sets.push("fullName = ?");
    params.push(patch.fullName.trim());
  }
  if (patch.email !== undefined) {
    sets.push("email = ?");
    params.push(patch.email?.trim() || null);
  }
  if (patch.enabled !== undefined) {
    sets.push("enabled = ?");
    params.push(patch.enabled ? 1 : 0);
  }
  if (patch.allProjects !== undefined) {
    sets.push("allProjects = ?");
    params.push(patch.allProjects ? 1 : 0);
  }
  if (sets.length === 0) return getUserById(id, c);

  sets.push("updatedAt = SYSUTCDATETIME()");
  params.push(id);
  await c.query(`UPDATE dbo.Users SET ${sets.join(", ")} WHERE id = ?`, params);
  return getUserById(id, c);
}

/**
 * Rotates the stored hash. Session revocation is the caller's job (the auth
 * service does it in the same transaction) so this stays a pure row update.
 */
export async function updateUserPassword(
  id: string,
  passwordHash: string,
  mustChangePassword: boolean,
  conn?: Connection,
): Promise<void> {
  const c = await resolve(conn);
  await c.query(
    `UPDATE dbo.Users
        SET passwordHash = ?, mustChangePassword = ?, passwordUpdatedAt = SYSUTCDATETIME(),
            failedLoginCount = 0, lockedUntil = NULL, updatedAt = SYSUTCDATETIME()
      WHERE id = ?`,
    [passwordHash, mustChangePassword ? 1 : 0, id],
  );
}

export async function recordSuccessfulLogin(id: string, conn?: Connection): Promise<void> {
  const c = await resolve(conn);
  await c.query(
    `UPDATE dbo.Users
        SET lastLoginAt = SYSUTCDATETIME(), failedLoginCount = 0, lockedUntil = NULL,
            updatedAt = SYSUTCDATETIME()
      WHERE id = ?`,
    [id],
  );
}

/**
 * Increments the failure counter and, once `lockAtAttempts` is reached, stamps
 * `lockedUntil`. Returns the resulting counter so the caller can report the
 * lockout without a second read.
 */
export async function recordFailedLogin(
  id: string,
  lockAtAttempts: number,
  lockUntil: Date,
  conn?: Connection,
): Promise<{ failedLoginCount: number; lockedUntil: string | null }> {
  const c = await resolve(conn);
  await c.query(
    `UPDATE dbo.Users
        SET failedLoginCount = failedLoginCount + 1, updatedAt = SYSUTCDATETIME()
      WHERE id = ?`,
    [id],
  );
  const rows = await c.query<{ failedLoginCount: number }>(
    "SELECT failedLoginCount FROM dbo.Users WHERE id = ?",
    [id],
  );
  const count = Number(rows[0]?.failedLoginCount ?? 0);
  if (count < lockAtAttempts) return { failedLoginCount: count, lockedUntil: null };

  const lockedUntil = lockUntil.toISOString();
  await c.query("UPDATE dbo.Users SET lockedUntil = ?, updatedAt = SYSUTCDATETIME() WHERE id = ?", [
    lockedUntil,
    id,
  ]);
  return { failedLoginCount: count, lockedUntil };
}

export async function clearLockout(id: string, conn?: Connection): Promise<void> {
  const c = await resolve(conn);
  await c.query(
    `UPDATE dbo.Users SET failedLoginCount = 0, lockedUntil = NULL, updatedAt = SYSUTCDATETIME()
      WHERE id = ?`,
    [id],
  );
}

/** Number of enabled users holding `admin.users`, used to protect the last admin. */
export async function countActiveAdmins(
  excludeUserId?: string,
  conn?: Connection,
): Promise<number> {
  const c = await resolve(conn);
  const exclusion = excludeUserId ? "AND u.id <> ?" : "";
  const params = excludeUserId ? ["admin.users", excludeUserId] : ["admin.users"];
  const rows = await c.query<{ n: number }>(
    `SELECT COUNT(DISTINCT u.id) AS n
       FROM dbo.Users u
       JOIN dbo.UserRoles ur ON ur.userId = u.id
       JOIN dbo.RolePermissions rp ON rp.roleId = ur.roleId
      WHERE u.enabled = 1 AND rp.permissionKey = ? ${exclusion}`,
    params,
  );
  return Number(rows[0]?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Role assignments
// ---------------------------------------------------------------------------

export async function getUserRoles(userId: string, conn?: Connection): Promise<UserRoleRef[]> {
  const c = await resolve(conn);
  return c.query<UserRoleRef>(
    `SELECT r.id, r.slug, r.name
       FROM dbo.UserRoles ur
       JOIN dbo.Roles r ON r.id = ur.roleId
      WHERE ur.userId = ?
      ORDER BY r.slug`,
    [userId],
  );
}

/** Role refs for several users at once, so listing N users stays a single query. */
export async function getRolesForUsers(
  userIds: string[],
  conn?: Connection,
): Promise<Map<string, UserRoleRef[]>> {
  const result = new Map<string, UserRoleRef[]>();
  if (userIds.length === 0) return result;
  const c = await resolve(conn);
  const rows = await c.query<UserRoleRef & { userId: string }>(
    `SELECT ur.userId, r.id, r.slug, r.name
       FROM dbo.UserRoles ur
       JOIN dbo.Roles r ON r.id = ur.roleId
      WHERE ur.userId IN (${placeholders(userIds.length)})
      ORDER BY r.slug`,
    userIds,
  );
  for (const row of rows) {
    const list = result.get(row.userId) ?? [];
    list.push({ id: row.id, slug: row.slug, name: row.name });
    result.set(row.userId, list);
  }
  return result;
}

export async function replaceUserRoles(
  userId: string,
  roleIds: string[],
  conn?: Connection,
): Promise<void> {
  const c = await resolve(conn);
  await c.query("DELETE FROM dbo.UserRoles WHERE userId = ?", [userId]);
  for (const roleId of new Set(roleIds)) {
    await c.query("INSERT INTO dbo.UserRoles (userId, roleId) VALUES (?, ?)", [userId, roleId]);
  }
}

/** Union of the permissions granted by every role the user holds. */
export async function getEffectivePermissions(
  userId: string,
  conn?: Connection,
): Promise<PermissionKey[]> {
  const c = await resolve(conn);
  const rows = await c.query<{ permissionKey: string }>(
    `SELECT DISTINCT rp.permissionKey
       FROM dbo.UserRoles ur
       JOIN dbo.RolePermissions rp ON rp.roleId = ur.roleId
      WHERE ur.userId = ?`,
    [userId],
  );
  return rows.map((row) => row.permissionKey as PermissionKey);
}

// ---------------------------------------------------------------------------
// Per-project scope
// ---------------------------------------------------------------------------

export async function getUserProjectAccess(
  userId: string,
  conn?: Connection,
): Promise<UserProjectAccess[]> {
  const c = await resolve(conn);
  const rows = await c.query<{
    projectId: string;
    projectSlug: string;
    projectName: string;
    accessLevel: number;
    grantedAt: unknown;
  }>(
    `SELECT upa.projectId, p.slug AS projectSlug, p.name AS projectName,
            upa.accessLevel, upa.grantedAt
       FROM dbo.UserProjectAccess upa
       JOIN dbo.Projects p ON p.id = upa.projectId
      WHERE upa.userId = ?
      ORDER BY p.slug`,
    [userId],
  );
  return rows.map((row) => ({
    projectId: row.projectId,
    projectSlug: row.projectSlug,
    projectName: row.projectName,
    accessLevel: (Number(row.accessLevel) === 2 ? 2 : 1) as ProjectAccessLevel,
    grantedAt: toIso(row.grantedAt),
  }));
}

export async function replaceUserProjectAccess(
  userId: string,
  entries: { projectId: string; accessLevel: ProjectAccessLevel }[],
  conn?: Connection,
): Promise<void> {
  const c = await resolve(conn);
  await c.query("DELETE FROM dbo.UserProjectAccess WHERE userId = ?", [userId]);
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = entry.projectId.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    await c.query(
      "INSERT INTO dbo.UserProjectAccess (userId, projectId, accessLevel) VALUES (?, ?, ?)",
      [userId, entry.projectId, entry.accessLevel],
    );
  }
}

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

export type AuditEntryInput = {
  actorUserId?: string | null;
  targetUserId?: string | null;
  action: string;
  details?: unknown;
};

export type AuditEntry = {
  id: number;
  actorUserId: string | null;
  targetUserId: string | null;
  action: string;
  details: unknown;
  createdAt: string;
};

export async function appendAuditLog(entry: AuditEntryInput, conn?: Connection): Promise<void> {
  const c = await resolve(conn);
  await c.query(
    `INSERT INTO dbo.UserAuditLog (actorUserId, targetUserId, action, detailsJson)
     VALUES (?, ?, ?, ?)`,
    [
      entry.actorUserId ?? null,
      entry.targetUserId ?? null,
      entry.action,
      entry.details === undefined ? null : JSON.stringify(entry.details),
    ],
  );
}

export async function listAuditLog(
  targetUserId: string,
  limit = 50,
  conn?: Connection,
): Promise<AuditEntry[]> {
  const c = await resolve(conn);
  const rows = await c.query<{
    id: number;
    actorUserId: string | null;
    targetUserId: string | null;
    action: string;
    detailsJson: string | null;
    createdAt: unknown;
  }>(
    `SELECT id, actorUserId, targetUserId, action, detailsJson, createdAt
       FROM dbo.UserAuditLog
      WHERE targetUserId = ?
      ORDER BY createdAt DESC, id DESC`,
    [targetUserId],
  );
  return rows.slice(0, Math.max(1, limit)).map((row) => ({
    id: Number(row.id),
    actorUserId: row.actorUserId ?? null,
    targetUserId: row.targetUserId ?? null,
    action: row.action,
    details: parseJson(row.detailsJson),
    createdAt: toIso(row.createdAt),
  }));
}

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
