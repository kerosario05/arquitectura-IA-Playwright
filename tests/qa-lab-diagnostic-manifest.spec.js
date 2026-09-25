"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const test_1 = require("@playwright/test");
const qa_lab_diagnostic_manifest_1 = require("../src/server/jobs/qa-lab-diagnostic-manifest");
(0, test_1.test)("persists the QA Lab lifecycle and redacts sensitive fields", () => {
    const artifactDir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), "qa-lab-diagnostic-"));
    try {
        const filePath = (0, qa_lab_diagnostic_manifest_1.createQaLabDiagnosticManifest)(artifactDir, "run-synthetic", {
            appSlug: "default",
            password: "must-not-persist",
            nested: { otp: "123456", value: "safe" },
        });
        (0, qa_lab_diagnostic_manifest_1.recordQaLabDiagnosticPhase)(filePath, "generation", "artifacts_written", {
            scenarios: [{ id: "PREVIEW-001", title: "Synthetic scenario", coverageRefs: ["list_screen_0"] }],
        });
        (0, qa_lab_diagnostic_manifest_1.recordQaLabDiagnosticPhase)(filePath, "coverage", "computed", { covered: 1, total: 1 });
        (0, qa_lab_diagnostic_manifest_1.recordQaLabDiagnosticPhase)(filePath, "launch", "metadata_received", { launchId: "launch-1", testRunId: 42 });
        (0, qa_lab_diagnostic_manifest_1.recordQaLabDiagnosticPhase)(filePath, "execution", "completed", { exitCode: 0 });
        (0, qa_lab_diagnostic_manifest_1.recordQaLabDiagnosticPhase)(filePath, "result_sync", "completed", { synced: 1 });
        (0, qa_lab_diagnostic_manifest_1.recordQaLabDiagnosticPhase)(filePath, "completed", "done", { resultPath: "results.json" });
        const manifest = JSON.parse(node_fs_1.default.readFileSync(filePath, "utf-8"));
        (0, test_1.expect)(manifest.runId).toBe("run-synthetic");
        (0, test_1.expect)(Object.keys(manifest.phases)).toEqual([
            "generation",
            "coverage",
            "launch",
            "execution",
            "result_sync",
            "completed",
        ]);
        (0, test_1.expect)(manifest.request.password).toBeUndefined();
        (0, test_1.expect)(manifest.request.nested.otp).toBeUndefined();
        (0, test_1.expect)(manifest.request.nested.value).toBe("safe");
    }
    finally {
        node_fs_1.default.rmSync(artifactDir, { recursive: true, force: true });
    }
});
