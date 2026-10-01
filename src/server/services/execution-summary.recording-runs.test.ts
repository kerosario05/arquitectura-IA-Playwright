import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

/**
 * "Ejecuciones" read only launch manifests (.artifacts/scenario-launch-runs), so every execution
 * started from Grabación -- persisted under .artifacts/scenario-preview-runs -- never appeared
 * there: the newest listed run was weeks old while recording replays ran daily.
 */

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value), "utf8");
}

test("recording replays are listed next to launches, newest first, and open as a summary", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "exec-summary-"));
  const previous = process.cwd();
  process.chdir(root);
  try {
    writeJson(path.join(root, ".artifacts/scenario-launch-runs/launch-1/launch-manifest.json"), {
      createdAt: "2026-09-10T10:00:00.000Z", status: "completed", appSlug: "kiosko", jira: { key: "AA-1", title: "HU" },
      results: [{ scenarioId: "S1", discoveryStatus: "passed" }],
    });
    writeJson(path.join(root, ".artifacts/scenario-preview-runs/job-rec/job.json"), {
      createdAt: "2026-10-01T05:14:26.819Z", completedAt: "2026-10-01T05:19:03.735Z", status: "done", appSlug: "kiosko",
      testRail: { projectId: "56", suiteId: "1731", sectionId: "4761", sectionName: "REGRESION-KIOSKO" },
    });
    writeJson(path.join(root, ".artifacts/scenario-launch-runs/launch-tr/launch-manifest.json"), {
      createdAt: "2026-09-09T10:00:00.000Z", status: "completed", appSlug: "app-conversacional", testRail: { projectId: 56, sectionId: 4903 },
      results: [{ scenarioId: "S1", discoveryStatus: "failed" }],
    });
    writeJson(path.join(root, ".artifacts/scenario-preview-runs/job-rec/results.json"), {
      cases: [
        { recordingId: "rec-1", recordedScenarioId: "REC-01", title: "Desde ¡Hola!: Tarjetas", status: "passed" },
        { recordingId: "rec-1", recordedScenarioId: "REC-01-FLOW-1", title: "Sub-flujo", status: "failed" },
      ],
    });
    // An older run that saved no destination, of scenarios published to TestRail.
    writeJson(path.join(root, ".artifacts/scenario-preview-runs/job-old/job.json"), { createdAt: "2026-09-30T10:00:00.000Z", status: "done", appSlug: "kiosko" });
    writeJson(path.join(root, ".artifacts/scenario-preview-runs/job-old/results.json"), {
      cases: [{ recordingId: "rec-1", recordedScenarioId: "REC-01", title: "Desde ¡Hola!: Tarjetas", status: "passed" }],
    });
    writeJson(path.join(root, "automations/apps/kiosko/recordings/rec-1/scenarios.json"), [
      { scenarioId: "REC-01", title: "Desde ¡Hola!: Tarjetas", testRailCaseId: 47066, testRailDestination: { projectId: "56", suiteId: "1731", sectionId: "4755" }, testRailSteps: [], preconditions: [], requiredData: [] },
      { scenarioId: "REC-01-FLOW-1", title: "Sub-flujo", testRailSteps: [], preconditions: [], requiredData: [] },
    ]);
    // A preview run that is not a recording replay stays out.
    writeJson(path.join(root, ".artifacts/scenario-preview-runs/job-other/results.json"), { cases: [{ status: "passed" }] });
    writeJson(path.join(root, "automations/apps/kiosko/recordings/rec-1/trace.json"), {
      recordingId: "rec-1", appSlug: "kiosko", recordingGoal: { declaredGoal: "solicitar tarjeta" }, events: [], screens: [],
    });

    // config/env.ts reads .env from the working directory; this one has none.
    Object.assign(process.env, { APP_BASE_URL: process.env.APP_BASE_URL ?? "http://kiosko.test", APP_LOGIN_MODE: process.env.APP_LOGIN_MODE ?? "no_login", HEADLESS: process.env.HEADLESS ?? "true", BROWSER: process.env.BROWSER ?? "chromium", EVIDENCE_DIR: process.env.EVIDENCE_DIR ?? ".artifacts/evidence", DEFAULT_TIMEOUT_MS: process.env.DEFAULT_TIMEOUT_MS ?? "30000" });
    const service = await import("./execution-summary.service");
    const list = service.listExecutionSummaries();
    assert.deepEqual(list.map((item: { launchId: string; source?: string }) => [item.launchId, item.source]), [["job-rec", "recording"], ["job-old", "recording"], ["launch-1", "launch"], ["launch-tr", "launch"]]);
    const recording = list[0];
    assert.equal(recording.huTitle, "Grabación: solicitar tarjeta");
    assert.equal(recording.status, "completed_with_failures");
    assert.deepEqual([recording.scenarioCount, recording.passed, recording.failed], [2, 1, 1]);

    const detail = service.buildExecutionSummary("job-rec");
    assert.equal(detail?.source, "recording");
    // A recording is not a user story: its goal is the recording, the destination is TestRail.
    assert.equal(detail?.origin, "recording");
    assert.deepEqual(detail?.hu, {});
    assert.deepEqual(detail?.recording, { id: "rec-1", goal: "solicitar tarjeta" });
    assert.equal(detail?.project.appSlug, "kiosko");
    assert.equal(detail?.testRail.sectionName, "REGRESION-KIOSKO");
    assert.equal(detail?.testRail.sectionId, "4761");
    // Without a saved destination, the published scenarios tell where they live in TestRail.
    const old = service.buildExecutionSummary("job-old");
    assert.deepEqual(old?.testRail, { projectId: "56", suiteId: "1731", sectionId: "4755", sectionName: undefined });
    assert.deepEqual(old?.scenarios.map((scenario: { scenarioId: string; caseId?: number }) => [scenario.scenarioId, scenario.caseId]), [["REC-01", 47066]]);
    assert.equal(detail?.scenarios.find((scenario: { scenarioId: string }) => scenario.scenarioId === "REC-01")?.caseId, 47066);
    assert.equal(service.buildExecutionSummary("launch-1")?.origin, "jira");
    assert.equal(service.buildExecutionSummary("launch-tr")?.origin, "testrail");
    assert.equal(detail?.jobId, "job-rec");
    assert.deepEqual(detail?.scenarios.map((scenario: { scenarioId: string; result: string }) => [scenario.scenarioId, scenario.result]), [["REC-01", "passed"], ["REC-01-FLOW-1", "failed"]]);
    assert.equal(service.buildExecutionSummary("job-other"), null);
  } finally {
    process.chdir(previous);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
