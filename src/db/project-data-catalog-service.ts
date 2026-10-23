import crypto from "node:crypto";
import { withConnection, withTransaction } from "./sql-connection";
import type { DbConnection } from "./db-connection";

export type ProjectDataCatalogOption = {
  id: string;
  label: string;
  value: string;
  active: boolean;
  position: number;
};

export type ProjectDataCatalog = {
  id: string;
  projectSlug: string;
  name: string;
  fieldName: string;
  aliases: string[];
  active: boolean;
  revision: number;
  options: ProjectDataCatalogOption[];
};

export type ProjectDataCatalogInput = {
  name: string;
  fieldName: string;
  aliases?: string[];
  active?: boolean;
  options: Array<Partial<ProjectDataCatalogOption> & Pick<ProjectDataCatalogOption, "label" | "value">>;
};

export class ProjectDataCatalogError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
    this.name = "ProjectDataCatalogError";
  }
}

export function normalizeCatalogField(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[\\_-]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function resolveProjectDataCatalogMatches(
  field: string,
  catalogs: ProjectDataCatalog[],
): ProjectDataCatalog[] {
  const normalized = normalizeCatalogField(field);
  if (!normalized) return [];
  return catalogs.filter((catalog) => catalog.active && [catalog.fieldName, ...catalog.aliases]
    .some((candidate) => normalizeCatalogField(candidate) === normalized));
}

function activeFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function parseAliases(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function validateInput(input: ProjectDataCatalogInput): ProjectDataCatalogInput {
  const name = String(input?.name ?? "").trim();
  const fieldName = String(input?.fieldName ?? "").trim();
  if (!name) throw new ProjectDataCatalogError("catalog_name_required", "El nombre del catálogo es obligatorio.");
  if (!fieldName) throw new ProjectDataCatalogError("catalog_field_required", "El campo asociado es obligatorio.");
  if (!Array.isArray(input?.options)) throw new ProjectDataCatalogError("catalog_options_invalid", "Las opciones deben ser una lista.");
  const aliases = [...new Set((input.aliases ?? []).map((alias) => String(alias).trim()).filter(Boolean))];
  const seen = new Set<string>();
  const options = input.options.map((option, position) => {
    const label = String(option.label ?? "").trim();
    const value = String(option.value ?? "").trim();
    if (!label || !value) throw new ProjectDataCatalogError("catalog_option_required", "Cada opción requiere etiqueta y valor.");
    const active = option.active !== false;
    if (active && seen.has(value)) throw new ProjectDataCatalogError("catalog_option_duplicate", "El catálogo no puede repetir valores activos.");
    if (active) seen.add(value);
    return { ...option, label, value, active, position };
  });
  return { ...input, name, fieldName, aliases, active: input.active !== false, options };
}

type CatalogRow = { id: string; projectId: string; name: string; fieldName: string; aliasesJson: unknown; active: unknown; revision: unknown };
type OptionRow = { id: string; catalogId: string; label: string; value: string; active: unknown; position: unknown };

async function projectIdForSlug(conn: DbConnection, projectSlug: string): Promise<string> {
  const rows = await conn.query<{ id: string }>("SELECT id FROM dbo.Projects WHERE slug = ?", [projectSlug]);
  if (!rows[0]) throw new ProjectDataCatalogError("project_not_found", "No se encontró el proyecto.", 404);
  return rows[0].id;
}

async function mapCatalogs(conn: DbConnection, projectSlug: string, rows: CatalogRow[]): Promise<ProjectDataCatalog[]> {
  const result: ProjectDataCatalog[] = [];
  for (const row of rows) {
    const options = await conn.query<OptionRow>(
      `SELECT id, catalogId, label, [value], active, position
       FROM dbo.ProjectDataCatalogOption WHERE catalogId = ? ORDER BY position, id`,
      [row.id],
    );
    result.push({
      id: row.id,
      projectSlug,
      name: row.name,
      fieldName: row.fieldName,
      aliases: parseAliases(row.aliasesJson),
      active: activeFlag(row.active),
      revision: Number(row.revision) || 1,
      options: options.map((option) => ({
        id: option.id,
        label: option.label,
        value: option.value,
        active: activeFlag(option.active),
        position: Number(option.position) || 0,
      })),
    });
  }
  return result;
}

export async function listProjectDataCatalogs(projectSlug: string, includeInactive = true): Promise<ProjectDataCatalog[]> {
  return withConnection(async (conn) => {
    const projectId = await projectIdForSlug(conn, projectSlug);
    const rows = await conn.query<CatalogRow>(
      `SELECT id, projectId, name, fieldName, aliasesJson, active, revision
       FROM dbo.ProjectDataCatalog WHERE projectId = ? ${includeInactive ? "" : "AND active = 1"}
       ORDER BY name, id`,
      [projectId],
    );
    return mapCatalogs(conn, projectSlug, rows);
  });
}

export async function createProjectDataCatalog(projectSlug: string, input: ProjectDataCatalogInput): Promise<ProjectDataCatalog> {
  const value = validateInput(input);
  return withTransaction(async (conn) => {
    const projectId = await projectIdForSlug(conn, projectSlug);
    const id = crypto.randomUUID();
    await conn.query(
      `INSERT INTO dbo.ProjectDataCatalog (id, projectId, name, fieldName, aliasesJson, active, revision)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [id, projectId, value.name, value.fieldName, JSON.stringify(value.aliases), value.active ? 1 : 0],
    );
    for (const option of value.options) {
      await conn.query(
        `INSERT INTO dbo.ProjectDataCatalogOption (id, catalogId, label, [value], active, position)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), id, option.label, option.value, option.active ? 1 : 0, option.position],
      );
    }
    const rows = await conn.query<CatalogRow>(
      `SELECT id, projectId, name, fieldName, aliasesJson, active, revision FROM dbo.ProjectDataCatalog WHERE id = ? AND projectId = ?`,
      [id, projectId],
    );
    return (await mapCatalogs(conn, projectSlug, rows))[0];
  });
}

export async function updateProjectDataCatalog(
  projectSlug: string,
  catalogId: string,
  input: ProjectDataCatalogInput,
): Promise<ProjectDataCatalog> {
  const value = validateInput(input);
  return withTransaction(async (conn) => {
    const projectId = await projectIdForSlug(conn, projectSlug);
    const rows = await conn.query<CatalogRow>(
      `SELECT id, projectId, name, fieldName, aliasesJson, active, revision
       FROM dbo.ProjectDataCatalog WHERE id = ? AND projectId = ?`,
      [catalogId, projectId],
    );
    const existing = rows[0];
    if (!existing) throw new ProjectDataCatalogError("catalog_not_found", "No se encontró el catálogo en este proyecto.", 404);
    const priorOptions = await conn.query<{ id: string }>(
      "SELECT id FROM dbo.ProjectDataCatalogOption WHERE catalogId = ?",
      [catalogId],
    );
    const validOptionIds = new Set(priorOptions.map((option) => option.id.toLowerCase()));
    for (const option of value.options) {
      if (option.id && !validOptionIds.has(option.id.toLowerCase())) {
        throw new ProjectDataCatalogError("catalog_option_project_mismatch", "Una opción no pertenece a este catálogo.");
      }
    }
    await conn.query(
      `UPDATE dbo.ProjectDataCatalog SET name = ?, fieldName = ?, aliasesJson = ?, active = ?, revision = ?, updatedAt = SYSUTCDATETIME()
       WHERE id = ? AND projectId = ?`,
      [value.name, value.fieldName, JSON.stringify(value.aliases), value.active ? 1 : 0, Number(existing.revision) + 1, catalogId, projectId],
    );
    const retainedIds: string[] = [];
    for (const option of value.options) {
      const optionId = option.id || crypto.randomUUID();
      retainedIds.push(optionId);
      if (option.id) {
        await conn.query(
          `UPDATE dbo.ProjectDataCatalogOption SET label = ?, [value] = ?, active = ?, position = ?, updatedAt = SYSUTCDATETIME()
           WHERE id = ? AND catalogId = ?`,
          [option.label, option.value, option.active ? 1 : 0, option.position, optionId, catalogId],
        );
      } else {
        await conn.query(
          `INSERT INTO dbo.ProjectDataCatalogOption (id, catalogId, label, [value], active, position)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [optionId, catalogId, option.label, option.value, option.active ? 1 : 0, option.position],
        );
      }
    }
    if (retainedIds.length) {
      const placeholders = retainedIds.map(() => "?").join(",");
      await conn.query(
        `UPDATE dbo.ProjectDataCatalogOption SET active = 0, updatedAt = SYSUTCDATETIME()
         WHERE catalogId = ? AND id NOT IN (${placeholders})`,
        [catalogId, ...retainedIds],
      );
    } else {
      await conn.query("UPDATE dbo.ProjectDataCatalogOption SET active = 0, updatedAt = SYSUTCDATETIME() WHERE catalogId = ?", [catalogId]);
    }
    const updated = await conn.query<CatalogRow>(
      `SELECT id, projectId, name, fieldName, aliasesJson, active, revision FROM dbo.ProjectDataCatalog WHERE id = ? AND projectId = ?`,
      [catalogId, projectId],
    );
    return (await mapCatalogs(conn, projectSlug, updated))[0];
  });
}

export async function setProjectDataCatalogOptionActive(
  projectSlug: string,
  catalogId: string,
  optionId: string,
  active: boolean,
): Promise<ProjectDataCatalog> {
  const catalog = await withTransaction(async (conn) => {
    const projectId = await projectIdForSlug(conn, projectSlug);
    const rows = await conn.query<{ id: string; revision: number }>(
      "SELECT id, revision FROM dbo.ProjectDataCatalog WHERE id = ? AND projectId = ?",
      [catalogId, projectId],
    );
    if (!rows[0]) throw new ProjectDataCatalogError("catalog_not_found", "No se encontró el catálogo en este proyecto.", 404);
    const option = await conn.query<{ id: string }>(
      "SELECT id FROM dbo.ProjectDataCatalogOption WHERE id = ? AND catalogId = ?",
      [optionId, catalogId],
    );
    if (!option[0]) throw new ProjectDataCatalogError("catalog_option_not_found", "No se encontró la opción en este catálogo.", 404);
    await conn.query("UPDATE dbo.ProjectDataCatalogOption SET active = ?, updatedAt = SYSUTCDATETIME() WHERE id = ? AND catalogId = ?", [active ? 1 : 0, optionId, catalogId]);
    await conn.query("UPDATE dbo.ProjectDataCatalog SET revision = revision + 1, updatedAt = SYSUTCDATETIME() WHERE id = ?", [catalogId]);
    return true;
  });
  void catalog;
  const list = await listProjectDataCatalogs(projectSlug);
  const result = list.find((item) => item.id.toLowerCase() === catalogId.toLowerCase());
  if (!result) throw new ProjectDataCatalogError("catalog_not_found", "No se encontró el catálogo en este proyecto.", 404);
  return result;
}
