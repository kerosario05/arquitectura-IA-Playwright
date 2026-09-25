import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * FIRST_LOSS fix (jobId ea237116-88b1-4be4-ab74-9e37e0716c5f): the PREVIOUS ticket transported
 * `RecordedScenario.runtimeDataset.resolvedValues` through `rerun-runner.ts`'s
 * `resolvePromotedSpecReuse` (used by `POST /api/runs/:jobId/rerun`), but the SEPARATE fast path
 * inside `POST /api/recordings/:recordingId/execute` (recordings.ts ~line 670-675) builds its own
 * `ReuseExistingPromotedSpecScenario[]` directly from the loaded `RecordedScenario` -- which
 * DOES already carry `runtimeDataset.resolvedValues` ("Datos de este escenario") -- but never
 * copied it into the returned scenario object. Two independent construction sites, only one of
 * which was fixed before. Confirmed physically: the exact job that hit this path
 * (`[recordings:execute] ... jobId=ea237116-...`) never came through `/api/runs/:jobId/rerun` at
 * all.
 *
 * Fixed with the SAME one-field addition pattern as the prior ticket
 * (`runtimeValues: scenario.runtimeDataset?.resolvedValues`), feeding the SAME downstream chain
 * (`scenario-preview-runner.ts`'s `startReuseExistingPromotedSpecRun` -> `verifyPromotedSpec`'s
 * `appContext.scenarioRuntimeValues` -> `resolveVerifyPromotedSpecAppExecEnv`) already proven by
 * `promote-plan.reuse-scenario-runtime-authority.test.ts`'s 8 focal tests -- this file only
 * proves THIS route's own construction site now feeds that chain, mirroring the established
 * source-text convention `recordings.reuse-existing-async.test.ts` already uses for this exact
 * route (mounting the full Express route needs a real TestRail client / recording fixtures,
 * disproportionate for a request-shape change).
 */

const RECORDINGS_SOURCE = fs.readFileSync(path.resolve(__dirname, "recordings.ts"), "utf8");
const RERUN_RUNNER_SOURCE = fs.readFileSync(path.resolve(__dirname, "../jobs/rerun-runner.ts"), "utf8");
const SCENARIO_PREVIEW_RUNNER_SOURCE = fs.readFileSync(path.resolve(__dirname, "../jobs/scenario-preview-runner.ts"), "utf8");

function fastPathBlock(): string {
  const start = RECORDINGS_SOURCE.indexOf("const reuseJobScenarios: ReuseExistingPromotedSpecScenario[] = reuseScenarios.map((scenario) => {");
  const end = RECORDINGS_SOURCE.indexOf("});", start);
  assert.notEqual(start, -1, "the recordings.ts execute fast-path construction must exist");
  return RECORDINGS_SOURCE.slice(start, end);
}

test("1/FAST_PATH_COPIES_RUNTIME_DATASET: the recordings.ts execute fast-path's own scenario construction now includes runtimeValues from RecordedScenario.runtimeDataset.resolvedValues", () => {
  const block = fastPathBlock();
  assert.match(
    block,
    /runtimeValues:\s*scenario\.runtimeDataset\?\.resolvedValues/,
    "the fast-path scenario object must copy runtimeDataset.resolvedValues verbatim",
  );
});

test("2/CHAIN_REACHES_VERIFY_APPCONTEXT: the fast-path's runtimeValues field flows through the SAME downstream chain (startReuseExistingPromotedSpecRun -> verifyPromotedSpec.appContext.scenarioRuntimeValues) already proven end-to-end", () => {
  assert.match(
    SCENARIO_PREVIEW_RUNNER_SOURCE,
    /scenarioRuntimeValues:\s*scenario\.runtimeValues,/,
    "startReuseExistingPromotedSpecRun must still forward scenario.runtimeValues into appContext.scenarioRuntimeValues",
  );
  // The fast-path job (recordings.ts) and the rerun job (rerun-runner.ts/runs.ts) both create
  // jobs via jobStore.create("scenario-preview", { scenarios: reuseJobScenarios/reuseScenarios,
  // executionMode: "reuse_existing_promoted_spec" }) and are both consumed by the SAME
  // startReuseExistingPromotedSpecRun -- one shared consumer, not two divergent runtimes.
  assert.match(RECORDINGS_SOURCE, /executionMode: "reuse_existing_promoted_spec"/);
});

test("3/NO_LOCAL_VALUE_RECONSTRUCTION: the fast-path never reconstructs runtime values from app-global data itself -- it only ever forwards the scenario's own field, delegating precedence entirely to resolveVerifyPromotedSpecAppExecEnv", () => {
  const block = fastPathBlock();
  assert.doesNotMatch(block, /loadPromotedAppConfigSync|testData\[/, "the fast path must not attempt its own app-global fallback merge -- that authority lives only in resolveVerifyPromotedSpecAppExecEnv");
});

test("4/UNDEFINED_SAFE_WHEN_NO_DATASET: a scenario with no runtimeDataset yields runtimeValues=undefined (optional chaining) in the RETURNED scenario object, never a fabricated empty object standing in for real data", () => {
  const block = fastPathBlock();
  const returnStart = block.indexOf("return {");
  const returnStatement = block.slice(returnStart);
  assert.match(returnStatement, /runtimeValues:\s*scenario\.runtimeDataset\?\.resolvedValues\s*\}/, "the returned scenario's runtimeValues must be plain optional chaining with no fallback");
  assert.doesNotMatch(returnStatement, /runtimeValues:\s*scenario\.runtimeDataset\?\.resolvedValues\s*\?\?\s*\{\}/, "must not silently substitute an empty object for a genuinely absent dataset");
});

test("5/NO_VALUE_LOGGING: the new diagnostic log line for this fast path reports only presence/keys, never the actual runtime values", () => {
  const start = RECORDINGS_SOURCE.indexOf("[promoted-spec-reuse] phase=execution_start");
  const lineStart = RECORDINGS_SOURCE.lastIndexOf("console.log", start);
  const lineEnd = RECORDINGS_SOURCE.indexOf(");", start);
  const logLine = RECORDINGS_SOURCE.slice(lineStart, lineEnd);
  assert.match(logLine, /runtimeDatasetPresent=\$\{Boolean\(scenario\.runtimeDataset\?\.resolvedValues\)\}/);
  assert.match(logLine, /runtimeKeys=\$\{JSON\.stringify\(Object\.keys\(scenario\.runtimeDataset\?\.resolvedValues\s*\?\?\s*\{\}\)\)\}/);
  assert.doesNotMatch(logLine, /Object\.values|resolvedValues\}/, "must never interpolate the values map itself, only its key names");
});

test("6/RERUN_PATH_REGRESSION_UNCHANGED: the previously-fixed /api/runs/:jobId/rerun path (rerun-runner.ts) still carries its own runtimeValues field intact", () => {
  assert.match(
    RERUN_RUNNER_SOURCE,
    /runtimeValues:\s*match\.runtimeDataset\?\.resolvedValues,/,
    "resolvePromotedSpecReuse's own runtimeValues transport (fixed in the prior ticket) must remain unchanged",
  );
});

test("7/BOTH_ROUTES_FEED_THE_SAME_TYPE: ReuseExistingPromotedSpecScenario.runtimeValues is the single shared field both construction sites populate -- not two divergent shapes", () => {
  assert.match(
    SCENARIO_PREVIEW_RUNNER_SOURCE,
    /export type ReuseExistingPromotedSpecScenario = \{[\s\S]*?runtimeValues\?:\s*Record<string, string>;[\s\S]*?\};/,
  );
});

test("8/GENERICITY: this fix's own source contains no fixture-specific business key names", () => {
  const block = fastPathBlock();
  assert.doesNotMatch(block, /usuario|contrasena|numero_de_identificacion/i);
});
