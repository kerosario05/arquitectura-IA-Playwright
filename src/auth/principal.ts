import type { PermissionKey } from "./permissions";
import type { SessionScope } from "../db/session-repository";

/**
 * The authenticated caller, resolved once per request.
 *
 * Two kinds exist: a `user` backed by a session row, and the `service` principal
 * granted to callers presenting the legacy `X-Api-Key` header (CLIs, the runner,
 * internal jobs) so machine-to-machine traffic keeps working unchanged.
 */
export type Principal = {
  kind: "user" | "service";
  userId: string | null;
  username: string;
  sessionId: string | null;
  scope: SessionScope;
  permissions: ReadonlySet<PermissionKey>;
  /** Skips the per-project check entirely. */
  allProjects: boolean;
  /** Lowercased project ids the user was granted. */
  projectIds: ReadonlySet<string>;
  /** Lowercased project slugs, for routes that address a project by slug. */
  projectSlugs: ReadonlySet<string>;
  /** Project ids the user may write to (accessLevel 2). */
  writableProjectIds: ReadonlySet<string>;
  mustChangePassword: boolean;
};

/** Full-access principal for `X-Api-Key` callers and for `AUTH_ENABLED=false`. */
export function createServicePrincipal(username = "service"): Principal {
  return {
    kind: "service",
    userId: null,
    username,
    sessionId: null,
    scope: "full",
    permissions: ALL_PERMISSIONS_SENTINEL,
    allProjects: true,
    projectIds: new Set(),
    projectSlugs: new Set(),
    writableProjectIds: new Set(),
    mustChangePassword: false,
  };
}

/**
 * A set that reports membership for every key. Using this instead of a copy of
 * the catalogue means a service principal automatically holds permissions added
 * in later releases, which is the intent for trusted machine callers.
 */
const ALL_PERMISSIONS_SENTINEL: ReadonlySet<PermissionKey> = {
  has: () => true,
  get size() {
    return Number.POSITIVE_INFINITY;
  },
  keys: () => [][Symbol.iterator](),
  values: () => [][Symbol.iterator](),
  entries: () => [][Symbol.iterator](),
  forEach: () => undefined,
  [Symbol.iterator]: () => [][Symbol.iterator](),
} as unknown as ReadonlySet<PermissionKey>;

export function hasPermission(principal: Principal, permission: PermissionKey): boolean {
  return principal.permissions.has(permission);
}

export function hasEveryPermission(
  principal: Principal,
  permissions: PermissionKey[],
): boolean {
  return permissions.every((permission) => principal.permissions.has(permission));
}

/**
 * Project scoping. `reference` may be an id or a slug — routes address projects
 * both ways, and a caller should not have to know which one a given route uses.
 */
export function canAccessProject(principal: Principal, reference: string | null | undefined): boolean {
  if (principal.allProjects) return true;
  if (!reference) return false;
  const key = reference.trim().toLowerCase();
  if (key.length === 0) return false;
  return principal.projectIds.has(key) || principal.projectSlugs.has(key);
}

export function canWriteProject(principal: Principal, projectId: string | null | undefined): boolean {
  if (principal.allProjects) return true;
  if (!projectId) return false;
  return principal.writableProjectIds.has(projectId.trim().toLowerCase());
}

/** Shape returned by `GET /api/auth/me` and embedded in the login response. */
export function describePrincipal(principal: Principal): {
  kind: string;
  userId: string | null;
  username: string;
  scope: SessionScope;
  mustChangePassword: boolean;
  allProjects: boolean;
  permissions: PermissionKey[] | "*";
} {
  return {
    kind: principal.kind,
    userId: principal.userId,
    username: principal.username,
    scope: principal.scope,
    mustChangePassword: principal.mustChangePassword,
    allProjects: principal.allProjects,
    permissions: principal.kind === "service" ? "*" : [...principal.permissions],
  };
}
