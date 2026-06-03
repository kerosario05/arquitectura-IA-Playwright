"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const repair_decision_validator_1 = require("../src/ai/repair/repair-decision-validator");
const baseContext = {
    candidates: [
        { candidateId: "c1", visible: true, clickable: true, enabled: true, sensitive: false }
    ]
};
(0, test_1.test)("repaired_plan requiere candidateId", () => {
    const r = (0, repair_decision_validator_1.validateRepairDecision)({ decision: "repaired_plan", reason: "x" }, baseContext);
    (0, test_1.expect)(r.valid).toBe(false);
    if (!r.valid)
        (0, test_1.expect)(r.code).toBe("AI_REPAIR_MISSING_CANDIDATE");
});
(0, test_1.test)("candidateId debe existir", () => {
    const r = (0, repair_decision_validator_1.validateRepairDecision)({ decision: "repaired_plan", reason: "x", candidateId: "missing" }, baseContext);
    (0, test_1.expect)(r.valid).toBe(false);
    if (!r.valid)
        (0, test_1.expect)(r.code).toBe("AI_REPAIR_UNKNOWN_CANDIDATE");
});
(0, test_1.test)("bloquea candidate invisible", () => {
    const r = (0, repair_decision_validator_1.validateRepairDecision)({ decision: "repaired_plan", reason: "x", candidateId: "c1" }, { candidates: [{ candidateId: "c1", visible: false, clickable: true }] });
    (0, test_1.expect)(r.valid).toBe(false);
    if (!r.valid)
        (0, test_1.expect)(r.code).toBe("AI_REPAIR_CANDIDATE_NOT_VISIBLE");
});
(0, test_1.test)("bloquea candidate no actionable", () => {
    const r = (0, repair_decision_validator_1.validateRepairDecision)({ decision: "repaired_plan", reason: "x", candidateId: "c1" }, { candidates: [{ candidateId: "c1", visible: true, clickable: false, editable: false, enabled: true }] });
    (0, test_1.expect)(r.valid).toBe(false);
    if (!r.valid)
        (0, test_1.expect)(r.code).toBe("AI_REPAIR_CANDIDATE_NOT_ACTIONABLE");
});
(0, test_1.test)("bloquea sensitive candidate", () => {
    const r = (0, repair_decision_validator_1.validateRepairDecision)({ decision: "repaired_plan", reason: "x", candidateId: "c1" }, { candidates: [{ candidateId: "c1", visible: true, clickable: true, sensitive: true }] });
    (0, test_1.expect)(r.valid).toBe(false);
    if (!r.valid)
        (0, test_1.expect)(r.code).toBe("AI_REPAIR_SENSITIVE_ACTION_BLOCKED");
});
(0, test_1.test)("bloquea selector inventado", () => {
    const r = (0, repair_decision_validator_1.validateRepairDecision)({ decision: "no_safe_action", reason: "x", css: "#id" }, baseContext);
    (0, test_1.expect)(r.valid).toBe(false);
    if (!r.valid)
        (0, test_1.expect)(r.code).toBe("AI_REPAIR_SELECTOR_INVENTED");
});
(0, test_1.test)("acepta no_safe_action con reason", () => {
    const r = (0, repair_decision_validator_1.validateRepairDecision)({ decision: "no_safe_action", reason: "x" }, baseContext);
    (0, test_1.expect)(r.valid).toBe(true);
});
(0, test_1.test)("acepta needs_more_context con reason", () => {
    const r = (0, repair_decision_validator_1.validateRepairDecision)({ decision: "needs_more_context", reason: "x" }, baseContext);
    (0, test_1.expect)(r.valid).toBe(true);
});
(0, test_1.test)("normaliza confidence high a numerico conocido", () => {
    const r = (0, repair_decision_validator_1.validateRepairDecision)({ decision: "repaired_plan", reason: "x", candidateId: "c1", confidence: "high" }, baseContext);
    (0, test_1.expect)(r.valid).toBe(true);
    if (r.valid) {
        (0, test_1.expect)(r.decision.confidence).toBe(0.85);
        (0, test_1.expect)(r.decision.confidenceNormalizedFrom).toBe("high");
    }
});
(0, test_1.test)("rechaza confidence string desconocido", () => {
    const r = (0, repair_decision_validator_1.validateRepairDecision)({ decision: "repaired_plan", reason: "x", candidateId: "c1", confidence: "very-high" }, baseContext);
    (0, test_1.expect)(r.valid).toBe(false);
    if (!r.valid)
        (0, test_1.expect)(r.code).toBe("AI_REPAIR_SCHEMA_INVALID");
});
