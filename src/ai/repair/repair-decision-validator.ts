import type { RepairDecision } from "./repair-decision.schema";
import {
  REPAIR_DECISION_ALLOWED_DECISIONS,
  REPAIR_DECISION_ALLOWED_TYPES,
  hasForbiddenRepairDecisionFields
} from "./repair-decision.schema";

export type RepairCandidateForValidation = {
  candidateId: string;
  visible: boolean;
  enabled?: boolean;
  clickable?: boolean;
  editable?: boolean;
  sensitive?: boolean;
  role?: string;
  name?: string;
  text?: string;
};

export type RepairValidationContext = {
  candidates: RepairCandidateForValidation[];
  blockSensitiveActions?: boolean;
  blockAuthSecrets?: boolean;
  blockPayments?: boolean;
  blockTransfers?: boolean;
  mustUseVisibleCandidate?: boolean;
  mustReturnExistingCandidateId?: boolean;
};

export type RepairDecisionValidationResult =
  | { valid: true; decision: RepairDecision }
  | { valid: false; code: string; message: string };

const SELECTOR_HINTS = /(locator|selector|xpath|css|testid|getby|queryselector)/i;
const SENSITIVE_HINTS = /(otp|pin|token|password|contrasena|api[_ -]?key|secret)/i;
const PAYMENT_HINTS = /(payment|pago|card number|tarjeta|cvv)/i;
const TRANSFER_HINTS = /(transfer|transferencia|wire)/i;

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
