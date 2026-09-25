"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_fs_1 = __importDefault(require("node:fs"));
const discovery_batch_runner_1 = require("./discovery-batch-runner");
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
describe("discovery runtime context transport (runner)", () => {
    test("writeRuntimeContextIfPresent persists caseId -> entries and returns the path", () => {
        const jobId = "rt-runner-1";
        const params = {
            caseIds: [100, 200],
            runtimeEntriesByCase: {
                "100": [{ key: "auth.username", value: "runtime-user", source: "fixture", sensitive: false }],
                "200": [{ key: "employee.document", value: "DOC-1", source: "fixture", sensitive: true }],
            },
        };
        const target = (0, discovery_batch_runner_1.writeRuntimeContextIfPresent)(jobId, params);
        node_assert_1.default.ok(target);
        const parsed = JSON.parse(node_fs_1.default.readFileSync(target, "utf-8"));
        node_assert_1.default.strictEqual(parsed["100"][0].key, "auth.username");
        node_assert_1.default.strictEqual(parsed["100"][0].value, "runtime-user");
        node_assert_1.default.strictEqual(parsed["200"][0].value, "DOC-1");
    });
    test("normalizes UI manual runtime entries by semantic key, never by value", () => {
        node_assert_1.default.strictEqual((0, discovery_batch_runner_1.normalizeRuntimeEntry)({ key: "auth.username", value: "runtime-user", source: "manual_runtime", sensitive: true }).source, "user_provided_qa_credentials");
        node_assert_1.default.strictEqual((0, discovery_batch_runner_1.normalizeRuntimeEntry)({ key: "employee.document", value: "DOC-1", source: "manual_runtime", sensitive: true }).source, "explicit_runtime_input");
        node_assert_1.default.strictEqual((0, discovery_batch_runner_1.normalizeRuntimeEntry)({ key: "employee.document", value: "DOC-1", source: "fixture", sensitive: true }).source, "fixture");
    });
    test("writeRuntimeContextIfPresent returns undefined without runtimeEntriesByCase", () => {
        const target = (0, discovery_batch_runner_1.writeRuntimeContextIfPresent)("rt-runner-2", { caseIds: [100] });
        node_assert_1.default.strictEqual(target, undefined);
    });
    test("deleteRuntimeContextIfExists removes the file and is idempotent on ENOENT", async () => {
        const jobId = "rt-runner-3";
        (0, discovery_batch_runner_1.writeRuntimeContextIfPresent)(jobId, {
            caseIds: [100],
            runtimeEntriesByCase: { "100": [{ key: "a", value: "b", source: "fixture", sensitive: false }] },
        });
        const target = (0, discovery_batch_runner_1.buildRuntimeContextPath)(jobId);
        node_assert_1.default.ok(node_fs_1.default.existsSync(target));
        await (0, discovery_batch_runner_1.deleteRuntimeContextIfExists)(jobId);
        node_assert_1.default.ok(!node_fs_1.default.existsSync(target));
        await (0, discovery_batch_runner_1.deleteRuntimeContextIfExists)(jobId);
    });
    test("buildDiscoveryChildEnv only adds DISCOVERY_RUNTIME_CONTEXT when a path is present", () => {
        const base = { APP_SLUG: "app-a" };
        node_assert_1.default.strictEqual((0, discovery_batch_runner_1.buildDiscoveryChildEnv)(base, "/tmp/ctx.json").DISCOVERY_RUNTIME_CONTEXT, "/tmp/ctx.json");
        node_assert_1.default.strictEqual((0, discovery_batch_runner_1.buildDiscoveryChildEnv)(base, undefined).DISCOVERY_RUNTIME_CONTEXT, undefined);
    });
    test("discovery args never include runtime values", () => {
        const args = (0, discovery_batch_runner_1.buildDiscoveryBatchArgs)({ caseIds: [100], appSlug: "app-a" }, [100]);
        node_assert_1.default.ok(!args.some((a) => a.includes("runtime-user") || a.includes("DOC-1")));
    });
    test("discovery args carry explicit TestRail launch identity", () => {
        const args = (0, discovery_batch_runner_1.buildDiscoveryBatchArgs)({
            caseIds: [44757],
            appSlug: "app-a",
            testRailProjectId: 30,
            testRailSuiteId: 37,
            testRailSectionId: 5794,
        }, [44757]);
        node_assert_1.default.deepStrictEqual(args.slice(-6), [
            "--testrail-project-id", "30",
            "--testrail-suite-id", "37",
            "--testrail-section-id", "5794",
        ]);
    });
});
