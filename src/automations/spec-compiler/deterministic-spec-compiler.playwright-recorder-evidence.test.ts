import assert from "node:assert/strict";
import test from "node:test";
import { compileDeterministicSpec } from "./deterministic-spec-compiler";
import type { SpecExecutionContract, SpecExecutionContractStep } from "../spec-execution-contract";

const evidence = {
  kind: "role" as const,
  role: "button",
  normalizedName: "Observed control",
  scopeIdentity: { strategy: "id" as const, value: "scope" },
  captureMatchCount: 1,
  runtimeResolutionRequired: true as const,
};

test("generated spec transports recorder evidence and never emits positional selectors", () => {
  const step: SpecExecutionContractStep = {
    contractStepIndex: 0, scenarioStepIndex: 0, originalText: "observed", operation: "click",
    target: { strategy: "text", value: "Observed control" }, resolutionState: "runtime_resolution_required",
    playwrightRecorderEvidence: evidence, required: true, executionStatus: "executed", evidenceRefs: [],
  } as SpecExecutionContractStep;
  const contract = {
    version: "1", scenarioId: "SYN-REC", title: "recorder", steps: [step],
    unresolvedRequiredOracles: [], diagnostics: { requiredScenarioSteps: 1, representedScenarioSteps: 1, missingScenarioSteps: [] },
  } as SpecExecutionContract;
  const result = compileDeterministicSpec(contract, { targetSpecPath: "synthetic/case.spec.ts" });
  assert.equal(result.unsupportedCapabilities.length, 0);
  assert.match(result.source, /playwrightRecorderEvidence: \{/);
  assert.doesNotMatch(result.source, /\.nth\(|\.first\(|\.last\(/);
});
