import fs from "node:fs";
import path from "node:path";

/**
 * Reads the Portal API database sign-in from its `appsettings.json` (DatabaseSettings:Default) so the user does not
 * have to retype it. Only that one connection string is used; nothing else from the file is kept or returned.
 * The caller stores the password encrypted and never sends it back to the browser.
 */
export class PortalDbImportError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
    this.name = "PortalDbImportError";
  }
}

export type ImportedPortalDbSettings = { server: string; database: string; user: string; password: string };

const MAX_BYTES = 1024 * 1024;
const FILE_NAME = /^appsettings(?:\.[\w-]+)?\.json$/i;

/** `Server=a;Database=b;User Id=c;pwd=d` -> its parts (keys are case-insensitive, values may be quoted). */
export function parseConnectionString(text: string): Record<string, string> {
  const parts: Record<string, string> = {};
  let rest = text;
  while (rest.length) {
    const equals = rest.indexOf("=");
    if (equals < 0) break;
    const key = rest.slice(0, equals).replace(/^[\s;]+/, "").trim().toLowerCase();
    let value = rest.slice(equals + 1).replace(/^\s+/, "");
    const quote = value[0] === '"' || value[0] === "'" ? value[0] : "";
    if (quote) {
      const end = value.indexOf(quote, 1);
      if (end < 0) { parts[key] = value.slice(1); break; }
      parts[key] = value.slice(1, end);
      rest = value.slice(end + 1).replace(/^\s*;?/, "");
    } else {
      const end = value.indexOf(";");
      parts[key] = (end < 0 ? value : value.slice(0, end)).trim();
      rest = end < 0 ? "" : value.slice(end + 1);
    }
    if (!key) delete parts[key];
  }
  return parts;
}

const pick = (parts: Record<string, string>, ...names: string[]) => names.map((name) => parts[name]).find((value) => value !== undefined && value !== "");

export function readPortalDbSettingsFile(filePath: unknown): ImportedPortalDbSettings {
  const raw = String(filePath ?? "").trim().replace(/^"|"$/g, "");
  if (!raw) throw new PortalDbImportError("path_required", 400, "Indica la ruta del archivo appsettings.json de la API del Portal.");
  const resolved = path.resolve(raw);
  if (!FILE_NAME.test(path.basename(resolved))) {
    throw new PortalDbImportError("file_not_allowed", 400, "Solo se puede importar un archivo llamado appsettings.json (o con un ambiente, como appsettings.Production.json).");
  }
  let stat: fs.Stats;
  try { stat = fs.statSync(resolved); }
  catch { throw new PortalDbImportError("file_not_found", 404, "No se encontró ese archivo en el equipo donde corre QA Lab."); }
  if (!stat.isFile() || stat.size > MAX_BYTES) {
    throw new PortalDbImportError("file_not_allowed", 400, "La ruta no es un archivo appsettings.json válido (o es demasiado grande).");
  }
  let settings: { DatabaseSettings?: { Default?: unknown } };
  try { settings = JSON.parse(fs.readFileSync(resolved, "utf8").replace(/^﻿/, "")); }
  catch { throw new PortalDbImportError("file_invalid", 422, "El archivo no es un JSON válido."); }
  const connection = settings?.DatabaseSettings?.Default;
  if (typeof connection !== "string" || !connection.trim()) {
    throw new PortalDbImportError("connection_string_missing", 422, "El archivo no tiene DatabaseSettings → Default.");
  }
  const parts = parseConnectionString(connection);
  const server = pick(parts, "server", "data source", "address", "addr", "network address");
  const database = pick(parts, "database", "initial catalog");
  const user = pick(parts, "user id", "uid", "user");
  const password = pick(parts, "pwd", "password");
  if (!server || !database || !user || !password) {
    throw new PortalDbImportError("connection_string_incomplete", 422,
      `La cadena de conexión no trae todo lo necesario (falta: ${[!server && "servidor", !database && "base", !user && "usuario", !password && "contraseña"].filter(Boolean).join(", ")}). Puede usar seguridad integrada.`);
  }
  return { server, database, user, password };
}
