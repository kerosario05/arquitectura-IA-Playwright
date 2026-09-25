import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import type { SpecExecutionContract, SpecExecutionContractStep } from "../spec-execution-contract";
import { compileDeterministicSpec as compileDeterministicSpecRaw } from "./deterministic-spec-compiler";
import type { SemanticRuntimeEvidence } from "../../recording/structural-owner-identity";

/**
 * DEFINITIVE FIX (recordingId=e224287e-...), Blocker A closure: a `runtime_resolution_required`
 * click with NO structured locator/certified evidence at all (technicalTargetCandidates/
 * certifiedTechnicalTarget/plan target all absent) but a captured `SemanticRuntimeEvidence`
 * previously fell into `{kind:"insufficient", reason:"runtime_resolution_required_missing_
 * structured_evidence"}` -- the step was silently dropped (`unsupportedCapabilities`), so
 * `semanticRuntimeEvidence` never reached the generated spec at all. Fixed: a new
 * `{kind:"semantic_runtime_only"}` authority emits `semanticRuntimeEvidence` as STRUCTURED DATA
 * on the `pageObject.click({...})` call -- never a getByText/text=/nth/first/last/coordinate
 * selector -- and the shared runtime resolver (target-resolver.ts) re-proves uniqueness live.
 */

const TEST_TARGET_SPEC_PATH = path.resolve(
  process.cwd(),
  "automations/apps/synthetic-app/sections/synthetic-section/cases/synthetic-case/case.spec.ts",
);

function compileDeterministicSpec(contract: SpecExecutionContract) {
  return compileDeterministicSpecRaw(contract, { targetSpecPath: TEST_TARGET_SPEC_PATH });
}

function step(overrides: Partial<SpecExecutionContractStep>): SpecExecutionContractStep {
  return {
    contractStepIndex: 0,
    scenarioStepIndex: 0,
    originalText: "synthetic step",
    operation: "click",
    required: true,
    executionStatus: "executed",
    evidenceRefs: [],
    ...overrides,
  };
}

function contract(steps: SpecExecutionContractStep[], overrides: Partial<SpecExecutionContract> = {}): SpecExecutionContract {
  return {
    version: "1",
    scenarioId: "SYN-001",
    title: "synthetic scenario",
    steps,
    unresolvedRequiredOracles: [],
    diagnostics: { requiredScenarioSteps: steps.length, representedScenarioSteps: steps.length, missingScenarioSteps: [] },
    ...overrides,
  } as SpecExecutionContract;
}

const SEMANTIC_EVIDENCE: SemanticRuntimeEvidence = {
  source: "visible_text",
  normalizedValue: "SMS",
  targetTag: "div",
  scopeAlternatives: [{ scopeIdentity: { strategy: "id", value: "stable-scope" }, captureMatchCount: 1 }],
  captureUniqueTarget: true,
};

test("4/5/6. a runtime_resolution_required click with NO structured evidence at all but a captured SemanticRuntimeEvidence compiles (not dropped) and emits it as STRUCTURED DATA, never a text/position selector", () => {
  const clickStep = step({
    scenarioStepIndex: 9,
    operation: "click",
    target: { strategy: "text", value: "SMS" },
    resolutionState: "runtime_resolution_required",
    semanticRuntimeEvidence: SEMANTIC_EVIDENCE,
  } as any);
  const result = compileDeterministicSpec(contract([clickStep]));

  assert.equal(result.unsupportedCapabilities.length, 0, "the step must not be dropped as insufficient authority");
  assert.match(result.source, /semanticRuntimeEvidence: \{/);
  const emittedMatch = result.source.match(/semanticRuntimeEvidence: (\{[\s\S]*?\}),\n\s*action:/);
  assert.ok(emittedMatch, "semanticRuntimeEvidence object literal must be present before the action callback");
  const emitted = JSON.parse(emittedMatch![1]);
  assert.deepEqual(emitted, SEMANTIC_EVIDENCE, "the evidence transports structurally, never degraded to a plain string");
  assert.equal(result.bindings[0].runtimeResolutionRequired, true);

  // Never a text/position selector generated FROM the semantic evidence.
  assert.doesNotMatch(result.source, /getByText/);
  assert.doesNotMatch(result.source, /text=/);
  assert.doesNotMatch(result.source, /\.nth\(/);
  assert.doesNotMatch(result.source, /\.first\(/);
  assert.doesNotMatch(result.source, /\.last\(/);
});

test("7. certified technical target still takes priority over semantic runtime evidence when both are present", () => {
  const clickStep = step({
    scenarioStepIndex: 3,
    operation: "click",
    target: { strategy: "text", value: "Synthetic Target" },
    technicalTargetRef: "css:[data-testid=\"btn\"]",
    semanticRuntimeEvidence: SEMANTIC_EVIDENCE,
  } as any);
  const result = compileDeterministicSpec(contract([clickStep]));

  assert.doesNotMatch(result.source, /semanticRuntimeEvidence:/, "certified/technical_ref authority must win; semantic evidence is last-resort only");
  assert.match(result.source, /technicalTargetRefs: \['css:\[data-testid="btn"\]'\]/);
});

test("no semantic evidence, no target, no structured evidence, runtime_resolution_required: step is dropped exactly as before (unchanged fail-closed behavior)", () => {
  const clickStep = step({
    scenarioStepIndex: 5,
    operation: "click",
    resolutionState: "runtime_resolution_required",
  } as any);
  const result = compileDeterministicSpec(contract([clickStep]));

  assert.equal(result.unsupportedCapabilities.length, 1);
  assert.match(result.unsupportedCapabilities[0], /runtime_resolution_required_missing_structured_evidence/);
});

test("same input produces the same generated source (deterministic compiler)", () => {
  const clickStep = step({
    scenarioStepIndex: 9,
    operation: "click",
    target: { strategy: "text", value: "SMS" },
    resolutionState: "runtime_resolution_required",
    semanticRuntimeEvidence: SEMANTIC_EVIDENCE,
  } as any);
  const first = compileDeterministicSpec(contract([clickStep]));
  const second = compileDeterministicSpec(contract([clickStep]));
  assert.equal(first.source, second.source);
});
