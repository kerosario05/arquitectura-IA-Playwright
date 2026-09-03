import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, expect } from "@playwright/test";
import {
  createQaLabDiagnosticManifest,
  recordQaLabDiagnosticPhase,
} from "../src/server/jobs/qa-lab-diagnostic-manifest";

test("persists the QA Lab lifecycle and redacts sensitive fields", () => {
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-lab-diagnostic-"));
  try {
    const filePath = createQaLabDiagnosticManifest(artifactDir, "run-synthetic", {
      appSlug: "default",
      password: "must-not-persist",
      nested: { otp: "123456", value: "safe" },
    });

    recordQaLabDiagnosticPhase(filePath, "generation", "artifacts_written", {
      scenarios: [{ id: "PREVIEW-001", title: "Synthetic scenario", coverageRefs: ["list_screen_0"] }],
    });
    recordQaLabDiagnosticPhase(filePath, "coverage", "computed", { covered: 1, total: 1 });
    recordQaLabDiagnosticPhase(filePath, "launch", "metadata_received", { launchId: "launch-1", testRunId: 42 });
    recordQaLabDiagnosticPhase(filePath, "execution", "completed", { exitCode: 0 });
    recordQaLabDiagnosticPhase(filePath, "result_sync", "completed", { synced: 1 });
    recordQaLabDiagnosticPhase(filePath, "completed", "done", { resultPath: "results.json" });

    const manifest = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(manifest.runId).toBe("run-synthetic");
    expect(Object.keys(manifest.phases)).toEqual([
      "generation",
      "coverage",
      "launch",
      "execution",
      "result_sync",
      "completed",
    ]);
    expect(manifest.request.password).toBeUndefined();
    expect(manifest.request.nested.otp).toBeUndefined();
    expect(manifest.request.nested.value).toBe("safe");
  } finally {
    fs.rmSync(artifactDir, { recursive: true, force: true });
  }
});
