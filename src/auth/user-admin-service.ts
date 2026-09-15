import { withTransaction } from "../db/sql-connection";
import type { DbConnection as Connection } from "../db/db-connection";
import * as userRepo from "../db/user-repository";
import * as roleRepo from "../db/role-repository";
import * as sessionRepo from "../db/session-repository";
import { getProjectById, getProjectBySlug } from "../db/project-repository";
import {
  assertPasswordPolicy,
  generateTemporaryPassword,
  hashPassword,
} from "./password";
import { normalizePermissionKeys, type PermissionKey } from "./permissions";

/**
 * Business rules for the admin module.
 *
 * Two invariants drive most of the code here:
 *  - an install must never lose its last administrator, and nobody may lock
 *    themselves out; and
 *  - any change to what a user may do revokes their live sessions, so a cached
 *    principal cannot outlive the grant it was built from.
 */

export class AdminError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AdminError";
  }
}

const ADMIN_PERMISSION: PermissionKey = "admin.users";
const USERNAME_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{1,62})[a-zA-Z0-9]$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ProjectAccessInput =
  | string
  | { projectId?: string; slug?: string; accessLevel?: number };

export type CreateUserRequest = {
  username: string;
  fullName: string;
  email?: string | null;
  password?: string;
  roles?: string[];
  allProjects?: boolean;
  projects?: ProjectAccessInput[];
  enabled?: boolean;
};

export type UpdateUserRequest = {
  username?: string;
  fullName?: string;
  email?: string | null;
  enabled?: boolean;
};

/** A user hydrated with everything the admin UI shows in one row. */
export type AdminUserView = userRepo.User & {
  roles: userRepo.UserRoleRef[];
  permissions: PermissionKey[];
  projects: userRepo.UserProjectAccess[];
  activeSessions: number;
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function assertUsername(username: unknown): string {
  const value = String(username ?? "").trim();
  if (!value) throw new AdminError("invalid_username", "El usuario es obligatorio", 400);
  if (!USERNAME_PATTERN.test(value)) {
    throw new AdminError(
      "invalid_username",
      "El usuario debe tener entre 3 y 64 caracteres y solo letras, números, punto, guion o guion bajo",
      400,
    );
  }
  return value;
}

function assertFullName(fullName: unknown): string {
  const value = String(fullName ?? "").trim();
  if (value.length < 2) {
    throw new AdminError("invalid_full_name", "El nombre completo es obligatorio", 400);
  }
  if (value.length > 200) {
    throw new AdminError("invalid_full_name", "El nombre completo es demasiado largo", 400);
  }
  return value;
}

function normalizeEmail(email: unknown): string | null {
  if (email === null || email === undefined || String(email).trim() === "") return null;
  const value = String(email).trim();
  if (!EMAIL_PATTERN.test(value)) {
    throw new AdminError("invalid_email", "El correo no tiene un formato válido", 400);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

async function holdsAdminPermission(userId: string, conn: Connection): Promise<boolean> {
  const permissions = await userRepo.getEffectivePermissions(userId, conn);
  return permissions.includes(ADMIN_PERMISSION);
}

/**
 * Refuses a change that would leave no enabled administrator behind.
 * `countActiveAdmins` excludes the target, so it answers exactly the question
 * "would anyone still be able to get into the admin module after this?".
 */
async function assertNotLastAdmin(
  targetUserId: string,
  conn: Connection,
  action: string,
): Promise<void> {
  if (!(await holdsAdminPermission(targetUserId, conn))) return;
  const remaining = await userRepo.countActiveAdmins(targetUserId, conn);
  if (remaining === 0) {
    throw new AdminError(
      "last_admin",
      `No se puede ${action}: es el único administrador activo`,
      409,
    );
  }
}

function assertNotSelf(actorUserId: string | null, targetUserId: string, action: string): void {
  if (actorUserId && actorUserId.toLowerCase() === targetUserId.toLowerCase()) {
    throw new AdminError("cannot_modify_self", `No puedes ${action} tu propia cuenta`, 409);
  }
}

// ---------------------------------------------------------------------------
// Project references
// ---------------------------------------------------------------------------

/**
 * Accepts `"kiosko"`, `{ slug: "kiosko" }` or `{ projectId, accessLevel }` so the
 * UI is free to send whichever it has at hand. An unknown reference is an error,
 * never a silent omission — a dropped grant is a permission bug.
 */
async function resolveProjectAccess(
  entries: ProjectAccessInput[],
): Promise<{ projectId: string; accessLevel: userRepo.ProjectAccessLevel }[]> {
  const resolved: { projectId: string; accessLevel: userRepo.ProjectAccessLevel }[] = [];

  for (const entry of entries) {
    const reference = typeof entry === "string" ? entry : entry.projectId ?? entry.slug;
    if (!reference || !String(reference).trim()) {
      throw new AdminError("invalid_project", "Cada proyecto necesita un id o un slug", 400);
    }
    const rawLevel = typeof entry === "string" ? 1 : entry.accessLevel ?? 1;
    if (rawLevel !== 1 && rawLevel !== 2) {
      throw new AdminError(
        "invalid_access_level",
        "accessLevel debe ser 1 (lectura) o 2 (escritura)",
        400,
      );
    }

    const key = String(reference).trim();
    const project = (await getProjectById(key)) ?? (await getProjectBySlug(key));
    if (!project) {
      throw new AdminError("project_not_found", `El proyecto no existe: ${key}`, 404);
    }
    resolved.push({ projectId: project.id, accessLevel: rawLevel });
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listUsers(filter: userRepo.ListUsersFilter): Promise<AdminUserView[]> {
  const users = await userRepo.listUsers(filter);
  if (users.length === 0) return [];

  const rolesByUser = await userRepo.getRolesForUsers(users.map((u) => u.id));
  const permissionsByRole = await roleRepo.getPermissionsForRoles(
    [...new Set([...rolesByUser.values()].flat().map((r) => r.id))],
  );

  const views: AdminUserView[] = [];
  for (const user of users) {
    const roles = rolesByUser.get(user.id) ?? [];
    const permissions = new Set<PermissionKey>();
    for (const role of roles) {
      for (const key of permissionsByRole.get(role.id) ?? []) permissions.add(key);
    }
    views.push({
      ...user,
      roles,
      permissions: [...permissions],
      projects: user.allProjects ? [] : await userRepo.getUserProjectAccess(user.id),
      activeSessions: (await sessionRepo.listActiveSessions(user.id)).length,
    });
  }
  return views;
}

export async function getUser(userId: string): Promise<AdminUserView> {
  const user = await userRepo.getUserById(userId);
  if (!user) throw new AdminError("user_not_found", "El usuario no existe", 404);
  return {
    ...user,
    roles: await userRepo.getUserRoles(userId),
    permissions: await userRepo.getEffectivePermissions(userId),
    projects: user.allProjects ? [] : await userRepo.getUserProjectAccess(userId),
    activeSessions: (await sessionRepo.listActiveSessions(userId)).length,
  };
}

export async function getUserAudit(userId: string, limit = 50): Promise<userRepo.AuditEntry[]> {
  const user = await userRepo.getUserById(userId);
  if (!user) throw new AdminError("user_not_found", "El usuario no existe", 404);
  return userRepo.listAuditLog(userId, limit);
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export type CreateUserResult = {
  user: AdminUserView;
  /** Present only when the service generated the password; shown once. */
  temporaryPassword?: string;
};

export async function createUser(
  request: CreateUserRequest,
  actorUserId: string | null,
): Promise<CreateUserResult> {
  const username = assertUsername(request.username);
  const fullName = assertFullName(request.fullName);
  const email = normalizeEmail(request.email);
  const allProjects = request.allProjects === true;

  const supplied = request.password;
  const generated = supplied ? undefined : generateTemporaryPassword();
  const password = supplied ?? generated!;
  assertPasswordPolicy(password, { username });

  const projectEntries =
    allProjects || !request.projects ? [] : await resolveProjectAccess(request.projects);
  const passwordHash = await hashPassword(password);

  const userId = await withTransaction(async (conn) => {
    if (await userRepo.usernameExists(username, undefined, conn)) {
      throw new AdminError("username_taken", `El usuario ya existe: ${username}`, 409);
    }

    const roleIds = await roleRepo.resolveRoleIds(request.roles ?? [], conn).catch((err) => {
      throw new AdminError("role_not_found", err instanceof Error ? err.message : String(err), 404);
    });

    const created = await userRepo.createUser(
      {
        username,
        fullName,
        email,
        passwordHash,
        // Always temporary: the admin knows this password, so the user has to
        // replace it before the account is really theirs.
        mustChangePassword: true,
        enabled: request.enabled !== false,
        allProjects,
        createdBy: actorUserId,
      },
      conn,
    );

    if (roleIds.length > 0) await userRepo.replaceUserRoles(created.id, roleIds, conn);
    if (projectEntries.length > 0) {
      await userRepo.replaceUserProjectAccess(created.id, projectEntries, conn);
    }

    await userRepo.appendAuditLog(
      {
        actorUserId,
        targetUserId: created.id,
        action: "user.created",
        details: {
          username,
          roles: request.roles ?? [],
          allProjects,
          projectCount: projectEntries.length,
          passwordSource: supplied ? "provided" : "generated",
        },
      },
      conn,
    );

    return created.id;
  });

  return { user: await getUser(userId), temporaryPassword: generated };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateUser(
  userId: string,
  request: UpdateUserRequest,
  actorUserId: string | null,
): Promise<AdminUserView> {
  const patch: userRepo.UpdateUserInput = {};
  if (request.username !== undefined) patch.username = assertUsername(request.username);
  if (request.fullName !== undefined) patch.fullName = assertFullName(request.fullName);
  if (request.email !== undefined) patch.email = normalizeEmail(request.email);
  if (request.enabled !== undefined) patch.enabled = request.enabled === true;

  await withTransaction(async (conn) => {
    const current = await userRepo.getUserById(userId, conn);
    if (!current) throw new AdminError("user_not_found", "El usuario no existe", 404);

    if (patch.username && patch.username.toLowerCase() !== current.username.toLowerCase()) {
      if (await userRepo.usernameExists(patch.username, userId, conn)) {
        throw new AdminError("username_taken", `El usuario ya existe: ${patch.username}`, 409);
      }
    }

    const isDisabling = patch.enabled === false && current.enabled;
    if (isDisabling) {
      assertNotSelf(actorUserId, userId, "desactivar");
      await assertNotLastAdmin(userId, conn, "desactivar este usuario");
    }

    await userRepo.updateUser(userId, patch, conn);

    // A disabled account must not keep working until its token expires.
    if (isDisabling) await sessionRepo.revokeAllUserSessions(userId, undefined, conn);

    await userRepo.appendAuditLog(
      {
        actorUserId,
        targetUserId: userId,
        action: isDisabling
          ? "user.disabled"
          : patch.enabled === true && !current.enabled
            ? "user.enabled"
            : "user.updated",
        details: { changes: Object.keys(patch) },
      },
      conn,
    );
  });

  return getUser(userId);
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export type ResetPasswordResult = {
  temporaryPassword?: string;
  revokedSessions: number;
};

/**
 * Admin-driven reset. The new password is always temporary: the user is forced
 * to replace it on their next login, so an administrator never ends up knowing
 * a credential the user keeps using.
 */
export async function resetPassword(
  userId: string,
  password: string | undefined,
  actorUserId: string | null,
): Promise<ResetPasswordResult> {
  const user = await userRepo.getUserById(userId);
  if (!user) throw new AdminError("user_not_found", "El usuario no existe", 404);

  const generated = password ? undefined : generateTemporaryPassword();
  const value = password ?? generated!;
  assertPasswordPolicy(value, { username: user.username });
  const passwordHash = await hashPassword(value);

  const revokedSessions = await withTransaction(async (conn) => {
    await userRepo.updateUserPassword(userId, passwordHash, true, conn);
    const revoked = await sessionRepo.revokeAllUserSessions(userId, undefined, conn);
    await userRepo.appendAuditLog(
      {
        actorUserId,
        targetUserId: userId,
        action: "user.password_reset",
        details: { revokedSessions: revoked, passwordSource: password ? "provided" : "generated" },
      },
      conn,
    );
    return revoked;
  });

  return { temporaryPassword: generated, revokedSessions };
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export async function setUserRoles(
  userId: string,
  roleRefs: unknown,
  actorUserId: string | null,
): Promise<AdminUserView> {
  if (!Array.isArray(roleRefs)) {
    throw new AdminError("invalid_roles", "roles debe ser un arreglo", 400);
  }

  await withTransaction(async (conn) => {
    const user = await userRepo.getUserById(userId, conn);
    if (!user) throw new AdminError("user_not_found", "El usuario no existe", 404);

    const roleIds = await roleRepo.resolveRoleIds(roleRefs.map(String), conn).catch((err) => {
      throw new AdminError("role_not_found", err instanceof Error ? err.message : String(err), 404);
    });

    // Would the user still be an admin afterwards? Resolve the incoming set's
    // permissions before writing anything.
    const incoming = await roleRepo.getPermissionsForRoles(roleIds, conn);
    const keepsAdmin = [...incoming.values()].flat().includes(ADMIN_PERMISSION);

    if (!keepsAdmin) {
      assertNotSelf(actorUserId, userId, "quitarte los permisos de administración de");
      await assertNotLastAdmin(userId, conn, "quitarle el rol de administrador");
    }

    await userRepo.replaceUserRoles(userId, roleIds, conn);
    // The principal is built from these roles at login: revoke so it is rebuilt.
    const revoked = await sessionRepo.revokeAllUserSessions(userId, undefined, conn);

    await userRepo.appendAuditLog(
      {
        actorUserId,
        targetUserId: userId,
        action: "user.roles_changed",
        details: { roles: roleRefs, revokedSessions: revoked },
      },
      conn,
    );
  });

  return getUser(userId);
}

// ---------------------------------------------------------------------------
// Project scope
// ---------------------------------------------------------------------------

export async function setUserProjects(
  userId: string,
  request: { allProjects?: boolean; projects?: ProjectAccessInput[] },
  actorUserId: string | null,
): Promise<AdminUserView> {
  const allProjects = request.allProjects === true;
  if (!allProjects && request.projects !== undefined && !Array.isArray(request.projects)) {
    throw new AdminError("invalid_projects", "projects debe ser un arreglo", 400);
  }

  const entries = allProjects ? [] : await resolveProjectAccess(request.projects ?? []);

  await withTransaction(async (conn) => {
    const user = await userRepo.getUserById(userId, conn);
    if (!user) throw new AdminError("user_not_found", "El usuario no existe", 404);

    await userRepo.updateUser(userId, { allProjects }, conn);
    await userRepo.replaceUserProjectAccess(userId, entries, conn);
    const revoked = await sessionRepo.revokeAllUserSessions(userId, undefined, conn);

    await userRepo.appendAuditLog(
      {
        actorUserId,
        targetUserId: userId,
        action: "user.projects_changed",
        details: { allProjects, projectCount: entries.length, revokedSessions: revoked },
      },
      conn,
    );
  });

  return getUser(userId);
}

// ---------------------------------------------------------------------------
// Deactivation (there is no hard delete)
// ---------------------------------------------------------------------------

/**
 * Users are never removed from the table: executions, recordings and the audit
 * trail reference them, and a deleted row would turn that history into dangling
 * ids. Deactivating is the terminal state.
 */
export async function deactivateUser(
  userId: string,
  actorUserId: string | null,
): Promise<AdminUserView> {
  return updateUser(userId, { enabled: false }, actorUserId);
}

// ---------------------------------------------------------------------------
// Role administration
// ---------------------------------------------------------------------------

export type CreateRoleRequest = {
  slug: string;
  name: string;
  description?: string | null;
  permissions?: unknown;
};

const ROLE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;

function assertRoleSlug(slug: unknown): string {
  const value = String(slug ?? "").trim().toLowerCase();
  if (!ROLE_SLUG_PATTERN.test(value)) {
    throw new AdminError(
      "invalid_role_slug",
      "El slug del rol debe tener entre 3 y 40 caracteres, en minúsculas, y solo letras, números o guiones",
      400,
    );
  }
  return value;
}

function parsePermissions(permissions: unknown): PermissionKey[] {
  try {
    return normalizePermissionKeys(permissions ?? []);
  } catch (err) {
    throw new AdminError(
      "invalid_permissions",
      err instanceof Error ? err.message : String(err),
      400,
    );
  }
}

export async function createRole(
  request: CreateRoleRequest,
  actorUserId: string | null,
): Promise<roleRepo.RoleWithPermissions> {
  const slug = assertRoleSlug(request.slug);
  const name = String(request.name ?? "").trim();
  if (name.length < 2) {
    throw new AdminError("invalid_role_name", "El nombre del rol es obligatorio", 400);
  }
  const permissions = parsePermissions(request.permissions);

  const roleId = await withTransaction(async (conn) => {
    if (await roleRepo.getRoleBySlug(slug, conn)) {
      throw new AdminError("role_slug_taken", `Ya existe un rol con el slug: ${slug}`, 409);
    }
    const role = await roleRepo.createRole(
      { slug, name, description: request.description ?? null, isSystem: false },
      conn,
    );
    await roleRepo.replaceRolePermissions(role.id, permissions, conn);
    await userRepo.appendAuditLog(
      {
        actorUserId,
        targetUserId: null,
        action: "role.created",
        details: { slug, permissions },
      },
      conn,
    );
    return role.id;
  });

  return getRole(roleId);
}

export async function getRole(roleId: string): Promise<roleRepo.RoleWithPermissions> {
  const role = await roleRepo.getRoleById(roleId);
  if (!role) throw new AdminError("role_not_found", "El rol no existe", 404);
  return {
    ...role,
    permissions: await roleRepo.getRolePermissions(roleId),
    userCount: await roleRepo.countUsersWithRole(roleId),
  };
}

export async function updateRole(
  roleId: string,
  request: { name?: string; description?: string | null },
  actorUserId: string | null,
): Promise<roleRepo.RoleWithPermissions> {
  const patch: roleRepo.UpdateRoleInput = {};
  if (request.name !== undefined) {
    const name = String(request.name).trim();
    if (name.length < 2) {
      throw new AdminError("invalid_role_name", "El nombre del rol es obligatorio", 400);
    }
    patch.name = name;
  }
  if (request.description !== undefined) patch.description = request.description;

  await withTransaction(async (conn) => {
    const role = await roleRepo.getRoleById(roleId, conn);
    if (!role) throw new AdminError("role_not_found", "El rol no existe", 404);
    await roleRepo.updateRole(roleId, patch, conn);
    await userRepo.appendAuditLog(
      {
        actorUserId,
        targetUserId: null,
        action: "role.updated",
        details: { slug: role.slug, changes: Object.keys(patch) },
      },
      conn,
    );
  });

  return getRole(roleId);
}

/**
 * Rewrites a role's permissions.
 *
 * System roles stay editable on purpose — an operator may legitimately want to
 * narrow `qa-engineer`. The one thing refused is stripping `admin.users` from
 * the role that keeps the last administrator in place.
 */
export async function setRolePermissions(
  roleId: string,
  permissions: unknown,
  actorUserId: string | null,
): Promise<roleRepo.RoleWithPermissions> {
  const parsed = parsePermissions(permissions);

  await withTransaction(async (conn) => {
    const role = await roleRepo.getRoleById(roleId, conn);
    if (!role) throw new AdminError("role_not_found", "El rol no existe", 404);

    const current = await roleRepo.getRolePermissions(roleId, conn);
    const losesAdmin = current.includes(ADMIN_PERMISSION) && !parsed.includes(ADMIN_PERMISSION);

    if (losesAdmin) {
      await roleRepo.replaceRolePermissions(roleId, parsed, conn);
      const remainingAdmins = await userRepo.countActiveAdmins(undefined, conn);
      if (remainingAdmins === 0) {
        // Undo and refuse: this write would have locked everyone out.
        await roleRepo.replaceRolePermissions(roleId, current, conn);
        throw new AdminError(
          "last_admin",
          "No se puede quitar admin.users: nadie quedaría con acceso de administración",
          409,
        );
      }
    } else {
      await roleRepo.replaceRolePermissions(roleId, parsed, conn);
    }

    // Everyone holding this role is carrying a now-stale principal.
    const holders = await conn.query<{ userId: string }>(
      "SELECT userId FROM dbo.UserRoles WHERE roleId = ?",
      [roleId],
    );
    for (const holder of holders) {
      await sessionRepo.revokeAllUserSessions(holder.userId, undefined, conn);
    }

    await userRepo.appendAuditLog(
      {
        actorUserId,
        targetUserId: null,
        action: "role.permissions_changed",
        details: { slug: role.slug, permissions: parsed, affectedUsers: holders.length },
      },
      conn,
    );
  });

  return getRole(roleId);
}

export async function deleteRole(roleId: string, actorUserId: string | null): Promise<void> {
  await withTransaction(async (conn) => {
    const role = await roleRepo.getRoleById(roleId, conn);
    if (!role) throw new AdminError("role_not_found", "El rol no existe", 404);
    if (role.isSystem) {
      throw new AdminError("system_role", "Los roles de sistema no se pueden eliminar", 409);
    }
    const assigned = await roleRepo.countUsersWithRole(roleId, conn);
    if (assigned > 0) {
      throw new AdminError(
        "role_in_use",
        `El rol está asignado a ${assigned} usuario(s); reasígnalos antes de eliminarlo`,
        409,
        { userCount: assigned },
      );
    }
    await roleRepo.deleteRole(roleId, conn);
    await userRepo.appendAuditLog(
      { actorUserId, targetUserId: null, action: "role.deleted", details: { slug: role.slug } },
      conn,
    );
  });
}

export async function listRoles(): Promise<roleRepo.RoleWithPermissions[]> {
  return roleRepo.listRolesWithPermissions();
}
