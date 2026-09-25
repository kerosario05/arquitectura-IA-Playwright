/**
 * Spec runtime gate — the policy that decides whether a freshly generated candidate spec is
 * allowed to be promoted, based on whether its required steps actually ran and passed.
 *
 * Today `spec-generation-hybrid.ts` treats a skipped functional-execution pass (the default,
 * since `AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED` defaults off) as equivalent to "fine to
 * promote" — `(!functionalExecutionEnabled || validation.functionalExecution === "passed")`.
 * That is exactly how the Kiosko2/Step-4 candidate slipped through: its generated spec text
 * was never independently run, so nothing caught that its click target could never resolve.
 *
 * This module is the corrected decision table, expressed as one small, pure, fully-tested
 * function — independent of spec-generation-hybrid.ts's control flow (repair loops, AI
 * invocation counters, etc.) so it can be verified here without touching or risking that
 * ~4000-line pipeline. Wiring it into that file's live `passed` boolean is a distinct,
 * deliberately follow-up step: doing so blind, without being able to run real Playwright in
 * this session, risks mis-triggering the repair/AI-retry loop for a "deferred" candidate that
 * was never actually validated as broken. The policy below is what that wiring should call.
 */

export type SpecRuntimeStepResult = {
  stepIndex: number;
  required: boolean;
  status: "passed" | "failed";
};

/** Whether the candidate's required steps were actually exercised against a real runtime. */
export type SpecRuntimeAvailability = "available" | "unavailable";

export type SpecRuntimeGateInput = {
  availability: SpecRuntimeAvailability;
  /** Only meaningful when availability === "available". */
  steps: SpecRuntimeStepResult[];
  /** Identity of the spec this candidate would replace, if any — never overwritten on block/defer. */
  previousPromotedSpecPath?: string;
};

export type SpecRuntimeGateDecision = "promote" | "block" | "defer";

export type SpecRuntimeGateResult = {
  decision: SpecRuntimeGateDecision;
  promotionAllowed: boolean;
  promotionStatus: "promoted" | "blocked" | "deferred";
  reason: string;
  failedSteps: number[];
  /** True whenever a previously promoted spec must be left exactly as it was. */
  previousPromotedSpecPreserved: boolean;
};

/**
 * CASE G/H/I/J/K's decision table:
 *   - runtime unavailable (skipped/not run)        -> defer   (never silently "fine")
 *   - runtime ran, a required step failed          -> block   (previous spec untouched)
 *   - runtime ran, required steps present, all pass -> promote
 *   - runtime ran but reported zero required steps  -> defer   (nothing was actually proven)
 */
export function evaluateSpecRuntimeGate(input: SpecRuntimeGateInput): SpecRuntimeGateResult {
  const hasPreviousSpec = Boolean(input.previousPromotedSpecPath);

  if (input.availability === "unavailable") {
    return {
      decision: "defer",
      promotionAllowed: false,
      promotionStatus: "deferred",
      reason: "runtime_unavailable_promotion_deferred: candidate runtime did not execute, so no required step was proven to pass — promotion is neither allowed nor denied until it does.",
      failedSteps: [],
      previousPromotedSpecPreserved: hasPreviousSpec,
    };
  }

  const requiredSteps = input.steps.filter((step) => step.required);
  const failedSteps = requiredSteps.filter((step) => step.status !== "passed").map((step) => step.stepIndex);

  if (failedSteps.length > 0) {
    return {
      decision: "block",
      promotionAllowed: false,
      promotionStatus: "blocked",
      reason: `runtime_required_step_failed: ${failedSteps.length} required step(s) did not pass (steps ${failedSteps.join(", ")}).`,
      failedSteps,
      previousPromotedSpecPreserved: hasPreviousSpec,
    };
  }

  if (requiredSteps.length === 0) {
    return {
      decision: "defer",
      promotionAllowed: false,
      promotionStatus: "deferred",
      reason: "runtime_no_required_steps_evaluated: runtime ran but reported no required steps — nothing was actually proven to pass.",
      failedSteps: [],
      previousPromotedSpecPreserved: hasPreviousSpec,
    };
  }

  return {
    decision: "promote",
    promotionAllowed: true,
    promotionStatus: "promoted",
    reason: `runtime_all_required_steps_passed: ${requiredSteps.length} required step(s) passed.`,
    failedSteps: [],
    previousPromotedSpecPreserved: false,
  };
}
