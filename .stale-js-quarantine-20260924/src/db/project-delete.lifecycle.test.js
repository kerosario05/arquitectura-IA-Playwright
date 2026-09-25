"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const project_service_1 = require("./project-service");
process.env.DB_DRIVER = "sqlite";
const CORE_TABLES = [
    "ProjectConfigurationHistory",
    "ProjectJiraConfiguration",
    "ProjectTestRailConfiguration",
    "ProjectOtpConfiguration",
    "ProjectKnowledge",
    "WebProjectConfiguration",
    "MobileProjectConfiguration",
    "Projects",
];
function harness(options = {}) {
    const statements = [];
    let rolledBack = false;
    let committed = false;
    const conn = {
        async query(sql, params = []) {
            if (sql.includes("FROM dbo.Projects WHERE slug")) {
                return (options.project === false ? [] : [{ id: "project-a", slug: "project-a" }]);
            }
            if (sql.includes("FROM sqlite_master")) {
                return (options.tables ?? CORE_TABLES).map((name) => ({ name }));
            }
            if (sql.startsWith("DELETE FROM dbo.")) {
                if (options.failOn && sql.includes(options.failOn))
                    throw new Error(`forced failure: ${options.failOn}`);
                statements.push({ sql, params });
            }
            return [];
        },
        async beginTransaction() { },
        async commit() { committed = true; },
        async rollback() { rolledBack = true; },
        async close() { },
    };
    const dependencies = {
        withTransaction: async (fn) => {
            try {
                const result = await fn(conn);
                await conn.commit();
                return result;
            }
            catch (error) {
                await conn.rollback();
                throw error;
            }
        },
        removeArtifacts: () => [],
    };
    return { conn, dependencies, statements, get rolledBack() { return rolledBack; }, get committed() { return committed; } };
}
(0, node_test_1.default)("CASE 1: normal current schema deletes successfully", async () => {
    const h = harness();
    const result = await (0, project_service_1.deleteProject)("project-a", h.dependencies);
    strict_1.default.equal(result.projectDeleted, true);
    strict_1.default.equal(h.committed, true);
    strict_1.default.equal(h.rolledBack, false);
    strict_1.default.ok(h.statements.some(({ sql }) => sql.includes("DELETE FROM dbo.Projects")));
});
(0, node_test_1.default)("CASE 2: absent legacy/additive table does not block deletion", async () => {
    const h = harness();
    await (0, project_service_1.deleteProject)("project-a", h.dependencies);
    strict_1.default.equal(h.statements.some(({ sql }) => /ProjectCaseInputRequirement|ProjectCaseRuntimeValue|ProjectGenerationConfig/.test(sql)), false);
});
(0, node_test_1.default)("CASE 3: deleting project A binds only project A", async () => {
    const h = harness();
    await (0, project_service_1.deleteProject)("project-a", h.dependencies);
    strict_1.default.ok(h.statements.length > 0);
    strict_1.default.equal(h.statements.every(({ params }) => params[0] === "project-a"), true);
});
(0, node_test_1.default)("CASE 4: related configuration and knowledge are included in cleanup", async () => {
    const h = harness();
    await (0, project_service_1.deleteProject)("project-a", h.dependencies);
    for (const table of ["WebProjectConfiguration", "ProjectKnowledge", "ProjectConfigurationHistory"]) {
        strict_1.default.ok(h.statements.some(({ sql }) => sql.includes(`DELETE FROM dbo.${table}`)), `missing ${table} cleanup`);
    }
});
(0, node_test_1.default)("CASE 5: filesystem cleanup removes only the target project roots", () => {
    const temp = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), "project-delete-"));
    try {
        const appsRoot = node_path_1.default.join(temp, "apps");
        const dataRoot = node_path_1.default.join(temp, "projects");
        node_fs_1.default.mkdirSync(node_path_1.default.join(appsRoot, "project-a", "recordings"), { recursive: true });
        node_fs_1.default.mkdirSync(node_path_1.default.join(dataRoot, "project-a", "runtime"), { recursive: true });
        node_fs_1.default.mkdirSync(node_path_1.default.join(appsRoot, "project-b"), { recursive: true });
        node_fs_1.default.mkdirSync(node_path_1.default.join(dataRoot, "project-b"), { recursive: true });
        const warnings = (0, project_service_1.removeProjectArtifacts)("project-a", [
            { root: appsRoot, warning: "apps_cleanup_failed" },
            { root: dataRoot, warning: "data_cleanup_failed" },
        ]);
        strict_1.default.deepEqual(warnings, []);
        strict_1.default.equal(node_fs_1.default.existsSync(node_path_1.default.join(appsRoot, "project-a")), false);
        strict_1.default.equal(node_fs_1.default.existsSync(node_path_1.default.join(dataRoot, "project-a")), false);
        strict_1.default.equal(node_fs_1.default.existsSync(node_path_1.default.join(appsRoot, "project-b")), true);
        strict_1.default.equal(node_fs_1.default.existsSync(node_path_1.default.join(dataRoot, "project-b")), true);
    }
    finally {
        node_fs_1.default.rmSync(temp, { recursive: true, force: true });
    }
});
(0, node_test_1.default)("CASE 6: SQL failure before commit rolls back without partial relational delete", async () => {
    const h = harness({ failOn: "ProjectKnowledge" });
    await strict_1.default.rejects(() => (0, project_service_1.deleteProject)("project-a", h.dependencies), /forced failure/);
    strict_1.default.equal(h.committed, false);
    strict_1.default.equal(h.rolledBack, true);
});
(0, node_test_1.default)("CASE 7: nonexistent project returns a controlled not-found error", async () => {
    const h = harness({ project: false });
    await strict_1.default.rejects(() => (0, project_service_1.deleteProject)("missing", h.dependencies), /project not found: missing/);
    strict_1.default.equal(h.statements.length, 0);
    strict_1.default.equal(h.rolledBack, true);
});
