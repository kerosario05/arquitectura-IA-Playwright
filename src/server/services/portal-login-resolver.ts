import { loadPromotedAppConfigSync } from "../../automations/app-profile";
import { withConnection } from "../../db/sql-connection";
import type { DbConnection } from "../../db/db-connection";
import type { PortalLogin } from "./data-cedulas-reuse";
import { PORTAL_LOGIN_CREDENTIAL, readServiceCredential } from "../../db/project-service-credential-service";

/**
 * Where a Portal sign-in comes from, so no job needs a hand-set user/password or a recording id:
 *   1. the credentials the service panel asked for and stored encrypted (Catálogo de servicios);
 *   2. DATA_CEDULAS_LEXIS_PORTAL_USERNAME / _PASSWORD (optional override, kept for existing setups);
 *   3. the project's own saved launch credentials: the `usuario` / `contrasena` values confirmed when
 *      a case was last launched with them (ProjectCaseRuntimeValue), taken from ONE case so the pair matches.
 * The Portal address is the project's configured base URL. Credentials are returned to the caller only and
 * are never logged.
 */
export type PortalLoginSource = "service_credentials" | "environment" | "project_saved_launch_values";
export type ResolvedPortalLogin = { login: PortalLogin; source: PortalLoginSource };

const USER_KEY = /^(?:usuario|username|user)(?:_|$)/i;
const PASSWORD_KEY = /^(?:contrasena|password|clave)(?:_|$)/i;

type RuntimeRow = { caseId: number | string; key: string; value: string; updatedAt: string };

const usable = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "" && !/^\[?\s*redacted/i.test(value.trim());

/** Newest case that has both a user and a password value. Pure: easy to test. */
export function pickSavedPortalCredentials(rows: readonly RuntimeRow[]): { username: string; password: string } | undefined {
  const byCase = new Map<string, { updatedAt: string; username?: string; password?: string }>();
  for (const row of rows) {
    if (!usable(row.value)) continue;
    const entry = byCase.get(String(row.caseId)) ?? { updatedAt: "" };
    if (USER_KEY.test(row.key)) entry.username = row.value;
    else if (PASSWORD_KEY.test(row.key)) entry.password = row.value;
    else continue;
    if (row.updatedAt > entry.updatedAt) entry.updatedAt = row.updatedAt;
    byCase.set(String(row.caseId), entry);
  }
  const complete = [...byCase.values()].filter(entry => entry.username && entry.password)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return complete[0] ? { username: complete[0].username!, password: complete[0].password! } : undefined;
}

export async function readSavedPortalCredentials(projectSlug: string, conn?: DbConnection): Promise<{ username: string; password: string } | undefined> {
  const read = async (connection: DbConnection) => {
    const project = await connection.query<{ id: string }>("SELECT id FROM dbo.Projects WHERE slug = ?", [projectSlug]);
    if (!project.length) return undefined;
    const rows = await connection.query<RuntimeRow>(
      `SELECT caseId, [key], [value], updatedAt FROM dbo.ProjectCaseRuntimeValue WHERE projectId = ? AND confirmed = 1`,
      [project[0].id],
    );
    return pickSavedPortalCredentials(rows ?? []);
  };
  try { return conn ? await read(conn) : await withConnection(read); } catch { return undefined; }
}

export async function resolvePortalLogin(
  projectSlug: string,
  options: {
    env?: NodeJS.ProcessEnv;
    baseUrl?: string;
    readStored?: (slug: string) => Promise<{ username: string; password: string } | undefined>;
    readSaved?: (slug: string) => Promise<{ username: string; password: string } | undefined>;
  } = {},
): Promise<ResolvedPortalLogin | undefined> {
  const env = options.env ?? process.env;
  let baseUrl = options.baseUrl;
  if (!baseUrl) {
    try { baseUrl = (loadPromotedAppConfigSync({ appSlug: projectSlug }) as { baseUrl?: string } | undefined)?.baseUrl; } catch { /* no profile */ }
  }
  if (!baseUrl) return undefined;
  const stored = await (options.readStored ?? ((slug: string) => readServiceCredential(slug, PORTAL_LOGIN_CREDENTIAL)))(projectSlug);
  if (stored) return { login: { baseUrl, ...stored }, source: "service_credentials" };
  const envUser = env.DATA_CEDULAS_LEXIS_PORTAL_USERNAME?.trim();
  const envPassword = env.DATA_CEDULAS_LEXIS_PORTAL_PASSWORD;
  if (envUser && envPassword) return { login: { baseUrl, username: envUser, password: envPassword }, source: "environment" };
  const saved = await (options.readSaved ?? readSavedPortalCredentials)(projectSlug);
  return saved ? { login: { baseUrl, ...saved }, source: "project_saved_launch_values" } : undefined;
}
