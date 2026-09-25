import assert from "node:assert/strict";
import test from "node:test";
import { getPreRuntimeBlockingFailures, getFailedSpecValidationNames } from "./spec-generation-hybrid";

/**
 * FIRST_LOSS (jobId d56e3c6f-7e18-4517-9967-97f7fbd26d2e): `evaluateSpecCandidate`'s admission
 * guard for functionalExecution only checked `functionalExecutionEnabled && discoveryOk` -- a
 * candidate already proven statically invalid (semanticCoverage=failed on a
 * runtime_method_operation_mismatch) still spawned a real browser/Playwright child process.
 * `getPreRuntimeBlockingFailures` reuses the existing `getFailedSpecValidationNames` CORE
 * aggregator (the same one repair already consults), scoped to the static gates already computed
 * before functionalExecution runs -- excluding `playwrightDiscovery` (already authoritative via
 * the caller's own freshly-computed `discoveryOk`) and `functionalExecution` itself (not yet run).
 */

function baseValidation(): {
  schema: "passed"; structure: "passed" | "failed"; traceFidelity: "passed" | "failed" | "skipped";
  typescript: "passed" | "failed"; playwrightDiscovery: "passed" | "failed" | "skipped";
  semanticCoverage: "passed" | "failed"; functionalExecution: "passed" | "failed" | "skipped";
} {
  return {
    schema: "passed", structure: "passed", traceFidelity: "skipped", typescript: "passed",
    playwrightDiscovery: "passed", semanticCoverage: "passed", functionalExecution: "skipped",
  };
}

test("1/semanticCoverageFailedBlocksAdmission. semanticCoverage=failed (with discoveryOk=true, checked separately by the caller) is reported as a pre-runtime blocking failure", () => {
  const validation = { ...baseValidation(), semanticCoverage: "failed" as const };
  const failures = getPreRuntimeBlockingFailures(validation);
  assert.deepEqual(failures, ["semanticCoverage"]);
});

test("2/structureFailedBlocksAdmission. structure=failed blocks admission", () => {
  const validation = { ...baseValidation(), structure: "failed" as const };
  assert.deepEqual(getPreRuntimeBlockingFailures(validation), ["structuralValidation"]);
});

test("3/traceFidelityFailedBlocksAdmission. traceFidelity=failed blocks admission", () => {
  const validation = { ...baseValidation(), traceFidelity: "failed" as const };
  assert.deepEqual(getPreRuntimeBlockingFailures(validation), ["traceFidelityValidation"]);
});

test("4/typescriptFailedBlocksAdmission. typescript=failed blocks admission", () => {
  const validation = { ...baseValidation(), typescript: "failed" as const };
  assert.deepEqual(getPreRuntimeBlockingFailures(validation), ["typescriptValidation"]);
});

test("5/allStaticGreenAdmitsExactlyOnce. every static gate green -> empty list, admission proceeds (caller still ANDs functionalExecutionEnabled && discoveryOk itself)", () => {
  assert.deepEqual(getPreRuntimeBlockingFailures(baseValidation()), []);
});

test("6/playwrightDiscoveryExcludedNoDoubleLogic. playwrightDiscovery=failed is never reported here -- it is authoritative via the caller's own discoveryOk, not duplicated", () => {
  const validation = { ...baseValidation(), playwrightDiscovery: "failed" as const };
  assert.deepEqual(getPreRuntimeBlockingFailures(validation), [], "playwrightDiscovery must not appear in this list");
});

test("7/functionalExecutionNeverSelfBlocks. functionalExecution's own default 'skipped' status (not yet run) never appears in the pre-runtime list -- the helper never self-blocks", () => {
  assert.deepEqual(getPreRuntimeBlockingFailures(baseValidation()), []);
  // Even a stale/hypothetical "failed" on functionalExecution itself must never leak in --
  // this helper is only ever consulted BEFORE functionalExecution runs.
  const validation = { ...baseValidation(), functionalExecution: "failed" as const };
  assert.deepEqual(getPreRuntimeBlockingFailures(validation), []);
});

test("8/multipleStaticFailuresAllReported. multiple simultaneous static failures are all reported, in the same order getFailedSpecValidationNames already produces", () => {
  const validation = { ...baseValidation(), structure: "failed" as const, semanticCoverage: "failed" as const, typescript: "failed" as const };
  assert.deepEqual(getPreRuntimeBlockingFailures(validation), ["structuralValidation", "semanticCoverage", "typescriptValidation"]);
});

test("9/repairReceivesOriginalFailedGate. the original failing gate (semanticCoverage) survives unchanged for repair -- getFailedSpecValidationNames itself is untouched by this fix", () => {
  const validation = { ...baseValidation(), semanticCoverage: "failed" as const };
  assert.deepEqual(getFailedSpecValidationNames(validation), ["semanticCoverage"]);
});

test("10/skipNeverBecomesPass. functionalExecution stays at its 'skipped' default when admission is blocked -- never silently marked 'passed'", () => {
  const validation = { ...baseValidation(), semanticCoverage: "failed" as const };
  assert.deepEqual(getPreRuntimeBlockingFailures(validation), ["semanticCoverage"]);
  // functionalExecution itself is untouched by getPreRuntimeBlockingFailures (a read-only
  // aggregator) -- the caller leaves it at its "skipped" default rather than setting "passed".
  assert.equal(validation.functionalExecution, "skipped");
});
