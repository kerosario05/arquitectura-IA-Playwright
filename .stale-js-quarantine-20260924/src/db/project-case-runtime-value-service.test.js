"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const project_case_runtime_value_service_1 = require("./project-case-runtime-value-service");
class FakeConnection {
    slugToId = new Map([["project-a", "project-id-a"]]);
    rows = new Map();
    queries = [];
    async beginTransaction() { }
    async commit() { }
    async rollback() { }
    async close() { }
    async query(sql, params = []) {
        this.queries.push({ sql, params });
        if (sql.includes("SELECT id FROM dbo.Projects")) {
            const id = this.slugToId.get(String(params[0]));
            return (id ? [{ id }] : []);
        }
        if (sql.includes("OBJECT_ID(N'dbo.ProjectCaseRuntimeValue'"))
            return [{ tableId: 1 }];
        if (sql.includes("SELECT [key] FROM dbo.ProjectCaseRuntimeValue")) {
            const row = this.rows.get(`${params[0]}:${params[1]}:${params[2]}`);
            return (row ? [{ key: row.key }] : []);
        }
        if (sql.includes("SELECT [key], semanticType")) {
            return [...this.rows.values()].filter((row) => row.projectId === params[0] && row.caseId === params[1]);
        }
        if (sql.trimStart().startsWith("UPDATE")) {
            const row = this.rows.get(`${params[8]}:${params[9]}:${params[10]}`);
            if (row)
                Object.assign(row, { semanticType: params[0], fieldKind: params[1], datasetIdentity: params[2], contractVersion: params[3], valueType: params[4], value: params[5], source: params[6], verified: params[7], confirmed: 1 });
            return [];
        }
        if (sql.trimStart().startsWith("INSERT")) {
            const [projectId, caseId, key, semanticType, fieldKind, datasetIdentity, contractVersion, type, value, source, verified] = params;
            this.rows.set(`${projectId}:${caseId}:${key}`, { projectId, caseId, key, semanticType, fieldKind, datasetIdentity, contractVersion, valueType: type, value, source, verified, confirmed: 1 });
            return [];
        }
        return [];
    }
}
(0, node_test_1.default)("persists confirmed non-secret values with semantic metadata and replays by project/case", async () => {
    const conn = new FakeConnection();
    const count = await (0, project_case_runtime_value_service_1.persistConfirmedRuntimeValues)({
        projectSlug: "project-a",
        caseId: 90001,
        conn: conn,
        values: [
            { key: "employee.document", value: "document-value", semanticType: "document_number", fieldKind: "text", datasetIdentity: "employee", contractVersion: "v1", verified: true },
            { key: "auth.password", value: "secret-value", verified: true },
        ],
    });
    strict_1.default.equal(count, 1);
    strict_1.default.equal(conn.rows.size, 1);
    strict_1.default.equal([...conn.rows.values()][0].value, "document-value");
    strict_1.default.ok(conn.queries.every(({ params }) => !params.includes("secret-value")));
    const replay = await (0, project_case_runtime_value_service_1.getConfirmedRuntimeValues)("project-id-a", 90001, conn);
    strict_1.default.deepEqual(replay, [{
            key: "employee.document",
            value: "document-value",
            semanticType: "document_number",
            fieldKind: "text",
            datasetIdentity: "employee",
            contractVersion: "v1",
            source: "confirmed_case_runtime",
            verified: true,
        }]);
});
(0, node_test_1.default)("confirmed runtime values are isolated by case and project", async () => {
    const conn = new FakeConnection();
    await (0, project_case_runtime_value_service_1.persistConfirmedRuntimeValues)({ projectSlug: "project-a", caseId: 1, conn: conn, values: [{ key: "x", value: "one" }] });
    strict_1.default.deepEqual(await (0, project_case_runtime_value_service_1.getConfirmedRuntimeValues)("project-id-a", 2, conn), []);
    strict_1.default.deepEqual(await (0, project_case_runtime_value_service_1.getConfirmedRuntimeValues)("other-project", 1, conn), []);
});
