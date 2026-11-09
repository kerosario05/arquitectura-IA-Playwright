import { readServiceCredential } from "../../db/project-service-credential-service";
import { PortalDbImportError, readPortalDbSettingsFile } from "./portal-db-import";
import { PortalDbError, portalDbLocation, type PortalDbTarget } from "./portal-requests-db";

/** Credential key (encrypted store) holding the user/password of the Portal API database. */
export const PORTAL_DB_CREDENTIAL = "portal-db";

export type PortalDbTargetSource = "settings_file" | "env_and_panel";

/**
 * Where the Portal requests database is and how to sign in, in this order:
 *   1. PORTAL_API_APPSETTINGS: path (relative to the project or absolute) of an appsettings.json holding
 *      DatabaseSettings:Default. Server, database, user and password all come from there: nothing to type or import.
 *   2. PORTAL_DB_SERVER + PORTAL_DB_DATABASE from the environment, and the user/password saved (encrypted) in the panel.
 * A clear error says what is missing.
 */
export async function resolvePortalDbTarget(
  projectSlug: string,
  options: { env?: NodeJS.ProcessEnv; readCredential?: (slug: string) => Promise<{ username: string; password: string } | undefined> } = {},
): Promise<PortalDbTarget & { source: PortalDbTargetSource }> {
  const env = options.env ?? process.env;
  const settingsPath = env.PORTAL_API_APPSETTINGS?.trim();
  if (settingsPath) {
    try {
      const file = readPortalDbSettingsFile(settingsPath);
      return { server: file.server, database: file.database, user: file.user, password: file.password, source: "settings_file" };
    } catch (error) {
      if (error instanceof PortalDbImportError) {
        throw new PortalDbError("settings_file_unusable", 503, `PORTAL_API_APPSETTINGS apunta a un archivo que no se puede usar: ${error.message}`);
      }
      throw error;
    }
  }
  const { server, database } = portalDbLocation(env);
  if (!server || !database) {
    throw new PortalDbError("db_not_configured", 503, "Falta indicar la base del Portal: define PORTAL_API_APPSETTINGS (ruta del appsettings.json) o bien PORTAL_DB_SERVER y PORTAL_DB_DATABASE en el .env.");
  }
  const credential = await (options.readCredential ?? ((slug: string) => readServiceCredential(slug, PORTAL_DB_CREDENTIAL)))(projectSlug);
  if (!credential) {
    throw new PortalDbError("credentials_required", 401, "Faltan el usuario y la contraseña de la base del Portal: guárdalos en este panel.");
  }
  return { server, database, user: credential.username, password: credential.password, source: "env_and_panel" };
}

/** What the panel needs to know, never the password. */
export async function describePortalDbAccess(
  projectSlug: string,
  options: Parameters<typeof resolvePortalDbTarget>[1] = {},
): Promise<{ source?: PortalDbTargetSource; configured: boolean; server?: string; database?: string; username?: string; problem?: string }> {
  try {
    const target = await resolvePortalDbTarget(projectSlug, options);
    return { source: target.source, configured: true, server: target.server, database: target.database, username: target.user };
  } catch (error) {
    const location = portalDbLocation(options.env);
    return { configured: false, ...location, problem: error instanceof PortalDbError ? error.code : "error" };
  }
}