"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const project_case_input_requirement_service_1 = require("./project-case-input-requirement-service");
class FakeConnection {
    slugToId = new Map();
    requirements = new Map();
    configs = new Map();
    configError;
    async beginTransaction() { }
    async commit() { }
    async rollback() { }
    async close() { }
    async query(sql, params = []) {
        if (sql.includes("FROM dbo.Projects"))
            return (this.slugToId.has(String(params[0])) ? [{ id: this.slugToId.get(String(params[0])) }] : []);
        if (sql.includes("FROM dbo.ProjectGenerationConfig")) {
            if (this.configError)
                throw this.configError;
            const config = this.configs.get(String(params[0]));
            return config ? [{ projectId: String(params[0]), version: config.version, configJson: JSON.stringify(config) }] : [];
        }
        if (sql.trim().startsWith("SELECT")) {
            const rows = this.requirements.get(`${params[0]}:${params[1]}`) ?? [];
            return rows.map((r) => ({ key: r.key, label: r.label ?? null, controlType: r.controlType ?? null, required: r.required ? 1 : 0, sensitive: r.sensitive ? 1 : 0, allowedValues: r.allowedValues ? JSON.stringify(r.allowedValues) : null, namedProfileRef: r.namedProfileRef ?? null }));
        }
        if (sql.trim().startsWith("DELETE")) {
            const rows = this.requirements.get(`${params[0]}:${params[1]}`) ?? [];
            if (params.length > 2) {
                this.requirements.set(`${params[0]}:${params[1]}`, rows.filter((r) => r.key !== params[2]));
            }
            else {
                this.requirements.delete(`${params[0]}:${params[1]}`);
            }
            return [];
        }
        if (sql.trim().startsWith("INSERT")) {
            const [projectId, caseId, key, label, controlType, required, sensitive, allowedValues, namedProfileRef] = params;
            const rows = this.requirements.get(`${projectId}:${caseId}`) ?? [];
            rows.push({ key: String(key), label: label == null ? undefined : String(label), controlType: controlType == null ? undefined : String(controlType), required: required === 1, sensitive: sensitive === 1, allowedValues: typeof allowedValues === "string" ? JSON.parse(allowedValues) : undefined, namedProfileRef: namedProfileRef == null ? null : String(namedProfileRef) });
            this.requirements.set(`${projectId}:${caseId}`, rows);
            return [];
        }
        if (sql.trim().startsWith("UPDATE")) {
            const [label, controlType, required, sensitive, allowedValues] = params;
            const hasNamedProfileRef = params.length === 9;
            const namedProfileRef = hasNamedProfileRef ? params[5] : undefined;
            const projectId = params[hasNamedProfileRef ? 6 : 5];
            const caseId = params[hasNamedProfileRef ? 7 : 6];
            const key = params[hasNamedProfileRef ? 8 : 7];
            const rows = this.requirements.get(`${projectId}:${caseId}`) ?? [];
            const row = rows.find((r) => r.key === key);
            if (row) {
                row.label = label == null ? undefined : String(label);
                row.controlType = controlType == null ? undefined : String(controlType);
                row.required = required === 1;
                row.sensitive = sensitive === 1;
                row.allowedValues = typeof allowedValues === "string" ? JSON.parse(allowedValues) : undefined;
                if (namedProfileRef !== undefined)
                    row.namedProfileRef = namedProfileRef == null ? null : String(namedProfileRef);
            }
            return [];
        }
        return [];
    }
}
const profile = { valueKind: "string", sourceMode: "synthetic" };
function setup() {
    const conn = new FakeConnection();
    conn.slugToId.set("app-a", "project-a");
    conn.slugToId.set("app-b", "project-b");
    return conn;
}
(0, node_test_1.default)("namedProfileRef persistence validates same-project config and pending lifecycle", async (t) => {
    await t.test("null and valid refs round-trip, and null clears the binding", async () => {
        const conn = setup();
        conn.configs.set("project-a", { version: "v1", namedProfiles: { profile_a: profile } });
        await (0, project_case_input_requirement_service_1.replaceForProjectAndCase)("app-a", 1, [{ key: "field", namedProfileRef: "profile_a" }, { key: "other", namedProfileRef: "" }], conn);
        strict_1.default.deepEqual((await (0, project_case_input_requirement_service_1.getByProjectAndCase)("app-a", 1, conn)).map((r) => r.namedProfileRef), ["profile_a", null]);
        await (0, project_case_input_requirement_service_1.replaceForProjectAndCase)("app-a", 1, [{ key: "field", namedProfileRef: null }], conn);
        strict_1.default.equal((await (0, project_case_input_requirement_service_1.getByProjectAndCase)("app-a", 1, conn))[0].namedProfileRef, null);
    });
    await t.test("rejects an unknown ref when same-project config exists", async () => {
        const conn = setup();
        conn.configs.set("project-a", { version: "v1", namedProfiles: { other: profile } });
        await strict_1.default.rejects((0, project_case_input_requirement_service_1.replaceForProjectAndCase)("app-a", 2, [{ key: "field", namedProfileRef: "missing" }], conn), (error) => error.code === "named_profile_reference_not_configured");
    });
    await t.test("allows pending ref when config is absent but propagates lookup errors", async () => {
        const conn = setup();
        await (0, project_case_input_requirement_service_1.replaceForProjectAndCase)("app-a", 3, [{ key: "field", namedProfileRef: "pending" }], conn);
        strict_1.default.equal((await (0, project_case_input_requirement_service_1.getByProjectAndCase)("app-a", 3, conn))[0].namedProfileRef, "pending");
        conn.configError = new Error("database unavailable");
        await strict_1.default.rejects((0, project_case_input_requirement_service_1.replaceForProjectAndCase)("app-a", 4, [{ key: "field", namedProfileRef: "pending" }], conn), /database unavailable/);
    });
    await t.test("does not validate against another project's config", async () => {
        const conn = setup();
        conn.configs.set("project-a", { version: "v1", namedProfiles: {} });
        conn.configs.set("project-b", { version: "v1", namedProfiles: { foreign: profile } });
        await strict_1.default.rejects((0, project_case_input_requirement_service_1.replaceForProjectAndCase)("app-a", 5, [{ key: "field", namedProfileRef: "foreign" }], conn), (error) => error.code === "named_profile_reference_not_configured");
    });
    await t.test("merges parser output while preserving local bindings and removing absent keys", async () => {
        const conn = setup();
        conn.requirements.set("project-a:6", [
            { key: "existing", label: "old", controlType: "text", required: false, sensitive: false, allowedValues: [], namedProfileRef: "profile-x" },
            { key: "removed", label: "remove", namedProfileRef: "profile-y" },
        ]);
        await (0, project_case_input_requirement_service_1.replaceForProjectAndCase)("app-a", 6, [
            { key: "existing", label: "new", controlType: "date", required: true, sensitive: true, allowedValues: ["A"] },
            { key: "new", label: "new key", controlType: "text", required: true, sensitive: false, allowedValues: [] },
            { key: "new", label: "duplicate", controlType: "text" },
        ], conn);
        const result = await (0, project_case_input_requirement_service_1.getByProjectAndCase)("app-a", 6, conn);
        strict_1.default.deepEqual(result, [
            { key: "existing", label: "new", controlType: "date", required: true, sensitive: true, allowedValues: ["A"], namedProfileRef: "profile-x" },
            { key: "new", label: "new key", controlType: "text", required: true, sensitive: false, allowedValues: [], namedProfileRef: null },
        ]);
    });
});
