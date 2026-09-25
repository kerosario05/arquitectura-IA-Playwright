"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeInputRequirements = normalizeInputRequirements;
exports.getByProjectAndCase = getByProjectAndCase;
exports.getByProjectIdAndCase = getByProjectIdAndCase;
exports.replaceForProjectAndCase = replaceForProjectAndCase;
const sql_connection_1 = require("./sql-connection");
const project_generation_config_1 = require("../data/project-generation-config");
const generation_profile_1 = require("../testrail/generation-profile");
function normalizeKey(key) {
    return key
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}
function normalizeInputRequirements(requirements) {
    const seen = new Set();
    const result = [];
    for (const req of requirements) {
        if (!req || typeof req.key !== "string" || req.key.trim() === "") {
            throw new Error("input requirement key cannot be empty");
        }
        const normalized = normalizeKey(req.key);
        if (seen.has(normalized))
            continue;
        seen.add(normalized);
        const entry = { key: req.key.trim() };
        if (typeof req.label === "string")
            entry.label = req.label;
        if (typeof req.displayLabel === "string")
            entry.displayLabel = req.displayLabel;
        if (typeof req.technicalLabel === "string")
            entry.technicalLabel = req.technicalLabel;
        if (typeof req.semanticField === "string")
            entry.semanticField = req.semanticField;
        if (typeof req.entityDisplayName === "string")
            entry.entityDisplayName = req.entityDisplayName;
        if (typeof req.controlType === "string")
            entry.controlType = req.controlType;
        if (typeof req.required === "boolean")
            entry.required = req.required;
        if (typeof req.sensitive === "boolean")
            entry.sensitive = req.sensitive;
        if (typeof req.datasetIdentity === "string")
            entry.datasetIdentity = req.datasetIdentity;
        if (typeof req.datasetOrdinal === "number")
            entry.datasetOrdinal = req.datasetOrdinal;
        if (typeof req.value === "string" || typeof req.value === "number" || typeof req.value === "boolean")
            entry.value = req.value;
        if (typeof req.source === "string")
            entry.source = req.source;
        if (typeof req.generated === "boolean")
            entry.generated = req.generated;
        if (typeof req.verified === "boolean")
            entry.verified = req.verified;
        if (typeof req.editable === "boolean")
            entry.editable = req.editable;
        if (Array.isArray(req.allowedValues)) {
            entry.allowedValues = req.allowedValues.map((value) => String(value));
        }
        if (Object.prototype.hasOwnProperty.call(req, "namedProfileRef")) {
            entry.namedProfileRef = typeof req.namedProfileRef === "string" && req.namedProfileRef.trim() ? req.namedProfileRef.trim() : null;
        }
        result.push(entry);
    }
    return result;
}
function toBoolean(value) {
    if (typeof value === "boolean")
        return value;
    if (typeof value === "number")
        return value !== 0;
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "1" || normalized === "true")
            return true;
        if (normalized === "0" || normalized === "false")
            return false;
    }
    return undefined;
}
function mapRow(row) {
    const entry = { key: row.key };
    if (row.label != null)
        entry.label = row.label;
    if (row.controlType != null)
        entry.controlType = row.controlType;
    const required = toBoolean(row.required);
    if (required !== undefined)
        entry.required = required;
    const sensitive = toBoolean(row.sensitive);
    if (sensitive !== undefined)
        entry.sensitive = sensitive;
    if (row.allowedValues) {
        try {
            const parsed = JSON.parse(row.allowedValues);
            if (Array.isArray(parsed))
                entry.allowedValues = parsed.map((value) => String(value));
        }
        catch {
            // malformed persisted JSON → treat as absent
        }
    }
    entry.namedProfileRef = row.namedProfileRef?.trim() || null;
    return entry;
}
async function resolveProjectId(conn, projectSlug) {
    const rows = await conn.query("SELECT id FROM dbo.Projects WHERE slug = ?", [projectSlug]);
    if (!rows || rows.length === 0) {
        throw new Error(`project not found: ${projectSlug}`);
    }
    return rows[0].id;
}
function profileCapability(profile) {
    if (profile.valueKind === "number")
        return { kind: "number" };
    if (profile.valueKind === "date")
        return { kind: "date" };
    if (profile.valueKind === "datetime")
        return { kind: "datetime" };
    return { kind: "text" };
}
async function validateNamedProfileReference(conn, projectId, ref) {
    const rows = await conn.query("SELECT version, configJson FROM dbo.ProjectGenerationConfig WHERE projectId = ?", [projectId]);
    if (rows.length === 0)
        return;
    let parsed;
    try {
        parsed = JSON.parse(rows[0].configJson);
    }
    catch {
        throw new Error("stored project generation config JSON is corrupt");
    }
    const configValidation = (0, project_generation_config_1.validateProjectGenerationConfig)(parsed);
    if (!configValidation.valid)
        throw new Error("stored project generation config is invalid");
    const config = parsed;
    const profile = config.namedProfiles?.[ref];
    if (!profile || !(0, generation_profile_1.validateGenerationProfile)({ fieldCapability: profileCapability(profile), generationProfile: profile }).valid) {
        const error = new Error("named profile reference is not configured for this project");
        error.code = "named_profile_reference_not_configured";
        throw error;
    }
}
async function runReplace(conn, projectSlug, caseId, requirements) {
    const projectId = await resolveProjectId(conn, projectSlug);
    for (const req of requirements) {
        if (req.namedProfileRef)
            await validateNamedProfileReference(conn, projectId, req.namedProfileRef);
    }
    const existingRows = await conn.query(`SELECT [key], label, controlType, required, sensitive, namedProfileRef, allowedValues
       FROM dbo.ProjectCaseInputRequirement
      WHERE projectId = ? AND caseId = ?`, [projectId, caseId]);
    const incomingKeys = new Set(requirements.map((req) => req.key));
    for (const existing of existingRows) {
        if (!incomingKeys.has(existing.key)) {
            await conn.query("DELETE FROM dbo.ProjectCaseInputRequirement WHERE projectId = ? AND caseId = ? AND [key] = ?", [
                projectId,
                caseId,
                existing.key,
            ]);
        }
    }
    for (const req of requirements) {
        const existing = existingRows.find((row) => row.key === req.key);
        const parserParams = [
            req.label ?? null,
            req.controlType ?? null,
            req.required === true ? 1 : 0,
            req.sensitive === true ? 1 : 0,
            req.allowedValues ? JSON.stringify(req.allowedValues) : null,
        ];
        if (existing) {
            const namedProfileClause = Object.prototype.hasOwnProperty.call(req, "namedProfileRef") ? ", namedProfileRef = ?" : "";
            await conn.query(`UPDATE dbo.ProjectCaseInputRequirement
            SET label = ?, controlType = ?, required = ?, sensitive = ?, allowedValues = ?${namedProfileClause}, updatedAt = SYSUTCDATETIME()
          WHERE projectId = ? AND caseId = ? AND [key] = ?`, [...parserParams, ...(Object.prototype.hasOwnProperty.call(req, "namedProfileRef") ? [req.namedProfileRef ?? null] : []), projectId, caseId, req.key]);
        }
        else {
            await conn.query(`INSERT INTO dbo.ProjectCaseInputRequirement
           (projectId, caseId, [key], label, controlType, required, sensitive, allowedValues, namedProfileRef, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, SYSUTCDATETIME(), SYSUTCDATETIME())`, [
                projectId,
                caseId,
                req.key,
                req.label ?? null,
                req.controlType ?? null,
                req.required === true ? 1 : 0,
                req.sensitive === true ? 1 : 0,
                req.allowedValues ? JSON.stringify(req.allowedValues) : null,
                req.namedProfileRef ?? null,
            ]);
        }
    }
}
async function getByProjectAndCase(projectSlug, caseId, conn) {
    const read = async (c) => {
        const projectId = await resolveProjectId(c, projectSlug);
        const rows = await c.query(`SELECT [key], label, controlType, required, sensitive, namedProfileRef, allowedValues
       FROM dbo.ProjectCaseInputRequirement
       WHERE projectId = ? AND caseId = ?
       ORDER BY [key]`, [projectId, caseId]);
        return (rows ?? []).map(mapRow);
    };
    return conn ? read(conn) : (0, sql_connection_1.withConnection)(read);
}
async function getByProjectIdAndCase(projectId, caseId, conn) {
    const read = async (c) => {
        const rows = await c.query(`SELECT [key], label, controlType, required, sensitive, namedProfileRef, allowedValues
       FROM dbo.ProjectCaseInputRequirement
       WHERE projectId = ? AND caseId = ?
       ORDER BY [key]`, [projectId, caseId]);
        return (rows ?? []).map(mapRow);
    };
    return conn ? read(conn) : (0, sql_connection_1.withConnection)(read);
}
async function replaceForProjectAndCase(projectSlug, caseId, requirements, conn) {
    const normalized = normalizeInputRequirements(requirements);
    if (conn) {
        await conn.beginTransaction();
        try {
            await runReplace(conn, projectSlug, caseId, normalized);
            await conn.commit();
        }
        catch (err) {
            try {
                await conn.rollback();
            }
            catch {
                // original error propagates
            }
            throw err;
        }
        return;
    }
    await (0, sql_connection_1.withTransaction)(async (c) => runReplace(c, projectSlug, caseId, normalized));
}
