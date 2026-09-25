"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const project_case_input_requirement_service_1 = require("./project-case-input-requirement-service");
class FakeConnection {
    slugToId = new Map();
    store = new Map();
    beginCount = 0;
    commitCount = 0;
    rollbackCount = 0;
    queries = [];
    async beginTransaction() {
        this.beginCount += 1;
    }
    async commit() {
        this.commitCount += 1;
    }
    async rollback() {
        this.rollbackCount += 1;
    }
    async close() {
        /* no-op */
    }
    async query(sql, params = []) {
        this.queries.push(sql);
        if (sql.includes("FROM dbo.Projects")) {
            const id = this.slugToId.get(String(params[0]));
            return (id ? [{ id }] : []);
        }
        if (sql.trim().startsWith("SELECT")) {
            const projectId = String(params[0]);
            const caseId = Number(params[1]);
            const reqs = this.store.get(projectId)?.get(String(caseId)) ?? [];
            return reqs.map((r) => ({
                key: r.key,
                label: r.label ?? null,
                controlType: r.controlType ?? null,
                required: r.required ? 1 : 0,
                sensitive: r.sensitive ? 1 : 0,
                allowedValues: r.allowedValues ? JSON.stringify(r.allowedValues) : null,
            }));
        }
        if (sql.trim().startsWith("DELETE")) {
            const projectId = String(params[0]);
            const caseId = Number(params[1]);
            this.store.get(projectId)?.delete(String(caseId));
            return [];
        }
        if (sql.trim().startsWith("INSERT")) {
            const [projectId, caseId, key, label, controlType, required, sensitive, allowedValues] = params;
            const perProject = this.store.get(String(projectId)) ?? new Map();
            const reqs = perProject.get(String(caseId)) ?? [];
            reqs.push({
                key: String(key),
                label: label == null ? undefined : String(label),
                controlType: controlType == null ? undefined : String(controlType),
                required: required === 1,
                sensitive: sensitive === 1,
                allowedValues: typeof allowedValues === "string" ? JSON.parse(allowedValues) : undefined,
            });
            perProject.set(String(caseId), reqs);
            this.store.set(String(projectId), perProject);
            return [];
        }
        return [];
    }
}
function test(label, fn) {
    try {
        fn();
        console.log(`  PASS  ${label}`);
    }
    catch (err) {
        console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    }
}
function describe(_name, fn) {
    console.log(`\n${_name}`);
    fn();
}
describe("ProjectCaseInputRequirement service", () => {
    test("A: replace persists exactly 2 requirements for case A and get returns them", async () => {
        const conn = new FakeConnection();
        conn.slugToId.set("app-a", "p1");
        await (0, project_case_input_requirement_service_1.replaceForProjectAndCase)("app-a", 100, [
            { key: "auth.username", label: "Usuario", controlType: "text", required: true, sensitive: false },
            { key: "auth.password", controlType: "password", required: true, sensitive: true },
        ], conn);
        const result = await (0, project_case_input_requirement_service_1.getByProjectAndCase)("app-a", 100, conn);
        node_assert_1.default.strictEqual(result.length, 2);
        node_assert_1.default.ok(result.some((r) => r.key === "auth.username"));
        node_assert_1.default.ok(result.some((r) => r.key === "auth.password"));
    });
    test("B: replacing case A does not affect case B", async () => {
        const conn = new FakeConnection();
        conn.slugToId.set("app-a", "p1");
        await (0, project_case_input_requirement_service_1.replaceForProjectAndCase)("app-a", 100, [{ key: "auth.username" }], conn);
        await (0, project_case_input_requirement_service_1.replaceForProjectAndCase)("app-a", 101, [{ key: "employee.document", sensitive: true }], conn);
        await (0, project_case_input_requirement_service_1.replaceForProjectAndCase)("app-a", 100, [{ key: "auth.password", sensitive: true }], conn);
        const forA = await (0, project_case_input_requirement_service_1.getByProjectAndCase)("app-a", 100, conn);
        const forB = await (0, project_case_input_requirement_service_1.getByProjectAndCase)("app-a", 101, conn);
        node_assert_1.default.deepStrictEqual(forA.map((r) => r.key), ["auth.password"]);
        node_assert_1.default.deepStrictEqual(forB.map((r) => r.key), ["employee.document"]);
        node_assert_1.default.strictEqual(forB[0].sensitive, true);
    });
    test("C: allowedValues round-trips as string[]", async () => {
        const conn = new FakeConnection();
        conn.slugToId.set("app-a", "p1");
        await (0, project_case_input_requirement_service_1.replaceForProjectAndCase)("app-a", 200, [{ key: "auth.role", controlType: "select", allowedValues: ["admin", "user", "auditor"] }], conn);
        const result = await (0, project_case_input_requirement_service_1.getByProjectAndCase)("app-a", 200, conn);
        node_assert_1.default.deepStrictEqual(result[0].allowedValues, ["admin", "user", "auditor"]);
    });
    test("D: empty requirements delete existing requirements for the case", async () => {
        const conn = new FakeConnection();
        conn.slugToId.set("app-a", "p1");
        await (0, project_case_input_requirement_service_1.replaceForProjectAndCase)("app-a", 300, [{ key: "auth.username" }], conn);
        await (0, project_case_input_requirement_service_1.replaceForProjectAndCase)("app-a", 300, [], conn);
        const result = await (0, project_case_input_requirement_service_1.getByProjectAndCase)("app-a", 300, conn);
        node_assert_1.default.deepStrictEqual(result, []);
    });
    test("E: unknown project throws a controlled error and inserts nothing", async () => {
        const conn = new FakeConnection();
        conn.slugToId.set("app-a", "p1");
        await node_assert_1.default.rejects((0, project_case_input_requirement_service_1.replaceForProjectAndCase)("missing-app", 400, [{ key: "auth.username" }], conn), /project not found/);
        node_assert_1.default.strictEqual(conn.store.size, 0);
    });
    test("replace uses a transaction (begin/commit)", async () => {
        const conn = new FakeConnection();
        conn.slugToId.set("app-a", "p1");
        await (0, project_case_input_requirement_service_1.replaceForProjectAndCase)("app-a", 500, [{ key: "auth.username" }], conn);
        node_assert_1.default.ok(conn.beginCount >= 1);
        node_assert_1.default.ok(conn.commitCount >= 1);
    });
    test("read SELECT places namedProfileRef before allowedValues", async () => {
        const conn = new FakeConnection();
        conn.slugToId.set("app-a", "p1");
        await (0, project_case_input_requirement_service_1.getByProjectAndCase)("app-a", 600, conn);
        const select = conn.queries.find((sql) => sql.includes("FROM dbo.ProjectCaseInputRequirement"));
        node_assert_1.default.ok(select, "missing ProjectCaseInputRequirement SELECT");
        const namedProfileIndex = select.indexOf("namedProfileRef");
        const allowedValuesIndex = select.indexOf("allowedValues");
        node_assert_1.default.ok(namedProfileIndex >= 0, "missing namedProfileRef");
        node_assert_1.default.ok(allowedValuesIndex > namedProfileIndex, "allowedValues must follow namedProfileRef");
        node_assert_1.default.match(select.trim(), /allowedValues\s*\n\s+FROM\s+dbo\.ProjectCaseInputRequirement/i);
    });
});
