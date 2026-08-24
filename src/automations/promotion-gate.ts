import { validateExecutionPlan } from "../plans/execution-plan-validator";
import type { ExecutionPlan } from "../types/execution-plan.types";
import type { CaseDiscoveryResult, DiscoveryStepResult } from "../types/discovery.types";
import type { PromotionPolicy, POMPromotionStatus } from "../types/automation-promotion.types";
import { DEFAULT_PROMOTION_POLICY } from "../types/automation-promotion.types";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function detectFillValueLiteralFieldNameAntiPattern(specContent: string): string[] {
  const errors: string[] = [];
  
  const fillPromotedFieldRegex = /fillPromotedField\(\{\s*stepIndex:\s*\d+,\s*field:\s*'([^']+)',\s*value:\s*String\(([^)]+)\),[^}]*fill:\s*async\s*\(\)\s*=>\s*\{\s*await\s+\w+\.\w+\([^}]+\}\s*\}\)/g;
  
  let match: RegExpExecArray | null;
  while ((match = fillPromotedFieldRegex.exec(specContent)) !== null) {
    const fieldName = match[1];
    const valueVar = match[2];
    const fullCall = match[0];
    
    const fillMethodMatch = fullCall.match(/await\s+\w+\.\w+\(\s*'([^']+)',\s*'([^']+)'\s*\)/);
    if (fillMethodMatch) {
      const firstArg = fillMethodMatch[1];
      const secondArg = fillMethodMatch[2];
      
      if (firstArg === fieldName && secondArg === fieldName) {
        errors.push(`PROMOTED_FILL_VALUE_LITERAL_FIELD_NAME: fillPromotedField field="${fieldName}" has callback fill('${firstArg}', '${secondArg}') where second arg equals field name instead of using value variable "${valueVar}"`);
      }
    }
  }
  
  return errors;
}

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
  specContent?: string;
  observableOracles?: Array<{
    requirement: string;
    type: string;
    backed: boolean;
  }>;
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
  // Recovered/repaired steps are not blocking
  if (step.recoveryStatus === "recovered" || step.recoveryStatus === "repaired") {
    return false;
  }
  
  // Assertion failures that were recovered are not blocking
  if (step.recoveredBy === "auth_flow" || step.recoveredBy === "page_stability" || step.recoveredBy === "later_success" || step.recoveredBy === "retry_after_navigation") {
    return false;
  }
  
  // Check recovery metadata for explicit blocking flag
  if (step.recoveryMetadata?.blocking === false) {
    return false;
  }
  
  // Not found and click_no_transition are blocking unless recovered
  if (step.status === "not_found" || step.status === "click_no_transition") {
    return true;
  }
  
  // Resolution needs are blocking
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

  if (!plan) {
    reasons.push("Candidate plan is missing.");
    return { allowed: false, status: "blocked", reasons, warnings };
  }

  const validation = validateExecutionPlan(plan);
  const blockingSteps = discovery.steps.filter((step) => !isOptionalOrInformational(step) && isBlockingStep(step));
  const eligibleFromPartialDiscovery =
    discovery.status === "discovered_partial"
    && plan.status === "validated"
    && validation.valid
    && blockingSteps.length === 0;

  if (
    discovery.status !== "discovered_passed"
    && discovery.status !== "repaired_passed"
    && !eligibleFromPartialDiscovery
  ) {
    return {
      allowed: false,
      status: "not_applicable",
      reasons: [`Promotion not applicable because discovery status is ${discovery.status}.`],
      warnings
    };
  }

  if (eligibleFromPartialDiscovery) {
    warnings.push("Promotion proceeding from discovered_partial because only non-blocking/contextual discovery gaps remain.");
  }

  if (plan.status !== "validated") {
    reasons.push(`Candidate plan status is '${plan.status}', expected 'validated'.`);
  }

  if (!validation.valid) {
    reasons.push("Candidate plan validation failed.");
  }

  if (discovery.failedReason) {
    // Check if the candidate plan is validated - if so, the failure was recovered
    // and shouldn't block promotion
    if (plan.status === "validated" && validation.valid) {
      // Plan is valid, failure was recovered during discovery
      warnings.push(`Discovery had failedReason '${discovery.failedReason}' but plan is validated (recovered).`);
    } else {
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
  }

  // Check for blocking steps in discovery
  // If the plan is validated, skip this check - the plan validation already ensures correctness
  // and any failed discovery steps were recovered/removed from the plan
  if (plan.status !== "validated" || !validation.valid) {
    if (blockingSteps.length > 0) {
      reasons.push(`Blocking discovery steps found: ${blockingSteps.map((step) => `#${step.index}:${step.status}`).join(", ")}`);
    }
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

  // --- Observable Oracle Gate ---
  // A required expected outcome that could not be resolved to an observable
  // oracle must block promotion: promoting a spec that cannot verify the
  // scenario's expected result is forbidden.
  let pomStatus: POMPromotionStatus | undefined;
  if (input.observableOracles && input.observableOracles.length > 0) {
    const unresolvedRequired = input.observableOracles.filter(
      (oracle) => oracle.type === "unsupported_or_unresolved" && oracle.backed === false
    );
    if (unresolvedRequired.length > 0) {
      for (const oracle of unresolvedRequired) {
        console.log(`[promotion-oracle-gate] requirement="${oracle.requirement.slice(0, 120)}" oracleType=${oracle.type} backed=false`);
      }
      reasons.push(
        `Required observable oracle unresolved (${unresolvedRequired.length}): ` +
        unresolvedRequired.map((oracle) => `"${oracle.requirement}"`).join(", ") +
        `. Spec cannot verify the expected result; promotion blocked before spec generation.`
      );
      pomStatus = "needs_manual_review";
    }
  }

  // --- POM Policy Checks ---

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

  // --- Promoted Fill Value Contract Check ---
  if (input.specContent) {
    const fillValueErrors = detectFillValueLiteralFieldNameAntiPattern(input.specContent);
    if (fillValueErrors.length > 0) {
      reasons.push(...fillValueErrors);
      pomStatus = "needs_manual_review";
    }
  }

  // --- AuthFlow Requirement Check ---
  // If plan metadata indicates AuthFlow is required but spec doesn't include it, block promotion
  if (plan.metadata?.authFlowRequired && input.specContent) {
    const hasAuthFlowImport = input.specContent.includes("AuthFlow");
    const hasAuthFlowCall = input.specContent.includes("authFlow.ensureAuthenticated");

    if (!hasAuthFlowImport || !hasAuthFlowCall) {
      reasons.push(
        `Plan requires AuthFlow (authGate detected during discovery at step ${plan.metadata.authFlowInsertionAfterStepIndex ?? "unknown"}), ` +
        `but generated spec does not include AuthFlow.ensureAuthenticated(). ` +
        `This will cause runtime failure with auth_required_before_open_module error.`
      );
      pomStatus = "needs_auth_flow_in_spec";
    }
  }

  // --- Evidence Gate: Detail Screenshot Requirement Check ---
  // If this is a detail scenario and detail screenshot is required but not captured,
  // block promotion

  // Try to use evidenceJsonPath from discovery result (set by finalizeDiscoveryEvidence)
  // Fall back to evidenceDir/evidence.json for backward compatibility
  const evidenceJsonPath = (discovery as any).evidenceJsonPath
    ?? (discovery.evidenceDir ? join(discovery.evidenceDir, "evidence.json") : undefined);

  if (evidenceJsonPath && existsSync(evidenceJsonPath)) {
    try {
      const evidenceJsonContent = readFileSync(evidenceJsonPath, "utf-8");
      const evidenceRecord = JSON.parse(evidenceJsonContent);
      const detailEvidence = evidenceRecord?.detailEvidence;
      const evidenceKind = evidenceRecord?.evidenceKind ?? "unknown";
      const isDetailEvidence = evidenceKind === "detailEvidence";

      console.log(`[evidence-gate] scenario="${discovery.name}" evidenceKind=${evidenceKind} isDetail=${isDetailEvidence}`);

      if (detailEvidence?.required === true) {
        // Detail screenshot was required for this scenario
        const detailScreenshotCaptured = detailEvidence.captured === true && detailEvidence.screenshotPath;
        const detailActuallyOpened = detailEvidence.detailOpened === true;

        console.log(
          `[promotion-gate] evidence-gate check evidenceJsonPath=${evidenceJsonPath} ` +
          `detailRequired=true captured=${detailScreenshotCaptured} opened=${detailActuallyOpened} evidenceKind=${evidenceKind}`
        );

        if (!isDetailEvidence) {
          console.log(`[evidence-gate] skipped detailEvidence check reason=not_detail_evidence evidenceKind=${evidenceKind}`);
        } else if (!detailScreenshotCaptured) {
          reasons.push(
            `Evidence gate failed: Detail screenshot was required but not captured. ` +
            `Target="${detailEvidence.target ?? "unknown"}". ` +
            `Reason: ${detailEvidence.reason ?? "missing_detail_screenshot"}`
          );
          pomStatus = "needs_manual_review";
        } else if (!detailActuallyOpened) {
          reasons.push(
            `Evidence gate failed: Detail screen did not open. ` +
            `Target="${detailEvidence.target ?? "unknown"}". ` +
            `Screenshot was captured but oracle detected insufficient detail signals. ` +
            `detailHeading=${detailEvidence.detailHeading ?? false} ` +
            `detailSections=${detailEvidence.detailSections ?? false} ` +
            `actionButtons=${detailEvidence.actionButtons ?? false}. ` +
            `Reason: ${detailEvidence.oracleReason ?? detailEvidence.reason ?? "detail_not_opened"}`
          );
          pomStatus = "needs_manual_review";
        } else {
          console.log(
            `[promotion-gate] evidence-gate passed detailScreenshot captured and validated ` +
            `path=${detailEvidence.screenshotPath}`
          );
        }
      }
    } catch (err) {
      warnings.push(
        `Evidence gate check failed to read evidence.json: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  } else if (evidenceJsonPath) {
    console.log(
      `[promotion-gate] evidence-gate skipped (evidence.json not found) path=${evidenceJsonPath}`
    );
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
