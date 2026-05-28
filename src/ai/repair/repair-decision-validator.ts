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
  selectionCandidates?: RepairCandidateForValidation[]; // For selection_resolution (defaults to candidates if not provided)
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

  // Verificar solo las KEYS del objeto, no el contenido de los valores (reason puede mencionar "selectors" explicando)
  const allKeys = Object.keys(obj);
  if (hasForbiddenRepairDecisionFields(obj) || allKeys.some((k) => SELECTOR_HINTS.test(k))) {
    return { valid: false, code: "AI_REPAIR_SELECTOR_INVENTED", message: "Selector-like fields are not allowed." };
  }

  // Verificar patrones de texto inventado en reason
  if (reason && INVENTED_TEXT_HINTS.test(reason)) {
    return { valid: false, code: "AI_REPAIR_ASSERTION_TEXT_INVENTED", message: "Reason contains invented/uncertain text patterns." };
  }

  // Assertion resolution validation (ANTES de bloques genéricos para tener control fino sobre sensitive evidence)
  if (repairType === "assertion_resolution") {
    const evidenceId = obj.evidenceId as string | undefined;
    const assertionStatus = obj.assertionStatus as string | undefined;

    if (decision === "repaired_plan") {
      // evidenceId es requerido para repaired_plan
      if (!evidenceId || (evidenceId as string).trim().length === 0) {
        return { valid: false, code: "AI_REPAIR_MISSING_EVIDENCE", message: "evidenceId is required for assertion_resolution repaired_plan." };
      }
      // assertionStatus es requerido y debe ser válido
      if (!assertionStatus || !ASSERTION_STATUS_ALLOWED.includes(assertionStatus as any)) {
        return { valid: false, code: "AI_REPAIR_SCHEMA_INVALID", message: `assertionStatus must be one of: ${ASSERTION_STATUS_ALLOWED.join(", ")}` };
      }
      // evidenceId debe existir en evidenceCandidates
      if (context.evidenceCandidates && context.evidenceCandidates.length > 0) {
        const evidence = context.evidenceCandidates.find((e) => e.evidenceId === evidenceId);
        if (!evidence) {
          return { valid: false, code: "AI_REPAIR_UNKNOWN_EVIDENCE", message: `evidenceId "${evidenceId}" not found in evidenceCandidates.` };
        }
        // evidenceId no debe ser sensible
        if (context.blockAuthSecrets !== false && evidence.sensitive) {
          return { valid: false, code: "AI_REPAIR_SENSITIVE_ASSERTION_BLOCKED", message: `Sensitive evidence "${evidenceId}" is blocked.` };
        }
      }
    } else if (decision === "no_safe_action") {
      // no_safe_action no requiere evidenceId
    }
    // Para assertion_resolution, NO aplicar bloques genéricos SENSITIVE_HINTS en reason
    // porque el control de sensitive ya se hizo arriba sobre evidence.sensitive
  } else if (repairType === "selection_resolution") {
    // selectionCandidates defaults to candidates si no se proporciona
    const selectionCandidates = context.selectionCandidates ?? context.candidates;

    if (decision === "repaired_plan") {
      // candidateId es requerido para repaired_plan
      const candidateIdStr = candidateId as string | undefined;
      if (!candidateIdStr || candidateIdStr.trim().length === 0) {
        return { valid: false, code: "AI_REPAIR_MISSING_CANDIDATE", message: "candidateId is required for selection_resolution repaired_plan." };
      }
      // candidateId debe existir en selectionCandidates
      const candidate = selectionCandidates.find((c) => c.candidateId === candidateIdStr);
      if (!candidate) {
        return { valid: false, code: "AI_REPAIR_UNKNOWN_CANDIDATE", message: `candidateId "${candidateIdStr}" not found in selectionCandidates.` };
      }
      // candidate debe ser visible/enabled/clickable si mustUseVisibleCandidate está activo
      if (context.mustUseVisibleCandidate !== false) {
        if (!candidate.visible) {
          return { valid: false, code: "AI_REPAIR_CANDIDATE_NOT_VISIBLE", message: `Candidate "${candidateIdStr}" is not visible.` };
        }
        if (!candidate.enabled) {
          return { valid: false, code: "AI_REPAIR_CANDIDATE_NOT_ENABLED", message: `Candidate "${candidateIdStr}" is not enabled.` };
        }
        if (!candidate.clickable) {
          return { valid: false, code: "AI_REPAIR_CANDIDATE_NOT_CLICKABLE", message: `Candidate "${candidateIdStr}" is not clickable.` };
        }
      }
      // candidateId no debe ser sensible
      if (context.blockSensitiveActions !== false && candidate.sensitive) {
        return { valid: false, code: "AI_REPAIR_SENSITIVE_ACTION_BLOCKED", message: `Sensitive candidate "${candidateIdStr}" is blocked.` };
      }
    } else if (decision === "no_safe_action") {
      // no_safe_action no requiere candidateId
    }
    // Para selection_resolution, NO aplicar bloques genéricos PAYMENT_HINTS/TRANSFER_HINTS en reason
    // porque el control de sensitive ya se hizo arriba sobre candidate.sensitive
  } else {
    // Para target_resolution / route_recovery / otros: aplicar bloques genéricos
    const fullText = JSON.stringify(obj);
    if (context.blockAuthSecrets !== false && SENSITIVE_HINTS.test(fullText)) {
      return { valid: false, code: "AI_REPAIR_SENSITIVE_ACTION_BLOCKED", message: "Auth/secrets related action blocked." };
    }
    if (context.blockPayments !== false && PAYMENT_HINTS.test(fullText)) {
      return { valid: false, code: "AI_REPAIR_SENSITIVE_ACTION_BLOCKED", message: "Payment related action blocked." };
    }
    if (context.blockTransfers !== false && TRANSFER_HINTS.test(fullText)) {
      return { valid: false, code: "AI_REPAIR_SENSITIVE_ACTION_BLOCKED", message: "Transfer related action blocked." };
    }
  }

  // Validación de candidateId cuando está presente (independiente de repairType)
  if (candidateId !== undefined) {
    if (context.mustReturnExistingCandidateId !== false) {
      const candidateIdStr = candidateId as string;
      const candidate = context.candidates.find((c) => c.candidateId === candidateIdStr);
      if (!candidate) {
        return { valid: false, code: "AI_REPAIR_UNKNOWN_CANDIDATE", message: `candidateId "${candidateIdStr}" not found in candidates.` };
      }
      if (context.blockSensitiveActions !== false && candidate.sensitive) {
        return { valid: false, code: "AI_REPAIR_SENSITIVE_ACTION_BLOCKED", message: `Sensitive candidate "${candidateIdStr}" is blocked.` };
      }
    }
    // Route recovery loop prevention (solo si repairType es route_recovery)
    if (repairType === "route_recovery" && context.failedRoutePaths?.includes(candidateId as string)) {
      return { valid: false, code: "AI_REPAIR_ROUTE_CANDIDATE_ALREADY_FAILED", message: `Candidate "${candidateId}" already failed for route recovery.` };
    }
  }

  // Validación general: repaired_plan debe tener al menos un campo de acción
  if (decision === "repaired_plan" && !candidateId && !obj.evidenceId) {
    return { valid: false, code: "AI_REPAIR_SCHEMA_INVALID", message: "repaired_plan must include candidateId or evidenceId." };
  }

  const normalized: RepairDecision = {
    decision: decision as RepairDecision["decision"],
    reason,
    repairType: repairType as any,
    candidateId: candidateId as any,
    evidenceId: obj.evidenceId as any,
    assertionStatus: obj.assertionStatus as any,
    selectionStatus: obj.selectionStatus as any,
    confidence: confidence as any,
    questions: questions as any
  };
  return { valid: true, decision: normalized };
}
