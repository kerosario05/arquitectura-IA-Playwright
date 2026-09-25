import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { DbConnection as Connection } from "./db-connection";
import { resolveDriverName, withTransaction } from "./sql-connection";
import { createProject, type Project } from "./project-repository";
import {
  readProjectConfigurationOnConnection,
  evaluateProjectReadiness,
  type ProjectRow,
} from "./project-reader";
import { resolveSecretRef, SecretResolutionError } from "./secret-resolver";

const STAGING_DIR = path.resolve(process.cwd(), ".artifacts", "apks");

function isStagingPath(p: string): boolean {
  try {
    const normalized = path.resolve(p);
    const staging = path.resolve(STAGING_DIR);
    return normalized === staging || normalized.startsWith(staging + path.sep);
  } catch { return false; }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_") || "app.apk";
}

function getPersistentApkDir(slug: string): string {
  // storage data/projects/<appSlug>/apk ya resuelto — no tocar (staging .artifacts/apks → persistente data/projects)
  return path.resolve(process.cwd(), "data", "projects", slug, "apk");
}

function persistStagedApk(stagingPath: string, slug: string): string {
  if (!fs.existsSync(stagingPath)) throw new Error(`staging APK not found: ${stagingPath}`);
  const persistentDir = getPersistentApkDir(slug);
  fs.mkdirSync(persistentDir, { recursive: true });
  const rawBase = path.basename(stagingPath);
  const safeBase = sanitizeFilename(rawBase);
  let persistentPath = path.join(persistentDir, safeBase);
  if (fs.existsSync(persistentPath)) {
    const ext = path.extname(safeBase);
    const name = path.basename(safeBase, ext);
    persistentPath = path.join(persistentDir, `${name}-${crypto.randomUUID().slice(0, 8)}${ext}`);
  }
  fs.copyFileSync(stagingPath, persistentPath);
  if (!fs.existsSync(persistentPath)) throw new Error(`failed to persist APK to ${persistentPath}`);
  // cheap orphan cleanup: remove staging file after successful copy
  try { fs.unlinkSync(stagingPath); } catch {}
  return persistentPath;
}

export type LoginMode = 1 | 2 | 3;

export type CreateWebProjectInput = {
  name: string;
  slug: string;
  enabled?: boolean;
  baseUrl: string;
  loginMode: LoginMode;
  username?: string;
  passwordSecretRef?: string;
  ignoreHTTPSErrors?: boolean;
};

export type CreateMobileProjectInput = {
  name: string;
  slug: string;
  enabled?: boolean;
  apkPath: string;
  packageName: string;
  mainActivity: string;
  appName: string;
  framework?: string;
};

const EMPTY_KNOWLEDGE_JSON = JSON.stringify({ version: 1, items: [] });

function assertCommon(input: { name: string; slug: string }): void {
  if (!input.name?.trim()) throw new Error("name is required");
  if (!input.slug?.trim()) throw new Error("slug is required");
}

async function assertSlugAvailable(conn: Connection, slug: string): Promise<void> {
  const res = await conn.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM dbo.Projects WHERE slug = ?",
    [slug]
  );
  if (res[0].n > 0) throw new Error(`slug already exists: ${slug}`);
}

export async function createWebProject(input: CreateWebProjectInput): Promise<Project> {
  assertCommon(input);
  if (!input.baseUrl?.trim()) throw new Error("baseUrl is required");
  if (![1, 2, 3].includes(input.loginMode)) {
    throw new Error("loginMode must be 1 (password), 2 (no_login) or 3 (manual)");
  }
  if (input.loginMode === 1) {
    if (!input.username?.trim()) throw new Error("loginMode=password requires username");
    if (!input.passwordSecretRef?.trim()) {
      throw new Error("loginMode=password requires passwordSecretRef");
    }
  }

  return withTransaction(async (conn) => {
    await assertSlugAvailable(conn, input.slug);
    const project = await createProject(
      { slug: input.slug, name: input.name, projectType: 1, status: 0, enabled: input.enabled },
      conn
    );
    await conn.query(
      `INSERT INTO dbo.WebProjectConfiguration (projectId, baseUrl, loginMode, username, passwordSecretRef, ignoreHTTPSErrors)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [project.id, input.baseUrl, input.loginMode, input.username ?? null, input.passwordSecretRef ?? null, input.ignoreHTTPSErrors ?? false]
    );
    await conn.query(
      `INSERT INTO dbo.ProjectKnowledge (projectId, schemaVersion, knowledgeJson)
       VALUES (?, 1, ?)`,
      [project.id, EMPTY_KNOWLEDGE_JSON]
    );
    await conn.query(
      `INSERT INTO dbo.ProjectConfigurationHistory (projectId, changeType, section)
       VALUES (?, 1, 'project')`,
      [project.id]
    );
    return project;
  });
}

export async function createMobileProject(input: CreateMobileProjectInput): Promise<Project> {
  assertCommon(input);
  if (!input.apkPath?.trim()) throw new Error("apkPath is required");
  if (!input.packageName?.trim()) throw new Error("packageName is required");
  if (!input.mainActivity?.trim()) throw new Error("mainActivity is required");
  if (!input.appName?.trim()) throw new Error("appName is required");

  const initialPath = input.apkPath.trim();
  const needsPersist = isStagingPath(initialPath);
  if (needsPersist) {
    if (!fs.existsSync(initialPath)) throw new Error(`staging APK not found: ${initialPath}`);
  } else {
    if (!fs.existsSync(initialPath)) throw new Error(`APK file not found: ${initialPath}`);
  }

  let persistentPath: string | null = null;
  let project: Project | null = null;

  try {
    project = await withTransaction(async (conn) => {
      await assertSlugAvailable(conn, input.slug);
      let dbApkPath = initialPath;
      if (needsPersist) {
        const dir = getPersistentApkDir(input.slug);
        fs.mkdirSync(dir, { recursive: true });
        const base = sanitizeFilename(path.basename(initialPath));
        let dest = path.join(dir, base);
        if (fs.existsSync(dest)) {
          const ext = path.extname(base);
          const name = path.basename(base, ext);
          dest = path.join(dir, `${name}-${crypto.randomUUID().slice(0, 8)}${ext}`);
        }
        fs.copyFileSync(initialPath, dest);
        if (!fs.existsSync(dest)) throw new Error(`failed to persist APK to ${dest}`);
        persistentPath = dest;
        dbApkPath = dest;
        console.log(`[apk-project-storage] appSlug=${input.slug} source=upload staging=${initialPath} finalPath=${dest} exists=${String(fs.existsSync(dest))}`);
      } else {
        console.log(`[apk-project-storage] appSlug=${input.slug} source=local finalPath=${initialPath} exists=${String(fs.existsSync(initialPath))}`);
      }
      const p = await createProject(
        { slug: input.slug, name: input.name, projectType: 2, status: 0, enabled: input.enabled },
        conn
      );
      await conn.query(
        `INSERT INTO dbo.MobileProjectConfiguration (projectId, apkPath, packageName, mainActivity, appName, framework)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [p.id, dbApkPath, input.packageName, input.mainActivity, input.appName, input.framework ?? null]
      );
      await conn.query(
        `INSERT INTO dbo.ProjectKnowledge (projectId, schemaVersion, knowledgeJson)
         VALUES (?, 1, ?)`,
        [p.id, EMPTY_KNOWLEDGE_JSON]
      );
      await conn.query(
        `INSERT INTO dbo.ProjectConfigurationHistory (projectId, changeType, section)
         VALUES (?, 1, 'project')`,
        [p.id]
      );
      return p;
    });
    // after successful transaction, clean staging (cheap orphan handling)
    if (needsPersist && persistentPath) {
      try { fs.unlinkSync(initialPath); } catch {}
    }
    return project!;
  } catch (e) {
    // if transaction failed after copying persistent file, delete orphan persistent
    if (persistentPath && fs.existsSync(persistentPath)) {
      try { fs.unlinkSync(persistentPath); } catch {}
      // also try to remove empty persistent dir
      try {
        const dir = path.dirname(persistentPath);
        if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
      } catch {}
    }
    throw e;
  }
}

export type UpdateProjectInput = {
  name?: string;
  enabled?: boolean;
  // Web fields
  baseUrl?: string;
  loginMode?: LoginMode;
  username?: string;
  passwordSecretRef?: string;
  ignoreHTTPSErrors?: boolean;
  // Mobile fields
  apkPath?: string;
  packageName?: string;
  mainActivity?: string;
  appName?: string;
  framework?: string | null;
};

export async function updateProject(
  slug: string,
  input: UpdateProjectInput,
): Promise<{ projectId: string; status: number; reasons: string[] }> {
  if (!slug?.trim()) throw new Error("slug is required");
  let stagingToClean: string | null = null;
  let persistentForUpdate: string | null = null;
  let result: { projectId: string; status: number; reasons: string[] } | null = null;
  try {
  result = await withTransaction(async (conn) => {
    const rows = await conn.query<ProjectRow>(
      `SELECT id, slug, name, projectType, status, enabled, createdAt, updatedAt
       FROM dbo.Projects WHERE slug = ?`,
      [slug],
    );
    if (rows.length === 0) throw new Error("project not found");
    const project = rows[0];
    // If mobile and apkPath is staging, persist before DB update
    if (project.projectType === 2 && input.apkPath !== undefined) {
      const raw = input.apkPath.trim();
      if (raw && isStagingPath(raw)) {
        if (!fs.existsSync(raw)) throw new Error(`staging APK not found: ${raw}`);
        const dir = getPersistentApkDir(slug);
        fs.mkdirSync(dir, { recursive: true });
        const base = sanitizeFilename(path.basename(raw));
        let dest = path.join(dir, base);
        if (fs.existsSync(dest)) {
          const ext = path.extname(base);
          const name = path.basename(base, ext);
          dest = path.join(dir, `${name}-${crypto.randomUUID().slice(0, 8)}${ext}`);
        }
        fs.copyFileSync(raw, dest);
        if (!fs.existsSync(dest)) throw new Error(`failed to persist APK to ${dest}`);
        persistentForUpdate = dest;
        stagingToClean = raw;
        input = { ...input, apkPath: dest };
        console.log(`[apk-project-storage] appSlug=${slug} source=upload staging=${raw} finalPath=${dest} exists=${String(fs.existsSync(dest))}`);
      } else if (raw) {
        if (!fs.existsSync(raw)) throw new Error(`APK file not found: ${raw}`);
        console.log(`[apk-project-storage] appSlug=${slug} source=local finalPath=${raw} exists=${String(fs.existsSync(raw))}`);
      }
    }

    // Update common fields on Projects
    if (input.name !== undefined) {
      await conn.query("UPDATE dbo.Projects SET name = ?, updatedAt = SYSUTCDATETIME() WHERE id = ?", [input.name, project.id]);
    }
    if (input.enabled !== undefined) {
      const en = input.enabled ? 1 : 0;
      await conn.query("UPDATE dbo.Projects SET enabled = ?, updatedAt = SYSUTCDATETIME() WHERE id = ?", [en, project.id]);
    }

    // Update typed config
    if (project.projectType === 1) {
      const sets: string[] = [];
      const vals: any[] = [];
      if (input.baseUrl !== undefined) { sets.push("baseUrl = ?"); vals.push(input.baseUrl); }
      if (input.loginMode !== undefined) { sets.push("loginMode = ?"); vals.push(input.loginMode); }
      if (input.username !== undefined) { sets.push("username = ?"); vals.push(input.username || null); }
      if (input.passwordSecretRef !== undefined) { sets.push("passwordSecretRef = ?"); vals.push(input.passwordSecretRef || null); }
      if (input.ignoreHTTPSErrors !== undefined) { sets.push("ignoreHTTPSErrors = ?"); vals.push(input.ignoreHTTPSErrors ? 1 : 0); }
      if (sets.length > 0) {
        vals.push(project.id);
        await conn.query(`UPDATE dbo.WebProjectConfiguration SET ${sets.join(", ")} WHERE projectId = ?`, vals);
      }
    } else if (project.projectType === 2) {
      const sets: string[] = [];
      const vals: any[] = [];
      if (input.apkPath !== undefined) { sets.push("apkPath = ?"); vals.push(input.apkPath); }
      if (input.packageName !== undefined) { sets.push("packageName = ?"); vals.push(input.packageName); }
      if (input.mainActivity !== undefined) { sets.push("mainActivity = ?"); vals.push(input.mainActivity); }
      if (input.appName !== undefined) { sets.push("appName = ?"); vals.push(input.appName); }
      if (input.framework !== undefined) { sets.push("framework = ?"); vals.push(input.framework || null); }
      if (sets.length > 0) {
        vals.push(project.id);
        await conn.query(`UPDATE dbo.MobileProjectConfiguration SET ${sets.join(", ")} WHERE projectId = ?`, vals);
      }
    }

    // History
    await conn.query(
      `INSERT INTO dbo.ProjectConfigurationHistory (projectId, changeType, section)
       VALUES (?, 2, ?)`,
      [project.id, project.projectType === 1 ? "web_config" : "mobile_config"],
    );

    // Refresh status
    const cfg = await readProjectConfigurationOnConnection(conn, { ...project, name: input.name ?? project.name });
    const readiness = evaluateProjectReadiness(cfg);
    const newStatus = readiness.status === "READY" ? 1 : 2;
    await conn.query("UPDATE dbo.Projects SET status = ?, updatedAt = SYSUTCDATETIME() WHERE id = ?", [newStatus, project.id]);

    return { projectId: project.id, status: newStatus, reasons: readiness.reasons };
  });
  if (stagingToClean && persistentForUpdate) {
    try { fs.unlinkSync(stagingToClean); } catch {}
  }
  return result!;
  } catch (e) {
    if (persistentForUpdate && fs.existsSync(persistentForUpdate)) {
      try { fs.unlinkSync(persistentForUpdate); } catch {}
      try { const dir = path.dirname(persistentForUpdate); if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir); } catch {}
    }
    throw e;
  }
}

export type UpsertJiraConfigurationInput = { sharedConnectionId?: string | null; projectKey: string; acceptanceCriteriaField?: string | null; defaultJql?: string | null; dryRun?: boolean; };
export type UpsertTestRailConfigurationInput = { sharedConnectionId?: string | null; projectIdTr: string; suiteId?: string | null; sectionId?: string | null; sessionId?: string | null; };

async function resolveProject(conn: Connection, slug: string): Promise<ProjectRow> {
  const rows = await conn.query<ProjectRow>("SELECT id, slug, name, projectType, status, enabled, createdAt, updatedAt FROM dbo.Projects WHERE slug = ?", [slug]);
  if (rows.length === 0) throw new Error(`project not found: ${slug}`);
  return rows[0];
}

async function resolveSharedConnection(conn: Connection, id: string, expectedType: number, label: string): Promise<void> {
  const rows = await conn.query<{ connectionType: number }>("SELECT connectionType FROM dbo.SharedConnection WHERE id = ?", [id]);
  if (rows.length === 0) throw new Error(`${label} sharedConnection not found: ${id}`);
  if (rows[0].connectionType !== expectedType) throw new Error(`${label} sharedConnection type mismatch: expected ${expectedType}, got ${rows[0].connectionType}`);
}

export type SharedConnectionCredentials = { baseUrl: string; credentials: string };

export async function resolveSharedConnectionCredentials(sharedConnectionId: string): Promise<SharedConnectionCredentials> {
  const row = await withTransaction(async (c) => {
    const rows = await c.query<{ baseUrl: string; credentialSecretRef: string }>(
      "SELECT baseUrl, credentialSecretRef FROM dbo.SharedConnection WHERE id = ?", [sharedConnectionId]
    );
    if (rows.length === 0) throw new Error(`sharedConnection not found: ${sharedConnectionId}`);
    return rows[0];
  });
  const credentials = resolveSecretRef(row.credentialSecretRef);
  return { baseUrl: row.baseUrl, credentials };
}

export async function upsertJiraConfiguration(slug: string, input: UpsertJiraConfigurationInput): Promise<{ action: "inserted" | "updated"; projectId: string }> {
  if (!slug?.trim()) throw new Error("slug is required");
  if (!input.projectKey?.trim()) throw new Error("projectKey is required");
  return withTransaction(async (conn) => {
    const project = await resolveProject(conn, slug);
    const sharedConnId = input.sharedConnectionId?.trim() || null;
    if (sharedConnId) {
      await resolveSharedConnection(conn, sharedConnId, 1, "Jira");
    }
    const existing = await conn.query<{ projectId: string }>("SELECT projectId FROM dbo.ProjectJiraConfiguration WHERE projectId = ?", [project.id]);
    const cols = [sharedConnId, input.projectKey, input.acceptanceCriteriaField ?? null, input.defaultJql ?? null, input.dryRun ? 1 : 0];
    if (existing.length > 0) {
      await conn.query("UPDATE dbo.ProjectJiraConfiguration SET sharedConnectionId=?, projectKey=?, acceptanceCriteriaField=?, defaultJql=?, dryRun=?, updatedAt=SYSUTCDATETIME() WHERE projectId=?", [...cols, project.id]);
    } else {
      await conn.query("INSERT INTO dbo.ProjectJiraConfiguration (projectId, sharedConnectionId, projectKey, acceptanceCriteriaField, defaultJql, dryRun) VALUES (?,?,?,?,?,?)", [project.id, ...cols]);
    }
    await conn.query("INSERT INTO dbo.ProjectConfigurationHistory (projectId, changeType, section) VALUES (?, 2, 'jira')", [project.id]);
    return { action: existing.length > 0 ? "updated" : "inserted", projectId: project.id };
  });
}

export async function upsertTestRailConfiguration(slug: string, input: UpsertTestRailConfigurationInput): Promise<{ action: "inserted" | "updated"; projectId: string }> {
  if (!slug?.trim()) throw new Error("slug is required");
  if (!input.projectIdTr?.trim()) throw new Error("projectIdTr is required");
  return withTransaction(async (conn) => {
    const project = await resolveProject(conn, slug);
    const sharedConnId = input.sharedConnectionId?.trim() || null;
    if (sharedConnId) {
      await resolveSharedConnection(conn, sharedConnId, 2, "TestRail");
    }
    const existing = await conn.query<{ projectId: string }>("SELECT projectId FROM dbo.ProjectTestRailConfiguration WHERE projectId = ?", [project.id]);
    const cols = [sharedConnId, input.projectIdTr, input.suiteId ?? null, input.sectionId ?? null, input.sessionId ?? null];
    if (existing.length > 0) {
      await conn.query("UPDATE dbo.ProjectTestRailConfiguration SET sharedConnectionId=?, projectIdTr=?, suiteId=?, sectionId=?, sessionId=?, updatedAt=SYSUTCDATETIME() WHERE projectId=?", [...cols, project.id]);
    } else {
      await conn.query("INSERT INTO dbo.ProjectTestRailConfiguration (projectId, sharedConnectionId, projectIdTr, suiteId, sectionId, sessionId) VALUES (?,?,?,?,?,?)", [project.id, ...cols]);
    }
    await conn.query("INSERT INTO dbo.ProjectConfigurationHistory (projectId, changeType, section) VALUES (?, 2, 'testrail')", [project.id]);
    return { action: existing.length > 0 ? "updated" : "inserted", projectId: project.id };
  });
}

export async function refreshProjectStatus(identifier: {
  slug?: string;
  id?: string;
}): Promise<{ projectId: string; status: 1 | 2; reasons: string[] }> {
  if (!identifier?.slug?.trim() && !identifier?.id?.trim()) {
    throw new Error("identifier.slug or identifier.id is required");
  }
  return withTransaction(async (conn) => {
    const rows = identifier.id
      ? await conn.query<ProjectRow>(
          `SELECT id, slug, name, projectType, status, enabled, createdAt, updatedAt
           FROM dbo.Projects WHERE id = ?`,
          [identifier.id]
        )
      : await conn.query<ProjectRow>(
          `SELECT id, slug, name, projectType, status, enabled, createdAt, updatedAt
           FROM dbo.Projects WHERE slug = ?`,
          [identifier.slug]
        );
    if (rows.length === 0) throw new Error("project not found");

    const project = rows[0];
    const cfg = await readProjectConfigurationOnConnection(conn, project);
    const readiness = evaluateProjectReadiness(cfg);
    const newStatus = readiness.status === "READY" ? 1 : 2;
    const beforeStatus = project.status;

    await conn.query(
      "UPDATE dbo.Projects SET status = ?, updatedAt = SYSUTCDATETIME() WHERE id = ?",
      [newStatus, project.id]
    );
    await conn.query(
      `INSERT INTO dbo.ProjectConfigurationHistory (projectId, changeType, section, beforeJson, afterJson)
       VALUES (?, 2, 'project', ?, ?)`,
      [project.id, JSON.stringify({ status: beforeStatus }), JSON.stringify({ status: newStatus })]
    );

    return { projectId: project.id, status: newStatus as 1 | 2, reasons: readiness.reasons };
  });
}

export type DeleteProjectResult = {
  projectDeleted: boolean;
  warning?: string;
};

const PROJECT_DELETE_TABLE_ORDER = [
  "ProjectConfigurationHistory",
  "ProjectJiraConfiguration",
  "ProjectTestRailConfiguration",
  "ProjectOtpConfiguration",
  "ProjectKnowledge",
  "WebProjectConfiguration",
  "MobileProjectConfiguration",
  "ProjectCaseInputRequirement",
  "ProjectCaseRuntimeValue",
  "ProjectGenerationConfig",
  "Projects",
] as const;

const OPTIONAL_PROJECT_DELETE_TABLES = new Set<string>([
  "ProjectCaseInputRequirement",
  "ProjectCaseRuntimeValue",
  "ProjectGenerationConfig",
]);

const REQUIRED_PROJECT_DELETE_TABLES = PROJECT_DELETE_TABLE_ORDER.filter(
  (table) => !OPTIONAL_PROJECT_DELETE_TABLES.has(table),
);

export function buildProjectDeleteStatements(projectId: string, availableTables?: Iterable<string>): string[] {
  const available = availableTables ? new Set(availableTables) : undefined;
  return PROJECT_DELETE_TABLE_ORDER
    .filter((table) => !available || !OPTIONAL_PROJECT_DELETE_TABLES.has(table) || available.has(table))
    .map((table) => `DELETE FROM dbo.${table} WHERE ${table === "Projects" ? "id" : "projectId"} = ?`);
}

/**
 * Returns the project-delete tables visible to the active driver. The three
 * additive tables are deliberately optional: they exist in some SQL Server
 * installations but are not part of the authoritative SQLite schema.
 */
export async function listExistingProjectDeleteTables(conn: Connection): Promise<Set<string>> {
  const tableNames = PROJECT_DELETE_TABLE_ORDER.map((table) => `'${table}'`).join(", ");
  const rows = resolveDriverName() === "sqlite"
    ? await conn.query<Record<string, unknown>>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${tableNames})`,
      )
    : await conn.query<Record<string, unknown>>(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME IN (${tableNames})`,
      );
  return new Set(rows.map((row) => String(row.name ?? row.TABLE_NAME ?? row.tableName ?? "")).filter(Boolean));
}

export type ProjectDeleteDependencies = {
  withTransaction?: typeof withTransaction;
  listExistingTables?: typeof listExistingProjectDeleteTables;
  removeArtifacts?: (slug: string) => string[];
};

export async function deleteProject(slug: string, dependencies: ProjectDeleteDependencies = {}): Promise<DeleteProjectResult> {
  if (!slug?.trim()) throw new Error("slug is required");

  const runTransaction = dependencies.withTransaction ?? withTransaction;
  const listTables = dependencies.listExistingTables ?? listExistingProjectDeleteTables;
  const removeArtifacts = dependencies.removeArtifacts ?? removeProjectArtifacts;

  await runTransaction(async (conn) => {
    const rows = await conn.query<ProjectRow>(
      "SELECT id, slug FROM dbo.Projects WHERE slug = ?", [slug]
    );
    if (rows.length === 0) throw new Error(`project not found: ${slug}`);
    const projectId = rows[0].id;

    const availableTables = await listTables(conn);
    const missingRequiredTables = REQUIRED_PROJECT_DELETE_TABLES.filter((table) => !availableTables.has(table));
    if (missingRequiredTables.length > 0) {
      throw new Error(`project delete schema incomplete; missing required table(s): ${missingRequiredTables.join(", ")}`);
    }

    for (const statement of buildProjectDeleteStatements(projectId, availableTables)) {
      await conn.query(statement, [projectId]);
    }
  });

  const warnings = removeArtifacts(slug);
  return { projectDeleted: true, ...(warnings.length > 0 ? { warning: warnings.join(",") } : {}) };
}

export type ProjectArtifactRoot = { root: string; warning: string };

export function removeProjectArtifacts(
  slug: string,
  roots: ProjectArtifactRoot[] = [
    { root: path.resolve(process.cwd(), "automations", "apps"), warning: "runtime_directory_cleanup_failed" },
    { root: path.resolve(process.cwd(), "data", "projects"), warning: "legacy_project_directory_cleanup_failed" },
  ],
): string[] {
  const warnings: string[] = [];
  for (const { root, warning } of roots) {
    const target = path.resolve(root, slug);
    if (target === root || !target.startsWith(root + path.sep)) {
      warnings.push(warning);
      continue;
    }
    try {
      if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    } catch {
      warnings.push(warning);
    }
  }
  return warnings;
}
