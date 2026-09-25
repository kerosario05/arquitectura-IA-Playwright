"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const discovery_batch_1 = require("./discovery-batch");
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
describe("discovery runtime context CLI", () => {
    test("resolveRuntimeEntriesForCase returns only the entries for the requested caseId", () => {
        const context = {
            "100": [{ key: "auth.username", value: "runtime-user", source: "fixture", sensitive: false }],
            "200": [{ key: "employee.document", value: "DOC-1", source: "fixture", sensitive: true }],
        };
        const for100 = (0, discovery_batch_1.resolveRuntimeEntriesForCase)(context, 100);
        const for200 = (0, discovery_batch_1.resolveRuntimeEntriesForCase)(context, 200);
        node_assert_1.default.strictEqual(for100.length, 1);
        node_assert_1.default.strictEqual(for100[0].key, "auth.username");
        node_assert_1.default.strictEqual(for100[0].value, "runtime-user");
        node_assert_1.default.strictEqual(for200.length, 1);
        node_assert_1.default.strictEqual(for200[0].key, "employee.document");
    });
    test("resolveRuntimeEntriesForCase returns undefined without context or entries for the case", () => {
        node_assert_1.default.strictEqual((0, discovery_batch_1.resolveRuntimeEntriesForCase)(undefined, 100), undefined);
        node_assert_1.default.strictEqual((0, discovery_batch_1.resolveRuntimeEntriesForCase)({ "100": [] }, 100), undefined);
        node_assert_1.default.strictEqual((0, discovery_batch_1.resolveRuntimeEntriesForCase)({ "100": [{ key: "a", value: "b", source: "fixture", sensitive: false }] }, 999), undefined);
    });
    test("loadRuntimeContextFromPath parses the file and tolerates missing env path", async () => {
        const context = { "100": [{ key: "a", value: "b", source: "fixture", sensitive: false }] };
        const dir = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "rt-ctx-"));
        const file = node_path_1.default.join(dir, "ctx.json");
        await promises_1.default.writeFile(file, JSON.stringify(context), "utf-8");
        node_assert_1.default.strictEqual(JSON.stringify(await (0, discovery_batch_1.loadRuntimeContextFromPath)(file)), JSON.stringify(context));
        node_assert_1.default.strictEqual(await (0, discovery_batch_1.loadRuntimeContextFromPath)(undefined), undefined);
        node_assert_1.default.strictEqual(await (0, discovery_batch_1.loadRuntimeContextFromPath)(node_path_1.default.join(dir, "missing.json")), undefined);
    });
    test("explicit TestRail CLI identity overrides config fallback", () => {
        const args = (0, discovery_batch_1.parseBatchArgs)([
            "--case-ids", "44757",
            "--testrail-project-id", "30",
            "--testrail-suite-id", "37",
            "--testrail-section-id", "5794",
        ]);
        node_assert_1.default.deepStrictEqual((0, discovery_batch_1.resolveTestRailSelectionIds)(args), { projectId: "30", suiteId: "37", sectionId: "5794" });
    });
    test("without explicit TestRail identity, config fallback remains selected", () => {
        const args = (0, discovery_batch_1.parseBatchArgs)(["--case-ids", "44757"]);
        const ids = (0, discovery_batch_1.resolveTestRailSelectionIds)(args);
        node_assert_1.default.ok(ids.projectId);
        node_assert_1.default.ok(ids.suiteId);
        node_assert_1.default.ok(ids.sectionId);
    });
});
