"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const runs_1 = require("../src/server/routes/runs");
(0, test_1.test)("SSE done incluye summary final y currentCase", () => {
    const payload = (0, runs_1.buildRunStreamPayload)({
        status: "failed",
        exitCode: 1,
        currentCase: "Visualización de opciones principales tras iniciar el kiosco",
        currentCaseId: "PREVIEW-007",
        currentCaseTitle: "Visualización de opciones principales tras iniciar el kiosco",
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
    (0, test_1.expect)(payload.currentCase).toBe("Visualización de opciones principales tras iniciar el kiosco");
    (0, test_1.expect)(payload.currentCaseId).toBe("PREVIEW-007");
    (0, test_1.expect)(payload.currentCaseTitle).toBe("Visualización de opciones principales tras iniciar el kiosco");
    (0, test_1.expect)(payload.errorMessage).toContain("discovered_partial");
    (0, test_1.expect)(payload.summary.completed).toBe(7);
    (0, test_1.expect)(payload.summary.passed).toBe(5);
    (0, test_1.expect)(payload.summary.failed).toBe(2);
});
(0, test_1.test)("SSE mantiene fallback al id técnico cuando no hay título", () => {
    const payload = (0, runs_1.buildRunStreamPayload)({
        status: "running",
        currentCase: "PREVIEW-008",
        currentCaseId: "PREVIEW-008",
        currentCaseTitle: null,
    });
    (0, test_1.expect)(payload.currentCase).toBe("PREVIEW-008");
    (0, test_1.expect)(payload.currentCaseId).toBe("PREVIEW-008");
    (0, test_1.expect)(payload.currentCaseTitle).toBeNull();
});
