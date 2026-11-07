import { withConnection, withTransaction } from "./sql-connection";
import type { DbConnection } from "./db-connection";
import { normalizeRepositoryConfig, type RepositoryConfig } from "../test-planning/repository-config";

type ConnectionLike = Pick<DbConnection, "query">;

export interface ProjectRepositoryConfig extends RepositoryConfig {
  projectId: string;
  projectSlug: string;
  updatedAt: string | null;
}

interface Row {
  projectId: string;
  projectSlug: string;
  repoUrl: string;
  defaultBranch: string;
  specsPath: string;
  filePattern: string;
  protectedBranchesJson: string | null;
  credentialSecretRef: string | null;
  enabled: boolean | number | string;
  updatedAt: string | Date | null;
}

const SELECT = `SELECT r.projectId, p.slug AS projectSlug, r.repoUrl, r.defaultBranch, r.specsPath, r.filePattern,
       r.protectedBranchesJson, r.credentialSecretRef, r.enabled, r.updatedAt
  FROM dbo.ProjectRepositoryConfiguration r
  JOIN dbo.Projects p ON p.id = r.projectId`;

function parseList(json: string | null): string[] {
  try {
    const parsed = JSON.parse(json ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function toConfig(row: Row): ProjectRepositoryConfig {
  return {
    projectId: String(row.projectId).toUpperCase(),
    projectSlug: row.projectSlug,
    repoUrl: row.repoUrl,
    defaultBranch: row.defaultBranch,
    specsPath: row.specsPath,
    filePattern: row.filePattern,
    protectedBranches: parseList(row.protectedBranchesJson),
    credentialSecretRef: row.credentialSecretRef || null,
    enabled: row.enabled === true || row.enabled === 1 || row.enabled === "1",
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  };
}

export async function getRepositoryConfigBySlug(
  slug: string,
  conn?: ConnectionLike,
): Promise<ProjectRepositoryConfig | null> {
  const run = async (c: ConnectionLike) => {
    const rows = await c.query<Row>(`${SELECT} WHERE p.slug = ?`, [slug]);
    return rows.length ? toConfig(rows[0]) : null;
  };
  return conn ? run(conn) : withConnection(run);
}

/** Projects with an enabled repository configuration (for the module's project picker). */
export async function listRepositoryConfigs(): Promise<ProjectRepositoryConfig[]> {
  return withConnection(async (c) => {
    const rows = await c.query<Row>(`${SELECT} WHERE r.enabled = 1 ORDER BY p.name`);
    return rows.map(toConfig);
  });
}

export async function upsertRepositoryConfig(
  slug: string,
  input: Record<string, unknown>,
): Promise<{ action: "inserted" | "updated"; config: ProjectRepositoryConfig }> {
  const config = normalizeRepositoryConfig(input);
  return withTransaction(async (conn) => {
    const projects = await conn.query<{ id: string }>("SELECT id FROM dbo.Projects WHERE slug = ?", [slug]);
    if (!projects.length) throw new Error(`project not found: ${slug}`);
    const projectId = projects[0].id;
    const existing = await conn.query<{ projectId: string }>(
      "SELECT projectId FROM dbo.ProjectRepositoryConfiguration WHERE projectId = ?",
      [projectId],
    );
    const cols = [
      config.repoUrl,
      config.defaultBranch,
      config.specsPath,
      config.filePattern,
      JSON.stringify(config.protectedBranches),
      config.credentialSecretRef,
      config.enabled ? 1 : 0,
    ];
    if (existing.length) {
      await conn.query(
        `UPDATE dbo.ProjectRepositoryConfiguration
            SET repoUrl = ?, defaultBranch = ?, specsPath = ?, filePattern = ?, protectedBranchesJson = ?,
                credentialSecretRef = ?, enabled = ?, updatedAt = SYSUTCDATETIME()
          WHERE projectId = ?`,
        [...cols, projectId],
      );
    } else {
      await conn.query(
        `INSERT INTO dbo.ProjectRepositoryConfiguration
           (projectId, repoUrl, defaultBranch, specsPath, filePattern, protectedBranchesJson, credentialSecretRef, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [projectId, ...cols],
      );
    }
    await conn.query(
      "INSERT INTO dbo.ProjectConfigurationHistory (projectId, changeType, section) VALUES (?, 2, 'repository')",
      [projectId],
    );
    const saved = await getRepositoryConfigBySlug(slug, conn);
    return { action: existing.length ? "updated" : "inserted", config: saved! };
  });
}

export async function deleteRepositoryConfig(slug: string): Promise<boolean> {
  return withTransaction(async (conn) => {
    const projects = await conn.query<{ id: string }>("SELECT id FROM dbo.Projects WHERE slug = ?", [slug]);
    if (!projects.length) throw new Error(`project not found: ${slug}`);
    const existing = await conn.query<{ projectId: string }>(
      "SELECT projectId FROM dbo.ProjectRepositoryConfiguration WHERE projectId = ?",
      [projects[0].id],
    );
    if (!existing.length) return false;
    await conn.query("DELETE FROM dbo.ProjectRepositoryConfiguration WHERE projectId = ?", [projects[0].id]);
    await conn.query(
      "INSERT INTO dbo.ProjectConfigurationHistory (projectId, changeType, section) VALUES (?, 2, 'repository_removed')",
      [projects[0].id],
    );
    return true;
  });
}

/** Public shape: never exposes anything beyond the env var name of the credential. */
export function publicRepositoryConfig(config: ProjectRepositoryConfig) {
  return {
    repoUrl: config.repoUrl,
    defaultBranch: config.defaultBranch,
    specsPath: config.specsPath,
    filePattern: config.filePattern,
    protectedBranches: config.protectedBranches,
    credentialSecretRef: config.credentialSecretRef,
    authMode: config.credentialSecretRef ? "pat" : "system",
    enabled: config.enabled,
    updatedAt: config.updatedAt,
  };
}
