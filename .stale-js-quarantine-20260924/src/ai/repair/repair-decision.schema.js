"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REPAIR_DECISION_FORBIDDEN_KEYS_PATTERN = exports.REPAIR_DECISION_ALLOWED_KEYS = exports.REPAIR_DECISION_ALLOWED_TYPES = exports.REPAIR_DECISION_ALLOWED_DECISIONS = void 0;
exports.hasForbiddenRepairDecisionFields = hasForbiddenRepairDecisionFields;
exports.REPAIR_DECISION_ALLOWED_DECISIONS = [
    "repaired_plan",
    "no_safe_action",
    "needs_more_context"
];
exports.REPAIR_DECISION_ALLOWED_TYPES = [
    "target_resolution",
    "route_recovery",
    "assertion_resolution",
    "pom_method_missing",
    "selection_resolution",
    "missing_intermediate_step"
];
exports.REPAIR_DECISION_ALLOWED_KEYS = [
    "decision",
    "repairType",
    "candidateId",
    "evidenceId",
    "assertionStatus",
    "selectionStatus",
    "reason",
    "confidence",
    "questions",
    "insertedStepText"
];
exports.REPAIR_DECISION_FORBIDDEN_KEYS_PATTERN = /(css|xpath|locator|selector|testid|getby|queryselector|inventedText|fakeEvidence)/i;
function hasForbiddenRepairDecisionFields(obj) {
    for (const key of Object.keys(obj)) {
        if (exports.REPAIR_DECISION_FORBIDDEN_KEYS_PATTERN.test(key))
            return true;
        if (!exports.REPAIR_DECISION_ALLOWED_KEYS.includes(key))
            return true;
    }
    return false;
}
