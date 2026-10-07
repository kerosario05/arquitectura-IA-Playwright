import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { SessionTrace } from "./session-trace.types";
import { loadTrace, recordingDir, saveTrace } from "./recording-store";

test("recording store can persist a regression trace under an explicit staging root", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-recording-store-staging-"));
  const trace: SessionTrace = {
    recordingId: "regression-recording-001",
    projectSlug: "recording-engine-regression",
    appSlug: "recording-engine-regression",
    platform: "web",
    startedAt: new Date(0).toISOString(),
    status: "stopped",
    events: [],
    screens: [],
  };

  try {
    saveTrace(trace, { rootDir });
    assert.equal(recordingDir(trace.appSlug, trace.recordingId, { rootDir }), path.join(rootDir, trace.appSlug, "recordings", trace.recordingId));
    assert.deepEqual(loadTrace(trace.appSlug, trace.recordingId, { rootDir }), trace);
    assert.equal(fs.existsSync(path.join("automations", "apps", trace.appSlug, "recordings", trace.recordingId, "trace.json")), false);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("recording store keeps the official app root as the default", () => {
  assert.equal(recordingDir("sample-app", "recording-001"), path.join("automations", "apps", "sample-app", "recordings", "recording-001"));
});
