import { createHash, randomBytes } from "node:crypto";
import { getConnection, withTransaction } from "../db/sql-connection";
import type { DbConnection as Connection } from "../db/db-connection";
import * as userRepo from "../db/user-repository";
import * as sessionRepo from "../db/session-repository";
import type { Session, SessionScope } from "../db/session-repository";
import { assertPasswordPolicy, hashPassword, verifyPassword } from "./password";
import { resolveAuthConfig } from "./config";
import { createServicePrincipal, type Principal } from "./principal";
import type { PermissionKey } from "./permissions";

/**
 * Login, logout, password change and session resolution.
 *
 * Tokens are opaque: 32 random bytes handed to the client, of which only the
 * SHA-256 digest is stored. That makes a leaked database useless for replay and
 * — unlike a JWT — lets an admin revoke access the moment they disable an
 * account, which is the whole point of the admin module.
 */

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export type AuthErrorCode =
  | "invalid_credentials"
  | "account_disabled"
  | "account_locked"
  | "missing_token"
  | "invalid_token"
  | "session_expired"
  | "session_revoked"
  | "password_change_required"
  | "password_reuse"
  | "user_not_found";

const TOKEN_BYTES = 32;

/**
 * Compared against when the username does not exist, so a missing account costs
 * the same wall-clock time as a wrong password and cannot be probed for.
 */
const DUMMY_HASH =
  "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" +
  "cGxhY2Vob2xkZXJwbGFjZWhvbGRlcnBsYWNlaG9sZGVycGxhY2Vob2xkZXJwbGFjZWhvbGRlcnBsYWNlaG9sZA==";

export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Extracts the bearer token from an `Authorization` header value. */
export function extractBearerToken(header: string | undefined | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() || null : null;
}

// ---------------------------------------------------------------------------
// Principal assembly
// ---------------------------------------------------------------------------

async function buildUserPrincipal(
  user: userRepo.User,
  session: Session | null,
  conn: Connection,
): Promise<Principal> {
  const permissions = await userRepo.getEffectivePermissions(user.id, conn);
  const access = user.allProjects ? [] : await userRepo.getUserProjectAccess(user.id, conn);

  return {
    kind: "user",
    userId: user.id,
    username: user.username,
    sessionId: session?.id ?? null,
    scope: session?.scope ?? "full",
    permissions: new Set<PermissionKey>(permissions),
    allProjects: user.allProjects,
    projectIds: new Set(access.map((a) => a.projectId.toLowerCase())),
    projectSlugs: new Set(access.map((a) => a.projectSlug.toLowerCase())),
    writableProjectIds: new Set(
      access.filter((a) => a.accessLevel === 2).map((a) => a.projectId.toLowerCase()),
    ),
    mustChangePassword: user.mustChangePassword,
  };
}

export { createServicePrincipal };

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export type LoginInput = {
  username: string;
  password: string;
  userAgent?: string | null;
  ipAddress?: string | null;
};

export type LoginResult = {
  token: string;
  expiresAt: string;
  scope: SessionScope;
  mustChangePassword: boolean;
  user: userRepo.User;
  roles: userRepo.UserRoleRef[];
  permissions: PermissionKey[];
  projects: userRepo.UserProjectAccess[];
};

export async function login(input: LoginInput): Promise<LoginResult> {
  const config = resolveAuthConfig();
  const username = String(input.username ?? "").trim();
  const password = String(input.password ?? "");

  if (!username || !password) {
    throw new AuthError("invalid_credentials", "Usuario o contraseña incorrectos", 401);
  }

  // Deliberately NOT inside a transaction: the failure path below has to persist
  // the attempt counter *and* throw. Rolling the increment back with the error
  // would make the lockout unreachable — brute force would never be recorded.
  const user = await userRepo.getUserWithSecretByUsername(username);

  if (!user) {
    // Burn the same work a real verification would take before failing.
    await verifyPassword(password, DUMMY_HASH);
    throw new AuthError("invalid_credentials", "Usuario o contraseña incorrectos", 401);
  }

  const lockedUntilMs = user.lockedUntil ? Date.parse(user.lockedUntil) : 0;
  if (lockedUntilMs > Date.now()) {
    throw new AuthError(
      "account_locked",
      "La cuenta está bloqueada temporalmente por intentos fallidos",
      423,
      { lockedUntil: user.lockedUntil },
    );
  }

  const passwordMatches = await verifyPassword(password, user.passwordHash);
  if (!passwordMatches) {
    const outcome = await userRepo.recordFailedLogin(
      user.id,
      config.maxFailedAttempts,
      new Date(Date.now() + config.lockoutMs),
    );
    if (outcome.lockedUntil) {
      await userRepo.appendAuditLog({
        actorUserId: null,
        targetUserId: user.id,
        action: "user.locked_out",
        details: { failedLoginCount: outcome.failedLoginCount },
      });
      throw new AuthError(
        "account_locked",
        "La cuenta quedó bloqueada por intentos fallidos",
        423,
        { lockedUntil: outcome.lockedUntil },
      );
    }
    throw new AuthError("invalid_credentials", "Usuario o contraseña incorrectos", 401, {
      remainingAttempts: Math.max(0, config.maxFailedAttempts - outcome.failedLoginCount),
    });
  }

  // Checked after the password so a wrong guess cannot tell a disabled account
  // apart from a non-existent one.
  if (!user.enabled) {
    throw new AuthError("account_disabled", "La cuenta está desactivada", 403);
  }

  // Only the success path is atomic: stamping the login and minting the session
  // must not half-apply.
  return withTransaction(async (conn) => {
    await userRepo.recordSuccessfulLogin(user.id, conn);

    const scope: SessionScope = user.mustChangePassword ? "password_change_only" : "full";
    const ttl = scope === "full" ? config.sessionTtlMs : config.passwordChangeTtlMs;
    const token = generateSessionToken();
    const session = await sessionRepo.createSession(
      {
        userId: user.id,
        tokenHash: hashSessionToken(token),
        scope,
        expiresAt: new Date(Date.now() + ttl),
        userAgent: input.userAgent ?? null,
        ipAddress: input.ipAddress ?? null,
      },
      conn,
    );

    const publicUser = userRepo.stripSecret({ ...user, mustChangePassword: user.mustChangePassword });
    return {
      token,
      expiresAt: session.expiresAt,
      scope,
      mustChangePassword: user.mustChangePassword,
      user: publicUser,
      roles: await userRepo.getUserRoles(user.id, conn),
      permissions: await userRepo.getEffectivePermissions(user.id, conn),
      projects: user.allProjects ? [] : await userRepo.getUserProjectAccess(user.id, conn),
    };
  });
}

// ---------------------------------------------------------------------------
// Session resolution
// ---------------------------------------------------------------------------

export type ResolvedSession = {
  principal: Principal;
  session: Session;
  user: userRepo.User;
};

/**
 * Turns a bearer token into a principal, or throws with the reason.
 *
 * Expired and revoked are reported separately on purpose: "tu sesión expiró" and
 * "tu acceso fue revocado" call for different reactions from the user.
 */
export async function resolveSessionToken(token: string): Promise<ResolvedSession> {
  if (!token?.trim()) {
    throw new AuthError("missing_token", "Falta el token de sesión", 401);
  }

  // Not wrapped in a transaction: the disabled-account branch has to persist the
  // mass revocation *and* throw, and a rollback would silently undo it.
  const conn = await getConnection();
  const session = await sessionRepo.getSessionByTokenHash(hashSessionToken(token.trim()), conn);
  if (!session) {
    throw new AuthError("invalid_token", "Token de sesión inválido", 401);
  }
  if (session.revokedAt) {
    throw new AuthError("session_revoked", "La sesión fue revocada", 401);
  }
  if (Date.parse(session.expiresAt) <= Date.now()) {
    throw new AuthError("session_expired", "La sesión expiró", 401);
  }

  const user = await userRepo.getUserWithSecretById(session.userId, conn);
  if (!user) {
    throw new AuthError("user_not_found", "El usuario de la sesión ya no existe", 401);
  }
  if (!user.enabled) {
    // The account was disabled mid-session: close every door on the way out, so
    // re-enabling the account later does not resurrect the open sessions.
    await sessionRepo.revokeAllUserSessions(user.id, undefined, conn);
    throw new AuthError("account_disabled", "La cuenta está desactivada", 403);
  }

  await sessionRepo.touchSession(session.id, conn);
  const publicUser = userRepo.stripSecret(user);
  return {
    principal: await buildUserPrincipal(publicUser, session, conn),
    session,
    user: publicUser,
  };
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

export async function logout(token: string): Promise<void> {
  if (!token?.trim()) return;
  await sessionRepo.revokeSessionByTokenHash(hashSessionToken(token.trim()));
}

// ---------------------------------------------------------------------------
// Password change
// ---------------------------------------------------------------------------

export type ChangePasswordInput = {
  userId: string;
  currentPassword: string;
  newPassword: string;
  userAgent?: string | null;
  ipAddress?: string | null;
};

export type ChangePasswordResult = {
  token: string;
  expiresAt: string;
  revokedSessions: number;
};

/**
 * Rotates the password and hands back a fresh full-scope session.
 *
 * Every existing session is revoked, including the restricted one this call was
 * made with: a first-login change must not leave the temporary credential's
 * session alive, and a deliberate change is also how a user kicks out whoever
 * might be logged in elsewhere.
 */
export async function changePassword(input: ChangePasswordInput): Promise<ChangePasswordResult> {
  const config = resolveAuthConfig();

  return withTransaction(async (conn) => {
    const user = await userRepo.getUserWithSecretById(input.userId, conn);
    if (!user) throw new AuthError("user_not_found", "El usuario no existe", 404);
    if (!user.enabled) throw new AuthError("account_disabled", "La cuenta está desactivada", 403);

    const currentMatches = await verifyPassword(
      String(input.currentPassword ?? ""),
      user.passwordHash,
    );
    if (!currentMatches) {
      throw new AuthError("invalid_credentials", "La contraseña actual no es correcta", 401);
    }

    const newPassword = String(input.newPassword ?? "");
    assertPasswordPolicy(newPassword, { username: user.username });

    if (await verifyPassword(newPassword, user.passwordHash)) {
      throw new AuthError(
        "password_reuse",
        "La nueva contraseña debe ser distinta de la actual",
        400,
      );
    }

    await userRepo.updateUserPassword(user.id, await hashPassword(newPassword), false, conn);
    const revokedSessions = await sessionRepo.revokeAllUserSessions(user.id, undefined, conn);

    const token = generateSessionToken();
    const session = await sessionRepo.createSession(
      {
        userId: user.id,
        tokenHash: hashSessionToken(token),
        scope: "full",
        expiresAt: new Date(Date.now() + config.sessionTtlMs),
        userAgent: input.userAgent ?? null,
        ipAddress: input.ipAddress ?? null,
      },
      conn,
    );

    await userRepo.appendAuditLog(
      {
        actorUserId: user.id,
        targetUserId: user.id,
        action: "user.password_changed",
        details: { revokedSessions },
      },
      conn,
    );

    return { token, expiresAt: session.expiresAt, revokedSessions };
  });
}

// ---------------------------------------------------------------------------
// Identity snapshot for GET /api/auth/me
// ---------------------------------------------------------------------------

export type IdentitySnapshot = {
  user: userRepo.User | null;
  roles: userRepo.UserRoleRef[];
  permissions: PermissionKey[] | "*";
  projects: userRepo.UserProjectAccess[];
  allProjects: boolean;
  scope: SessionScope;
  mustChangePassword: boolean;
  session: { id: string; expiresAt: string; issuedAt: string } | null;
};

export async function describeIdentity(
  principal: Principal,
  session: Session | null,
): Promise<IdentitySnapshot> {
  if (principal.kind === "service" || !principal.userId) {
    return {
      user: null,
      roles: [],
      permissions: "*",
      projects: [],
      allProjects: true,
      scope: "full",
      mustChangePassword: false,
      session: null,
    };
  }

  const user = await userRepo.getUserById(principal.userId);
  return {
    user,
    roles: await userRepo.getUserRoles(principal.userId),
    permissions: [...principal.permissions],
    projects: principal.allProjects ? [] : await userRepo.getUserProjectAccess(principal.userId),
    allProjects: principal.allProjects,
    scope: principal.scope,
    mustChangePassword: principal.mustChangePassword,
    session: session
      ? { id: session.id, expiresAt: session.expiresAt, issuedAt: session.issuedAt }
      : null,
  };
}
