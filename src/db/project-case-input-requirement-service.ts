import type { Connection } from "odbc";
import { withConnection, withTransaction } from "./sql-connection";
import { validateProjectGenerationConfig, type ProjectGenerationConfig } from "../data/project-generation-config";
import { validateGenerationProfile, type GenerationProfile } from "../testrail/generation-profile";

export type InputRequirement = {
  key: string;
  label?: string;
  displayLabel?: string;
  technicalLabel?: string;
  semanticField?: string;
  entityDisplayName?: string;
  controlType?: string;
  required?: boolean;
  sensitive?: boolean;
  allowedValues?: string[];
  semanticType?: string;
  datasetIdentity?: string;
  datasetOrdinal?: number;
  value?: string | number | boolean;
  source?: string;
  generated?: boolean;
  verified?: boolean;
  editable?: boolean;
  namedProfileRef?: string | null;
  /** Non-persisted lineage used by the runtime contract/UI when available. */
  inputUsage?: Array<'action' | 'assertion' | 'expected' | string>;
  valueRole?: 'runtime_input' | 'expected_oracle' | 'runtime_derived_oracle' | string;
  oracleSource?: string;
  dependsOn?: string[];
};

type RequirementRow = {
  key: string;
  label: string | null;
  controlType: string | null;
  required: boolean | number | string;
  sensitive: boolean | number | string;
  allowedValues: string | null;
  namedProfileRef: string | null;
};

function normalizeKey(key: string): string {
  return key
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function normalizeInputRequirements(requirements: InputRequirement[]): InputRequirement[] {
  const seen = new Set<string>();
  const result: InputRequirement[] = [];
  for (const req of requirements) {
    if (!req || typeof req.key !== "string" || req.key.trim() === "") {
      throw new Error("input requirement key cannot be empty");
    }
    const normalized = normalizeKey(req.key);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const entry: InputRequirement = { key: req.key.trim() };
    if (typeof req.label === "string") entry.label = req.label;
    if (typeof req.displayLabel === "string") entry.displayLabel = req.displayLabel;
    if (typeof req.technicalLabel === "string") entry.technicalLabel = req.technicalLabel;
    if (typeof req.semanticField === "string") entry.semanticField = req.semanticField;
    if (typeof req.entityDisplayName === "string") entry.entityDisplayName = req.entityDisplayName;
    if (typeof req.controlType === "string") entry.controlType = req.controlType;
    if (typeof req.required === "boolean") entry.required = req.required;
    if (typeof req.sensitive === "boolean") entry.sensitive = req.sensitive;
    if (typeof req.datasetIdentity === "string") entry.datasetIdentity = req.datasetIdentity;
    if (typeof req.datasetOrdinal === "number") entry.datasetOrdinal = req.datasetOrdinal;
    if (typeof req.value === "string" || typeof req.value === "number" || typeof req.value === "boolean") entry.value = req.value;
    if (typeof req.source === "string") entry.source = req.source;
    if (typeof req.generated === "boolean") entry.generated = req.generated;
    if (typeof req.verified === "boolean") entry.verified = req.verified;
    if (typeof req.editable === "boolean") entry.editable = req.editable;
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

function toBoolean(value: boolean | number | string | undefined): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "1" || normalized === "true") return true;
    if (normalized === "0" || normalized === "false") return false;
  }
  return undefined;
}

function mapRow(row: RequirementRow): InputRequirement {
  const entry: InputRequirement = { key: row.key };
  if (row.label != null) entry.label = row.label;
  if (row.controlType != null) entry.controlType = row.controlType;
  const required = toBoolean(row.required);
  if (required !== undefined) entry.required = required;
  const sensitive = toBoolean(row.sensitive);
  if (sensitive !== undefined) entry.sensitive = sensitive;
  if (row.allowedValues) {
    try {
      const parsed = JSON.parse(row.allowedValues);
      if (Array.isArray(parsed)) entry.allowedValues = parsed.map((value) => String(value));
    } catch {
      // malformed persisted JSON → treat as absent
    }
  }
  entry.namedProfileRef = row.namedProfileRef?.trim() || null;
  return entry;
}

async function resolveProjectId(conn: Connection, projectSlug: string): Promise<string> {
  const rows = await conn.query<{ id: string }>("SELECT id FROM dbo.Projects WHERE slug = ?", [projectSlug]);
  if (!rows || rows.length === 0) {
    throw new Error(`project not found: ${projectSlug}`);
  }
  return rows[0].id;
}

function profileCapability(profile: GenerationProfile): { kind: "number" | "date" | "datetime" | "text" } {
  if (profile.valueKind === "number") return { kind: "number" };
  if (profile.valueKind === "date") return { kind: "date" };
  if (profile.valueKind === "datetime") return { kind: "datetime" };
  return { kind: "text" };
}

async function validateNamedProfileReference(conn: Connection, projectId: string, ref: string): Promise<void> {
  const rows = await conn.query<{ version: string; configJson: string }>(
    "SELECT version, configJson FROM dbo.ProjectGenerationConfig WHERE projectId = ?", [projectId],
  );
  if (rows.length === 0) return;
  let parsed: unknown;
  try { parsed = JSON.parse(rows[0].configJson); } catch { throw new Error("stored project generation config JSON is corrupt"); }
  const configValidation = validateProjectGenerationConfig(parsed);
  if (!configValidation.valid) throw new Error("stored project generation config is invalid");
  const config = parsed as ProjectGenerationConfig;
  const profile = config.namedProfiles?.[ref];
  if (!profile || !validateGenerationProfile({ fieldCapability: profileCapability(profile), generationProfile: profile }).valid) {
    const error = new Error("named profile reference is not configured for this project") as Error & { code?: string };
    error.code = "named_profile_reference_not_configured";
    throw error;
  }
}

async function runReplace(
  conn: Connection,
  projectSlug: string,
  caseId: number,
  requirements: InputRequirement[],
): Promise<void> {
  const projectId = await resolveProjectId(conn, projectSlug);
  for (const req of requirements) {
    if (req.namedProfileRef) await validateNamedProfileReference(conn, projectId, req.namedProfileRef);
  }
  const existingRows = await conn.query<RequirementRow>(
    `SELECT [key], label, controlType, required, sensitive, namedProfileRef, allowedValues
       FROM dbo.ProjectCaseInputRequirement
      WHERE projectId = ? AND caseId = ?`,
    [projectId, caseId],
  );
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
    const parserParams: unknown[] = [
      req.label ?? null,
      req.controlType ?? null,
      req.required === true ? 1 : 0,
      req.sensitive === true ? 1 : 0,
      req.allowedValues ? JSON.stringify(req.allowedValues) : null,
    ];
    if (existing) {
      const namedProfileClause = Object.prototype.hasOwnProperty.call(req, "namedProfileRef") ? ", namedProfileRef = ?" : "";
      await (conn.query as any)(
        `UPDATE dbo.ProjectCaseInputRequirement
            SET label = ?, controlType = ?, required = ?, sensitive = ?, allowedValues = ?${namedProfileClause}, updatedAt = SYSUTCDATETIME()
          WHERE projectId = ? AND caseId = ? AND [key] = ?`,
        [...parserParams, ...(Object.prototype.hasOwnProperty.call(req, "namedProfileRef") ? [req.namedProfileRef ?? null] : []), projectId, caseId, req.key] as unknown[],
      );
    } else {
      await (conn.query as any)(
        `INSERT INTO dbo.ProjectCaseInputRequirement
           (projectId, caseId, [key], label, controlType, required, sensitive, allowedValues, namedProfileRef, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, SYSUTCDATETIME(), SYSUTCDATETIME())`,
        [
          projectId,
          caseId,
          req.key,
          req.label ?? null,
          req.controlType ?? null,
          req.required === true ? 1 : 0,
          req.sensitive === true ? 1 : 0,
          req.allowedValues ? JSON.stringify(req.allowedValues) : null,
          req.namedProfileRef ?? null,
        ] as unknown[],
      );
    }
  }
}

export async function getByProjectAndCase(
  projectSlug: string,
  caseId: number,
  conn?: Connection,
): Promise<InputRequirement[]> {
  const read = async (c: Connection): Promise<InputRequirement[]> => {
    const projectId = await resolveProjectId(c, projectSlug);
    const rows = await c.query<RequirementRow>(
       `SELECT [key], label, controlType, required, sensitive, namedProfileRef, allowedValues
       FROM dbo.ProjectCaseInputRequirement
       WHERE projectId = ? AND caseId = ?
       ORDER BY [key]`,
      [projectId, caseId],
    );
    return (rows ?? []).map(mapRow);
  };
  return conn ? read(conn) : withConnection(read);
}

export async function getByProjectIdAndCase(
  projectId: string,
  caseId: number,
  conn?: Connection,
): Promise<InputRequirement[]> {
  const read = async (c: Connection): Promise<InputRequirement[]> => {
    const rows = await c.query<RequirementRow>(
      `SELECT [key], label, controlType, required, sensitive, namedProfileRef, allowedValues
       FROM dbo.ProjectCaseInputRequirement
       WHERE projectId = ? AND caseId = ?
       ORDER BY [key]`,
      [projectId, caseId],
    );
    return (rows ?? []).map(mapRow);
  };
  return conn ? read(conn) : withConnection(read);
}

export async function replaceForProjectAndCase(
  projectSlug: string,
  caseId: number,
  requirements: InputRequirement[],
  conn?: Connection,
): Promise<void> {
  const normalized = normalizeInputRequirements(requirements);
  if (conn) {
    await conn.beginTransaction();
    try {
      await runReplace(conn, projectSlug, caseId, normalized);
      await conn.commit();
    } catch (err) {
      try {
        await conn.rollback();
      } catch {
        // original error propagates
      }
      throw err;
    }
    return;
  }
  await withTransaction(async (c) => runReplace(c, projectSlug, caseId, normalized));
}
