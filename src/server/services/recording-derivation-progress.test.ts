import assert from "node:assert/strict";
import test from "node:test";
import {
  getDerivationProgress,
  isDeriving,
  resetDerivationProgressForTests,
  startBackgroundDerivation,
  type DerivationStageUpdate,
} from "./recording-derivation-progress";

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test("returns immediately with status deriving, then reports each stage with counts", async () => {
  resetDerivationProgressForTests();
  const gate = deferred<{ scenarioCount: number }>();
  let report: ((update: DerivationStageUpdate) => void) | undefined;
  const started = startBackgroundDerivation("rec-1", (onProgress) => { report = onProgress; return gate.promise; });

  assert.equal(started.status, "deriving");
  assert.equal(started.stageIndex, 0);
  assert.equal(started.stageCount, 4);
  assert.equal(report, undefined, "the work must not start before the caller answers its HTTP request");
  await tick();
  assert.ok(report);

  report!({ stage: "building_steps", actionCount: 34 });
  assert.equal(getDerivationProgress("rec-1")?.stage, "building_steps");
  assert.equal(getDerivationProgress("rec-1")?.stageIndex, 2);
  assert.equal(getDerivationProgress("rec-1")?.actionCount, 34);

  report!({ stage: "ai_enrichment", stepCount: 21 });
  assert.equal(getDerivationProgress("rec-1")?.stageIndex, 3);
  assert.equal(getDerivationProgress("rec-1")?.actionCount, 34, "counts reported earlier are kept");
  assert.equal(getDerivationProgress("rec-1")?.stepCount, 21);

  gate.resolve({ scenarioCount: 3 });
  await tick();
  const done = getDerivationProgress("rec-1");
  assert.equal(done?.status, "derived");
  assert.equal(done?.stageIndex, 4);
  assert.equal(done?.scenarioCount, 3);
  assert.ok(done?.completedAt);
});

test("a second request while generating never launches a second derivation", async () => {
  resetDerivationProgressForTests();
  let runs = 0;
  const never = new Promise<{ scenarioCount: number }>(() => undefined);
  startBackgroundDerivation("rec-2", () => { runs += 1; return never; });
  const again = startBackgroundDerivation("rec-2", () => { runs += 1; return never; });
  await tick();
  assert.equal(runs, 1);
  assert.equal(again.status, "deriving");
  assert.equal(isDeriving("rec-2"), true);
});

test("a failure is reported with its code and message, and can be retried", async () => {
  resetDerivationProgressForTests();
  const error = Object.assign(new Error("No se puede generar escenarios sin un objetivo"), { code: "MISSING_RECORDING_GOAL" });
  startBackgroundDerivation("rec-3", async () => { throw error; });
  await tick();
  const failed = getDerivationProgress("rec-3");
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.errorCode, "MISSING_RECORDING_GOAL");
  assert.match(failed?.errorMessage ?? "", /objetivo/);

  let retried = false;
  startBackgroundDerivation("rec-3", async () => { retried = true; return { scenarioCount: 1 }; });
  await tick();
  assert.equal(retried, true);
});

test("stage reports after completion are ignored", async () => {
  resetDerivationProgressForTests();
  let report!: (update: DerivationStageUpdate) => void;
  startBackgroundDerivation("rec-4", async (onProgress) => { report = onProgress; return { scenarioCount: 1 }; });
  await tick();
  report({ stage: "normalizing" });
  assert.equal(getDerivationProgress("rec-4")?.status, "derived");
  assert.equal(getDerivationProgress("rec-4")?.stageIndex, 4);
});
