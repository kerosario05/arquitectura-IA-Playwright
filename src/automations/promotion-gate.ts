import { validateExecutionPlan } from "../plans/execution-plan-validator";
import type { ExecutionPlan } from "../types/execution-plan.types";
import type { CaseDiscoveryResult, DiscoveryStepResult } from "../types/discovery.types";
import type { PromotionPolicy, POMPromotionStatus } from "../types/automation-promotion.types";
import { DEFAULT_PROMOTION_POLICY } from "../types/automation-promotion.types";

export type PromotionGateStatus = "passed" | "blocked" | "not_applicable";

export type PromotionGateInput = {
  discoveryResult: CaseDiscoveryResult;
  candidatePlan?: ExecutionPlan;
  strict?: boolean;
  requireApproval?: boolean;
  promotionPolicy?: PromotionPolicy;
  pomStatus?: POMPromotionStatus;
  missingPageObjects?: string[];
  missingMethods?: string[];
};

export type PromotionGateResult = {
  allowed: boolean;
  status: PromotionGateStatus;
  reasons: string[];
  warnings: string[];
  summary?: string;
  pomStatus?: POMPromotionStatus;
};

const BLOCKING_FAILED_REASONS = new Set([
  "target_not_found",
  "ambiguous_target",
  "locator_resolution_failed",
  "fill_target_not_found",
  "fill_target_not_editable",
  "fill_failed",
  "click_no_transition",
  "needs_assertion_resolution",
  "needs_setup_resolution",
  "needs_associated_target_resolution",
  "semantic_target_not_found"
]);

function isBlockingStep(step: DiscoveryStepResult): boolean {
  if (step.recoveryStatus === "recovered" || step.recoveryStatus === "repaired") {
    return false;
  }
  if (step.status === "not_found" || step.status === "click_no_transition") {
    return true;
  }
  if (step.status === "needs_assertion_resolution" || step.status === "needs_setup_resolution" || step.status === "needs_associated_target_resolution") {
    return true;
  }
  return false;
}

function isOptionalOrInformational(step: DiscoveryStepResult): boolean {
  if (step.status === "skipped" || step.status === "skipped_semantic_descriptor") {
    return true;
  }
  if (step.assertionStatus === "skipped_semantic_descriptor") {
    return true;
  }
  return false;
}

export function evaluatePromotionGate(input: PromotionGateInput): PromotionGateResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const discovery = input.discoveryResult;
  const plan = input.candidatePlan ?? discovery.candidatePlan;
  const policy = input.promotionPolicy ?? DEFAULT_PROMOTION_POLICY;

  if (discovery.status !== "discovered_passed" && discovery.status !== "repaired_passed") {
    return {
      allowed: false,
      status: "not_applicable",
      reasons: [`Promotion not applicable because discovery status is ${discovery.status}.`],
      warnings
    };
  }

  if (!plan) {
    reasons.push("Candidate plan is missing.");
    return { allowed: false, status: "blocked", reasons, warnings };
  }

  if (plan.status !== "validated") {
    reasons.push(`Candidate plan status is '${plan.status}', expected 'validated'.`);
  }

  const validation = validateExecutionPlan(plan);
  if (!validation.valid) {
    reasons.push("Candidate plan validation failed.");
  }

  if (discovery.failedReason) {
    const hasUnresolvedBlocking = discovery.steps.some(
      (s) => !isOptionalOrInformational(s) && isBlockingStep(s)
    );
    if (hasUnresolvedBlocking) {
      reasons.push(`Discovery reported failedReason '${discovery.failedReason}' with unresolved blocking steps.`);
      if (BLOCKING_FAILED_REASONS.has(discovery.failedReason)) {
        reasons.push(`Blocking failedReason detected: ${discovery.failedReason}.`);
      }
    }
  }

  const blockingSteps = discovery.steps.filter((step) => !isOptionalOrInformational(step) && isBlockingStep(step));
  if (blockingSteps.length > 0) {
    reasons.push(`Blocking discovery steps found: ${blockingSteps.map((step) => `#${step.index}:${step.status}`).join(", ")}`);
  }

  const unresolvedData = plan.requiredData.filter((entry) => entry.required && !entry.resolved);
  if (unresolvedData.length > 0) {
    reasons.push(`Required data unresolved: ${unresolvedData.map((entry) => entry.key).join(", ")}`);
  }

  const sensitiveSteps = plan.steps.filter((step) => {
    const meta = step as typeof step & {
      requiresApproval?: boolean;
      isSensitive?: boolean;
      riskLevel?: string;
      actionCategory?: string;
    };
    return Boolean(
      meta.requiresApproval ||
      meta.isSensitive ||
      meta.riskLevel === "high" ||
      (meta.actionCategory && ["destructive", "financial", "submit_final", "irreversible"].includes(meta.actionCategory))
    );
  });
  if (sensitiveSteps.length > 0) {
    reasons.push(`Sensitive plan steps require explicit approval (${sensitiveSteps.length} step(s)).`);
  }

  if (input.requireApproval) {
    reasons.push("Promotion requires explicit approval flag.");
  }

  if (input.strict && discovery.steps.some((step) => step.status === "skipped")) {
    warnings.push("Strict mode enabled and skipped steps were detected.");
  }

  // --- POM Policy Checks ---
  let pomStatus: POMPromotionStatus | undefined;

  if (policy.requirePageObjects) {
    const missingPO = input.missingPageObjects ?? [];
    const missingMethods = input.missingMethods ?? [];

    if (missingPO.length > 0 && policy.blockPromotionWhenPageObjectMissing) {
      pomStatus = "needs_page_object";
      reasons.push(`Page Object Model requires ${missingPO.length} missing page object(s): ${missingPO.join(", ")}.`);
      reasons.push("Use --inline-debug-spec for debug-only inline spec, or create required Page Objects.");
    }

    if (missingMethods.length > 0 && pomStatus === undefined) {
      pomStatus = "needs_page_method";
      reasons.push(`Page Object Model requires ${missingMethods.length} missing method(s): ${missingMethods.join(", ")}.`);
    }

    if (input.pomStatus === "page_object_candidate_created") {
      pomStatus = "page_object_candidate_created";
      reasons.push("Page Object candidates were created during discovery. Review and approve them before promotion.");
    }

    if (input.pomStatus === "inline_debug_only") {
      pomStatus = "inline_debug_only";
      warnings.push("Spec generated in inline-debug mode. It is NOT a stable automation.");
    }
  }

  return {
    allowed: reasons.length === 0,
    status: reasons.length === 0 ? "passed" : "blocked",
    reasons,
    warnings,
    pomStatus,
    summary: reasons.length === 0 ? "Promotion gate passed." : "Promotion gate blocked."
  };
}
