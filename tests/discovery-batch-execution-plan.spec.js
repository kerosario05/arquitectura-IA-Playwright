"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const discovery_batch_runner_1 = require("../src/server/jobs/discovery-batch-runner");
const case_discovery_workflow_1 = require("../src/discovery/case-discovery-workflow");
(0, test_1.test)("execution plan: all requested cases are executable", () => {
    const plan = (0, discovery_batch_runner_1.buildDiscoveryBatchExecutionPlan)([42868, 42869, 42870], new Set([42868, 42869, 42870]), new Set([42868, 42869, 42870]));
    (0, test_1.expect)(plan.requestedCaseIds).toEqual([42868, 42869, 42870]);
    (0, test_1.expect)(plan.executableCaseIds).toEqual([42868, 42869, 42870]);
    (0, test_1.expect)(plan.notExecutableCaseIds).toEqual([]);
    (0, test_1.expect)(plan.requiresDiscoveryCaseIds).toEqual([]);
});
(0, test_1.test)("execution plan: one promoted and two discovered_partial stay non-executable", () => {
    const plan = (0, discovery_batch_runner_1.buildDiscoveryBatchExecutionPlan)([5001, 5002, 5003], new Set([5001]), new Set([5001]));
    (0, test_1.expect)(plan.alreadyPromotedCaseIds).toEqual([5001]);
    (0, test_1.expect)(plan.executableCaseIds).toEqual([5001]);
    (0, test_1.expect)(plan.notExecutableCaseIds).toEqual([5002, 5003]);
    (0, test_1.expect)(plan.requiresDiscoveryCaseIds).toEqual([5002, 5003]);
});
(0, test_1.test)("execution plan: no promoted cases yields empty executable list", () => {
    const plan = (0, discovery_batch_runner_1.buildDiscoveryBatchExecutionPlan)([7001, 7002], new Set(), new Set());
    (0, test_1.expect)(plan.executableCaseIds).toEqual([]);
    (0, test_1.expect)(plan.notExecutableCaseIds).toEqual([7001, 7002]);
});
(0, test_1.test)("functional snapshot: progress and pass rate are separated", () => {
    const snapshot = (0, discovery_batch_runner_1.computeFunctionalExecutionSnapshot)({
        requested: 3,
        completed: 1,
        executed: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
    });
    (0, test_1.expect)(snapshot.progressPercent).toBe(33.33);
    (0, test_1.expect)(snapshot.passRate).toBe(100);
});
(0, test_1.test)("functional snapshot: pass rate is null when no cases were executed", () => {
    const snapshot = (0, discovery_batch_runner_1.computeFunctionalExecutionSnapshot)({
        requested: 3,
        completed: 1,
        executed: 0,
        passed: 0,
        failed: 0,
        skipped: 1,
    });
    (0, test_1.expect)(snapshot.progressPercent).toBe(33.33);
    (0, test_1.expect)(snapshot.passRate).toBeNull();
});
(0, test_1.test)("functional snapshot: non-executable failures reduce pass rate", () => {
    const snapshot = (0, discovery_batch_runner_1.computeFunctionalExecutionSnapshot)({
        requested: 3,
        completed: 2,
        executed: 1,
        passed: 1,
        failed: 1,
        skipped: 0,
    });
    (0, test_1.expect)(snapshot.progressPercent).toBe(66.67);
    (0, test_1.expect)(snapshot.passRate).toBe(50);
});
(0, test_1.test)("test:promoted args include headed only when explicitly requested", () => {
    const defaultArgs = (0, discovery_batch_runner_1.buildTestPromotedArgs)({ caseIds: [42868] }, 42868);
    (0, test_1.expect)(defaultArgs).not.toContain("--headed");
    const headedArgs = (0, discovery_batch_runner_1.buildTestPromotedArgs)({ caseIds: [42868], headed: true }, 42868);
    (0, test_1.expect)(headedArgs).toContain("--headed");
});
(0, test_1.test)("automatic promoted execution forces headless contract env", () => {
    const env = (0, discovery_batch_runner_1.buildPromotedExecutionEnv)({ caseIds: [42868], appSlug: "app-a", sectionSlug: "detalle-kiosko" }, "job-123", { HEADLESS: "false", PWDEBUG: "1" });
    (0, test_1.expect)(env.EVIDENCE_RUN_ID).toBe("job-123");
    (0, test_1.expect)(env.APP_SLUG).toBe("app-a");
    (0, test_1.expect)(env.SECTION_SLUG).toBe("detalle-kiosko");
    (0, test_1.expect)(env.EVIDENCE_APP_SLUG).toBe("app-a");
    (0, test_1.expect)(env.EVIDENCE_SECTION_SLUG).toBe("detalle-kiosko");
    (0, test_1.expect)(env.AUTOMATION_HEADLESS).toBe("true");
    (0, test_1.expect)(env.AUTOMATION_SOURCE).toBe("qa_lab_automatic");
});
(0, test_1.test)("explicit headed promoted execution does not force automation headless", () => {
    const env = (0, discovery_batch_runner_1.buildPromotedExecutionEnv)({ caseIds: [42868], headed: true }, "job-123", {});
    (0, test_1.expect)(env.AUTOMATION_HEADLESS).toBeUndefined();
    (0, test_1.expect)(env.AUTOMATION_SOURCE).toBeUndefined();
});
(0, test_1.test)("checklist identity prefers launchId and falls back to jobId", () => {
    (0, test_1.expect)((0, discovery_batch_runner_1.buildDiscoveryBatchChecklistIdentity)({ jobId: "job-123", launchId: "launch-abc" })).toBe("launch:launch-abc");
    (0, test_1.expect)((0, discovery_batch_runner_1.buildDiscoveryBatchChecklistIdentity)({ jobId: "job-123" })).toBe("job:job-123");
});
(0, test_1.test)("issueKey metadata stays optional and only resolves unique source key", () => {
    (0, test_1.expect)((0, discovery_batch_runner_1.resolveDiscoveryBatchIssueKeyMetadata)({
        jiraKey: "QA-101",
        publishedCases: [{ sourceIssueKey: "QA-999" }],
    })).toBe("QA-101");
    (0, test_1.expect)((0, discovery_batch_runner_1.resolveDiscoveryBatchIssueKeyMetadata)({
        publishedCases: [{ sourceIssueKey: "QA-1" }, { sourceIssueKey: "QA-2" }],
    })).toBeUndefined();
    (0, test_1.expect)((0, discovery_batch_runner_1.resolveDiscoveryBatchIssueKeyMetadata)({
        publishedCases: [{ sourceIssueKey: "QA-1" }, { sourceIssueKey: "QA-1" }],
    })).toBe("QA-1");
});
(0, test_1.test)("promoted failure parser captures failed step and locator target", () => {
    const parsed = (0, discovery_batch_runner_1.parsePromotedFunctionalFailure)([
        '[functional] Promoted click failed at step 4 target="Información de productos" currentUrl="https://app.local/success" matchedLocatorStrategy="unknown"',
    ]);
    (0, test_1.expect)(parsed.failureReason).toBe("promoted_click_failed");
    (0, test_1.expect)(parsed.failedAtStep).toBe(4);
    (0, test_1.expect)(parsed.failedTarget).toBe("Información de productos");
    (0, test_1.expect)(parsed.currentUrl).toBe("https://app.local/success");
    (0, test_1.expect)(parsed.matchedLocatorStrategy).toBe("unknown");
});
(0, test_1.test)("defect dedupe key is stable per job and case", () => {
    const keyA = (0, discovery_batch_runner_1.buildDiscoveryBatchDefectDedupeKey)({ jobId: "job-1", caseId: 42958, scenarioId: "PREVIEW-001" });
    const keyB = (0, discovery_batch_runner_1.buildDiscoveryBatchDefectDedupeKey)({ jobId: "job-1", caseId: 42958, scenarioId: "PREVIEW-001" });
    const keyC = (0, discovery_batch_runner_1.buildDiscoveryBatchDefectDedupeKey)({ jobId: "job-2", caseId: 42958, scenarioId: "PREVIEW-001" });
    (0, test_1.expect)(keyA).toBe(keyB);
    (0, test_1.expect)(keyA).not.toBe(keyC);
});
(0, test_1.test)("discovery args do not include overwrite/rerun-active by default", () => {
    const args = (0, discovery_batch_runner_1.buildDiscoveryBatchArgs)({ caseIds: [42868], appSlug: "app-a" }, [42868]);
    (0, test_1.expect)(args).toContain("--auto-promote");
    (0, test_1.expect)(args).toContain("--auto-pom");
    (0, test_1.expect)(args).not.toContain("--overwrite");
    (0, test_1.expect)(args).not.toContain("--rerun-active");
});
(0, test_1.test)("discovery args include overwrite/rerun-active only when explicitly requested", () => {
    const args = (0, discovery_batch_runner_1.buildDiscoveryBatchArgs)({ caseIds: [42868], appSlug: "app-a", overwrite: true, rerunActive: true }, [42868]);
    (0, test_1.expect)(args).toContain("--overwrite");
    (0, test_1.expect)(args).toContain("--rerun-active");
});
(0, test_1.test)("promoted execution forwards the existing runtime context path only", () => {
    const runtimeContextPath = ".artifacts/tmp/discovery-runtime/job-a.json";
    const env = (0, discovery_batch_runner_1.buildPromotedExecutionEnv)({ caseIds: [44757], appSlug: "app-a", sectionSlug: "section-a" }, "job-a", { HEADLESS: "false", APP_USERNAME: "must-not-be-copied" }, runtimeContextPath);
    (0, test_1.expect)(env.DISCOVERY_RUNTIME_CONTEXT).toBe(runtimeContextPath);
    (0, test_1.expect)(env.APP_USERNAME).toBe("must-not-be-copied");
    (0, test_1.expect)(Object.keys(env).filter((key) => key.includes("PASSWORD") || key.includes("COMPANY"))).toEqual([]);
});
(0, test_1.test)("promoted execution leaves runtime context absent when no path exists", () => {
    const env = (0, discovery_batch_runner_1.buildPromotedExecutionEnv)({ caseIds: [44757] }, "job-a", {});
    (0, test_1.expect)(env.DISCOVERY_RUNTIME_CONTEXT).toBeUndefined();
});
(0, test_1.test)("discovery and functional children reuse the same case-scoped path without cross-case contamination", () => {
    const pathA = ".artifacts/tmp/discovery-runtime/job-a.json";
    const pathB = ".artifacts/tmp/discovery-runtime/job-b.json";
    const envA = (0, discovery_batch_runner_1.buildPromotedExecutionEnv)({ caseIds: [44757] }, "job-a", {}, pathA);
    const envB = (0, discovery_batch_runner_1.buildPromotedExecutionEnv)({ caseIds: [44758] }, "job-b", {}, pathB);
    (0, test_1.expect)(envA.DISCOVERY_RUNTIME_CONTEXT).toBe(pathA);
    (0, test_1.expect)(envB.DISCOVERY_RUNTIME_CONTEXT).toBe(pathB);
    (0, test_1.expect)(envA.DISCOVERY_RUNTIME_CONTEXT).not.toBe(envB.DISCOVERY_RUNTIME_CONTEXT);
    (0, test_1.expect)(Object.keys(envA).sort()).toEqual([
        "AUTOMATION_HEADLESS",
        "AUTOMATION_SOURCE",
        "DISCOVERY_RUNTIME_CONTEXT",
        "EVIDENCE_RUN_ID",
    ]);
});
(0, test_1.test)("resolved rediscovery intent is propagated to the child discovery command", () => {
    const intent = (0, discovery_batch_runner_1.resolveRediscoveryIntent)({
        forceRediscovery: false,
        overwrite: true,
        rerunActive: true,
        executePromotedSpecs: false,
    });
    const args = (0, discovery_batch_runner_1.buildDiscoveryBatchArgs)({
        caseIds: [],
        appSlug: "app-a",
        overwrite: intent.overwrite,
        rerunActive: intent.rerunActive,
    }, [42868]);
    (0, test_1.expect)(intent.explicit).toBe(false);
    (0, test_1.expect)(args).toContain("--overwrite");
    (0, test_1.expect)(args).toContain("--rerun-active");
});
(0, test_1.test)("mixed execution planner prioritizes jira preview while preserving relative order per group", () => {
    const plan = (0, discovery_batch_runner_1.buildMixedExecutionPlan)({
        caseIds: [1001, 2001, 1002, 2002],
        publishedCases: [
            { caseId: 1001, scenarioId: "TR-CASE-1001", sourceType: "testrail_case" },
            { caseId: 2001, scenarioId: "L-a-001", sourceType: "jira_preview", executionScenarioId: "PREVIEW-001" },
            { caseId: 1002, scenarioId: "TR-CASE-1002", sourceType: "testrail_case" },
            { caseId: 2002, scenarioId: "L-a-002", sourceType: "jira_preview", executionScenarioId: "PREVIEW-002" },
        ],
    });
    (0, test_1.expect)(plan.mode).toBe("mixed");
    (0, test_1.expect)(plan.jiraPreviewCases.map((entry) => entry.caseId)).toEqual([2001, 2002]);
    (0, test_1.expect)(plan.testRailCases.map((entry) => entry.caseId)).toEqual([1001, 1002]);
    (0, test_1.expect)(plan.orderedCases.map((entry) => entry.caseId)).toEqual([2001, 2002, 1001, 1002]);
});
(0, test_1.test)("mixed execution schedule preserves per-group sequence and computed indexes", () => {
    const schedule = (0, discovery_batch_runner_1.buildCaseSchedule)((0, discovery_batch_runner_1.buildMixedExecutionPlan)({
        caseIds: [1001, 2001, 1002, 2002],
        publishedCases: [
            { caseId: 1001, scenarioId: "TR-CASE-1001", sourceType: "testrail_case" },
            { caseId: 2001, scenarioId: "L-a-001", sourceType: "jira_preview", executionScenarioId: "PREVIEW-001" },
            { caseId: 1002, scenarioId: "TR-CASE-1002", sourceType: "testrail_case" },
            { caseId: 2002, scenarioId: "L-a-002", sourceType: "jira_preview", executionScenarioId: "PREVIEW-002" },
        ],
    }));
    (0, test_1.expect)(schedule.map((entry) => `${entry.caseId}:${entry.sourceGroup}:${entry.groupIndex}:${entry.overallIndex}`)).toEqual([
        "2001:jira_preview:1:1",
        "2002:jira_preview:2:2",
        "1001:testrail_case:1:3",
        "1002:testrail_case:2:4",
    ]);
});
(0, test_1.test)("mixed execution plan keeps jira-only and testrail-only selections stable", () => {
    const jiraOnly = (0, discovery_batch_runner_1.buildMixedExecutionPlan)({
        caseIds: [3001, 3002],
        publishedCases: [
            { caseId: 3001, scenarioId: "L-j-001", sourceType: "jira_preview", executionScenarioId: "PREVIEW-001" },
            { caseId: 3002, scenarioId: "L-j-002", sourceType: "jira_preview", executionScenarioId: "PREVIEW-002" },
        ],
    });
    (0, test_1.expect)(jiraOnly.mode).toBe("jira_only");
    (0, test_1.expect)(jiraOnly.orderedCases.map((entry) => entry.caseId)).toEqual([3001, 3002]);
    const trOnly = (0, discovery_batch_runner_1.buildMixedExecutionPlan)({
        caseIds: [4001, 4002],
        publishedCases: [
            { caseId: 4001, scenarioId: "TR-CASE-4001", sourceType: "testrail_case" },
            { caseId: 4002, scenarioId: "TR-CASE-4002", sourceType: "testrail_case" },
        ],
    });
    (0, test_1.expect)(trOnly.mode).toBe("testrail_only");
    (0, test_1.expect)(trOnly.orderedCases.map((entry) => entry.caseId)).toEqual([4001, 4002]);
});
(0, test_1.test)("mixed execution plan preserves case identity without duplicates", () => {
    const plan = (0, discovery_batch_runner_1.buildMixedExecutionPlan)({
        caseIds: [5001, 5001, 5002],
        publishedCases: [
            { caseId: 5002, scenarioId: "TR-CASE-5002", sourceType: "testrail_case" },
            { caseId: 5003, scenarioId: "L-z-001", sourceType: "jira_preview", executionScenarioId: "PREVIEW-003" },
        ],
    });
    (0, test_1.expect)(plan.orderedCases.map((entry) => entry.caseId)).toEqual([5003, 5001, 5002]);
    (0, test_1.expect)(new Set(plan.orderedCases.map((entry) => entry.caseId)).size).toBe(plan.orderedCases.length);
});
(0, test_1.test)("mixed execution planner infers jira preview source from official launch metadata when sourceType is absent", () => {
    const plan = (0, discovery_batch_runner_1.buildMixedExecutionPlan)({
        caseIds: [6101, 6102],
        publishedCases: [
            { caseId: 6101, scenarioId: "legacy-preview", executionScenarioId: "PREVIEW-010" },
            { caseId: 6102, scenarioId: "TR-CASE-6102" },
        ],
    });
    (0, test_1.expect)(plan.jiraPreviewCases.map((entry) => entry.caseId)).toEqual([6101]);
    (0, test_1.expect)(plan.testRailCases.map((entry) => entry.caseId)).toEqual([6102]);
});
(0, test_1.test)("explicit testrail source is preserved even if executionScenarioId looks like PREVIEW-*", () => {
    const plan = (0, discovery_batch_runner_1.buildMixedExecutionPlan)({
        caseIds: [42983],
        publishedCases: [
            { caseId: 42983, scenarioId: "TR-CASE-42983", sourceType: "testrail_case", executionScenarioId: "PREVIEW-001" },
        ],
    });
    (0, test_1.expect)(plan.mode).toBe("testrail_only");
    (0, test_1.expect)(plan.jiraPreviewCases).toHaveLength(0);
    (0, test_1.expect)(plan.testRailCases.map((entry) => entry.caseId)).toEqual([42983]);
});
(0, test_1.test)("route decision prefers promoted reuse when validation is reusable", () => {
    const route = (0, discovery_batch_runner_1.resolveRouteFromValidation)({
        caseId: 42868,
        appSlug: "app-a",
        forceRediscovery: false,
        validation: {
            reusable: true,
            blocked: false,
            reason: "promoted_spec_valid",
            specPath: "automations/apps/app-a/sections/sec/cases/c42868/case.spec.ts",
        },
    });
    (0, test_1.expect)(route.route).toBe("promoted_reuse");
    (0, test_1.expect)(route.reason).toBe("promoted_spec_valid");
});
(0, test_1.test)("persisted promotion requires both a reusable entry and promoted child state", () => {
    (0, test_1.expect)((0, discovery_batch_runner_1.isPersistedDiscoveryPromotionSuccessful)({ discoveredState: "discovered_passed", reusable: true })).toBe(false);
    (0, test_1.expect)((0, discovery_batch_runner_1.isPersistedDiscoveryPromotionSuccessful)({ discoveredState: "promoted", reusable: true })).toBe(true);
    (0, test_1.expect)((0, discovery_batch_runner_1.isPersistedDiscoveryPromotionSuccessful)({ discoveredState: "promoted", reusable: false })).toBe(false);
});
function postDiscoveryEntry(overrides = {}) {
    return {
        id: "automation-post-discovery",
        caseId: 5010,
        title: "post discovery case",
        appSlug: "app-a",
        appProfile: "app-a",
        specPath: "automations/apps/app-a/sections/section-a/cases/c5010/case.spec.ts",
        planPath: "automations/apps/app-a/sections/section-a/cases/c5010/plan.json",
        appConfigPath: "automations/apps/app-a/app.config.json",
        status: "active",
        pomStatus: "promoted",
        specVerificationStatus: "passed",
        ...overrides,
    };
}
(0, test_1.test)("T1: promoted child with persisted valid entry admits functional execution", () => {
    const result = (0, discovery_batch_runner_1.resolvePostDiscoveryExecutionAdmission)({
        caseId: 5010,
        appSlug: "app-a",
        sectionSlug: "section-a",
        childStatus: "promoted",
        promotionPersisted: true,
        entries: [postDiscoveryEntry()],
        fileExists: () => true,
    });
    (0, test_1.expect)(result.admitted).toBe(true);
    (0, test_1.expect)(result.specPath).toMatch(/case\.spec\.ts$/);
});
(0, test_1.test)("T2: promoted child with invalid persisted entry fails closed", () => {
    const result = (0, discovery_batch_runner_1.resolvePostDiscoveryExecutionAdmission)({
        caseId: 5010,
        appSlug: "app-a",
        childStatus: "promoted",
        promotionPersisted: true,
        entries: [postDiscoveryEntry({ specVerificationStatus: "failed" })],
        fileExists: () => true,
    });
    (0, test_1.expect)(result.admitted).toBe(false);
    (0, test_1.expect)(result.specPath).toBeUndefined();
});
(0, test_1.test)("T3: discovered_passed without persisted promotion is not admitted", () => {
    const result = (0, discovery_batch_runner_1.resolvePostDiscoveryExecutionAdmission)({
        caseId: 5010,
        appSlug: "app-a",
        childStatus: "discovered_passed",
        promotionPersisted: false,
        entries: [postDiscoveryEntry()],
        fileExists: () => true,
    });
    (0, test_1.expect)(result).toMatchObject({ admitted: false, reason: "child_status_discovered_passed" });
});
(0, test_1.test)("context-only admits only a fully materialized discovered_passed child", () => {
    const result = (0, discovery_batch_runner_1.resolvePostDiscoveryExecutionAdmission)({
        caseId: 5010,
        appSlug: "app-a",
        contextOnly: true,
        contextMaterialized: true,
        childStatus: "discovered_passed",
        promotionPersisted: false,
        entries: [],
    });
    (0, test_1.expect)(result).toEqual({ admitted: true, reason: "context_materialized" });
});
(0, test_1.test)("context-only rejects missing materialization, failed, and partial children", () => {
    for (const childStatus of ["discovered_passed", "failed", "discovered_partial"]) {
        const result = (0, discovery_batch_runner_1.resolvePostDiscoveryExecutionAdmission)({
            caseId: 5010,
            appSlug: "app-a",
            contextOnly: true,
            contextMaterialized: childStatus === "discovered_passed" ? false : true,
            childStatus,
            promotionPersisted: false,
            entries: [],
        });
        (0, test_1.expect)(result.admitted).toBe(false);
    }
});
(0, test_1.test)("context-only does not relax normal discovered_passed admission", () => {
    const result = (0, discovery_batch_runner_1.resolvePostDiscoveryExecutionAdmission)({
        caseId: 5010,
        appSlug: "app-a",
        contextOnly: false,
        contextMaterialized: true,
        childStatus: "discovered_passed",
        promotionPersisted: false,
        entries: [postDiscoveryEntry()],
        fileExists: () => true,
    });
    (0, test_1.expect)(result).toMatchObject({ admitted: false, reason: "child_status_discovered_passed" });
});
(0, test_1.test)("T4: discovered_partial is not admitted", () => {
    const result = (0, discovery_batch_runner_1.resolvePostDiscoveryExecutionAdmission)({
        caseId: 5010,
        appSlug: "app-a",
        childStatus: "discovered_partial",
        promotionPersisted: true,
        entries: [postDiscoveryEntry()],
        fileExists: () => true,
    });
    (0, test_1.expect)(result.admitted).toBe(false);
});
(0, test_1.test)("T5: promoted is preparation success, not a failed full-discovery result", () => {
    const result = (0, discovery_batch_runner_1.resolvePostDiscoveryExecutionAdmission)({
        caseId: 5010,
        appSlug: "app-a",
        childStatus: "promoted",
        promotionPersisted: true,
        entries: [postDiscoveryEntry()],
        fileExists: () => true,
    });
    (0, test_1.expect)(result.reason).not.toBe("full_discovery_promoted");
});
(0, test_1.test)("T6: admitted promoted result carries the exact spec for functional execution", () => {
    const result = (0, discovery_batch_runner_1.resolvePostDiscoveryExecutionAdmission)({
        caseId: 5010,
        appSlug: "app-a",
        sectionSlug: "section-a",
        childStatus: "promoted",
        promotionPersisted: true,
        entries: [postDiscoveryEntry()],
        fileExists: () => true,
    });
    (0, test_1.expect)(result.admitted).toBe(true);
    (0, test_1.expect)(result.specPath?.replace(/\\/g, "/")).toContain("/c5010/");
});
(0, test_1.test)("T7: post-discovery admission uses the promoted spec resolver", () => {
    const result = (0, discovery_batch_runner_1.resolvePostDiscoveryExecutionAdmission)({
        caseId: 5010,
        appSlug: "app-a",
        sectionSlug: "wrong-section",
        childStatus: "promoted",
        promotionPersisted: true,
        entries: [postDiscoveryEntry()],
        fileExists: () => true,
    });
    (0, test_1.expect)(result.admitted).toBe(false);
});
(0, test_1.test)("T8: direct promoted reuse semantics remain unchanged", () => {
    (0, test_1.expect)((0, discovery_batch_runner_1.isPersistedDiscoveryPromotionSuccessful)({ discoveredState: "promoted", reusable: true })).toBe(true);
    (0, test_1.expect)((0, discovery_batch_runner_1.isPersistedDiscoveryPromotionSuccessful)({ discoveredState: "discovered_passed", reusable: true })).toBe(false);
});
(0, test_1.test)("workflow does not label a failed spec-generation gate as promoted", () => {
    (0, test_1.expect)((0, case_discovery_workflow_1.resolvePromotionOutcome)({ promotionAllowed: false, promotionStatus: "promoted" })).toEqual({
        promoted: false,
        promotionStatus: "promotion_failed",
        promotionReason: "spec_generation_promotion_not_allowed",
    });
    (0, test_1.expect)((0, case_discovery_workflow_1.resolvePromotionOutcome)({ promotionAllowed: true, promotionStatus: "promoted" })).toEqual({
        promoted: true,
        promotionStatus: "promoted",
    });
    (0, test_1.expect)((0, case_discovery_workflow_1.resolvePromotionOutcome)({ promotionAllowed: true, promotionStatus: "promotion_failed" }).promoted).toBe(false);
});
(0, test_1.test)("route decision forces discovery when explicit rediscovery is requested", () => {
    const route = (0, discovery_batch_runner_1.resolveRouteFromValidation)({
        caseId: 42868,
        appSlug: "app-a",
        forceRediscovery: true,
        validation: {
            reusable: true,
            blocked: false,
            reason: "promoted_spec_valid",
        },
    });
    (0, test_1.expect)(route.route).toBe("full_discovery");
    (0, test_1.expect)(route.reason).toBe("explicit_rediscovery_requested");
});
(0, test_1.test)("route decision marks blocked when validation says blocked", () => {
    const route = (0, discovery_batch_runner_1.resolveRouteFromValidation)({
        caseId: 42868,
        appSlug: "app-a",
        forceRediscovery: false,
        validation: {
            reusable: false,
            blocked: true,
            reason: "blocked_status_needs_page_method",
        },
    });
    (0, test_1.expect)(route.route).toBe("blocked");
    (0, test_1.expect)(route.reason).toBe("blocked_status_needs_page_method");
});
(0, test_1.test)("route decision uses contract recommendation when promoted entry is not reusable", () => {
    const route = (0, discovery_batch_runner_1.resolveRouteFromValidation)({
        caseId: 42868,
        appSlug: "app-a",
        forceRediscovery: false,
        validation: {
            reusable: false,
            blocked: false,
            reason: "missing_spec_file",
        },
        contractEvaluation: {
            sufficient: true,
            gaps: [],
            recommendedRoute: "automation_from_case_contract",
            reasonCode: "contract_sufficient",
        },
    });
    (0, test_1.expect)(route.route).toBe("automation_from_case_contract");
    (0, test_1.expect)(route.reason).toBe("contract_sufficient");
});
(0, test_1.test)("legacy overwrite/rerun defaults do not force explicit rediscovery in execution flow", () => {
    const intent = (0, discovery_batch_runner_1.resolveRediscoveryIntent)({
        executePromotedSpecs: true,
        overwrite: true,
        rerunActive: true,
    });
    (0, test_1.expect)(intent).toEqual({
        explicit: false,
        source: "legacy_default",
        overwrite: true,
        rerunActive: true,
    });
    const route = (0, discovery_batch_runner_1.resolveRouteFromValidation)({
        caseId: 42868,
        appSlug: "app-a",
        forceRediscovery: intent.explicit,
        targetedDiscoverySupported: (0, discovery_batch_runner_1.supportsTargetedDiscoveryPreview)(),
        validation: {
            reusable: false,
            blocked: false,
            reason: "missing_spec_file",
        },
        contractEvaluation: {
            sufficient: true,
            gaps: [],
            recommendedRoute: "automation_from_case_contract",
            reasonCode: "contract_sufficient",
        },
    });
    (0, test_1.expect)(route.route).toBe("automation_from_case_contract");
});
(0, test_1.test)("explicit rediscovery intent forces full_discovery even with promoted or contract-ready inputs", () => {
    const intent = (0, discovery_batch_runner_1.resolveRediscoveryIntent)({
        executePromotedSpecs: true,
        forceRediscovery: true,
        overwrite: true,
        rerunActive: true,
    });
    (0, test_1.expect)(intent.explicit).toBe(true);
    (0, test_1.expect)(intent.source).toBe("user_request");
    const route = (0, discovery_batch_runner_1.resolveRouteFromValidation)({
        caseId: 42868,
        appSlug: "app-a",
        forceRediscovery: intent.explicit,
        validation: {
            reusable: true,
            blocked: false,
            reason: "promoted_spec_valid",
        },
        contractEvaluation: {
            sufficient: true,
            gaps: [],
            recommendedRoute: "automation_from_case_contract",
            reasonCode: "contract_sufficient",
        },
    });
    (0, test_1.expect)(route.route).toBe("full_discovery");
    (0, test_1.expect)(route.reason).toBe("explicit_rediscovery_requested");
});
(0, test_1.test)("promoted reusable case stays promoted_reuse when rediscovery intent is not explicit", () => {
    const intent = (0, discovery_batch_runner_1.resolveRediscoveryIntent)({
        executePromotedSpecs: true,
        overwrite: true,
        rerunActive: true,
    });
    const route = (0, discovery_batch_runner_1.resolveRouteFromValidation)({
        caseId: 42868,
        appSlug: "app-a",
        forceRediscovery: intent.explicit,
        validation: {
            reusable: true,
            blocked: false,
            reason: "promoted_spec_valid",
            specPath: "automations/apps/app-a/sections/sec/cases/c42868/case.spec.ts",
        },
    });
    (0, test_1.expect)(route.route).toBe("promoted_reuse");
});
(0, test_1.test)("targeted contract recommendation is downgraded to full_discovery when gap-scoped preview is unsupported", () => {
    (0, test_1.expect)((0, discovery_batch_runner_1.supportsTargetedDiscoveryPreview)()).toBe(false);
    const route = (0, discovery_batch_runner_1.resolveRouteFromValidation)({
        caseId: 42868,
        appSlug: "app-a",
        forceRediscovery: false,
        targetedDiscoverySupported: false,
        validation: {
            reusable: false,
            blocked: false,
            reason: "missing_spec_file",
        },
        contractEvaluation: {
            sufficient: false,
            gaps: [{ type: "missing_locator", stepNumber: 1, target: "boton" }],
            recommendedRoute: "targeted_discovery",
            reasonCode: "targeted_gap_resolution_required",
        },
    });
    (0, test_1.expect)(route.route).toBe("full_discovery");
    (0, test_1.expect)(route.reason).toBe("targeted_discovery_not_supported");
});
(0, test_1.test)("discovery preview args omit overwrite/rerun-active by design", () => {
    const args = (0, discovery_batch_runner_1.buildDiscoveryPreviewArgs)({
        previewPath: "C:\\temp\\preview.json",
        appSlug: "app-a",
        autoPromote: true,
        autoPom: true,
        headed: false,
    });
    (0, test_1.expect)(args).toContain("discovery:preview");
    (0, test_1.expect)(args).toContain("--auto-promote");
    (0, test_1.expect)(args).toContain("--auto-pom");
    (0, test_1.expect)(args).not.toContain("--overwrite");
    (0, test_1.expect)(args).not.toContain("--rerun-active");
});
(0, test_1.test)("discovery preview args can defer evidence consolidation for mixed execution lifecycle", () => {
    const args = (0, discovery_batch_runner_1.buildDiscoveryPreviewArgs)({
        previewPath: "C:\\temp\\preview.json",
        appSlug: "app-a",
        autoPromote: true,
        autoPom: true,
        deferEvidenceConsolidation: true,
    });
    (0, test_1.expect)(args).toContain("--defer-evidence-consolidation");
});
(0, test_1.test)("promoted spec validation accepts reusable promoted case in app and section scope", () => {
    const caseId = 990001;
    const appSlug = `tmp-route-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const sectionSlug = "seccion-kiosko";
    const appRoot = node_path_1.default.join(process.cwd(), "automations", "apps", appSlug);
    const caseDir = node_path_1.default.join(appRoot, "sections", sectionSlug, "cases", `c${caseId}-sample`);
    const specPath = node_path_1.default.join(caseDir, "case.spec.ts");
    const planPath = node_path_1.default.join(caseDir, "plan.json");
    const appConfigPath = node_path_1.default.join(appRoot, "app.config.json");
    node_fs_1.default.mkdirSync(caseDir, { recursive: true });
    node_fs_1.default.writeFileSync(specPath, "test('sample', async () => {});", "utf-8");
    node_fs_1.default.writeFileSync(planPath, "{\"steps\":[]}", "utf-8");
    node_fs_1.default.writeFileSync(appConfigPath, "{}", "utf-8");
    try {
        const validation = (0, discovery_batch_runner_1.validatePromotedEntryForExecution)({
            caseId,
            appSlug,
            sectionSlug,
            entry: {
                id: "entry-1",
                caseId,
                title: "sample",
                planPath,
                specPath,
                appSlug,
                appConfigPath,
                status: "active",
                source: "manual",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            },
        });
        (0, test_1.expect)(validation.reusable).toBe(true);
        (0, test_1.expect)(validation.blocked).toBe(false);
        (0, test_1.expect)(validation.reason).toBe("promoted_spec_valid");
    }
    finally {
        node_fs_1.default.rmSync(appRoot, { recursive: true, force: true });
    }
});
(0, test_1.test)("promoted spec validation rejects section mismatch", () => {
    const caseId = 990002;
    const appSlug = `tmp-route-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const appRoot = node_path_1.default.join(process.cwd(), "automations", "apps", appSlug);
    const caseDir = node_path_1.default.join(appRoot, "sections", "section-real", "cases", `c${caseId}-sample`);
    const specPath = node_path_1.default.join(caseDir, "case.spec.ts");
    const planPath = node_path_1.default.join(caseDir, "plan.json");
    node_fs_1.default.mkdirSync(caseDir, { recursive: true });
    node_fs_1.default.writeFileSync(specPath, "test('sample', async () => {});", "utf-8");
    node_fs_1.default.writeFileSync(planPath, "{\"steps\":[]}", "utf-8");
    try {
        const validation = (0, discovery_batch_runner_1.validatePromotedEntryForExecution)({
            caseId,
            appSlug,
            sectionSlug: "section-expected",
            entry: {
                id: "entry-2",
                caseId,
                title: "sample",
                planPath,
                specPath,
                appSlug,
                status: "active",
                source: "manual",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            },
        });
        (0, test_1.expect)(validation.reusable).toBe(false);
        (0, test_1.expect)(validation.reason).toBe("section_slug_mismatch");
    }
    finally {
        node_fs_1.default.rmSync(appRoot, { recursive: true, force: true });
    }
});
(0, test_1.test)("promoted spec validation keeps legacy non-sectioned specs reusable when case/app are valid", () => {
    const caseId = 990006;
    const appSlug = `tmp-route-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const appRoot = node_path_1.default.join(process.cwd(), "automations", "apps", appSlug);
    const caseDir = node_path_1.default.join(appRoot, "cases", `c${caseId}-sample`);
    const specPath = node_path_1.default.join(caseDir, "case.spec.ts");
    const planPath = node_path_1.default.join(caseDir, "plan.json");
    const appConfigPath = node_path_1.default.join(appRoot, "app.config.json");
    node_fs_1.default.mkdirSync(caseDir, { recursive: true });
    node_fs_1.default.writeFileSync(specPath, "test('sample', async () => {});", "utf-8");
    node_fs_1.default.writeFileSync(planPath, "{\"steps\":[]}", "utf-8");
    node_fs_1.default.writeFileSync(appConfigPath, "{}", "utf-8");
    try {
        const validation = (0, discovery_batch_runner_1.validatePromotedEntryForExecution)({
            caseId,
            appSlug,
            sectionSlug: "detalle-kiosko",
            entry: {
                id: "entry-legacy-no-section",
                caseId,
                title: "legacy",
                planPath,
                specPath,
                appSlug,
                appConfigPath,
                status: "active",
                source: "manual",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            },
        });
        (0, test_1.expect)(validation.reusable).toBe(true);
        (0, test_1.expect)(validation.reason).toBe("promoted_spec_valid");
    }
    finally {
        node_fs_1.default.rmSync(appRoot, { recursive: true, force: true });
    }
});
(0, test_1.test)("promoted spec validation rejects reusable candidate from a different appSlug", () => {
    const validation = (0, discovery_batch_runner_1.validatePromotedEntryForExecution)({
        caseId: 990007,
        appSlug: "default",
        sectionSlug: "any-section",
        entry: {
            id: "entry-other-app",
            caseId: 990007,
            title: "other app",
            planPath: "automations/apps/app-b/sections/any-section/cases/c990007/plan.json",
            specPath: "automations/apps/app-b/sections/any-section/cases/c990007/case.spec.ts",
            appSlug: "app-b",
            status: "active",
            source: "manual",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        },
    });
    (0, test_1.expect)(validation.reusable).toBe(false);
    (0, test_1.expect)(validation.reason).toBe("app_slug_mismatch");
});
(0, test_1.test)("promoted spec validation marks blocked statuses as blocked route candidates", () => {
    const validation = (0, discovery_batch_runner_1.validatePromotedEntryForExecution)({
        caseId: 990003,
        appSlug: "app-a",
        sectionSlug: "any-section",
        entry: {
            id: "entry-3",
            caseId: 990003,
            title: "blocked",
            planPath: "automations/apps/app-a/sections/any-section/cases/c990003/plan.json",
            specPath: "automations/apps/app-a/sections/any-section/cases/c990003/case.spec.ts",
            appSlug: "app-a",
            status: "needs_page_method",
            source: "manual",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        },
    });
    (0, test_1.expect)(validation.reusable).toBe(false);
    (0, test_1.expect)(validation.blocked).toBe(true);
    (0, test_1.expect)(validation.reason).toBe("blocked_status_needs_page_method");
});
(0, test_1.test)("promoted spec validation accepts draft status when files are executable", () => {
    const caseId = 990004;
    const appSlug = `tmp-route-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const sectionSlug = "seccion-kiosko";
    const appRoot = node_path_1.default.join(process.cwd(), "automations", "apps", appSlug);
    const caseDir = node_path_1.default.join(appRoot, "sections", sectionSlug, "cases", `c${caseId}-sample`);
    const specPath = node_path_1.default.join(caseDir, "case.spec.ts");
    const planPath = node_path_1.default.join(caseDir, "plan.json");
    node_fs_1.default.mkdirSync(caseDir, { recursive: true });
    node_fs_1.default.writeFileSync(specPath, "test('sample', async () => {});", "utf-8");
    node_fs_1.default.writeFileSync(planPath, "{\"steps\":[]}", "utf-8");
    try {
        const validation = (0, discovery_batch_runner_1.validatePromotedEntryForExecution)({
            caseId,
            appSlug,
            sectionSlug,
            entry: {
                id: "entry-4",
                caseId,
                title: "draft",
                planPath,
                specPath,
                appSlug,
                status: "draft",
                source: "manual",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            },
        });
        (0, test_1.expect)(validation.reusable).toBe(true);
    }
    finally {
        node_fs_1.default.rmSync(appRoot, { recursive: true, force: true });
    }
});
(0, test_1.test)("promoted spec validation accepts inline_debug_only status when files are executable", () => {
    const caseId = 990005;
    const appSlug = `tmp-route-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const sectionSlug = "seccion-kiosko";
    const appRoot = node_path_1.default.join(process.cwd(), "automations", "apps", appSlug);
    const caseDir = node_path_1.default.join(appRoot, "sections", sectionSlug, "cases", `c${caseId}-sample`);
    const specPath = node_path_1.default.join(caseDir, "case.spec.ts");
    const planPath = node_path_1.default.join(caseDir, "plan.json");
    node_fs_1.default.mkdirSync(caseDir, { recursive: true });
    node_fs_1.default.writeFileSync(specPath, "test('sample', async () => {});", "utf-8");
    node_fs_1.default.writeFileSync(planPath, "{\"steps\":[]}", "utf-8");
    try {
        const validation = (0, discovery_batch_runner_1.validatePromotedEntryForExecution)({
            caseId,
            appSlug,
            sectionSlug,
            entry: {
                id: "entry-5",
                caseId,
                title: "inline",
                planPath,
                specPath,
                appSlug,
                status: "inline_debug_only",
                source: "manual",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            },
        });
        (0, test_1.expect)(validation.reusable).toBe(true);
    }
    finally {
        node_fs_1.default.rmSync(appRoot, { recursive: true, force: true });
    }
});
(0, test_1.test)("functional snapshot: emits partial progression across cases", () => {
    const start = (0, discovery_batch_runner_1.computeFunctionalExecutionSnapshot)({
        requested: 3,
        completed: 0,
        executed: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
    });
    (0, test_1.expect)(start.progressPercent).toBe(0);
    (0, test_1.expect)(start.passRate).toBeNull();
    const afterFirst = (0, discovery_batch_runner_1.computeFunctionalExecutionSnapshot)({
        requested: 3,
        completed: 1,
        executed: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
    });
    (0, test_1.expect)(afterFirst.progressPercent).toBe(33.33);
    (0, test_1.expect)(afterFirst.passRate).toBe(100);
    const afterSecond = (0, discovery_batch_runner_1.computeFunctionalExecutionSnapshot)({
        requested: 3,
        completed: 2,
        executed: 2,
        passed: 1,
        failed: 1,
        skipped: 0,
    });
    (0, test_1.expect)(afterSecond.progressPercent).toBe(66.67);
    (0, test_1.expect)(afterSecond.passRate).toBe(50);
    const afterThird = (0, discovery_batch_runner_1.computeFunctionalExecutionSnapshot)({
        requested: 3,
        completed: 3,
        executed: 3,
        passed: 2,
        failed: 1,
        skipped: 0,
    });
    (0, test_1.expect)(afterThird.progressPercent).toBe(100);
    (0, test_1.expect)(afterThird.passRate).toBe(66.67);
});
(0, test_1.test)("evidence parser: detects initialized recorder", () => {
    const parsed = (0, discovery_batch_runner_1.parseEvidenceInitializationResult)([
        "[evidence] initialized scenario=TR-CASE-42868",
    ]);
    (0, test_1.expect)(parsed).toEqual({
        initialized: true,
        reason: "none",
    });
});
(0, test_1.test)("evidence parser: detects esm/cjs initialization error", () => {
    const parsed = (0, discovery_batch_runner_1.parseEvidenceInitializationResult)([
        "Warning: Failed to load the ES module: src\\evidence\\evidence-recorder.ts",
        "[evidence] init failed: Cannot use import statement outside a module",
    ]);
    (0, test_1.expect)(parsed).toEqual({
        initialized: false,
        reason: "esm_cjs_boundary_violation",
    });
});
