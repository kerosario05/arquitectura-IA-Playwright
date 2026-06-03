"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_preview_runner_1 = require("../src/server/jobs/scenario-preview-runner");
const runs_1 = require("../src/server/routes/runs");
(0, test_1.test)("parsea summary final de discovery:preview", () => {
    const patch = (0, scenario_preview_runner_1.parseScenarioPreviewResultsLine)("[discovery:preview] Results: 5 passed, 2 failed out of 7");
    (0, test_1.expect)(patch).toEqual({
        completed: 7,
        passed: 5,
        failed: 2,
        scenarioCount: 7,
        totalStories: 7,
    });
});
(0, test_1.test)("case_finished passed incrementa completed y passed", () => {
    const patch = (0, scenario_preview_runner_1.applyCaseFinishedSummaryPatch)({ totalStories: 7, synced: 0, passed: 0, failed: 0, completed: 0 }, "passed");
    (0, test_1.expect)(patch.completed).toBe(1);
    (0, test_1.expect)(patch.passed).toBe(1);
    (0, test_1.expect)(patch.failed).toBe(0);
});
(0, test_1.test)("case_finished failed incrementa completed y failed", () => {
    const patch = (0, scenario_preview_runner_1.applyCaseFinishedSummaryPatch)({ totalStories: 7, synced: 0, passed: 1, failed: 0, completed: 1 }, "failed");
    (0, test_1.expect)(patch.completed).toBe(2);
    (0, test_1.expect)(patch.passed).toBe(1);
    (0, test_1.expect)(patch.failed).toBe(1);
});
(0, test_1.test)("results.json final tiene prioridad como fuente de verdad", () => {
    const summary = (0, scenario_preview_runner_1.mergeScenarioPreviewSummary)({ totalStories: 7, synced: 0, passed: 1, failed: 0, completed: 1 }, (0, scenario_preview_runner_1.parseScenarioPreviewResultsFile)({
        total: 7,
        passed: 5,
        failed: 2,
        status: "failed",
        promotionStatus: "not_applicable",
        promotionReason: "Promotion not applicable because discovery status is discovered_partial.",
        cases: Array.from({ length: 7 }, (_, i) => ({ status: i < 5 ? "passed" : "failed" })),
    }));
    (0, test_1.expect)(summary.completed).toBe(7);
    (0, test_1.expect)(summary.passed).toBe(5);
    (0, test_1.expect)(summary.failed).toBe(2);
    (0, test_1.expect)(summary.scenarioCount).toBe(7);
    (0, test_1.expect)(summary.totalStories).toBe(7);
    (0, test_1.expect)(summary.promotionStatus).toBe("not_applicable");
    (0, test_1.expect)(summary.promotionReason).toContain("discovered_partial");
});
(0, test_1.test)("promotion gate not_applicable no borra contadores", () => {
    const summary = (0, scenario_preview_runner_1.mergeScenarioPreviewSummary)({ totalStories: 7, synced: 0, passed: 5, failed: 2, completed: 7, scenarioCount: 7 }, {
        promotionStatus: "not_applicable",
        promotionReason: "Promotion not applicable because discovery status is discovered_partial.",
    });
    (0, test_1.expect)(summary.completed).toBe(7);
    (0, test_1.expect)(summary.passed).toBe(5);
    (0, test_1.expect)(summary.failed).toBe(2);
    (0, test_1.expect)(summary.promotionStatus).toBe("not_applicable");
});
(0, test_1.test)("results.json conserva failureGroups en summary final", () => {
    const summary = (0, scenario_preview_runner_1.mergeScenarioPreviewSummary)(undefined, (0, scenario_preview_runner_1.parseScenarioPreviewResultsFile)({
        total: 10,
        passed: 3,
        failed: 7,
        summary: {
            total: 10,
            passed: 3,
            failed: 7,
            failureGroups: {
                assertion_not_found: 4,
                target_not_found: 2,
                route_profile_missing: 1,
                promotion_not_applicable: 7,
            },
        },
    }));
    (0, test_1.expect)(summary.failureGroups).toEqual({
        assertion_not_found: 4,
        target_not_found: 2,
        route_profile_missing: 1,
        promotion_not_applicable: 7,
    });
});
(0, test_1.test)("no usa failed before first case si hubo case_started", () => {
    (0, test_1.expect)((0, scenario_preview_runner_1.shouldReportFailedBeforeFirstCase)({
        exitCode: 1,
        firstCaseStarted: true,
        finishedCaseIds: new Set(),
        completedCount: 0,
        hasResultsSummary: false,
        sawResultsLine: false,
    })).toBe(false);
});
(0, test_1.test)("no usa failed before first case si hubo case_finished", () => {
    (0, test_1.expect)((0, scenario_preview_runner_1.shouldReportFailedBeforeFirstCase)({
        exitCode: 1,
        firstCaseStarted: false,
        finishedCaseIds: new Set(["PREVIEW-001"]),
        completedCount: 0,
        hasResultsSummary: false,
        sawResultsLine: false,
    })).toBe(false);
});
(0, test_1.test)("results line final evita failed before first case", () => {
    (0, test_1.expect)((0, scenario_preview_runner_1.shouldReportFailedBeforeFirstCase)({
        exitCode: 1,
        firstCaseStarted: false,
        finishedCaseIds: new Set(),
        completedCount: 0,
        hasResultsSummary: false,
        sawResultsLine: true,
    })).toBe(false);
});
(0, test_1.test)("failed before first case solo aplica sin ejecucion ni results utiles", () => {
    (0, test_1.expect)((0, scenario_preview_runner_1.shouldReportFailedBeforeFirstCase)({
        exitCode: 1,
        firstCaseStarted: false,
        finishedCaseIds: new Set(),
        completedCount: 0,
        hasResultsSummary: false,
        sawResultsLine: false,
    })).toBe(true);
});
(0, test_1.test)("buildRunStreamPayload conserva completed_with_failures como estado terminal", () => {
    const payload = (0, runs_1.buildRunStreamPayload)({
        status: "completed_with_failures",
        exitCode: 1,
        currentCase: "PREVIEW-007",
        errorMessage: "7 de 8 escenarios pasaron. 1 requiere revisión.",
        summary: {
            completed: 8,
            passed: 7,
            failed: 1,
            scenarioCount: 8,
            totalStories: 8,
            failureGroups: { assertion_not_found_unrecovered: 1 },
        },
    }, true);
    (0, test_1.expect)(payload.status).toBe("completed_with_failures");
    (0, test_1.expect)(payload.currentCase).toBe("PREVIEW-007");
    (0, test_1.expect)(payload.summary.passed).toBe(7);
    (0, test_1.expect)(payload.summary.failed).toBe(1);
    (0, test_1.expect)(payload.summary.failureGroups.assertion_not_found_unrecovered).toBe(1);
});
(0, test_1.test)("exitCode=1 con results 7/1/8 devuelve completed_with_failures", () => {
    (0, test_1.expect)((0, scenario_preview_runner_1.getScenarioPreviewOutcome)({
        exitCode: 1,
        results: {
            total: 8,
            completed: 8,
            passed: 7,
            failed: 1,
            cases: Array.from({ length: 8 }, (_, i) => ({ status: i < 7 ? "passed" : "failed" })),
        },
        completedCount: 8,
        sawCaseStarted: true,
        firstCaseStarted: true,
    })).toBe("completed_with_failures");
});
(0, test_1.test)("exitCode=1 sin cases ejecutados devuelve technical_failure", () => {
    (0, test_1.expect)((0, scenario_preview_runner_1.getScenarioPreviewOutcome)({
        exitCode: 1,
        results: {
            ok: false,
            error: "discovery_preview_start_failed",
            message: "spawn failed",
        },
        completedCount: 0,
        sawCaseStarted: false,
        firstCaseStarted: false,
    })).toBe("technical_failure");
});
