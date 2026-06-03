"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const testrail_reporter_1 = require("../src/testrail/testrail-reporter");
(0, test_1.test)("mapExecutionStatusToTestRail maps passed to 1", () => {
    (0, test_1.expect)((0, testrail_reporter_1.mapExecutionStatusToTestRail)("passed")).toBe(1);
});
(0, test_1.test)("mapExecutionStatusToTestRail maps failed to 5", () => {
    (0, test_1.expect)((0, testrail_reporter_1.mapExecutionStatusToTestRail)("failed")).toBe(5);
});
(0, test_1.test)("mapExecutionStatusToTestRail maps partial to 5 (failed)", () => {
    (0, test_1.expect)((0, testrail_reporter_1.mapExecutionStatusToTestRail)("partial")).toBe(5);
});
(0, test_1.test)("mapExecutionStatusToTestRail maps skipped to 2 (blocked)", () => {
    (0, test_1.expect)((0, testrail_reporter_1.mapExecutionStatusToTestRail)("skipped")).toBe(2);
});
(0, test_1.test)("formatDuration formats seconds correctly", () => {
    (0, test_1.expect)((0, testrail_reporter_1.formatDuration)(5000)).toBe("5s");
});
(0, test_1.test)("formatDuration formats minutes and seconds correctly", () => {
    (0, test_1.expect)((0, testrail_reporter_1.formatDuration)(125000)).toBe("2m 5s");
});
(0, test_1.test)("buildComment includes failed steps info", () => {
    const result = {
        scenario: { source: "testrail", externalId: "C123", caseId: 123, title: "Test" },
        status: "failed",
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:05.000Z",
        durationMs: 5000,
        evidenceDir: "/tmp/evidence",
        steps: [
            { index: 1, action: "navigate", status: "passed", startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:02.000Z", durationMs: 2000 },
            { index: 2, action: "click", status: "failed", startedAt: "2026-01-01T00:00:02.000Z", finishedAt: "2026-01-01T00:00:05.000Z", durationMs: 3000, error: "Element not found" }
        ]
    };
    const comment = (0, testrail_reporter_1.buildComment)(result);
    (0, test_1.expect)(comment).toContain("Failed steps:");
    (0, test_1.expect)(comment).toContain("#2 (click)");
    (0, test_1.expect)(comment).toContain("Element not found");
    (0, test_1.expect)(comment).toContain("/tmp/evidence");
});
(0, test_1.test)("buildComment includes evidence dir for passed results", () => {
    const result = {
        scenario: { source: "testrail", externalId: "C123", caseId: 123, title: "Test" },
        status: "passed",
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:05.000Z",
        durationMs: 5000,
        evidenceDir: "/tmp/evidence",
        steps: [
            { index: 1, action: "navigate", status: "passed", startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:05.000Z", durationMs: 5000 }
        ]
    };
    const comment = (0, testrail_reporter_1.buildComment)(result);
    (0, test_1.expect)(comment).toContain("/tmp/evidence");
    (0, test_1.expect)(comment).not.toContain("Failed steps:");
});
