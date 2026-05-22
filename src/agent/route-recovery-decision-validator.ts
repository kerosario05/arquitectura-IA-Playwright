import type { RouteRecoveryDecision } from "../types/route-recovery-decision.types";
import type { RouteRecoveryPack } from "../types/codex-auto-repair.types";
import { getActionCapability } from "../registry/action-registry";

export type RouteRecoveryDecisionValidationIssue = {
  code: string;
  message: string;
};

export type RouteRecoveryDecisionValidationResult = {
  valid: boolean;
  decision?: RouteRecoveryDecision;
  issues: RouteRecoveryDecisionValidationIssue[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateRouteRecoveryDecision(
  raw: unknown,
  pack?: RouteRecoveryPack
): RouteRecoveryDecisionValidationResult {
  const issues: RouteRecoveryDecisionValidationIssue[] = [];

  if (!isObject(raw)) {
    return { valid: false, issues: [{ code: "NOT_OBJECT", message: "Route recovery decision must be an object." }] };
  }

  const obj = raw as Record<string, unknown>;

  if (!obj.recoveryDecision || typeof obj.recoveryDecision !== "string") {
    return { valid: false, issues: [{ code: "MISSING_RECOVERY_DECISION", message: "recoveryDecision is required." }] };
  }

  const decision = obj.recoveryDecision;

  if (!["repaired_plan", "no_safe_action", "needs_more_context"].includes(decision)) {
    return { valid: false, issues: [{ code: "INVALID_RECOVERY_DECISION", message: `recoveryDecision must be one of: repaired_plan, no_safe_action, needs_more_context. Got: ${decision}` }] };
  }

  // Placeholder detection across all fields
  const rawStr = JSON.stringify(raw);
  const placeholderPatterns = ["<candidateId", "<iso timestamp>", "<ISO_TIMESTAMP>", "<candidate-id", "<object-id", "<route-id", "<plan-id"];
  for (const p of placeholderPatterns) {
    if (rawStr.includes(p)) {
      issues.push({ code: "PLACEHOLDER_NOT_REPLACED", message: `Placeholder '${p}' found in route recovery decision.` });
    }
  }

  if (decision === "repaired_plan") {
    if (!obj.selectedCandidateId || typeof obj.selectedCandidateId !== "string" || obj.selectedCandidateId.length === 0) {
      issues.push({ code: "MISSING_CANDIDATE_ID", message: "repaired_plan requires selectedCandidateId." });
    }
    if (!obj.action || typeof obj.action !== "string" || obj.action.length === 0) {
      issues.push({ code: "MISSING_ACTION", message: "repaired_plan requires action." });
    } else if (!getActionCapability(obj.action as never)) {
      issues.push({
        code: "INVALID_ACTION",
        message: `repaired_plan action '${obj.action}' is not a supported ExecutionPlan action.`
      });
    }
    if (typeof obj.confidence !== "number") {
      issues.push({ code: "MISSING_CONFIDENCE", message: "repaired_plan requires confidence (number)." });
    }
    if (typeof obj.sensitive !== "boolean") {
      issues.push({ code: "MISSING_SENSITIVE", message: "repaired_plan requires sensitive (boolean)." });
    }
    if (!obj.rationale || typeof obj.rationale !== "string" || obj.rationale.length === 0) {
      issues.push({ code: "MISSING_RATIONALE", message: "repaired_plan requires rationale." });
    }

    if (pack && obj.selectedCandidateId && typeof obj.selectedCandidateId === "string") {
      const candidate = pack.topVisibleCandidates.find((c) => c.id === obj.selectedCandidateId);
      if (!candidate) {
        issues.push({ code: "CANDIDATE_NOT_IN_PACK", message: `selectedCandidateId '${obj.selectedCandidateId}' not found in route-recovery-pack.json.` });
      }
    }
  } else if (decision === "no_safe_action") {
    if (!obj.rationale || typeof obj.rationale !== "string" || obj.rationale.length === 0) {
      issues.push({ code: "MISSING_RATIONALE", message: "no_safe_action requires rationale." });
    }
  } else if (decision === "needs_more_context") {
    if (!Array.isArray(obj.unresolvedQuestions) || obj.unresolvedQuestions.length === 0) {
      issues.push({ code: "MISSING_UNRESOLVED_QUESTIONS", message: "needs_more_context requires unresolvedQuestions array." });
    }
    if (!obj.rationale || typeof obj.rationale !== "string" || obj.rationale.length === 0) {
      issues.push({ code: "MISSING_RATIONALE", message: "needs_more_context requires rationale." });
    }
  }

  const valid = issues.length === 0;
  let typedDecision: RouteRecoveryDecision | undefined;
  if (valid) {
    typedDecision = raw as RouteRecoveryDecision;
  }

  return { valid, decision: typedDecision, issues };
}
