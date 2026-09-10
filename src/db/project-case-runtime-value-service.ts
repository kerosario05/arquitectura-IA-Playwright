import type { Connection } from "odbc";
import { withConnection, withTransaction } from "./sql-connection";

export type ConfirmedRuntimeValue = {
  key: string;
  value: string | number | boolean;
  semanticType?: string;
  fieldKind?: string;
  datasetIdentity?: string;
  contractVersion?: string;
  verified?: boolean;
};

export type PersistedConfirmedRuntimeValue = ConfirmedRuntimeValue & {
  source: "confirmed_case_runtime";
  verified: boolean;
};

type RuntimeValueRow = {
  key: string;
  semanticType: string | null;
  fieldKind: string | null;
  datasetIdentity: string | null;
  contractVersion: string | null;
  valueType: string;
  value: string;
  source: string;
  verified: boolean | number | string;
  confirmed: boolean | number | string;
};

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function isSecretKey(key: string): boolean {
  return /(^|[._-])(password|pass|token|otp|secret|pin)([._-]|$)/i.test(normalizeKey(key));
}

function toBoolean(value: boolean | number | string): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return value.trim().toLowerCase() === "true" || value.trim() === "1";
}

function valueType(value: string | number | boolean): string {
  return typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string";
}

async function resolveProjectId(conn: Connection, projectSlug: string): Promise<string> {
  const rows = await conn.query<{ id: string }>("SELECT id FROM dbo.Projects WHERE slug = ?", [projectSlug]);
  if (!rows.length) throw new Error(`project not found: ${projectSlug}`);
  return rows[0].id;
}

function mapRow(row: RuntimeValueRow): PersistedConfirmedRuntimeValue {
  let value: string | number | boolean = row.value;
  if (row.valueType === "number") value = Number(row.value);
  if (row.valueType === "boolean") value = toBoolean(row.value);
  return {
    key: row.key,
    value,
    ...(row.semanticType ? { semanticType: row.semanticType } : {}),
    ...(row.fieldKind ? { fieldKind: row.fieldKind } : {}),
    ...(row.datasetIdentity ? { datasetIdentity: row.datasetIdentity } : {}),
    ...(row.contractVersion ? { contractVersion: row.contractVersion } : {}),
    source: "confirmed_case_runtime",
    verified: toBoolean(row.verified),
  };
}

export async function getConfirmedRuntimeValues(
  projectId: string,
  caseId: number,
  conn?: Connection,
): Promise<PersistedConfirmedRuntimeValue[]> {
  const read = async (connection: Connection): Promise<PersistedConfirmedRuntimeValue[]> => {
    // Probe metadata first so an un-migrated local database never prepares a
    // SELECT against a table that does not exist (which can block ODBC's
    // parameter analysis for a long time).
    const table = await connection.query<{ tableId: number | null }>(
      "SELECT OBJECT_ID(N'dbo.ProjectCaseRuntimeValue', N'U') AS tableId",
    );
    if (!table?.[0]?.tableId) return [];
    const rows = await connection.query<RuntimeValueRow>(
      `SELECT [key], semanticType, fieldKind, datasetIdentity, contractVersion, valueType, [value], source, verified, confirmed
         FROM dbo.ProjectCaseRuntimeValue
        WHERE projectId = ? AND caseId = ? AND confirmed = 1
        ORDER BY [key]`,
      [projectId, caseId],
    );
    return (rows ?? []).filter((row) => toBoolean(row.confirmed) && row.source === "confirmed_case_runtime").map(mapRow);
  };
  try {
    return conn ? await read(conn) : await withConnection(read);
  } catch (error) {
    // The replay table is an additive capability. Until migration 004 is applied,
    // a local QA Lab must continue with configured/deterministic sources instead
    // of hanging or failing the autofill request.
    const candidate = error as { message?: unknown; odbcErrors?: Array<{ message?: unknown }> };
    const message = [
      error instanceof Error ? error.message : String(error),
      ...(Array.isArray(candidate?.odbcErrors) ? candidate.odbcErrors.map((item) => String(item?.message ?? "")) : []),
    ].join(" ");
    if (/ProjectCaseRuntimeValue|invalid object name/i.test(message)) return [];
    throw error;
  }
}

export async function persistConfirmedRuntimeValues(input: {
  projectSlug: string;
  caseId: number;
  values: readonly ConfirmedRuntimeValue[];
  conn?: Connection;
}): Promise<number> {
  const persist = async (conn: Connection): Promise<number> => {
    const projectId = await resolveProjectId(conn, input.projectSlug);
    let persisted = 0;
    for (const entry of input.values) {
      if (!entry || typeof entry.key !== "string" || !entry.key.trim()) continue;
      // Passwords, OTPs, tokens and secrets are never persisted as raw runtime values.
      if (isSecretKey(entry.key)) continue;
      if (typeof entry.value !== "string" && typeof entry.value !== "number" && typeof entry.value !== "boolean") continue;
      const rawValue = String(entry.value).trim();
      if (!rawValue) continue;
      const existing = await conn.query<{ key: string }>(
        "SELECT [key] FROM dbo.ProjectCaseRuntimeValue WHERE projectId = ? AND caseId = ? AND [key] = ?",
        [projectId, input.caseId, entry.key],
      );
      const params = [
        entry.semanticType ?? null,
        entry.fieldKind ?? null,
        entry.datasetIdentity ?? null,
        entry.contractVersion ?? null,
        valueType(entry.value),
        rawValue,
        "confirmed_case_runtime",
        entry.verified === true ? 1 : 0,
        projectId,
        input.caseId,
        entry.key,
      ];
      if (existing.length) {
        await conn.query(
          `UPDATE dbo.ProjectCaseRuntimeValue
              SET semanticType = ?, fieldKind = ?, datasetIdentity = ?, contractVersion = ?, valueType = ?, [value] = ?, source = ?, verified = ?, confirmed = 1, updatedAt = SYSUTCDATETIME()
            WHERE projectId = ? AND caseId = ? AND [key] = ?`,
          params,
        );
      } else {
        await conn.query(
          `INSERT INTO dbo.ProjectCaseRuntimeValue
             (projectId, caseId, [key], semanticType, fieldKind, datasetIdentity, contractVersion, valueType, [value], source, verified, confirmed, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, SYSUTCDATETIME(), SYSUTCDATETIME())`,
          [projectId, input.caseId, entry.key, ...params.slice(0, 8)],
        );
      }
      persisted += 1;
    }
    return persisted;
  };
  if (input.conn) return persist(input.conn);
  return withTransaction(persist);
}
