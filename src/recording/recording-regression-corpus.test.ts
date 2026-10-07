import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { buildSemanticRecordingModel } from "./semantic-recording";
import type { SessionTrace } from "./session-trace.types";
import { auditPersistedRecordingCorpus } from "./recording-regression-corpus";
import { buildHappyPathScenario } from "./trace-to-scenario";

function sourceRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "recording-regression-corpus-"));
}

function writeRecording(root: string, appSlug: string, recordingId: string, trace: unknown, scenarios?: unknown): string {
  const dir = path.join(root, appSlug, "recordings", recordingId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "trace.json"), JSON.stringify(trace), "utf8");
  if (scenarios !== undefined) fs.writeFileSync(path.join(dir, "scenarios.json"), JSON.stringify(scenarios), "utf8");
  return dir;
}

function validTrace(recordingId: string, appSlug: string): SessionTrace {
  return {
    recordingId,
    projectSlug: appSlug,
    appSlug,
    platform: "web",
    baseUrl: "http://recording-regression-fixture.test/",
    startedAt: new Date(0).toISOString(),
    status: "stopped",
    events: [{
      seq: 0,
      t: 1,
      kind: "fill",
      screenKey: "form",
      target: { label: "Nombre", role: "textbox", associatedField: "Nombre", locators: [{ strategy: "css", value: "#name" }] },
      value: "Fixture User",
    } as any],
    screens: [],
  };
}

test("audits a persisted source trace in memory and confirms its bytes are unchanged", () => {
  const root = sourceRoot();
  try {
    const dir = writeRecording(root, "project-a", "recording-a", validTrace("recording-a", "project-a"));
    const tracePath = path.join(dir, "trace.json");
    const beforeBytes = fs.readFileSync(tracePath);
    const beforeHash = createHash("sha256").update(beforeBytes).digest("hex");

    const result = auditPersistedRecordingCorpus(root);

    assert.equal(result.total, 1);
    assert.equal(result.passed, 1);
    assert.equal(result.failed, 0);
    assert.equal(result.sourceHashesVerified, true);
    assert.equal(result.entries[0].status, "passed");
    assert.equal(result.entries[0].scenarioCount, 1);
    assert.equal(createHash("sha256").update(fs.readFileSync(tracePath)).digest("hex"), beforeHash);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rehydrates persisted scenario and semantic files without rewriting any source artifact", () => {
  const root = sourceRoot();
  try {
    const trace = validTrace("recording-b", "project-b");
    const dir = writeRecording(root, "project-b", "recording-b", trace, [buildHappyPathScenario(trace, trace.events)]);
    fs.writeFileSync(path.join(dir, "semantic-recording.json"), JSON.stringify(buildSemanticRecordingModel(trace, trace.events)), "utf8");
    const sourceFiles = ["trace.json", "scenarios.json", "semantic-recording.json"].map((name) => path.join(dir, name));
    const before = sourceFiles.map((file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex"));

    const result = auditPersistedRecordingCorpus(root);

    assert.equal(result.entries[0].status, "passed");
    assert.equal(result.entries[0].sourceHashVerified, true);
    assert.deepEqual(sourceFiles.map((file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex")), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("blocks corrupt or empty source traces and never scans generated staging profiles", () => {
  const root = sourceRoot();
  try {
    const corruptDir = writeRecording(root, "project-a", "broken", "{bad-json");
    fs.mkdirSync(path.join(root, "recording-regression-old", "recordings", "staging-only"), { recursive: true });
    const beforeBytes = fs.readFileSync(path.join(corruptDir, "trace.json"));

    const result = auditPersistedRecordingCorpus(root);

    assert.equal(result.total, 1);
    assert.equal(result.blocked, 1);
    assert.equal(result.entries[0].reason, "trace_invalid");
    assert.equal(result.sourceHashesVerified, true);
    assert.deepEqual(fs.readFileSync(path.join(corruptDir, "trace.json")), beforeBytes);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("reports a missing trace as blocked without fabricating a scenario", () => {
  const root = sourceRoot();
  try {
    fs.mkdirSync(path.join(root, "project-a", "recordings", "missing-trace"), { recursive: true });
    const result = auditPersistedRecordingCorpus(root);
    assert.equal(result.total, 1);
    assert.equal(result.blocked, 1);
    assert.equal(result.entries[0].reason, "trace_missing");
    assert.equal(result.entries[0].scenarioCount, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
