"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConfirmedRuntimeValues = getConfirmedRuntimeValues;
exports.persistConfirmedRuntimeValues = persistConfirmedRuntimeValues;
const sql_connection_1 = require("./sql-connection");
function normalizeKey(value) {
    return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function isSecretKey(key) {
    return /(^|[._-])(password|pass|token|otp|secret|pin)([._-]|$)/i.test(normalizeKey(key));
}
function toBoolean(value) {
    if (typeof value === "boolean")
        return value;
    if (typeof value === "number")
        return value !== 0;
    return value.trim().toLowerCase() === "true" || value.trim() === "1";
}
function valueType(value) {
    return typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string";
}
async function resolveProjectId(conn, projectSlug) {
    const rows = await conn.query("SELECT id FROM dbo.Projects WHERE slug = ?", [projectSlug]);
    if (!rows.length)
        throw new Error(`project not found: ${projectSlug}`);
    return rows[0].id;
}
function mapRow(row) {
    let value = row.value;
    if (row.valueType === "number")
        value = Number(row.value);
    if (row.valueType === "boolean")
        value = toBoolean(row.value);
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
async function getConfirmedRuntimeValues(projectId, caseId, conn) {
    const read = async (connection) => {
        // Probe metadata first so an un-migrated local database never prepares a
        // SELECT against a table that does not exist (which can block ODBC's
        // parameter analysis for a long time).
        const table = await connection.query("SELECT OBJECT_ID(N'dbo.ProjectCaseRuntimeValue', N'U') AS tableId");
        if (!table?.[0]?.tableId)
            return [];
        const rows = await connection.query(`SELECT [key], semanticType, fieldKind, datasetIdentity, contractVersion, valueType, [value], source, verified, confirmed
         FROM dbo.ProjectCaseRuntimeValue
        WHERE projectId = ? AND caseId = ? AND confirmed = 1
        ORDER BY [key]`, [projectId, caseId]);
        return (rows ?? []).filter((row) => toBoolean(row.confirmed) && row.source === "confirmed_case_runtime").map(mapRow);
    };
    try {
        return conn ? await read(conn) : await (0, sql_connection_1.withConnection)(read);
    }
    catch (error) {
        // The replay table is an additive capability. Until migration 004 is applied,
        // a local QA Lab must continue with configured/deterministic sources instead
        // of hanging or failing the autofill request.
        const candidate = error;
        const message = [
            error instanceof Error ? error.message : String(error),
            ...(Array.isArray(candidate?.odbcErrors) ? candidate.odbcErrors.map((item) => String(item?.message ?? "")) : []),
        ].join(" ");
        if (/ProjectCaseRuntimeValue|invalid object name/i.test(message))
            return [];
        throw error;
    }
}
async function persistConfirmedRuntimeValues(input) {
    const persist = async (conn) => {
        const projectId = await resolveProjectId(conn, input.projectSlug);
        let persisted = 0;
        for (const entry of input.values) {
            if (!entry || typeof entry.key !== "string" || !entry.key.trim())
                continue;
            // Passwords, OTPs, tokens and secrets are never persisted as raw runtime values.
            if (isSecretKey(entry.key))
                continue;
            if (typeof entry.value !== "string" && typeof entry.value !== "number" && typeof entry.value !== "boolean")
                continue;
            const rawValue = String(entry.value).trim();
            if (!rawValue)
                continue;
            const existing = await conn.query("SELECT [key] FROM dbo.ProjectCaseRuntimeValue WHERE projectId = ? AND caseId = ? AND [key] = ?", [projectId, input.caseId, entry.key]);
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
                await conn.query(`UPDATE dbo.ProjectCaseRuntimeValue
              SET semanticType = ?, fieldKind = ?, datasetIdentity = ?, contractVersion = ?, valueType = ?, [value] = ?, source = ?, verified = ?, confirmed = 1, updatedAt = SYSUTCDATETIME()
            WHERE projectId = ? AND caseId = ? AND [key] = ?`, params);
            }
            else {
                await conn.query(`INSERT INTO dbo.ProjectCaseRuntimeValue
             (projectId, caseId, [key], semanticType, fieldKind, datasetIdentity, contractVersion, valueType, [value], source, verified, confirmed, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, SYSUTCDATETIME(), SYSUTCDATETIME())`, [projectId, input.caseId, entry.key, ...params.slice(0, 8)]);
            }
            persisted += 1;
        }
        return persisted;
    };
    if (input.conn)
        return persist(input.conn);
    return (0, sql_connection_1.withTransaction)(persist);
}
