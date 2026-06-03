"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const runs_1 = require("../src/server/routes/runs");
(0, test_1.test)("SSE done incluye summary final y currentCase", () => {
    const payload = (0, runs_1.buildRunStreamPayload)({
        status: "failed",
        exitCode: 1,
        currentCase: "PREVIEW-007",
        errorMessage: "Promotion not applicable because discovery status is discovered_partial.",
        summary: {
            completed: 7,
            passed: 5,
            failed: 2,
            scenarioCount: 7,
            totalStories: 7,
        },
    }, true);
    (0, test_1.expect)(payload.status).toBe("failed");
    (0, test_1.expect)(payload.currentCase).toBe("PREVIEW-007");
    (0, test_1.expect)(payload.errorMessage).toContain("discovered_partial");
    (0, test_1.expect)(payload.summary.completed).toBe(7);
    (0, test_1.expect)(payload.summary.passed).toBe(5);
    (0, test_1.expect)(payload.summary.failed).toBe(2);
});
