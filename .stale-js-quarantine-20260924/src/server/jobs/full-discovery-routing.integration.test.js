"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const launch_orchestrator_1 = require("./launch-orchestrator");
const job_store_1 = require("./job-store");
const discovery_batch_runner_1 = require("./discovery-batch-runner");
function launchInput(overrides = {}) {
    return {
        appSlug: "app-a",
        sectionSlug: "section-a",
        sectionName: "Section A",
        projectId: 11,
        suiteId: 22,
        sectionId: 33,
        selectedScenarios: [],
        existingTestRailCaseIds: [100],
        runtimeEntriesByCase: {
            "100": [{ key: "auth.username", value: "runtime-fixture", source: "test", sensitive: false }],
        },
        ...overrides,
    };
}
function routeAfterRunnerReceivesJob(params) {
    const job = job_store_1.jobStore.create("discovery-batch", params);
    const stored = job_store_1.jobStore.getInternal(job.id);
    strict_1.default.ok(stored);
    const runnerParams = stored.params;
    const intent = (0, discovery_batch_runner_1.resolveRediscoveryIntent)({
        forceRediscovery: runnerParams.forceRediscovery,
        overwrite: runnerParams.overwrite,
        rerunActive: runnerParams.rerunActive,
        executePromotedSpecs: runnerParams.executePromotedSpecs,
    });
    const route = (0, discovery_batch_runner_1.resolveRouteFromValidation)({
        caseId: 100,
        appSlug: String(runnerParams.appSlug),
        forceRediscovery: intent.explicit,
        rediscoveryIntent: intent.rediscoveryIntent,
        validation: {
            reusable: true,
            blocked: false,
            reason: "promoted_spec_valid",
            specPath: "automations/apps/app-a/sections/section-a/cases/c100/case.spec.ts",
        },
    });
    return { runnerParams, intent, route };
}
const publishedCases = [{ scenarioId: "TR-CASE-100", caseId: 100, title: "Case A" }];
(0, node_test_1.test)("productive launch handoff preserves explicit Full Discovery through job, runner, intent and route", () => {
    const params = (0, launch_orchestrator_1.buildDiscoveryBatchParamsFromLaunch)({
        launch: launchInput({ forceRediscovery: true }),
        executionCaseIds: [100],
        publishedCases,
        launchId: "launch-integration-a",
        testRunId: 44,
    });
    const { runnerParams, intent, route } = routeAfterRunnerReceivesJob(params);
    strict_1.default.equal(runnerParams.forceRediscovery, true);
    strict_1.default.equal(runnerParams.runtimeEntriesByCase !== undefined, true);
    strict_1.default.equal(intent.explicit, true);
    strict_1.default.equal(intent.source, "user_request");
    strict_1.default.equal(route.route, "full_discovery");
    strict_1.default.equal(route.reason, "explicit_rediscovery_requested");
});
(0, node_test_1.test)("productive launch handoff preserves false and keeps legacy flags out of rediscovery", () => {
    const params = (0, launch_orchestrator_1.buildDiscoveryBatchParamsFromLaunch)({
        launch: launchInput({ forceRediscovery: false }),
        executionCaseIds: [100],
        publishedCases,
        launchId: "launch-integration-b",
    });
    const { runnerParams, intent, route } = routeAfterRunnerReceivesJob(params);
    strict_1.default.equal(runnerParams.forceRediscovery, false);
    strict_1.default.equal(intent.explicit, false);
    strict_1.default.equal(intent.rerunIntent, false);
    strict_1.default.equal(route.route, "promoted_reuse");
});
(0, node_test_1.test)("productive launch handoff keeps an absent forceRediscovery property absent", () => {
    const params = (0, launch_orchestrator_1.buildDiscoveryBatchParamsFromLaunch)({
        launch: launchInput(),
        executionCaseIds: [100],
        publishedCases,
        launchId: "launch-integration-c",
    });
    const { runnerParams, intent, route } = routeAfterRunnerReceivesJob(params);
    strict_1.default.equal(Object.prototype.hasOwnProperty.call(runnerParams, "forceRediscovery"), false);
    strict_1.default.equal(intent.explicit, false);
    strict_1.default.equal(route.route, "promoted_reuse");
});
(0, node_test_1.test)("productive launch handoff preserves explicit overwrite for generated artifacts", () => {
    const params = (0, launch_orchestrator_1.buildDiscoveryBatchParamsFromLaunch)({
        launch: launchInput({ forceRediscovery: false, overwrite: true }),
        executionCaseIds: [100],
        publishedCases,
        launchId: "launch-integration-overwrite",
    });
    strict_1.default.equal(params.overwrite, true);
    strict_1.default.equal(params.forceRediscovery, false);
});
