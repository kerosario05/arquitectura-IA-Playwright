import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import type { SpecExecutionContract, SpecExecutionContractStep } from "../spec-execution-contract";
import { compileDeterministicSpec as compileDeterministicSpecRaw } from "./deterministic-spec-compiler";

/**
 * FIRST_LOSS fix (jobId 25a2af2e-1ef3-4661-b156-5417c8783fe1): resolveActionTargetAuthority
 * checked `hasTechnicalTargetRef(step)` before ever consulting `step.certifiedTechnicalTarget`,
 * so a coexisting, earlier-provenance technicalTargetRef always opaqued a freshly-materialized,
 * non-ambiguous certified structural target on the same step (real steps 4/7 both carry both
 * fields). Fixed by trying the certified structural authority first -- reusing the EXACT SAME
 * tier/ambiguity/candidate validation the pre-existing certifiedTechnicalTarget branch already
 * applies -- but only when resolutionState is not "runtime_resolution_required" (which this
 * preference must never upgrade or bypass).
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
    operation: "fill",
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

const VALID_NON_AMBIGUOUS_CERT = {
  interactionEvidence: [],
  validatedByInteraction: true,
  certifiedFrom: "recording",
  targetType: "structural",
  locatorCandidates: [{ strategy: "css", value: "a.synthetic-nav-link", confidence: 0.9 }],
  confidence: 0.9,
  certificationTier: 1,
} as any;

const AMBIGUOUS_CERT = {
  interactionEvidence: [],
  validatedByInteraction: true,
  certifiedFrom: "recording",
  targetType: "structural",
  locatorCandidates: [{ strategy: "css", value: "a.synthetic-nav-link", confidence: 0.9 }],
  structuralContext: { identityAmbiguous: true, structuralIdentityMatchCount: 2, deterministicStructuralIdentity: false },
  confidence: 0.9,
  certificationTier: 1,
} as any;

test("1/BOTH_PRESENT_CERTIFIED_VALID: a coexisting technicalTargetRef and a valid, non-ambiguous certified structural target -- certified authority wins", () => {
  const clickStep = step({
    scenarioStepIndex: 4,
    operation: "click",
    target: { strategy: "role", role: "link", name: "Synthetic Nav" },
    technicalTargetRef: "role:link|Synthetic Nav",
    certifiedTechnicalTarget: VALID_NON_AMBIGUOUS_CERT,
  });
  const result = compileDeterministicSpec(contract([clickStep]));

  assert.equal(result.unsupportedCapabilities.length, 0);
  assert.equal(result.bindings[0].targetRef, "css:a.synthetic-nav-link", "certified structural ref must win over the coexisting technicalTargetRef");
  assert.match(result.source, /parseSerializedTechnicalTargetString\('css:a\.synthetic-nav-link'\)/);
  assert.doesNotMatch(result.source, /role:link\|Synthetic Nav/);
});

test("2/BOTH_PRESENT_CERTIFIED_AMBIGUOUS: an ambiguous certified structural target must not be selected -- existing technicalTargetRef behavior preserved", () => {
  const clickStep = step({
    scenarioStepIndex: 4,
    operation: "click",
    target: { strategy: "role", role: "link", name: "Synthetic Nav" },
    technicalTargetRef: "role:link|Synthetic Nav",
    certifiedTechnicalTarget: AMBIGUOUS_CERT,
  });
  const result = compileDeterministicSpec(contract([clickStep]));

  assert.equal(result.unsupportedCapabilities.length, 0);
  assert.equal(result.bindings[0].targetRef, "role:link|Synthetic Nav", "must fall back to the existing technicalTargetRef, never the ambiguous certification");
  assert.match(result.source, /parseSerializedTechnicalTargetString\('role:link\|Synthetic Nav'\)/);
  assert.doesNotMatch(result.source, /a\.synthetic-nav-link/);
});

test("3/TECHNICAL_REF_ONLY: no certifiedTechnicalTarget at all -- identical to prior behavior", () => {
  const clickStep = step({
    scenarioStepIndex: 4,
    operation: "click",
    target: { strategy: "role", role: "link", name: "Synthetic Nav" },
    technicalTargetRef: "role:link|Synthetic Nav",
  });
  const result = compileDeterministicSpec(contract([clickStep]));

  assert.equal(result.bindings[0].targetRef, "role:link|Synthetic Nav");
});

test("4/CERTIFIED_ONLY_VALID: no technicalTargetRef, only a valid certified structural target -- identical result to before this fix", () => {
  const clickStep = step({
    scenarioStepIndex: 4,
    operation: "click",
    target: { strategy: "role", role: "link", name: "Synthetic Nav" },
    certifiedTechnicalTarget: VALID_NON_AMBIGUOUS_CERT,
  });
  const result = compileDeterministicSpec(contract([clickStep]));

  assert.equal(result.bindings[0].targetRef, "css:a.synthetic-nav-link");
});

test("5/RUNTIME_RESOLUTION_REQUIRED: a valid certified structural target must NOT be promoted to certified authority when resolution is explicitly deferred -- existing runtime_deferred behavior preserved", () => {
  const clickStep = step({
    scenarioStepIndex: 6,
    operation: "click",
    target: { strategy: "text", value: "Synthetic deferred target" },
    resolutionState: "runtime_resolution_required",
    certifiedTechnicalTarget: VALID_NON_AMBIGUOUS_CERT,
  } as any);
  const result = compileDeterministicSpec(contract([clickStep]));

  assert.equal(result.unsupportedCapabilities.length, 0, "upstream explicitly deferred resolution -- not a compile-time failure");
  assert.equal(result.bindings.length, 1);
  assert.equal(result.bindings[0].targetRef, "css:a.synthetic-nav-link", "the same structured evidence is used, but via the existing runtime_deferred path");
  assert.equal(result.bindings[0].runtimeResolutionRequired, true, "must remain marked runtime_resolution_required, never silently upgraded to certified");
});

test("6/compiler output: when certified wins over technicalTargetRef, the binding/technicalTargetRefs materialize from the certified authority, not the defeated ref", () => {
  const clickStep = step({
    scenarioStepIndex: 4,
    operation: "click",
    target: { strategy: "role", role: "link", name: "Synthetic Nav" },
    technicalTargetRef: "role:link|Synthetic Nav",
    certifiedTechnicalTarget: VALID_NON_AMBIGUOUS_CERT,
  });
  const result = compileDeterministicSpec(contract([clickStep]));

  assert.match(result.source, /technicalTargetRefs: \['css:a\.synthetic-nav-link'\]/);
  assert.doesNotMatch(result.source, /technicalTargetRefs: \['role:link\|Synthetic Nav'\]/);
});
