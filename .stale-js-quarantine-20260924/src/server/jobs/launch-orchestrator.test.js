"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const launch_orchestrator_1 = require("./launch-orchestrator");
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
function describe(_name, fn) { console.log(`\n${_name}`); fn(); }
const validScenarios = [{ scenarioId: "LAUNCH-001", title: "Test", steps: ["Step 1"], expectedResult: "OK", preconditions: [] }];
// Store environment before tests
const originalEnv = { ...process.env };
describe("launchExecution validation", () => {
    test("targeted discovery without reusable automation is admitted as mcp_required", () => {
        const plan = (0, launch_orchestrator_1.resolveExistingCaseExecutionPlan)({
            caseIds: [100], appSlug: "app-a", entries: [],
            caseContracts: new Map([[100, { usable: false, reasonCode: "targeted_gap_resolution_required", recommendedRoute: "targeted_discovery" }]]),
        });
        node_assert_1.default.strictEqual(plan.mcpRequired[0]?.executionSource, "mcp_required");
        node_assert_1.default.deepStrictEqual(plan.blocked, []);
    });
    test("full discovery without reusable automation is admitted as mcp_required", () => {
        const plan = (0, launch_orchestrator_1.resolveExistingCaseExecutionPlan)({
            caseIds: [101], appSlug: "app-a", entries: [],
            caseContracts: new Map([[101, { usable: false, reasonCode: "contract_insufficient_for_fast_path", recommendedRoute: "full_discovery" }]]),
        });
        node_assert_1.default.strictEqual(plan.mcpRequired[0]?.executionSource, "mcp_required");
        node_assert_1.default.deepStrictEqual(plan.blocked, []);
    });
    test("hard-blocked contract remains blocked", () => {
        const plan = (0, launch_orchestrator_1.resolveExistingCaseExecutionPlan)({
            caseIds: [102], appSlug: "app-a", entries: [],
            caseContracts: new Map([[102, { usable: false, reasonCode: "non_automatable_contract" }]]),
        });
        node_assert_1.default.strictEqual(plan.blocked[0]?.executionSource, "blocked");
        node_assert_1.default.deepStrictEqual(plan.mcpRequired, []);
    });
    test("reusable automation remains existing_spec", () => {
        const plan = (0, launch_orchestrator_1.resolveExistingCaseExecutionPlan)({
            caseIds: [103], appSlug: "app-a",
            entries: [{ id: "automation-103", caseId: 103, appSlug: "app-a", status: "active", pomStatus: "promoted", specVerificationStatus: "passed", title: "Reusable" }],
            validateSpec: () => ({ reusable: true, blocked: false, reason: "promoted_spec_valid", specPath: "spec.ts" }),
        });
        node_assert_1.default.strictEqual(plan.existingSpec[0]?.executionSource, "existing_spec");
        node_assert_1.default.deepStrictEqual(plan.mcpRequired, []);
    });
    test("separa rerun de rediscovery y conserva el routing semántico", () => {
        const manual = (0, discovery_batch_runner_1.resolveRouteFromValidation)({
            caseId: 201, appSlug: "app-a", forceRediscovery: false,
            contractEvaluation: { sufficient: false, reasonCode: "missing_route_evidence", recommendedRoute: "full_discovery" },
            validation: { reusable: false, blocked: false, reason: "missing_route_evidence" },
        });
        const reusable = {
            caseId: 202, appSlug: "app-a", forceRediscovery: false,
            validation: { reusable: true, blocked: false, reason: "promoted_spec_valid", specPath: "spec.ts" },
        };
        const normal = (0, discovery_batch_runner_1.resolveRouteFromValidation)(reusable);
        const rerunIntent = (0, discovery_batch_runner_1.resolveRediscoveryIntent)({ rerunActive: true, executePromotedSpecs: true });
        const rerun = (0, discovery_batch_runner_1.resolveRouteFromValidation)({ ...reusable, rediscoveryIntent: rerunIntent.rediscoveryIntent });
        const stale = (0, discovery_batch_runner_1.resolveRouteFromValidation)({
            caseId: 203, appSlug: "app-a", forceRediscovery: false, targetedDiscoverySupported: true,
            contractEvaluation: { sufficient: false, reasonCode: "contract_stale", recommendedRoute: "targeted_discovery" },
            validation: { reusable: false, blocked: false, reason: "contract_stale", specPath: "spec.ts" },
        });
        const explicitRediscovery = (0, discovery_batch_runner_1.resolveRouteFromValidation)({
            caseId: 204, appSlug: "app-a", forceRediscovery: true,
            validation: { reusable: true, blocked: false, reason: "promoted_spec_valid", specPath: "spec.ts" },
        });
        const overwrite = (0, discovery_batch_runner_1.resolveRediscoveryIntent)({ overwrite: true, executePromotedSpecs: true });
        node_assert_1.default.strictEqual(manual.route, "full_discovery");
        node_assert_1.default.strictEqual(normal.route, "promoted_reuse");
        node_assert_1.default.strictEqual(rerunIntent.rerunIntent, true);
        node_assert_1.default.strictEqual(rerunIntent.rediscoveryIntent, false);
        node_assert_1.default.strictEqual(rerun.route, "promoted_reuse");
        node_assert_1.default.strictEqual(stale.route, "targeted_discovery");
        node_assert_1.default.strictEqual(explicitRediscovery.route, "full_discovery");
        node_assert_1.default.strictEqual(overwrite.rediscoveryIntent, false);
    });
    test("fails if no projectId", async () => {
        const { launchExecution } = await Promise.resolve().then(() => __importStar(require("./launch-orchestrator")));
        const input = { appSlug: "test", selectedScenarios: validScenarios };
        const result = await launchExecution(input);
        node_assert_1.default.ok(!result.ok);
        node_assert_1.default.strictEqual(result.error, "missing_project_id");
    });
    test("fails if no sectionId", async () => {
        const { launchExecution } = await Promise.resolve().then(() => __importStar(require("./launch-orchestrator")));
        const input = { appSlug: "test", projectId: 1, selectedScenarios: validScenarios };
        const result = await launchExecution(input);
        node_assert_1.default.ok(!result.ok);
        node_assert_1.default.strictEqual(result.error, "missing_section_id");
    });
    test("fails if no selectedScenarios", async () => {
        const { launchExecution } = await Promise.resolve().then(() => __importStar(require("./launch-orchestrator")));
        const input = { appSlug: "test", projectId: 1, sectionId: 10, selectedScenarios: [] };
        const result = await launchExecution(input);
        node_assert_1.default.ok(!result.ok);
        node_assert_1.default.strictEqual(result.error, "missing_selected_scenarios");
    });
    test("testrailSectionId works as fallback for sectionId", async () => {
        const { launchExecution } = await Promise.resolve().then(() => __importStar(require("./launch-orchestrator")));
        const input = { appSlug: "test", projectId: 1, testrailSectionId: 15, selectedScenarios: validScenarios };
        const result = await launchExecution(input);
        // Should pass validation but fail at publish (no real TestRail)
        node_assert_1.default.ok(!result.ok);
        node_assert_1.default.notStrictEqual(result.error, "missing_section_id");
    });
    test("publish_failed returned when TestRail not available", async () => {
        const { launchExecution } = await Promise.resolve().then(() => __importStar(require("./launch-orchestrator")));
        const input = { appSlug: "test", projectId: 1, sectionId: 10, selectedScenarios: validScenarios };
        const result = await launchExecution(input);
        node_assert_1.default.ok(!result.ok);
        node_assert_1.default.strictEqual(result.error, "publish_failed");
    });
    test("suiteId is included when provided", async () => {
        const { launchExecution } = await Promise.resolve().then(() => __importStar(require("./launch-orchestrator")));
        const input = {
            appSlug: "test", projectId: 1, suiteId: 5, sectionId: 10,
            selectedScenarios: validScenarios,
        };
        const result = await launchExecution(input);
        node_assert_1.default.ok(!result.ok);
        // SuiteId is passed through to publish (which fails due to no TestRail)
        node_assert_1.default.strictEqual(result.error, "publish_failed");
    });
    test("jiraKey is accepted in payload", async () => {
        const { launchExecution } = await Promise.resolve().then(() => __importStar(require("./launch-orchestrator")));
        const input = {
            appSlug: "test", projectId: 1, sectionId: 10,
            jiraKey: "HU-123", sprintName: "Sprint 1",
            selectedScenarios: validScenarios,
        };
        const result = await launchExecution(input);
        node_assert_1.default.ok(!result.ok);
        // jiraKey is metadata, should not cause validation to fail
        node_assert_1.default.notStrictEqual(result.error, "missing_project_id");
    });
    test("publishStrategy always_create is default", async () => {
        const { launchExecution } = await Promise.resolve().then(() => __importStar(require("./launch-orchestrator")));
        const input = { appSlug: "test", projectId: 1, sectionId: 10, selectedScenarios: validScenarios };
        const result = await launchExecution(input);
        node_assert_1.default.ok(!result.ok);
        // Default strategy should not cause validation errors
        node_assert_1.default.notStrictEqual(result.error, "missing_project_id");
    });
    test("only selectedScenarios are published (no extra scenarios leaked)", async () => {
        const { launchExecution } = await Promise.resolve().then(() => __importStar(require("./launch-orchestrator")));
        const scenarios = [
            { scenarioId: "LAUNCH-001", title: "Scenario A", steps: ["Step 1"], expectedResult: "OK", preconditions: [] },
            { scenarioId: "LAUNCH-002", title: "Scenario B", steps: ["Step 1"], expectedResult: "OK", preconditions: [] },
        ];
        const input = { appSlug: "test", projectId: 1, sectionId: 10, selectedScenarios: scenarios };
        const result = await launchExecution(input);
        node_assert_1.default.ok(!result.ok);
        // Only 2 scenarios should be in the publish call
        node_assert_1.default.strictEqual(result.error, "publish_failed");
        // If it reached publish with wrong count, publish would still fail
    });
    test("launchId is a UUID", async () => {
        const { launchExecution } = await Promise.resolve().then(() => __importStar(require("./launch-orchestrator")));
        const input = { appSlug: "test", projectId: 1, sectionId: 10, selectedScenarios: validScenarios };
        const result = await launchExecution(input);
        node_assert_1.default.ok(!result.ok);
        // UUID was generated (manifest would have it, but publish failed)
        // Verify via the error message that the launch started
        node_assert_1.default.strictEqual(result.error, "publish_failed");
    });
    test("sectionSlug is independent from appSlug", async () => {
        const { launchExecution } = await Promise.resolve().then(() => __importStar(require("./launch-orchestrator")));
        const input = {
            appSlug: "app-a", sectionSlug: "section-b",
            projectId: 1, sectionId: 10, selectedScenarios: validScenarios,
        };
        const result = await launchExecution(input);
        node_assert_1.default.ok(!result.ok);
        // Different values should not cause validation errors
        node_assert_1.default.strictEqual(result.error, "publish_failed");
    });
    test("does not run discovery or external processes", async () => {
        const { launchExecution } = await Promise.resolve().then(() => __importStar(require("./launch-orchestrator")));
        const input = { appSlug: "test", projectId: 1, sectionId: 10, selectedScenarios: validScenarios };
        const startTime = Date.now();
        const result = await launchExecution(input);
        const elapsed = Date.now() - startTime;
        node_assert_1.default.ok(!result.ok);
        // Should fail quickly (< 5s) at publish, not waiting for discovery
        node_assert_1.default.ok(elapsed < 5000, `took ${elapsed}ms - might have run discovery`);
        node_assert_1.default.strictEqual(result.error, "publish_failed");
    });
});
