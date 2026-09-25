import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * FIRST_LOSS (companion fix): `recordingReplay=true` with no usable `RecordingExecutionContract`
 * used to fall through silently into `parseScenarioStepsForDiscovery`'s legacy text-parsing
 * branch (`case-discovery.ts`), which re-derives actions from human-readable step TEXT with no
 * structured target/valueKey authority -- exactly what let a recorded FILL VALUE get misread as
 * a fill TARGET during a real physical rerun (source job e134f548-e2e8-4fc6-9222-352a933bb960,
 * rerun 90628bc0-8a66-4eae-98b6-5d0b99f79951). The root cause (the rerun conversion silently
 * dropping the contract) is fixed in `rerun-runner.ts`/`virtualCaseToScenario` -- this guard is
 * the ticket's explicit second, independent requirement: even if some OTHER caller ever produces
 * a recording-originated scenario without its contract, the runner must fail explicitly with a
 * structured reason (`recording_execution_contract_missing`) instead of silently degrading to
 * legacy parsing.
 *
 * This ~3000-line orchestrator's full run (`startScenarioPreviewRun`) requires a live app
 * config/route profile/browser session to invoke meaningfully and is not independently
 * re-testable here (no browser, matching this session's established convention for this file --
 * see the pre-existing `scenario-preview-runner.reuse-existing-job.test.ts`, which exercises a
 * lighter, separately-orchestrated function instead). What IS verified here, statically, is the
 * actual code-level claim this ticket cares about: the guard exists, checks the right condition,
 * fires BEFORE any further processing, uses the correct structured failure reason, and never
 * logs a dataset/secret value.
 */

const SOURCE_PATH = path.resolve(__dirname, "scenario-preview-runner.ts");
const source = fs.readFileSync(SOURCE_PATH, "utf8");

function guardRegion(): string {
  const marker = "recordingExecutionContractPresent = validScenarios.every(hasRecordingExecutionContract)";
  const start = source.indexOf(marker);
  assert.ok(start >= 0, "expected the recordingExecutionContractPresent computation to exist");
  const end = source.indexOf("// ── FASE 2b:", start);
  assert.ok(end > start, "expected the guard to end before FASE 2b's entrySteps resolution");
  return source.slice(start, end);
}

test("1/missingContractFailClosed. the guard checks recordingReplay AND !recordingExecutionContractPresent together", () => {
  const region = guardRegion();
  assert.match(region, /if \(recordingReplay && !recordingExecutionContractPresent\)/);
});

test("2/structuredReason. the guard uses the reason code recording_execution_contract_missing, never a generic/silent failure", () => {
  const region = guardRegion();
  assert.match(region, /reason=recording_execution_contract_missing/);
});

test("3/failsClosedBeforeEntrySteps. the guard returns (fails the job) before any entryStep/route resolution runs", () => {
  const region = guardRegion();
  assert.match(region, /status: "failed"/);
  assert.match(region, /\n\s*return;\s*\n\s*\}/);
});

test("4/noLegacyFallthrough. the guard sits between the diagnostic log and FASE 2b -- no code path reaches legacy step parsing when it fires", () => {
  const fullFunctionStart = source.indexOf("export async function startScenarioPreviewRun");
  const guardStart = source.indexOf("if (recordingReplay && !recordingExecutionContractPresent)");
  const phase2bStart = source.indexOf("// ── FASE 2b:");
  assert.ok(fullFunctionStart >= 0 && guardStart > fullFunctionStart, "guard must live inside startScenarioPreviewRun");
  assert.ok(guardStart < phase2bStart, "guard must run before entrySteps/route resolution");
});

test("5/noSecretInGuard. the guard never logs a dataset/secret value -- only ids/counts/booleans", () => {
  const region = guardRegion();
  // The only interpolated values allowed in this region are structural (counts, appSlug, boolean flags).
  assert.doesNotMatch(region, /\$\{.*value.*\}/i);
  assert.match(region, /appSlug=\$\{appSlug\}/);
});

test("6/genericNoHardcode. no app/business hardcode governs the guard", () => {
  const region = guardRegion();
  assert.doesNotMatch(region, /portal-comercial/i);
  assert.doesNotMatch(region, /solicitud multiproducto/i);
  assert.doesNotMatch(region, /numero.de.identificacion/i);
});
