import assert from "node:assert/strict";
import test from "node:test";
import { findUncertifiedRequiredTargetSteps } from "./spec-generation-hybrid";
import type { SpecExecutionContract, SpecExecutionContractStep } from "./spec-execution-contract";

/**
 * Pre-AI technical executability gate: a REQUIRED interactive step with no certifiedTechnicalTarget
 * must never reach AI spec generation. findUncertifiedRequiredTargetSteps is the exact pure
 * function the real pipeline calls (in runHybridSpecGenerationInternal, before any AI provider
 * invocation) to decide this — tested directly and hermetically here, independent of the
 * fixture-heavy AI generation flow.
 */

function baseStep(overrides: Partial<SpecExecutionContractStep>): SpecExecutionContractStep {
  return {
    contractStepIndex: 0,
    scenarioStepIndex: 1,
    originalText: "Clic en tarjeta",
    operation: "click",
    required: true,
    executionStatus: "executed",
    evidenceRefs: [],
    ...overrides,
  };
}

function contractOf(steps: SpecExecutionContractStep[]): SpecExecutionContract {
  return { steps } as SpecExecutionContract;
}

// CASE 6: a required long-text step with no certifiable technical identity blocks readiness.
test("uncertifiedRequiredBlocksTest (CASE 6): a required click step with no certifiedTechnicalTarget is reported as uncertified", () => {
  const contract = contractOf([baseStep({ scenarioStepIndex: 4 })]);
  const uncertified = findUncertifiedRequiredTargetSteps(contract);
  assert.equal(uncertified.length, 1);
  assert.equal(uncertified[0].scenarioStepIndex, 4);
});

// CASE 7: the detection itself — the real call site returns before any AI invocation code runs
// whenever this list is non-empty (verified by reading spec-generation-hybrid.ts: the early
// `return { promotionAllowed: false, ... }` for contractValid=false precedes
// `playwrightLaunchContext`/provider setup and every `[spec-generation] enabled provider=...`
// invocation log). This test proves the detection signal that gates that return is correct.
test("uncertifiedSkipsAiTest (CASE 7): the uncertified-required-target signal that gates AI invocation is non-empty when a required target is uncertified", () => {
  const contract = contractOf([
    baseStep({ scenarioStepIndex: 1, certifiedTechnicalTarget: { targetType: "structural", locatorCandidates: [{ strategy: "role", value: "button|Iniciar" }], interactionEvidence: [], confidence: 0.85, validatedByInteraction: true, certifiedFrom: "recording", certificationTier: 2 } as any }),
    baseStep({ scenarioStepIndex: 4 }), // uncertified
  ]);
  const uncertified = findUncertifiedRequiredTargetSteps(contract);
  assert.equal(uncertified.length, 1, "exactly the one uncertified required step must be flagged — AI generation must not be reached");
});

// Non-target-requiring operations (e.g. assertions) never block on a missing certified target —
// they were never going to have one.
test("assertVisible steps are never flagged even without a certifiedTechnicalTarget", () => {
  const contract = contractOf([baseStep({ scenarioStepIndex: 2, operation: "assertVisible" })]);
  assert.deepEqual(findUncertifiedRequiredTargetSteps(contract), []);
});

// Optional (non-required) steps never block readiness.
test("an optional (required=false) uncertified step does not block readiness", () => {
  const contract = contractOf([baseStep({ scenarioStepIndex: 3, required: false })]);
  assert.deepEqual(findUncertifiedRequiredTargetSteps(contract), []);
});

// CASE 8: all required steps certified -> AI generation remains eligible (signal is empty).
test("allCertifiedEligibleTest (CASE 8): all required interactive steps certified leaves AI generation eligible", () => {
  const certified = { targetType: "structural", locatorCandidates: [{ strategy: "role", value: "button|Iniciar" }], interactionEvidence: [], confidence: 0.85, validatedByInteraction: true, certifiedFrom: "recording", certificationTier: 2 } as any;
  const contract = contractOf([
    baseStep({ scenarioStepIndex: 1, certifiedTechnicalTarget: certified }),
    baseStep({ scenarioStepIndex: 2, operation: "fill", certifiedTechnicalTarget: certified }),
    baseStep({ scenarioStepIndex: 3, operation: "assertVisible" }),
  ]);
  assert.deepEqual(findUncertifiedRequiredTargetSteps(contract), []);
});
