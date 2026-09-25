"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_test_1 = __importDefault(require("node:test"));
const project_generation_config_service_1 = require("./project-generation-config-service");
const project_service_1 = require("./project-service");
const A = "00000000-0000-0000-0000-000000000001";
const B = "00000000-0000-0000-0000-000000000002";
const config = {
    version: "1",
    valueSets: { generic: { values: ["CONFIG_VALUE"], selectionStrategy: "seeded" } },
    namedProfiles: { reusable: { valueKind: "string", sourceMode: "configured_values", valueSetRef: "generic", semanticHint: "informational" } },
};
function fakeDb() {
    const rows = new Map();
    const queries = [];
    return {
        rows,
        queries,
        withConnection: async (fn) => fn({
            query: async (sql, params = []) => {
                queries.push(sql);
                const projectId = String(params[0] ?? "");
                if (/SELECT projectId/i.test(sql))
                    return rows.get(projectId) ? [rows.get(projectId)] : [];
                if (/DELETE FROM/i.test(sql)) {
                    rows.delete(projectId);
                    return [];
                }
                if (/\bUPDATE\b/i.test(sql)) {
                    const current = rows.get(String(params[2]));
                    current.version = String(params[0]);
                    current.configJson = String(params[1]);
                    current.updatedAt = new Date();
                    return [];
                }
                if (/INSERT/i.test(sql)) {
                    rows.set(projectId, { projectId, version: String(params[1]), configJson: String(params[2]), createdAt: new Date(), updatedAt: new Date() });
                    return [];
                }
                return [];
            },
        }),
        logger: (message) => { if (message.includes("CONFIG_VALUE"))
            throw new Error("secret logged"); },
    };
}
(0, node_test_1.default)("upserts canonical config per project and rejects invalid or corrupt data", async () => {
    const db = fakeDb();
    const service = (0, project_generation_config_service_1.createProjectGenerationConfigService)(db);
    strict_1.default.deepEqual(await service.upsertProjectGenerationConfig(A, config), config);
    strict_1.default.deepEqual(await service.getProjectGenerationConfig(A), config);
    await strict_1.default.rejects(() => service.upsertProjectGenerationConfig(A, { version: "1", valueSets: { bad: { values: [] } } }));
    strict_1.default.equal(db.rows.get(A)?.configJson.includes("CONFIG_VALUE"), true);
    db.rows.get(A).configJson = "{";
    await strict_1.default.rejects(() => service.getProjectGenerationConfig(A), /corrupt|invalid/i);
    strict_1.default.equal(await service.getProjectGenerationConfig(B), undefined);
});
(0, node_test_1.default)("normalizes legacy input, isolates projects, logs metadata only and supports delete", async () => {
    const db = fakeDb();
    const service = (0, project_generation_config_service_1.createProjectGenerationConfigService)(db);
    await service.upsertProjectGenerationConfig(A, { version: "legacy", pools: { old: { values: ["LEGACY_VALUE"] } } });
    strict_1.default.deepEqual(Object.keys((await service.getProjectGenerationConfig(A))?.valueSets ?? {}), ["old"]);
    await service.upsertProjectGenerationConfig(B, config);
    strict_1.default.equal((await service.getProjectGenerationConfig(B))?.version, "1");
    strict_1.default.equal((await service.getProjectGenerationConfig(A))?.version, "legacy");
    strict_1.default.ok(db.queries.every((query) => !query.includes("CONFIG_VALUE") && !query.includes("LEGACY_VALUE")));
    strict_1.default.ok((0, project_service_1.buildProjectDeleteStatements)(A).some((query) => query.includes("ProjectGenerationConfig")));
});
(0, node_test_1.default)("ships an idempotent project generation config migration", () => {
    const sql = node_fs_1.default.readFileSync("sql/schema/002-project-generation-config.sql", "utf8");
    strict_1.default.match(sql, /IF OBJECT_ID/);
    strict_1.default.match(sql, /PK_ProjectGenerationConfig/);
    strict_1.default.match(sql, /FK_ProjectGenerationConfig_Projects/);
});
