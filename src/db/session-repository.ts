import { getConnection } from "./sql-connection";
import type { DbConnection as Connection } from "./db-connection";
import { toIso, toIsoOrNull } from "./row-utils";

/**
 * Persistence for `UserSessions`.
 *
 * Only the SHA-256 of the bearer token is stored, so a dump of this table cannot
 * be replayed against the API. Revocation is a row update rather than a delete,
 * which keeps an expired-vs-revoked distinction available for diagnostics.
 */

export type SessionScope = "full" | "password_change_only";

export type Session = {
  id: string;
  userId: string;
  scope: SessionScope;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastSeenAt: string | null;
  userAgent: string | null;
  ipAddress: string | null;
};

export type CreateSessionInput = {
  userId: string;
  tokenHash: string;
  scope: SessionScope;
  expiresAt: Date;
  userAgent?: string | null;
  ipAddress?: string | null;
};

type SessionRow = {
  id: string;
  userId: string;
  scope: string;
  issuedAt: unknown;
  expiresAt: unknown;
  revokedAt: unknown;
  lastSeenAt: unknown;
  userAgent: string | null;
  ipAddress: string | null;
};

const COLUMN_LIST = [
  "id",
  "userId",
  "scope",
  "issuedAt",
  "expiresAt",
  "revokedAt",
  "lastSeenAt",
  "userAgent",
  "ipAddress",
];

const COLUMNS = COLUMN_LIST.join(", ");
const OUTPUT_COLUMNS = COLUMN_LIST.map((c) => `INSERTED.${c}`).join(", ");

function mapRow(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.userId,
    scope: row.scope === "password_change_only" ? "password_change_only" : "full",
    issuedAt: toIso(row.issuedAt),
    expiresAt: toIso(row.expiresAt),
    revokedAt: toIsoOrNull(row.revokedAt),
    lastSeenAt: toIsoOrNull(row.lastSeenAt),
    userAgent: row.userAgent ?? null,
    ipAddress: row.ipAddress ?? null,
  };
}

async function resolve(conn?: Connection): Promise<Connection> {
  return conn ?? (await getConnection());
}

export async function createSession(
  input: CreateSessionInput,
  conn?: Connection,
): Promise<Session> {
  const c = await resolve(conn);
  const rows = await c.query<SessionRow>(
    `INSERT INTO dbo.UserSessions (userId, tokenHash, scope, expiresAt, userAgent, ipAddress)
     OUTPUT ${OUTPUT_COLUMNS}
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.userId,
      input.tokenHash,
      input.scope,
      input.expiresAt.toISOString(),
      input.userAgent?.slice(0, 512) ?? null,
      input.ipAddress ?? null,
    ],
  );
  return mapRow(rows[0]);
}

/**
 * Looks a session up by token digest. Returns the row even when expired or
 * revoked — the caller decides which of the two to report, since "your session
 * expired" and "your access was revoked" are different messages for the user.
 */
export async function getSessionByTokenHash(
  tokenHash: string,
  conn?: Connection,
): Promise<Session | null> {
  const c = await resolve(conn);
  const rows = await c.query<SessionRow>(
    `SELECT ${COLUMNS} FROM dbo.UserSessions WHERE tokenHash = ?`,
    [tokenHash],
  );
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

export async function listActiveSessions(userId: string, conn?: Connection): Promise<Session[]> {
  const c = await resolve(conn);
  const rows = await c.query<SessionRow>(
    `SELECT ${COLUMNS}
       FROM dbo.UserSessions
      WHERE userId = ? AND revokedAt IS NULL AND expiresAt > SYSUTCDATETIME()
      ORDER BY issuedAt DESC`,
    [userId],
  );
  return rows.map(mapRow);
}

export async function revokeSession(id: string, conn?: Connection): Promise<void> {
  const c = await resolve(conn);
  await c.query(
    "UPDATE dbo.UserSessions SET revokedAt = SYSUTCDATETIME() WHERE id = ? AND revokedAt IS NULL",
    [id],
  );
}

export async function revokeSessionByTokenHash(
  tokenHash: string,
  conn?: Connection,
): Promise<void> {
  const c = await resolve(conn);
  await c.query(
    `UPDATE dbo.UserSessions SET revokedAt = SYSUTCDATETIME()
      WHERE tokenHash = ? AND revokedAt IS NULL`,
    [tokenHash],
  );
}

/**
 * Revokes every live session for a user — used when the password changes, when
 * an admin disables the account, and when roles or project scope are rewritten
 * so a cached principal cannot outlive its grant.
 *
 * Already-expired rows are left alone: they are unusable either way, and
 * skipping them keeps the returned count meaningful as "sessions terminated".
 */
export async function revokeAllUserSessions(
  userId: string,
  exceptSessionId?: string,
  conn?: Connection,
): Promise<number> {
  const c = await resolve(conn);
  const exclusion = exceptSessionId ? "AND id <> ?" : "";
  const params = exceptSessionId ? [userId, exceptSessionId] : [userId];
  const before = await c.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM dbo.UserSessions
      WHERE userId = ? AND revokedAt IS NULL AND expiresAt > SYSUTCDATETIME() ${exclusion}`,
    params,
  );
  await c.query(
    `UPDATE dbo.UserSessions SET revokedAt = SYSUTCDATETIME()
      WHERE userId = ? AND revokedAt IS NULL AND expiresAt > SYSUTCDATETIME() ${exclusion}`,
    params,
  );
  return Number(before[0]?.n ?? 0);
}

export async function touchSession(id: string, conn?: Connection): Promise<void> {
  const c = await resolve(conn);
  await c.query("UPDATE dbo.UserSessions SET lastSeenAt = SYSUTCDATETIME() WHERE id = ?", [id]);
}

/** Housekeeping: drops rows that expired more than `retentionDays` ago. */
export async function purgeExpiredSessions(retentionDays = 7, conn?: Connection): Promise<number> {
  const c = await resolve(conn);
  const cutoff = new Date(Date.now() - Math.max(0, retentionDays) * 24 * 60 * 60 * 1000);
  const before = await c.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM dbo.UserSessions WHERE expiresAt < ?",
    [cutoff.toISOString()],
  );
  await c.query("DELETE FROM dbo.UserSessions WHERE expiresAt < ?", [cutoff.toISOString()]);
  return Number(before[0]?.n ?? 0);
}
