import { getConnection } from "./sql-connection";
import type { DbConnection as Connection } from "./db-connection";

export type ProjectType = 1 | 2;
export type ProjectStatus = 0 | 1 | 2;

export type Project = {
  id: string;
  slug: string;
  name: string;
  projectType: ProjectType;
  status: ProjectStatus;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateProjectInput = {
  slug: string;
  name: string;
  projectType: ProjectType;
  status?: ProjectStatus;
  enabled?: boolean;
};

type ProjectRow = {
  id: string;
  slug: string;
  name: string;
  projectType: number;
  status: number;
  // SQLite stores booleans as 0/1 and SQL Server's BIT arrives as boolean.
  enabled: boolean | number | string;
  createdAt: Date;
  updatedAt: Date;
};

function mapRow(row: ProjectRow): Project {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    projectType: row.projectType as ProjectType,
    status: row.status as ProjectStatus,
    enabled: row.enabled === true || row.enabled === 1 || row.enabled === "1",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createProject(
  input: CreateProjectInput,
  conn?: Connection
): Promise<Project> {
  const c = conn ?? (await getConnection());
  const enabled = input.enabled === false ? 0 : 1;
  const status = input.status ?? 0;
  const result = await c.query<ProjectRow>(
    `INSERT INTO dbo.Projects (slug, name, projectType, status, enabled)
     OUTPUT INSERTED.id, INSERTED.slug, INSERTED.name, INSERTED.projectType,
            INSERTED.status, INSERTED.enabled, INSERTED.createdAt, INSERTED.updatedAt
     VALUES (?, ?, ?, ?, ?)`,
    [input.slug, input.name, input.projectType, status, enabled]
  );
  return mapRow(result[0]);
}

export async function getProjectById(id: string): Promise<Project | null> {
  const conn = await getConnection();
  const result = await conn.query<ProjectRow>(
    `SELECT id, slug, name, projectType, status, enabled, createdAt, updatedAt
     FROM dbo.Projects WHERE id = ?`,
    [id]
  );
  return result.length > 0 ? mapRow(result[0]) : null;
}

export async function getProjectBySlug(slug: string): Promise<Project | null> {
  const conn = await getConnection();
  const result = await conn.query<ProjectRow>(
    `SELECT id, slug, name, projectType, status, enabled, createdAt, updatedAt
     FROM dbo.Projects WHERE slug = ?`,
    [slug]
  );
  return result.length > 0 ? mapRow(result[0]) : null;
}

export async function listProjects(): Promise<Project[]> {
  const conn = await getConnection();
  const result = await conn.query<ProjectRow>(
    `SELECT id, slug, name, projectType, status, enabled, createdAt, updatedAt
     FROM dbo.Projects ORDER BY createdAt, slug`
  );
  return result.map(mapRow);
}

export { getConnection };