import { getConnection } from "./sql-connection";
import type { DbConnection as Connection } from "./db-connection";
import { placeholders, toBool, toIso } from "./row-utils";
import type { PermissionKey } from "../auth/permissions";

/**
 * Persistence for `Roles` and their `RolePermissions` rows.
 *
 * A role's permission set is always replaced wholesale rather than patched: the
 * admin UI submits the full checkbox tree, and a replace keeps the stored rows
 * from drifting out of sync with what the operator saw.
 */

export type Role = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RoleWithPermissions = Role & {
  permissions: PermissionKey[];
  userCount: number;
};

export type CreateRoleInput = {
  slug: string;
  name: string;
  description?: string | null;
  isSystem?: boolean;
};

export type UpdateRoleInput = {
  name?: string;
  description?: string | null;
};

type RoleRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isSystem: unknown;
  createdAt: unknown;
  updatedAt: unknown;
};

const COLUMN_LIST = ["id", "slug", "name", "description", "isSystem", "createdAt", "updatedAt"];
const COLUMNS = COLUMN_LIST.join(", ");
const OUTPUT_COLUMNS = COLUMN_LIST.map((c) => `INSERTED.${c}`).join(", ");

function mapRow(row: RoleRow): Role {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? null,
    isSystem: toBool(row.isSystem),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

async function resolve(conn?: Connection): Promise<Connection> {
  return conn ?? (await getConnection());
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export async function createRole(input: CreateRoleInput, conn?: Connection): Promise<Role> {
  const c = await resolve(conn);
  const rows = await c.query<RoleRow>(
    `INSERT INTO dbo.Roles (slug, name, description, isSystem)
     OUTPUT ${OUTPUT_COLUMNS}
     VALUES (?, ?, ?, ?)`,
    [
      input.slug.trim().toLowerCase(),
      input.name.trim(),
      input.description?.trim() || null,
      input.isSystem === true ? 1 : 0,
    ],
  );
  return mapRow(rows[0]);
}

export async function getRoleById(id: string, conn?: Connection): Promise<Role | null> {
  const c = await resolve(conn);
  const rows = await c.query<RoleRow>(`SELECT ${COLUMNS} FROM dbo.Roles WHERE id = ?`, [id]);
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

export async function getRoleBySlug(slug: string, conn?: Connection): Promise<Role | null> {
  const c = await resolve(conn);
  const rows = await c.query<RoleRow>(`SELECT ${COLUMNS} FROM dbo.Roles WHERE slug = ?`, [
    slug.trim(),
  ]);
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

export async function listRoles(conn?: Connection): Promise<Role[]> {
  const c = await resolve(conn);
  const rows = await c.query<RoleRow>(`SELECT ${COLUMNS} FROM dbo.Roles ORDER BY slug`);
  return rows.map(mapRow);
}

export async function updateRole(
  id: string,
  patch: UpdateRoleInput,
  conn?: Connection,
): Promise<Role | null> {
  const c = await resolve(conn);
  const sets: string[] = [];
  const params: unknown[] = [];

  if (patch.name !== undefined) {
    sets.push("name = ?");
    params.push(patch.name.trim());
  }
  if (patch.description !== undefined) {
    sets.push("description = ?");
    params.push(patch.description?.trim() || null);
  }
  if (sets.length === 0) return getRoleById(id, c);

  sets.push("updatedAt = SYSUTCDATETIME()");
  params.push(id);
  await c.query(`UPDATE dbo.Roles SET ${sets.join(", ")} WHERE id = ?`, params);
  return getRoleById(id, c);
}

/** `RolePermissions` and `UserRoles` rows cascade with the role. */
export async function deleteRole(id: string, conn?: Connection): Promise<void> {
  const c = await resolve(conn);
  await c.query("DELETE FROM dbo.Roles WHERE id = ?", [id]);
}

export async function countUsersWithRole(id: string, conn?: Connection): Promise<number> {
  const c = await resolve(conn);
  const rows = await c.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM dbo.UserRoles WHERE roleId = ?",
    [id],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Resolves slugs or ids to role ids, so the API can accept either form.
 * Throws on the first unknown reference rather than silently dropping it — a
 * typo in a role name must never result in a user with fewer roles than asked.
 */
export async function resolveRoleIds(
  refs: string[],
  conn?: Connection,
): Promise<string[]> {
  if (refs.length === 0) return [];
  const c = await resolve(conn);
  const cleaned = refs.map((r) => String(r).trim()).filter((r) => r.length > 0);
  if (cleaned.length === 0) return [];

  const marks = placeholders(cleaned.length);
  const rows = await c.query<{ id: string; slug: string }>(
    `SELECT id, slug FROM dbo.Roles WHERE id IN (${marks}) OR slug IN (${marks})`,
    [...cleaned, ...cleaned],
  );

  const byKey = new Map<string, string>();
  for (const row of rows) {
    byKey.set(row.id.toLowerCase(), row.id);
    byKey.set(row.slug.toLowerCase(), row.id);
  }

  const resolved: string[] = [];
  for (const ref of cleaned) {
    const id = byKey.get(ref.toLowerCase());
    if (!id) throw new Error(`unknown role: ${ref}`);
    if (!resolved.includes(id)) resolved.push(id);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Role permissions
// ---------------------------------------------------------------------------

export async function getRolePermissions(
  roleId: string,
  conn?: Connection,
): Promise<PermissionKey[]> {
  const c = await resolve(conn);
  const rows = await c.query<{ permissionKey: string }>(
    "SELECT permissionKey FROM dbo.RolePermissions WHERE roleId = ? ORDER BY permissionKey",
    [roleId],
  );
  return rows.map((row) => row.permissionKey as PermissionKey);
}

export async function getPermissionsForRoles(
  roleIds: string[],
  conn?: Connection,
): Promise<Map<string, PermissionKey[]>> {
  const result = new Map<string, PermissionKey[]>();
  if (roleIds.length === 0) return result;
  const c = await resolve(conn);
  const rows = await c.query<{ roleId: string; permissionKey: string }>(
    `SELECT roleId, permissionKey
       FROM dbo.RolePermissions
      WHERE roleId IN (${placeholders(roleIds.length)})
      ORDER BY permissionKey`,
    roleIds,
  );
  for (const row of rows) {
    const list = result.get(row.roleId) ?? [];
    list.push(row.permissionKey as PermissionKey);
    result.set(row.roleId, list);
  }
  return result;
}

export async function replaceRolePermissions(
  roleId: string,
  permissions: PermissionKey[],
  conn?: Connection,
): Promise<void> {
  const c = await resolve(conn);
  await c.query("DELETE FROM dbo.RolePermissions WHERE roleId = ?", [roleId]);
  for (const key of new Set(permissions)) {
    await c.query("INSERT INTO dbo.RolePermissions (roleId, permissionKey) VALUES (?, ?)", [
      roleId,
      key,
    ]);
  }
}

export async function countUsersPerRole(conn?: Connection): Promise<Map<string, number>> {
  const c = await resolve(conn);
  const rows = await c.query<{ roleId: string; n: number }>(
    "SELECT roleId, COUNT(*) AS n FROM dbo.UserRoles GROUP BY roleId",
  );
  const result = new Map<string, number>();
  for (const row of rows) result.set(row.roleId, Number(row.n));
  return result;
}

/** Roles hydrated with their permissions and assignment counts, for the admin UI. */
export async function listRolesWithPermissions(conn?: Connection): Promise<RoleWithPermissions[]> {
  const c = await resolve(conn);
  const roles = await listRoles(c);
  const permissions = await getPermissionsForRoles(
    roles.map((r) => r.id),
    c,
  );
  const counts = await countUsersPerRole(c);
  return roles.map((role) => ({
    ...role,
    permissions: permissions.get(role.id) ?? [],
    userCount: counts.get(role.id) ?? 0,
  }));
}
