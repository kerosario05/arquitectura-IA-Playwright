import type { RepairDecision } from "./repair-decision.schema";
import {
  REPAIR_DECISION_ALLOWED_DECISIONS,
  REPAIR_DECISION_ALLOWED_TYPES,
  hasForbiddenRepairDecisionFields
} from "./repair-decision.schema";

export type RepairCandidateForValidation = {
  candidateId: string;
  role?: string;
  name?: string;
  text?: string;
  visible: boolean;
  enabled?: boolean;
  clickable?: boolean;
  editable?: boolean;
  sensitive?: boolean;
};

export type RepairEvidenceForValidation = {
  evidenceId: string;
  type: "feedback_message" | "structural" | "modal_state" | "text_visible" | "form_field" | "url_state";
  text?: string;
  visible: boolean;
  source: "runtimeEvidenceTrace" | "structuralEvidence" | "feedbackEvidence";
  confidence?: number;
  sensitive?: boolean;
};

export type RepairValidationContext = {
  candidates: RepairCandidateForValidation[];
  evidenceCandidates?: RepairEvidenceForValidation[]; // For assertion_resolution
  blockSensitiveActions?: boolean;
  blockAuthSecrets?: boolean;
  blockPayments?: boolean;
  blockTransfers?: boolean;
  mustUseVisibleCandidate?: boolean;
  mustReturnExistingCandidateId?: boolean;
  failedRoutePaths?: string[]; // For route_recovery loop prevention
};

export type RepairDecisionValidationResult =
  | { valid: true; decision: RepairDecision }
  | { valid: false; code: string; message: string };

const SELECTOR_HINTS = /(locator|selector|xpath|css|testid|getby|queryselector)/i;
const SENSITIVE_HINTS = /(otp|pin|token|password|contrasena|api[_ -]?key|secret)/i;
const PAYMENT_HINTS = /(payment|pago|card number|tarjeta|cvv)/i;
const TRANSFER_HINTS = /(transfer|transferencia|wire)/i;
const INVENTED_TEXT_HINTS = /(i think|probably|maybe|seems like|appears to|likely|should be|would be)/i;

const ASSERTION_STATUS_ALLOWED = [
  "satisfied_by_existing_evidence",
  "partially_satisfied",
  "needs_manual_review"
] as const;

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export function validateRepairDecision(
  rawDecision: unknown,
  context: RepairValidationContext
): RepairDecisionValidationResult {
  const obj = asObject(rawDecision);
  if (!obj) return { valid: false, code: "AI_REPAIR_INVALID_JSON", message: "Repair decision must be a JSON object." };

  if (hasForbiddenRepairDecisionFields(obj) || Object.keys(obj).some((k) => SELECTOR_HINTS.test(k))) {
    return { valid: false, code: "AI_REPAIR_SELECTOR_INVENTED", message: "Selector-like fields are not allowed." };
  }

  const decision = obj.decision;
  const reason = obj.reason;
  const repairType = obj.repairType;
  const candidateId = obj.candidateId;
  const questions = obj.questions;
  const confidence = obj.confidence;

  if (typeof decision !== "string" || !REPAIR_DECISION_ALLOWED_DECISIONS.includes(decision as any)) {
    return { valid: false, code: "AI_REPAIR_SCHEMA_INVALID", message: "Invalid or missing decision." };
  }
  if (typeof reason !== "string" || reason.trim().length === 0) {
    return { valid: false, code: "AI_REPAIR_SCHEMA_INVALID", message: "Missing required reason." };
  }
  if (repairType !== undefined && (typeof repairType !== "string" || !REPAIR_DECISION_ALLOWED_TYPES.includes(repairType as any))) {
    return { valid: false, code: "AI_REPAIR_SCHEMA_INVALID", message: "Invalid repairType." };
  }
  if (questions !== undefined && (!Array.isArray(questions) || !questions.every((q) => typeof q === "string"))) {
    return { valid: false, code: "AI_REPAIR_SCHEMA_INVALID", message: "questions must be string[] when present." };
  }
  if (confidence !== undefined && typeof confidence !== "number") {
    return { valid: false, code: "AI_REPAIR_SCHEMA_INVALID", message: "confidence must be numeric when present." };
  }

  const fullText = JSON.stringify(obj);
  if (SELECTOR_HINTS.test(fullText)) {
    return { valid: false, code: "AI_REPAIR_SELECTOR_INVENTED", message: "Selector-like content is not allowed." };
  }

  // Assertion resolution validation (before general candidateId validation)
  if (repairType === "assertion_resolution") {
    const evidenceId = obj.evidenceId as string | undefined;
    const assertionStatus = obj.assertionStatus as string | undefined;

    if (decision === "repaired_plan") {
      // For assertion_resolution, evidenceId is required instead of candidateId
      if (!evidenceId || evidenceId.trim().length === 0) {
        return { valid: false, code: "AI_REPAIR_MISSING_EVIDENCE", message: "evidenceId is required for assertion_resolution repaired_plan." };
      }
      // Validate assertionStatus
      if (!assertionStatus || !ASSERTION_STATUS_ALLOWED.includes(assertionStatus as any)) {
        return { valid: false, code: "AI_REPAIR_SCHEMA_INVALID", message: `assertionStatus must be one of: ${ASSERTION_STATUS_ALLOWED.join(", ")}` };
      }
    }

    // Validate evidenceId exists in evidenceCandidates
    if (evidenceId && context.evidenceCandidates?.length) {
      const evidence = context.evidenceCandidates.find((e) => e.evidenceId === evidenceId);
      if (!evidence) {
        return { valid: false, code: "AI_REPAIR_UNKNOWN_EVIDENCE", message: `Unknown evidenceId "${evidenceId}".` };
      }
      // Evidence must be visible for assertion satisfaction
      if (!evidence.visible) {
        return { valid: false, code: "AI_REPAIR_EVIDENCE_NOT_VISIBLE", message: `Evidence "${evidenceId}" is not visible.` };
      }
      // Block sensitive evidence
      if (evidence.sensitive) {
        return { valid: false, code: "AI_REPAIR_SENSITIVE_ASSERTION_BLOCKED", message: `Sensitive evidence "${evidenceId}" cannot be used for assertion.` };
      }
    }

    // Check for invented text patterns in reason
    if (obj.reason && INVENTED_TEXT_HINTS.test(String(obj.reason))) {
      return { valid: false, code: "AI_REPAIR_ASSERTION_TEXT_INVENTED", message: "Reason contains uncertain/invented language." };
    }
    
    // For assertion_resolution, skip candidateId validation
    return { valid: true, decision: obj as RepairDecision };
  }

  // Selection resolution validation (before general candidateId validation)
  if (repairType === "selection_resolution") {
    const selectionStatus = obj.selectionStatus as string | undefined;

    if (decision === "repaired_plan") {
      // For selection_resolution, candidateId is required
      if (typeof candidateId !== "string" || candidateId.trim().length === 0) {
        return { valid: false, code: "AI_REPAIR_MISSING_CANDIDATE", message: "candidateId is required for selection_resolution repaired_plan." };
      }
      // Validate selectionStatus if present
      if (selectionStatus && !["selected", "partially_matched", "needs_confirmation"].includes(selectionStatus)) {
        return { valid: false, code: "AI_REPAIR_SCHEMA_INVALID", message: "selectionStatus must be one of: selected, partially_matched, needs_confirmation" };
      }
    }

    // Validate candidateId exists and is valid for selection
    if (typeof candidateId === "string" && candidateId.trim().length > 0) {
      const candidate = context.candidates.find((c) => c.candidateId === candidateId);
      if (!candidate) {
        return { valid: false, code: "AI_REPAIR_UNKNOWN_CANDIDATE", message: `Unknown candidateId "${candidateId}".` };
      }
      // Candidate must be visible for selection
      if (decision === "repaired_plan" && !candidate.visible) {
        return { valid: false, code: "AI_REPAIR_CANDIDATE_NOT_VISIBLE", message: `Candidate "${candidateId}" is not visible.` };
      }
      // Candidate must be actionable (clickable/selectable)
      if (decision === "repaired_plan") {
        const actionable = candidate.clickable || candidate.enabled;
        if (!actionable) {
          return { valid: false, code: "AI_REPAIR_CANDIDATE_NOT_ACTIONABLE", message: `Candidate "${candidateId}" is not selectable.` };
        }
      }
      // Block sensitive candidates for selection
      if (decision === "repaired_plan" && context.blockSensitiveActions !== false && candidate.sensitive) {
        return { valid: false, code: "AI_REPAIR_SENSITIVE_ACTION_BLOCKED", message: `Sensitive candidate "${candidateId}" cannot be selected.` };
      }
    }

    // Check for invented text patterns in reason
    if (obj.reason && INVENTED_TEXT_HINTS.test(String(obj.reason))) {
      return { valid: false, code: "AI_REPAIR_ASSERTION_TEXT_INVENTED", message: "Reason contains uncertain/invented language." };
    }
    
    // For selection_resolution, return early after validation
    return { valid: true, decision: obj as RepairDecision };
  }

  if (decision === "repaired_plan") {
    if (typeof candidateId !== "string" || candidateId.trim().length === 0) {
      return { valid: false, code: "AI_REPAIR_MISSING_CANDIDATE", message: "candidateId is required for repaired_plan." };
    }
  }

  if (typeof candidateId === "string" && candidateId.trim().length > 0) {
    const candidate = context.candidates.find((c) => c.candidateId === candidateId);
    if (!candidate) {
      return { valid: false, code: "AI_REPAIR_UNKNOWN_CANDIDATE", message: `Unknown candidateId "${candidateId}".` };
    }
    if (decision === "repaired_plan" && context.mustUseVisibleCandidate !== false && !candidate.visible) {
      return { valid: false, code: "AI_REPAIR_CANDIDATE_NOT_VISIBLE", message: `Candidate "${candidateId}" is not visible.` };
    }
    const actionable = candidate.clickable || candidate.editable || candidate.enabled;
    if (decision === "repaired_plan" && !actionable) {
      return { valid: false, code: "AI_REPAIR_CANDIDATE_NOT_ACTIONABLE", message: `Candidate "${candidateId}" is not actionable.` };
    }
    if (decision === "repaired_plan" && context.blockSensitiveActions !== false && candidate.sensitive) {
      return { valid: false, code: "AI_REPAIR_SENSITIVE_ACTION_BLOCKED", message: `Sensitive candidate "${candidateId}" is blocked.` };
    }
    // Route recovery loop prevention: don't reuse failed route candidates
    if (repairType === "route_recovery" && context.failedRoutePaths?.includes(candidateId)) {
      return { valid: false, code: "AI_REPAIR_ROUTE_CANDIDATE_ALREADY_FAILED", message: `Candidate "${candidateId}" already failed for route recovery.` };
    }
  }

  if (context.blockAuthSecrets !== false && SENSITIVE_HINTS.test(fullText)) {
    return { valid: false, code: "AI_REPAIR_SENSITIVE_ACTION_BLOCKED", message: "Auth/secrets related action blocked." };
  }
  if (context.blockPayments !== false && PAYMENT_HINTS.test(fullText)) {
    return { valid: false, code: "AI_REPAIR_SENSITIVE_ACTION_BLOCKED", message: "Payment related action blocked." };
  }
  if (context.blockTransfers !== false && TRANSFER_HINTS.test(fullText)) {
    return { valid: false, code: "AI_REPAIR_SENSITIVE_ACTION_BLOCKED", message: "Transfer related action blocked." };
  }

  const normalized: RepairDecision = {
    decision: decision as RepairDecision["decision"],
    reason,
    repairType: repairType as any,
    candidateId: candidateId as any,
    confidence: confidence as any,
    questions: questions as any
  };
  return { valid: true, decision: normalized };
}
