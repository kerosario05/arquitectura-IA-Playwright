import { withConnection, type odbc } from "./sql-connection";
import {
  normalizeLegacyGenerationConfig,
  toCanonicalProjectGenerationConfig,
  validateProjectGenerationConfig,
  type ProjectGenerationConfig,
} from "../data/project-generation-config";

type ConnectionLike = Pick<odbc.Connection, "query">;
type Dependencies = {
  withConnection?: <T>(fn: (connection: ConnectionLike) => Promise<T>) => Promise<T>;
  logger?: (message: string) => void;
};

const defaultDependencies: Required<Dependencies> = { withConnection, logger: (message) => console.log(message) };

function assertProjectId(projectId: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId ?? "")) throw new Error("projectId must be a valid UUID");
}

function validationError(errors: Array<{ path: string; code: string; message: string }>): Error {
  const error = new Error("project generation config validation failed");
  (error as Error & { code?: string; details?: unknown }).code = "invalid_project_generation_config";
  (error as Error & { details?: unknown }).details = errors;
  return error;
}

function canonicalize(input: ProjectGenerationConfig): ProjectGenerationConfig {
  const normalized = normalizeLegacyGenerationConfig(input);
  const validation = validateProjectGenerationConfig(normalized);
  if (!validation.valid) throw validationError(validation.errors);
  return toCanonicalProjectGenerationConfig(normalized);
}

function summary(config: ProjectGenerationConfig): string {
  return `version=${config.version} valueSetCount=${Object.keys(config.valueSets ?? {}).length} namedProfileCount=${Object.keys(config.namedProfiles ?? {}).length}`;
}

export function createProjectGenerationConfigService(dependencies: Dependencies = {}) {
  const deps = { ...defaultDependencies, ...dependencies };
  return {
    async getProjectGenerationConfig(projectId: string): Promise<ProjectGenerationConfig | undefined> {
      assertProjectId(projectId);
      return deps.withConnection(async (connection) => {
        const rows = await connection.query<{ projectId: string; version: string; configJson: string }>(
          "SELECT projectId, version, configJson FROM dbo.ProjectGenerationConfig WHERE projectId = ?", [projectId],
        );
        if (rows.length === 0) return undefined;
        let parsed: unknown;
        try { parsed = JSON.parse(rows[0].configJson); } catch { throw new Error("stored project generation config JSON is corrupt"); }
        const validation = validateProjectGenerationConfig(parsed);
        if (!validation.valid) throw new Error(`stored project generation config is invalid: ${validation.errors.map((error) => `${error.path}:${error.code}`).join(",")}`);
        const canonical = toCanonicalProjectGenerationConfig(parsed as ProjectGenerationConfig);
        if (canonical.version !== rows[0].version) throw new Error("stored project generation config version is inconsistent");
        return canonical;
      });
    },
    async upsertProjectGenerationConfig(projectId: string, input: ProjectGenerationConfig): Promise<ProjectGenerationConfig> {
      assertProjectId(projectId);
      const canonical = canonicalize(input);
      const configJson = JSON.stringify(canonical);
      return deps.withConnection(async (connection) => {
        const existing = await connection.query<{ projectId: string }>("SELECT projectId FROM dbo.ProjectGenerationConfig WHERE projectId = ?", [projectId]);
        if (existing.length > 0) {
          await connection.query("UPDATE dbo.ProjectGenerationConfig SET version = ?, configJson = ?, updatedAt = SYSUTCDATETIME() WHERE projectId = ?", [canonical.version, configJson, projectId]);
        } else {
          await connection.query("INSERT INTO dbo.ProjectGenerationConfig (projectId, version, configJson, createdAt, updatedAt) VALUES (?, ?, ?, SYSUTCDATETIME(), SYSUTCDATETIME())", [projectId, canonical.version, configJson]);
        }
        deps.logger(`[project-generation-config] projectId=${projectId} ${summary(canonical)} status=upserted`);
        return canonical;
      });
    },
    async deleteProjectGenerationConfig(projectId: string): Promise<void> {
      assertProjectId(projectId);
      await deps.withConnection(async (connection) => {
        await connection.query("DELETE FROM dbo.ProjectGenerationConfig WHERE projectId = ?", [projectId]);
        deps.logger(`[project-generation-config] projectId=${projectId} status=deleted`);
      });
    },
  };
}

const projectGenerationConfigService = createProjectGenerationConfigService();
export const getProjectGenerationConfig = projectGenerationConfigService.getProjectGenerationConfig;
export const upsertProjectGenerationConfig = projectGenerationConfigService.upsertProjectGenerationConfig;
export const deleteProjectGenerationConfig = projectGenerationConfigService.deleteProjectGenerationConfig;
