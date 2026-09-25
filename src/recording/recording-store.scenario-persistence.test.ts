import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadScenarios, recordingDir, saveScenarios } from "./recording-store";
import type { RecordedScenario } from "./trace-to-scenario";

/**
 * Focal tests for the derive -> saveScenarios -> loadScenarios pipeline this ticket audited.
 * Uses a synthetic, throwaway appSlug (never a real project) under `automations/apps/`, since
 * `recording-store.ts` has no override for its root directory -- cleaned up in `after()`.
 */

const appSlug = `test-recording-store-authority-${Date.now()}`;
const recordingId = "11111111-1111-1111-1111-111111111111";

function minimalScenario(scenarioId: string): RecordedScenario {
  return {
    scenarioId,
    title: scenarioId,
    description: "test",
    preconditions: [],
    kind: "happy_path",
    provenance: "observed",
    mobileSteps: [],
    webSteps: [],
    testRailSteps: [{ content: "Continuar", expected: "" }],
    requiredData: [],
    stepTargets: [],
    sourceRecordingId: recordingId,
    hasUncertainSteps: false,
  } as unknown as RecordedScenario;
}

test.after(() => {
  fs.rmSync(path.join("automations", "apps", appSlug), { recursive: true, force: true });
});

test("1/stopOnly (CASE A). a recording with no scenarios.json file ever written loads as an empty, non-throwing array", () => {
  const result = loadScenarios(appSlug, "never-derived-recording");
  assert.deepEqual(result, []);
});

test("3/immediateLoad. saveScenarios persists synchronously -- an immediate loadScenarios call returns the exact same ids, no async gap", () => {
  const scenarios = [minimalScenario("a"), minimalScenario("b")];
  saveScenarios(appSlug, recordingId, scenarios);
  const loaded = loadScenarios(appSlug, recordingId);
  assert.deepEqual(loaded.map((s) => s.scenarioId), ["a", "b"]);
});

test("5/restartPersistence. a later, independent loadScenarios call (simulating a backend restart -- the store has no in-memory cache) still returns the same persisted catalog", () => {
  const firstRead = loadScenarios(appSlug, recordingId);
  const secondRead = loadScenarios(appSlug, recordingId);
  assert.deepEqual(secondRead.map((s) => s.scenarioId), firstRead.map((s) => s.scenarioId));
  assert.equal(secondRead.length, 2);
});

test("6/sameIdentity. the SAME recordingId under a DIFFERENT appSlug is a completely isolated store -- no cross-project leakage", () => {
  const otherAppSlug = `${appSlug}-other`;
  try {
    assert.deepEqual(loadScenarios(otherAppSlug, recordingId), []);
  } finally {
    fs.rmSync(path.join("automations", "apps", otherAppSlug), { recursive: true, force: true });
  }
});

test("7/slugNormalization. write and read use the exact same directory for the same (appSlug, recordingId) pair", () => {
  assert.equal(recordingDir(appSlug, recordingId), recordingDir(appSlug, recordingId));
  const file = path.join(recordingDir(appSlug, recordingId), "scenarios.json");
  assert.ok(fs.existsSync(file), "expected the scenarios.json written by an earlier test to exist at the shared path");
});

test("4/semanticIndependent (CASE B guard). a scenarios.json that exists but fails to parse never throws -- it is treated the same as \"none yet\", not crashed on", () => {
  const corruptAppSlug = `${appSlug}-corrupt`;
  try {
    const dir = recordingDir(corruptAppSlug, recordingId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "scenarios.json"), "{ this is not valid JSON", "utf8");
    assert.deepEqual(loadScenarios(corruptAppSlug, recordingId), []);
  } finally {
    fs.rmSync(path.join("automations", "apps", corruptAppSlug), { recursive: true, force: true });
  }
});
