"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateRepairDecision = validateRepairDecision;
const repair_decision_schema_1 = require("./repair-decision.schema");
const SELECTOR_HINTS = /(locator|selector|xpath|css|testid|getby|queryselector)/i;
const SENSITIVE_HINTS = /(otp|pin|token|password|contrasena|api[_ -]?key|secret)/i;
const PAYMENT_HINTS = /(payment|pago|card number|tarjeta|cvv)/i;
const TRANSFER_HINTS = /(transfer|transferencia|wire)/i;
const INVENTED_TEXT_HINTS = /(i think|probably|maybe|seems like|appears to|likely|should be|would be)/i;
const SUBMIT_LIKE_HINTS = /(continuar|confirmar|enviar|submit|next|continue|confirm|send)/i;
const CONFIDENCE_STRING_MAP = {
    high: 0.85,
    medium: 0.65,
    low: 0.4,
};
const ASSERTION_STATUS_ALLOWED = [
    "satisfied_by_existing_evidence",
    "partially_satisfied",
    "needs_manual_review"
];
function asObject(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return undefined;
    return value;
}
function normalizeConfidenceValue(value) {
    if (value === undefined) {
        return { value: undefined, valid: true };
    }
    if (typeof value === "number") {
        return { value, valid: true };
    }
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized in CONFIDENCE_STRING_MAP) {
            return {
                value: CONFIDENCE_STRING_MAP[normalized],
                normalizedFrom: value,
                valid: true,
            };
        }
    }
    return { valid: false };
}
function validateRepairDecision(rawDecision, context) {
    const obj = asObject(rawDecision);
    if (!obj)
        return { valid: false, code: "AI_REPAIR_INVALID_JSON", message: "Repair decision must be a JSON object." };
    if ((0, repair_decision_schema_1.hasForbiddenRepairDecisionFields)(obj) || Object.keys(obj).some((k) => SELECTOR_HINTS.test(k))) {
        return { valid: false, code: "AI_REPAIR_SELECTOR_INVENTED", message: "Selector-like fields are not allowed." };
    }
    const decision = obj.decision;
    const reason = obj.reason;
    const repairType = obj.repairType;
    const candidateId = obj.candidateId;
    const questions = obj.questions;
    const normalizedConfidence = normalizeConfidenceValue(obj.confidence);
    if (typeof decision !== "string" || !repair_decision_schema_1.REPAIR_DECISION_ALLOWED_DECISIONS.includes(decision)) {
        return { valid: false, code: "AI_REPAIR_SCHEMA_INVALID", message: "Invalid or missing decision." };
    }
    if (typeof reason !== "string" || reason.trim().length === 0) {
        return { valid: false, code: "AI_REPAIR_SCHEMA_INVALID", message: "Missing required reason." };
    }
    if (repairType !== undefined && (typeof repairType !== "string" || !repair_decision_schema_1.REPAIR_DECISION_ALLOWED_TYPES.includes(repairType))) {
        return { valid: false, code: "AI_REPAIR_SCHEMA_INVALID", message: "Invalid repairType." };
    }
    if (questions !== undefined && (!Array.isArray(questions) || !questions.every((q) => typeof q === "string"))) {
        return { valid: false, code: "AI_REPAIR_SCHEMA_INVALID", message: "questions must be string[] when present." };
    }
    if (!normalizedConfidence.valid) {
        return { valid: false, code: "AI_REPAIR_SCHEMA_INVALID", message: "confidence must be numeric when present." };
    }
    // Verificar solo las KEYS del objeto, no el contenido de los valores (reason puede mencionar "selectors" explicando)
    const allKeys = Object.keys(obj);
    if ((0, repair_decision_schema_1.hasForbiddenRepairDecisionFields)(obj) || allKeys.some((k) => SELECTOR_HINTS.test(k))) {
        return { valid: false, code: "AI_REPAIR_SELECTOR_INVENTED", message: "Selector-like fields are not allowed." };
    }
    // Verificar patrones de texto inventado en reason (excluyendo missing_intermediate_step que usa insertedStepText)
    if (repairType !== "missing_intermediate_step" && reason && INVENTED_TEXT_HINTS.test(reason)) {
        return { valid: false, code: "AI_REPAIR_ASSERTION_TEXT_INVENTED", message: "Reason contains invented/uncertain text patterns." };
    }
    // Assertion resolution validation (ANTES de bloques genéricos para tener control fino sobre sensitive evidence)
    if (repairType === "assertion_resolution") {
        const evidenceId = obj.evidenceId;
        const assertionStatus = obj.assertionStatus;
        if (decision === "repaired_plan") {
            // evidenceId es requerido para repaired_plan
            if (!evidenceId || evidenceId.trim().length === 0) {
                return { valid: false, code: "AI_REPAIR_MISSING_EVIDENCE", message: "evidenceId is required for assertion_resolution repaired_plan." };
            }
            // assertionStatus es requerido y debe ser válido
            if (!assertionStatus || !ASSERTION_STATUS_ALLOWED.includes(assertionStatus)) {
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
        }
        else if (decision === "no_safe_action") {
            // no_safe_action no requiere evidenceId
        }
        // Para assertion_resolution, NO aplicar bloques genéricos SENSITIVE_HINTS en reason
        // porque el control de sensitive ya se hizo arriba sobre evidence.sensitive
    }
    else if (repairType === "selection_resolution") {
        // selectionCandidates defaults to candidates si no se proporciona
        const selectionCandidates = context.selectionCandidates ?? context.candidates;
        if (decision === "repaired_plan") {
            // candidateId es requerido para repaired_plan
            const candidateIdStr = candidateId;
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
        }
        else if (decision === "no_safe_action") {
            // no_safe_action no requiere candidateId
        }
        // Para selection_resolution, NO aplicar bloques genéricos PAYMENT_HINTS/TRANSFER_HINTS en reason
        // porque el control de sensitive ya se hizo arriba sobre candidate.sensitive
    }
    else if (repairType === "missing_intermediate_step") {
        // missing_intermediate_step: insertar paso intermedio de navegación
        const insertedStepText = obj.insertedStepText;
        if (decision === "repaired_plan") {
            // candidateId es requerido para repaired_plan
            const candidateIdStr = candidateId;
            if (!candidateIdStr || candidateIdStr.trim().length === 0) {
                return { valid: false, code: "AI_REPAIR_MISSING_CANDIDATE", message: "candidateId is required for missing_intermediate_step repaired_plan." };
            }
            // insertedStepText es requerido para repaired_plan
            if (!insertedStepText || insertedStepText.trim().length === 0) {
                return { valid: false, code: "AI_REPAIR_MISSING_INSERTED_STEP", message: "insertedStepText is required for missing_intermediate_step repaired_plan." };
            }
            // candidateId debe existir en candidates
            const candidate = context.candidates.find((c) => c.candidateId === candidateIdStr);
            if (!candidate) {
                return { valid: false, code: "AI_REPAIR_UNKNOWN_CANDIDATE", message: `candidateId "${candidateIdStr}" not found in candidates.` };
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
            // candidateId no debe ser un botón submit-like (Continuar, Confirmar, Enviar)
            // Los pasos intermedios deben ser navegación, no acciones de envío
            const candidateText = (candidate.name || candidate.text || "").toLowerCase();
            if (SUBMIT_LIKE_HINTS.test(candidateText)) {
                return { valid: false, code: "AI_REPAIR_SUBMIT_LIKE_CANDIDATE_BLOCKED", message: `Submit-like candidate "${candidateIdStr}" is not valid as intermediate navigation step.` };
            }
        }
        else if (decision === "no_safe_action") {
            // no_safe_action no requiere candidateId ni insertedStepText
        }
        // Para missing_intermediate_step, NO aplicar bloques genéricos de payment/transfer
        // porque el control de sensitive ya se hizo arriba sobre candidate.sensitive
        // "Tarjetas" es una categoría de navegación válida, no es sensible por sí misma
    }
    else {
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
    if (decision === "repaired_plan" && candidateId !== undefined) {
        const candidateIdStr = candidateId;
        const candidate = context.candidates.find((c) => c.candidateId === candidateIdStr);
        if (!candidate) {
            return { valid: false, code: "AI_REPAIR_UNKNOWN_CANDIDATE", message: `candidateId "${candidateIdStr}" not found in candidates.` };
        }
        if (context.mustUseVisibleCandidate !== false) {
            if (!candidate.visible) {
                return { valid: false, code: "AI_REPAIR_CANDIDATE_NOT_VISIBLE", message: `Candidate "${candidateIdStr}" is not visible.` };
            }
            if (candidate.enabled === false) {
                return { valid: false, code: "AI_REPAIR_CANDIDATE_NOT_ENABLED", message: `Candidate "${candidateIdStr}" is not enabled.` };
            }
            if (candidate.clickable === false && candidate.editable !== true) {
                return { valid: false, code: "AI_REPAIR_CANDIDATE_NOT_ACTIONABLE", message: `Candidate "${candidateIdStr}" is not actionable.` };
            }
        }
    }
    // Validación de candidateId cuando está presente (independiente de repairType)
    if (candidateId !== undefined) {
        if (context.mustReturnExistingCandidateId !== false) {
            const candidateIdStr = candidateId;
            const candidate = context.candidates.find((c) => c.candidateId === candidateIdStr);
            if (!candidate) {
                return { valid: false, code: "AI_REPAIR_UNKNOWN_CANDIDATE", message: `candidateId "${candidateIdStr}" not found in candidates.` };
            }
            if (context.blockSensitiveActions !== false && candidate.sensitive) {
                return { valid: false, code: "AI_REPAIR_SENSITIVE_ACTION_BLOCKED", message: `Sensitive candidate "${candidateIdStr}" is blocked.` };
            }
        }
        // Route recovery loop prevention (solo si repairType es route_recovery)
        if (repairType === "route_recovery" && context.failedRoutePaths?.includes(candidateId)) {
            return { valid: false, code: "AI_REPAIR_ROUTE_CANDIDATE_ALREADY_FAILED", message: `Candidate "${candidateId}" already failed for route recovery.` };
        }
    }
    // Validación general: repaired_plan debe tener al menos un campo de acción
    if (decision === "repaired_plan" && !candidateId && !obj.evidenceId) {
        return { valid: false, code: "AI_REPAIR_MISSING_CANDIDATE", message: "repaired_plan must include candidateId or evidenceId." };
    }
    const normalized = {
        decision: decision,
        reason,
        repairType: repairType,
        candidateId: candidateId,
        evidenceId: obj.evidenceId,
        assertionStatus: obj.assertionStatus,
        selectionStatus: obj.selectionStatus,
        insertedStepText: obj.insertedStepText,
        confidence: normalizedConfidence.value,
        confidenceNormalizedFrom: normalizedConfidence.normalizedFrom,
        questions: questions
    };
    return { valid: true, decision: normalized };
}
