import fs from "node:fs";
import path from "node:path";
import sql from "mssql";

/**
 * Cancels Portal requests straight in the Portal API database (dbo.Requests), for a reviewed selection of one
 * creator's requests. This skips the business process on purpose (it is a QA environment): it only moves the
 * request to its cancelled state the way the Portal's own CustomData save does.
 *
 * Safety: every statement filters by the exact creator and by active states; the ids are parameters; the rows to
 * change are saved to a local file first; the update runs in one transaction that is rolled back unless it touched
 * exactly the selected rows. `dryRun` does everything and always rolls back.
 */
export const ACTIVE_STATUSES = ["BORRADOR", "EN_PROGRESO"] as const;
const MAX_IDS = 1000;
const LIST_LIMIT = 5000;

export class PortalDbError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
    this.name = "PortalDbError";
  }
}

export type PortalDbTarget = { server: string; database: string; user: string; password: string };

export type CancellableRequest = {
  id: number;
  type: string;
  status: string;
  subStatus: string;
  stage: string;
  customIdentifier: string;
  identityHint: string;
  createdOnUtc: string | null;
  updatedOnUtc: string | null;
};

export type QueryResult = { recordset: Array<Record<string, unknown>>; rowsAffected: number[] };
/** The few database operations this module needs, so tests can replace the real driver. */
export interface SqlSession {
  query(text: string, params?: Record<string, unknown>): Promise<QueryResult>;
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close(): Promise<void>;
}

export type OpenSession = (target: PortalDbTarget) => Promise<SqlSession>;

export const openMssqlSession: OpenSession = async (target) => {
  const pool = await new sql.ConnectionPool({
    server: target.server, database: target.database, user: target.user, password: target.password,
    requestTimeout: 120_000, connectionTimeout: 20_000, options: { encrypt: false, trustServerCertificate: true },
  }).connect();
  let transaction: sql.Transaction | undefined;
  return {
    async query(text, params = {}) {
      const request = transaction ? new sql.Request(transaction) : pool.request();
      for (const [name, value] of Object.entries(params)) request.input(name, value as never);
      const result = await request.query(text);
      return { recordset: (result.recordset ?? []) as Array<Record<string, unknown>>, rowsAffected: result.rowsAffected ?? [] };
    },
    async begin() { transaction = new sql.Transaction(pool); await transaction.begin(); },
    async commit() { await transaction?.commit(); transaction = undefined; },
    async rollback() { try { await transaction?.rollback(); } catch { /* already finished */ } transaction = undefined; },
    async close() { await pool.close(); },
  };
};

/** Exact creator: the e-mail, or a user name matching the part before "@" of its own e-mail (never "radames2"). */
export function creatorFilter(createdByInput: unknown): { clause: string; params: Record<string, unknown>; label: string } {
  const createdBy = String(createdByInput ?? "").trim().toLowerCase();
  if (!/^[a-z0-9._@-]{3,64}$/.test(createdBy)) {
    throw new PortalDbError("creator_invalid", 400, "Indica el usuario creador (3 a 64 caracteres, sin espacios).");
  }
  const like = `${createdBy.replace(/[\\%_[]/g, "\\$&")}@%`;
  return {
    label: createdBy,
    params: { creator: createdBy, creatorLike: like },
    clause: "(LOWER(r.CreatedBy) = @creator OR (CHARINDEX('@', @creator) = 0 AND LOWER(r.CreatedBy) LIKE @creatorLike ESCAPE '\\'))",
  };
}

const ACTIVE_CLAUSE = `r.Status IN (${ACTIVE_STATUSES.map((status) => `'${status}'`).join(",")})
  AND NOT (r.Status = 'BORRADOR' AND ISNULL(CAST(r.SubStatus AS nvarchar(100)), '') = 'cancelled')`;

const hintOf = (identity: unknown) => {
  const digits = String(identity ?? "").replace(/\D/g, "");
  return digits.length > 4 ? `${"•".repeat(digits.length - 4)}${digits.slice(-4)}` : "";
};
const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : value ? String(value) : null);

export async function listCancellableRequests(target: PortalDbTarget, createdByInput: unknown, open: OpenSession = openMssqlSession): Promise<{
  createdBy: string; total: number; shown: number; requests: CancellableRequest[];
}> {
  const filter = creatorFilter(createdByInput);
  const session = await open(target).catch((error) => { throw asDbError(error); });
  try {
    const result = await session.query(
      `SELECT TOP (${LIST_LIMIT + 1}) r.Id, r.Type, r.Status, CAST(r.SubStatus AS nvarchar(100)) AS SubStatus, r.CustomIdentifier,
              r.CreatedOnUtc, r.UpdatedOnUtc,
              CASE WHEN ISJSON(r.SerializedDataByType) = 1 THEN JSON_VALUE(r.SerializedDataByType, '$.model.status') END AS Stage,
              CASE WHEN ISJSON(r.SerializedDataByType) = 1 THEN JSON_VALUE(r.SerializedDataByType, '$.model.customer.personalInfo.identification') END AS Ident
         FROM dbo.Requests r
        WHERE ${filter.clause} AND ${ACTIVE_CLAUSE}
        ORDER BY r.Id DESC`,
      filter.params,
    );
    const rows = result.recordset.slice(0, LIST_LIMIT);
    return {
      createdBy: filter.label,
      total: result.recordset.length > LIST_LIMIT ? LIST_LIMIT : rows.length,
      shown: rows.length,
      requests: rows.map((row) => ({
        id: Number(row.Id), type: String(row.Type ?? ""), status: String(row.Status ?? ""), subStatus: String(row.SubStatus ?? ""),
        stage: String(row.Stage ?? ""), customIdentifier: String(row.CustomIdentifier ?? ""), identityHint: hintOf(row.Ident),
        createdOnUtc: iso(row.CreatedOnUtc), updatedOnUtc: iso(row.UpdatedOnUtc),
      })),
    };
  } catch (error) {
    throw asDbError(error);
  } finally { await session.close().catch(() => undefined); }
}

function parseIds(input: unknown): number[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_IDS) {
    throw new PortalDbError("ids_invalid", 400, `Selecciona entre 1 y ${MAX_IDS} solicitudes.`);
  }
  const ids = input.map((value) => (typeof value === "number" ? value : Number(String(value).trim())));
  if (ids.some((id) => !Number.isInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
    throw new PortalDbError("ids_invalid", 400, "Las solicitudes seleccionadas no son válidas o están repetidas.");
  }
  return ids;
}

export type CancelOptions = {
  createdBy: unknown;
  ids: unknown;
  confirmed: unknown;
  /** Everything runs, nothing is kept. */
  dryRun?: boolean;
  /** Who is cancelling (stored in UpdatedBy). */
  actor?: string;
  backupDir?: string;
  now?: () => Date;
};

export type CancelOutcome = { dryRun: boolean; requested: number; cancelled: number; backupFile: string };

export async function cancelRequestsByIds(
  target: PortalDbTarget,
  options: CancelOptions,
  open: OpenSession = openMssqlSession,
): Promise<CancelOutcome> {
  const filter = creatorFilter(options.createdBy);
  const ids = parseIds(options.ids);
  if (options.dryRun !== true && options.confirmed !== true) {
    throw new PortalDbError("confirmation_required", 400, "Confirma explícitamente la selección antes de cancelar.");
  }
  const idParams = Object.fromEntries(ids.map((id, index) => [`id${index}`, id]));
  const idList = ids.map((_, index) => `@id${index}`).join(",");
  const where = `r.Id IN (${idList}) AND ${filter.clause} AND ${ACTIVE_CLAUSE}`;
  const params = { ...filter.params, ...idParams };
  const now = options.now ?? (() => new Date());
  const actor = String(options.actor ?? "qa-lab").replace(/[^\w.@-]/g, "").slice(0, 100) || "qa-lab";

  const session = await open(target).catch((error) => { throw asDbError(error); });
  let transactionOpen = false;
  try {
    await session.begin();
    transactionOpen = true;
    // Lock and read the rows that will change: they must be exactly the selection, still active, still this creator's.
    const before = await session.query(
      `SELECT r.Id, r.Status, CAST(r.SubStatus AS nvarchar(100)) AS SubStatus, r.SerializedDataByType, r.UpdatedBy, r.UpdatedOnUtc
         FROM dbo.Requests r WITH (UPDLOCK, HOLDLOCK) WHERE ${where}`,
      params,
    );
    if (before.recordset.length !== ids.length) {
      throw new PortalDbError("selection_changed", 409,
        `${before.recordset.length} de las ${ids.length} solicitudes seleccionadas siguen activas y son de ese usuario. No se cambió nada; vuelve a buscar.`);
    }
    const stamp = now().toISOString().replace(/[:.]/g, "-");
    const backupDir = options.backupDir ?? path.join(process.cwd(), ".artifacts", "portal-db-backups");
    const backupFile = path.join(backupDir, `requests-${filter.label.replace(/[^a-z0-9._-]/g, "_")}-${stamp}.json`);
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(backupFile, JSON.stringify({ database: target.database, createdBy: filter.label, savedAt: now().toISOString(), rows: before.recordset }, null, 2));

    const updated = await session.query(cancelUpdateSql(where), { ...params, actor });
    const touched = updated.rowsAffected[0] ?? 0;
    if (touched !== ids.length) {
      throw new PortalDbError("unexpected_row_count", 409, `La base cambió ${touched} filas y se esperaban ${ids.length}. Se deshizo todo.`);
    }
    if (options.dryRun === true) {
      await session.rollback();
      transactionOpen = false;
      return { dryRun: true, requested: ids.length, cancelled: 0, backupFile };
    }
    await session.commit();
    transactionOpen = false;
    return { dryRun: false, requested: ids.length, cancelled: touched, backupFile };
  } catch (error) {
    if (transactionOpen) await session.rollback().catch(() => undefined);
    throw asDbError(error);
  } finally { await session.close().catch(() => undefined); }
}

const cancelUpdateSql = (where: string) => `UPDATE r
          SET Status = 'CANCELADO', SubStatus = 'cancelled', UpdatedBy = @actor, UpdatedOnUtc = SYSUTCDATETIME(),
              SerializedDataByType = CASE WHEN ISJSON(r.SerializedDataByType) = 1 THEN
                JSON_MODIFY(JSON_MODIFY(r.SerializedDataByType, '$.model.status', 'cancelled'), 'append $.model.statusTimeline',
                  JSON_QUERY(CONCAT('{"from":"', REPLACE(ISNULL(JSON_VALUE(r.SerializedDataByType, '$.model.status'), 'none'), '"', ''),
                    '","to":"cancelled","at":"', CONVERT(varchar(30), SYSUTCDATETIME(), 126), 'Z","reason":"CANCEL"}')))
                ELSE r.SerializedDataByType END
         FROM dbo.Requests r WHERE ${where}`;

/**
 * Cancels every active request (any creator, any type) whose customer identification is this cédula, so the cédula
 * can be handed out. Same safety as above: rows saved to a local file first, one transaction, row-count guard.
 */
export async function cancelOpenRequestsOfIdentity(
  target: PortalDbTarget,
  identityInput: unknown,
  options: { actor?: string; backupDir?: string; now?: () => Date } = {},
  open: OpenSession = openMssqlSession,
): Promise<{ cancelled: number; backupFile?: string }> {
  const identity = String(identityInput ?? "").replace(/\D/g, "");
  if (identity.length < 6 || identity.length > 20) throw new PortalDbError("identity_invalid", 400, "La cédula no es válida.");
  const now = options.now ?? (() => new Date());
  const actor = String(options.actor ?? "qa-lab").replace(/[^\w.@-]/g, "").slice(0, 100) || "qa-lab";
  const session = await open(target).catch((error) => { throw asDbError(error); });
  let transactionOpen = false;
  try {
    await session.begin();
    transactionOpen = true;
    const before = await session.query(
      `SELECT r.Id, r.Status, CAST(r.SubStatus AS nvarchar(100)) AS SubStatus, r.SerializedDataByType, r.UpdatedBy, r.UpdatedOnUtc
         FROM dbo.Requests r WITH (UPDLOCK, HOLDLOCK)
        WHERE ${ACTIVE_CLAUSE} AND ISJSON(r.SerializedDataByType) = 1
          AND REPLACE(REPLACE(JSON_VALUE(r.SerializedDataByType, '$.model.customer.personalInfo.identification'), '-', ''), ' ', '') = @identity`,
      { identity },
    );
    if (before.recordset.length === 0) {
      await session.rollback();
      transactionOpen = false;
      return { cancelled: 0 };
    }
    const ids = before.recordset.map((row) => Number(row.Id));
    const backupDir = options.backupDir ?? path.join(process.cwd(), ".artifacts", "portal-db-backups");
    const backupFile = path.join(backupDir, `requests-cedula-${now().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(backupFile, JSON.stringify({ database: target.database, savedAt: now().toISOString(), rows: before.recordset }, null, 2));
    const idParams = Object.fromEntries(ids.map((id, index) => [`id${index}`, id]));
    const updated = await session.query(
      cancelUpdateSql(`r.Id IN (${ids.map((_, index) => `@id${index}`).join(",")}) AND ${ACTIVE_CLAUSE}`),
      { ...idParams, actor },
    );
    const touched = updated.rowsAffected[0] ?? 0;
    if (touched !== ids.length) throw new PortalDbError("unexpected_row_count", 409, `La base cambió ${touched} filas y se esperaban ${ids.length}. Se deshizo todo.`);
    await session.commit();
    transactionOpen = false;
    return { cancelled: touched, backupFile };
  } catch (error) {
    if (transactionOpen) await session.rollback().catch(() => undefined);
    throw asDbError(error);
  } finally { await session.close().catch(() => undefined); }
}

/** Plugs into the cédula generator: frees a cédula by cancelling its open requests in the Portal database. */
export function createDbCedulaReleaser(target: PortalDbTarget, open: OpenSession = openMssqlSession, backupDir?: string) {
  return async (cedula: string): Promise<"released" | "already_free" | "blocked"> => {
    try {
      const { cancelled } = await cancelOpenRequestsOfIdentity(target, cedula, { backupDir }, open);
      return cancelled > 0 ? "released" : "already_free";
    } catch (error) {
      console.log(`[data-cedulas][reuse] blocked reason=db_${error instanceof PortalDbError ? error.code : "error"}`);
      return "blocked";
    }
  };
}

function asDbError(error: unknown): PortalDbError {
  if (error instanceof PortalDbError) return error;
  const code = (error as { code?: string })?.code ?? "";
  if (code === "ELOGIN") return new PortalDbError("db_login_failed", 401, "La base rechazó el usuario o la contraseña.");
  if (code === "ESOCKET" || code === "ETIMEOUT" || code === "ECONNREFUSED") return new PortalDbError("db_unreachable", 502, "No se pudo conectar con la base del Portal.");
  return new PortalDbError("db_error", 502, "La base del Portal devolvió un error.");
}

/** Server and database come from the environment (not secrets); user and password from the encrypted store. */
export function portalDbLocation(env: NodeJS.ProcessEnv = process.env): { server?: string; database?: string } {
  const server = env.PORTAL_DB_SERVER?.trim();
  const database = env.PORTAL_DB_DATABASE?.trim();
  return { ...(server ? { server } : {}), ...(database ? { database } : {}) };
}
