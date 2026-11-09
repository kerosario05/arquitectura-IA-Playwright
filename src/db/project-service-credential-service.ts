import type { DbConnection } from "./db-connection";
import { decryptSecret, encryptSecret } from "./secret-box";
import { withConnection, withTransaction } from "./sql-connection";

type ConnectionLike = Pick<DbConnection, "query">;

/** The one Portal login shared by cédula generation, LexisNexis screening and request cancellation. */
export const PORTAL_LOGIN_CREDENTIAL = "portal-login";
const CREDENTIAL_KEY = /^[a-z0-9][a-z0-9_-]{1,63}$/i;

export type ServiceCredentialStatus =
  | { configured: false }
  | { configured: true; username: string; updatedAt: string | null; updatedBy: string | null };

export class ServiceCredentialError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
    this.name = "ServiceCredentialError";
  }
}

type Row = { username: string; passwordCipher: string; updatedAt: string | Date | null; updatedBy: string | null };

function assertKey(credentialKey: string): void {
  if (!CREDENTIAL_KEY.test(credentialKey)) throw new ServiceCredentialError("credential_key_invalid", 400, "Clave de credencial no válida.");
}

async function projectIdOf(conn: ConnectionLike, slug: string): Promise<string> {
  const rows = await conn.query<{ id: string }>("SELECT id FROM dbo.Projects WHERE slug = ?", [slug]);
  if (!rows.length) throw new ServiceCredentialError("project_not_found", 404, "El proyecto no existe.");
  return rows[0].id;
}

const iso = (value: string | Date | null) => (value instanceof Date ? value.toISOString() : value);

/** Status only: the password never leaves the server through this function. */
export async function getServiceCredentialStatus(slug: string, credentialKey: string, conn?: ConnectionLike): Promise<ServiceCredentialStatus> {
  assertKey(credentialKey);
  const run = async (c: ConnectionLike): Promise<ServiceCredentialStatus> => {
    const projectId = await projectIdOf(c, slug);
    const rows = await c.query<Row>(
      "SELECT username, passwordCipher, updatedAt, updatedBy FROM dbo.ProjectServiceCredential WHERE projectId = ? AND credentialKey = ?",
      [projectId, credentialKey],
    );
    return rows.length ? { configured: true, username: rows[0].username, updatedAt: iso(rows[0].updatedAt), updatedBy: rows[0].updatedBy } : { configured: false };
  };
  return conn ? run(conn) : withConnection(run);
}

/** Decrypted credential for server-side use only. Undefined when none is stored or it cannot be decrypted. */
export async function readServiceCredential(slug: string, credentialKey: string, conn?: ConnectionLike): Promise<{ username: string; password: string } | undefined> {
  assertKey(credentialKey);
  const run = async (c: ConnectionLike) => {
    const projects = await c.query<{ id: string }>("SELECT id FROM dbo.Projects WHERE slug = ?", [slug]);
    if (!projects.length) return undefined;
    const rows = await c.query<Row>(
      "SELECT username, passwordCipher, updatedAt, updatedBy FROM dbo.ProjectServiceCredential WHERE projectId = ? AND credentialKey = ?",
      [projects[0].id, credentialKey],
    );
    if (!rows.length) return undefined;
    try { return { username: rows[0].username, password: decryptSecret(rows[0].passwordCipher) }; }
    catch { return undefined; }
  };
  try { return conn ? await run(conn) : await withConnection(run); } catch { return undefined; }
}

export async function saveServiceCredential(
  slug: string,
  credentialKey: string,
  input: { username?: unknown; password?: unknown },
  updatedBy?: string,
): Promise<ServiceCredentialStatus> {
  assertKey(credentialKey);
  const username = typeof input.username === "string" ? input.username.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  if (!username || username.length > 254) throw new ServiceCredentialError("username_invalid", 400, "Indica el usuario.");
  if (!password || password.length > 512) throw new ServiceCredentialError("password_invalid", 400, "Indica la contraseña.");
  const passwordCipher = encryptSecret(password);
  await withTransaction(async (conn) => {
    const projectId = await projectIdOf(conn, slug);
    const existing = await conn.query<{ projectId: string }>(
      "SELECT projectId FROM dbo.ProjectServiceCredential WHERE projectId = ? AND credentialKey = ?",
      [projectId, credentialKey],
    );
    if (existing.length) {
      await conn.query(
        "UPDATE dbo.ProjectServiceCredential SET username = ?, passwordCipher = ?, updatedBy = ?, updatedAt = SYSUTCDATETIME() WHERE projectId = ? AND credentialKey = ?",
        [username, passwordCipher, updatedBy ?? null, projectId, credentialKey],
      );
    } else {
      await conn.query(
        "INSERT INTO dbo.ProjectServiceCredential (projectId, credentialKey, username, passwordCipher, updatedBy) VALUES (?, ?, ?, ?, ?)",
        [projectId, credentialKey, username, passwordCipher, updatedBy ?? null],
      );
    }
  });
  return getServiceCredentialStatus(slug, credentialKey);
}

export async function deleteServiceCredential(slug: string, credentialKey: string): Promise<void> {
  assertKey(credentialKey);
  await withTransaction(async (conn) => {
    const projectId = await projectIdOf(conn, slug);
    await conn.query("DELETE FROM dbo.ProjectServiceCredential WHERE projectId = ? AND credentialKey = ?", [projectId, credentialKey]);
  });
}
