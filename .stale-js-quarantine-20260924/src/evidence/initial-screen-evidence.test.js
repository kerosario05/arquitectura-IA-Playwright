"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const evidence_recorder_1 = require("./evidence-recorder");
function mockPage(options) {
    return {
        isClosed: () => false,
        waitForLoadState: async () => undefined,
        evaluate: async () => options.ready,
        screenshot: async ({ path: screenshotPath }) => {
            if (options.screenshotFails)
                throw new Error("screenshot_failed");
            await promises_1.default.mkdir(node_path_1.default.dirname(screenshotPath), { recursive: true });
            await promises_1.default.writeFile(screenshotPath, "image");
        },
    };
}
async function createRecorder(outputRoot, scenarioId) {
    return new evidence_recorder_1.EvidenceRecorder({
        appSlug: "generic-app",
        sectionSlug: "generic-section",
        scenarioId,
        scenarioTitle: "Generic scenario",
        outputRoot,
    }, { docxEnabled: false, perScenarioDocx: false });
}
(0, node_test_1.default)("T1-T7/T14 shared initial evidence contract for full_discovery and promoted_reuse", async () => {
    const root = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "initial-evidence-contract-"));
    try {
        for (const executionSource of ["full_discovery", "promoted_reuse"]) {
            const recorder = await createRecorder(root, executionSource);
            const ready = await recorder.captureInitialScreen(mockPage({ ready: true }), executionSource);
            strict_1.default.equal(ready, true);
            await recorder.captureStep(mockPage({ ready: true }), 1, "step one", { sourceStepIndex: 1 });
            const record = await recorder.finish();
            strict_1.default.deepEqual(Object.keys(record.initialScreenEvidence ?? {}).sort(), ["captured", "capturedAt", "path", "status"]);
            strict_1.default.equal(record.initialScreenEvidence?.status, "ready");
            strict_1.default.equal(record.initialScreenEvidence?.captured, true);
            strict_1.default.equal(record.steps.length, 1);
            strict_1.default.equal(record.steps[0].stepIndex, 1);
            strict_1.default.notEqual(record.initialScreenEvidence?.path, record.steps[0].screenshotPath);
            strict_1.default.ok(record.finalScreenEvidence?.captured);
        }
    }
    finally {
        await promises_1.default.rm(root, { recursive: true, force: true });
    }
});
(0, node_test_1.default)("T8 readiness success with screenshot failure does not reuse step screenshot", async () => {
    const root = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "initial-evidence-screenshot-failure-"));
    try {
        const recorder = await createRecorder(root, "SCREENSHOT-FAILURE");
        strict_1.default.equal(await recorder.captureInitialScreen(mockPage({ ready: true, screenshotFails: true }), "promoted_reuse"), true);
        await recorder.captureStep(mockPage({ ready: true }), 1, "step one", { sourceStepIndex: 1 });
        const record = await recorder.finish();
        strict_1.default.equal(record.initialScreenEvidence?.status, "ready");
        strict_1.default.equal(record.initialScreenEvidence?.captured, false);
        strict_1.default.equal(record.initialScreenEvidence?.path, null);
        strict_1.default.ok(record.steps[0].screenshotPath);
    }
    finally {
        await promises_1.default.rm(root, { recursive: true, force: true });
    }
});
(0, node_test_1.default)("T9-T13 readiness failure captures diagnostics and leaves steps unstarted", async () => {
    const root = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "initial-evidence-load-failure-"));
    try {
        for (const executionSource of ["full_discovery", "promoted_reuse"]) {
            const recorder = await createRecorder(root, executionSource);
            strict_1.default.equal(await recorder.captureInitialScreen(mockPage({ ready: false }), executionSource, 20), false);
            const record = await recorder.finish();
            strict_1.default.equal(record.initialScreenEvidence?.status, "load_failed");
            strict_1.default.equal(record.initialScreenEvidence?.captured, true);
            strict_1.default.equal(record.steps.length, 0);
            strict_1.default.equal(record.status, "Fallido");
        }
    }
    finally {
        await promises_1.default.rm(root, { recursive: true, force: true });
    }
});
