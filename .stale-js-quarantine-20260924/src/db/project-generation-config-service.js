"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteProjectGenerationConfig = exports.upsertProjectGenerationConfig = exports.getProjectGenerationConfig = void 0;
exports.createProjectGenerationConfigService = createProjectGenerationConfigService;
const sql_connection_1 = require("./sql-connection");
const project_generation_config_1 = require("../data/project-generation-config");
const defaultDependencies = { withConnection: sql_connection_1.withConnection, logger: (message) => console.log(message) };
function assertProjectId(projectId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId ?? ""))
        throw new Error("projectId must be a valid UUID");
}
function validationError(errors) {
    const error = new Error("project generation config validation failed");
    error.code = "invalid_project_generation_config";
    error.details = errors;
    return error;
}
function canonicalize(input) {
    const normalized = (0, project_generation_config_1.normalizeLegacyGenerationConfig)(input);
    const validation = (0, project_generation_config_1.validateProjectGenerationConfig)(normalized);
    if (!validation.valid)
        throw validationError(validation.errors);
    return (0, project_generation_config_1.toCanonicalProjectGenerationConfig)(normalized);
}
function summary(config) {
    return `version=${config.version} valueSetCount=${Object.keys(config.valueSets ?? {}).length} namedProfileCount=${Object.keys(config.namedProfiles ?? {}).length}`;
}
function createProjectGenerationConfigService(dependencies = {}) {
    const deps = { ...defaultDependencies, ...dependencies };
    return {
        async getProjectGenerationConfig(projectId) {
            assertProjectId(projectId);
            return deps.withConnection(async (connection) => {
                const rows = await connection.query("SELECT projectId, version, configJson FROM dbo.ProjectGenerationConfig WHERE projectId = ?", [projectId]);
                if (rows.length === 0)
                    return undefined;
                let parsed;
                try {
                    parsed = JSON.parse(rows[0].configJson);
                }
                catch {
                    throw new Error("stored project generation config JSON is corrupt");
                }
                const validation = (0, project_generation_config_1.validateProjectGenerationConfig)(parsed);
                if (!validation.valid)
                    throw new Error(`stored project generation config is invalid: ${validation.errors.map((error) => `${error.path}:${error.code}`).join(",")}`);
                const canonical = (0, project_generation_config_1.toCanonicalProjectGenerationConfig)(parsed);
                if (canonical.version !== rows[0].version)
                    throw new Error("stored project generation config version is inconsistent");
                return canonical;
            });
        },
        async upsertProjectGenerationConfig(projectId, input) {
            assertProjectId(projectId);
            const canonical = canonicalize(input);
            const configJson = JSON.stringify(canonical);
            return deps.withConnection(async (connection) => {
                const existing = await connection.query("SELECT projectId FROM dbo.ProjectGenerationConfig WHERE projectId = ?", [projectId]);
                if (existing.length > 0) {
                    await connection.query("UPDATE dbo.ProjectGenerationConfig SET version = ?, configJson = ?, updatedAt = SYSUTCDATETIME() WHERE projectId = ?", [canonical.version, configJson, projectId]);
                }
                else {
                    await connection.query("INSERT INTO dbo.ProjectGenerationConfig (projectId, version, configJson, createdAt, updatedAt) VALUES (?, ?, ?, SYSUTCDATETIME(), SYSUTCDATETIME())", [projectId, canonical.version, configJson]);
                }
                deps.logger(`[project-generation-config] projectId=${projectId} ${summary(canonical)} status=upserted`);
                return canonical;
            });
        },
        async deleteProjectGenerationConfig(projectId) {
            assertProjectId(projectId);
            await deps.withConnection(async (connection) => {
                await connection.query("DELETE FROM dbo.ProjectGenerationConfig WHERE projectId = ?", [projectId]);
                deps.logger(`[project-generation-config] projectId=${projectId} status=deleted`);
            });
        },
    };
}
const projectGenerationConfigService = createProjectGenerationConfigService();
exports.getProjectGenerationConfig = projectGenerationConfigService.getProjectGenerationConfig;
exports.upsertProjectGenerationConfig = projectGenerationConfigService.upsertProjectGenerationConfig;
exports.deleteProjectGenerationConfig = projectGenerationConfigService.deleteProjectGenerationConfig;
