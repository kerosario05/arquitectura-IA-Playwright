import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { EvidenceRecorder } from "./evidence-recorder";

function mockPage(options: { ready: boolean; screenshotFails?: boolean }) {
  return {
    isClosed: () => false,
    waitForLoadState: async () => undefined,
    evaluate: async () => options.ready,
    screenshot: async ({ path: screenshotPath }: { path: string }) => {
      if (options.screenshotFails) throw new Error("screenshot_failed");
      await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
      await fs.writeFile(screenshotPath, "image");
    },
  } as any;
}

async function createRecorder(outputRoot: string, scenarioId: string) {
  return new EvidenceRecorder({
    appSlug: "generic-app",
    sectionSlug: "generic-section",
    scenarioId,
    scenarioTitle: "Generic scenario",
    outputRoot,
  }, { docxEnabled: false, perScenarioDocx: false });
}

test("T1-T7/T14 shared initial evidence contract for full_discovery and promoted_reuse", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "initial-evidence-contract-"));
  try {
    for (const executionSource of ["full_discovery", "promoted_reuse"] as const) {
      const recorder = await createRecorder(root, executionSource);
      const ready = await recorder.captureInitialScreen(mockPage({ ready: true }), executionSource);
      assert.equal(ready, true);
      await recorder.captureStep(mockPage({ ready: true }), 1, "step one", { sourceStepIndex: 1 });
      const record = await recorder.finish();
      assert.deepEqual(Object.keys(record.initialScreenEvidence ?? {}).sort(), ["captured", "capturedAt", "path", "status"]);
      assert.equal(record.initialScreenEvidence?.status, "ready");
      assert.equal(record.initialScreenEvidence?.captured, true);
      assert.equal(record.steps.length, 1);
      assert.equal(record.steps[0].stepIndex, 1);
      assert.notEqual(record.initialScreenEvidence?.path, record.steps[0].screenshotPath);
      assert.ok(record.finalScreenEvidence?.captured);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("T8 readiness success with screenshot failure does not reuse step screenshot", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "initial-evidence-screenshot-failure-"));
  try {
    const recorder = await createRecorder(root, "SCREENSHOT-FAILURE");
    assert.equal(await recorder.captureInitialScreen(mockPage({ ready: true, screenshotFails: true }), "promoted_reuse"), true);
    await recorder.captureStep(mockPage({ ready: true }), 1, "step one", { sourceStepIndex: 1 });
    const record = await recorder.finish();
    assert.equal(record.initialScreenEvidence?.status, "ready");
    assert.equal(record.initialScreenEvidence?.captured, false);
    assert.equal(record.initialScreenEvidence?.path, null);
    assert.ok(record.steps[0].screenshotPath);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("T15 alreadyReady trusts the shared readiness authority instead of re-deriving via the independent DOM poll", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "initial-evidence-already-ready-"));
  try {
    const recorder = await createRecorder(root, "ALREADY-READY");
    // The page's own DOM poll would report not-ready (evaluate resolves false), but the
    // caller has already proven readiness upstream via the shared waitForPageReady
    // primitive (promoted-spec-runtime.ts's ensureInitialNavigation) immediately before this
    // call, so captureInitialScreen must trust that instead of independently timing out.
    const ready = await recorder.captureInitialScreen(mockPage({ ready: false }), "promoted_reuse", 20, { alreadyReady: true });
    assert.equal(ready, true);
    const record = await recorder.finish();
    assert.equal(record.initialScreenEvidence?.status, "ready");
    assert.equal(record.initialScreenEvidence?.captured, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("T16 alreadyReady still reports failure for a page that closed before evidence capture", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "initial-evidence-already-ready-closed-"));
  try {
    const recorder = await createRecorder(root, "ALREADY-READY-CLOSED");
    const closedPage = { ...mockPage({ ready: false }), isClosed: () => true };
    const ready = await recorder.captureInitialScreen(closedPage, "promoted_reuse", 20, { alreadyReady: true });
    assert.equal(ready, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("T9-T13 readiness failure captures diagnostics and leaves steps unstarted", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "initial-evidence-load-failure-"));
  try {
    for (const executionSource of ["full_discovery", "promoted_reuse"] as const) {
      const recorder = await createRecorder(root, executionSource);
      assert.equal(await recorder.captureInitialScreen(mockPage({ ready: false }), executionSource, 20), false);
      const record = await recorder.finish();
      assert.equal(record.initialScreenEvidence?.status, "load_failed");
      assert.equal(record.initialScreenEvidence?.captured, true);
      assert.equal(record.steps.length, 0);
      assert.equal(record.status, "Fallido");
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
