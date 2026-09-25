"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeAgentHandoffResponse = normalizeAgentHandoffResponse;
exports.repairAgentHandoffResponse = repairAgentHandoffResponse;
exports.validateAgentHandoffResponse = validateAgentHandoffResponse;
exports.assertValidAgentHandoffResponse = assertValidAgentHandoffResponse;
exports.validateRouteRecoveryPlan = validateRouteRecoveryPlan;
const plans_1 = require("../plans");
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasText(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function isRecoveryDecision(value) {
    return (typeof value === "string" &&
        ["repaired_plan", "no_safe_action", "needs_more_context"].includes(value));
}
function looksSensitiveLiteral(value) {
    const normalized = value.toLowerCase();
    return (normalized.includes("bearer") ||
        normalized.includes("token") ||
        normalized.includes("secret") ||
        normalized.includes("password") ||
        normalized.replace(/\D/g, "").length >= 12);
}
function looksLikeExecutionPlan(value) {
    if (!isObject(value)) {
        return false;
    }
    return (value.version === "1.0" &&
        hasText(value.source) &&
        hasText(value.status) &&
        isObject(value.scenario) &&
        Array.isArray(value.requiredData) &&
        Array.isArray(value.steps));
}
function looksLikeExecutionPlanArray(value) {
    return Array.isArray(value) && value.length > 0 && value.every((item) => looksLikeExecutionPlan(item));
}
function normalizeWrappedPlanResponse(response) {
    const singletonPlans = [];
    if (looksLikeExecutionPlan(response.plan)) {
        singletonPlans.push(response.plan);
    }
    if (looksLikeExecutionPlan(response.plans)) {
        singletonPlans.push(response.plans);
    }
    if (singletonPlans.length === 0) {
        return undefined;
    }
    const existingPlans = Array.isArray(response.plans)
        ? response.plans.filter((item) => looksLikeExecutionPlan(item))
        : [];
    const plans = existingPlans.length > 0 ? existingPlans : singletonPlans;
    const generatedAt = hasText(response.generatedAt)
        ? String(response.generatedAt)
        : plans.find((plan) => hasText(plan.createdAt))?.createdAt ?? new Date().toISOString();
    const recoveryDecision = isRecoveryDecision(response.recoveryDecision)
        ? response.recoveryDecision
        : "repaired_plan";
    const rationale = Array.isArray(response.rationale) && response.rationale.every((item) => typeof item === "string")
        ? response.rationale
        : ["Normalized legacy single-plan response into AgentHandoffResponse."];
    return {
        version: response.version === "1.0" ? "1.0" : "1.0",
        generatedAt,
        recoveryDecision,
        plans,
        proposedObjects: Array.isArray(response.proposedObjects) ? response.proposedObjects : [],
        unresolvedQuestions: Array.isArray(response.unresolvedQuestions) ? response.unresolvedQuestions : [],
        rationale
    };
}
function normalizeLegacyPlansArrayResponse(response) {
    if (!Array.isArray(response.plans)) {
        return undefined;
    }
    const plans = response.plans.filter((item) => looksLikeExecutionPlan(item));
    if (plans.length === 0) {
        return undefined;
    }
    const generatedAt = hasText(response.generatedAt)
        ? String(response.generatedAt)
        : plans.find((plan) => hasText(plan.createdAt))?.createdAt ?? new Date().toISOString();
    const recoveryDecision = isRecoveryDecision(response.recoveryDecision)
        ? response.recoveryDecision
        : "repaired_plan";
    const rationale = Array.isArray(response.rationale) && response.rationale.every((item) => typeof item === "string")
        ? response.rationale
        : ["Normalized legacy plans[] response into AgentHandoffResponse."];
    return {
        version: response.version === "1.0" ? "1.0" : "1.0",
        generatedAt,
        recoveryDecision,
        plans,
        proposedObjects: Array.isArray(response.proposedObjects) ? response.proposedObjects : [],
        unresolvedQuestions: Array.isArray(response.unresolvedQuestions) ? response.unresolvedQuestions : [],
        rationale
    };
}
function normalizeAgentHandoffResponse(response) {
    if (looksLikeExecutionPlanArray(response)) {
        const generatedAt = response.find((plan) => typeof plan.createdAt === "string" && plan.createdAt.trim().length > 0)?.createdAt
            ?? new Date().toISOString();
        return {
            version: "1.0",
            generatedAt,
            recoveryDecision: "repaired_plan",
            plans: response,
            proposedObjects: [],
            unresolvedQuestions: [],
            rationale: ["Normalized legacy ExecutionPlan[] response into AgentHandoffResponse."]
        };
    }
    if (looksLikeExecutionPlan(response)) {
        return {
            version: "1.0",
            generatedAt: typeof response.createdAt === "string" && response.createdAt.trim().length > 0
                ? response.createdAt
                : new Date().toISOString(),
            recoveryDecision: "repaired_plan",
            plans: [response],
            proposedObjects: [],
            unresolvedQuestions: [],
            rationale: ["Normalized legacy bare ExecutionPlan response into AgentHandoffResponse."]
        };
    }
    if (isObject(response)) {
        const normalized = normalizeWrappedPlanResponse(response) ?? normalizeLegacyPlansArrayResponse(response);
        if (normalized) {
            return normalized;
        }
    }
    return response;
}
function repairAgentHandoffResponse(response) {
    return normalizeAgentHandoffResponse(response);
}
function validateAgentHandoffResponse(response, options) {
    const issues = [];
    if (looksLikeExecutionPlan(response)) {
        return {
            valid: false,
            issues: [
                {
                    level: "error",
                    code: "RESPONSE_BARE_EXECUTION_PLAN",
                    message: "Response must be an AgentHandoffResponse object. Wrap the ExecutionPlan inside the top-level plans array."
                }
            ]
        };
    }
    if (!isObject(response)) {
        return {
            valid: false,
            issues: [{ level: "error", code: "RESPONSE_OBJECT_REQUIRED", message: "Agent response must be an object." }]
        };
    }
    if (response.version !== "1.0") {
        issues.push({ level: "error", code: "RESPONSE_VERSION_INVALID", message: "Response version must be 1.0." });
    }
    if (!hasText(response.generatedAt)) {
        issues.push({ level: "error", code: "RESPONSE_GENERATED_AT_REQUIRED", message: "generatedAt is required." });
    }
    if (!Array.isArray(response.plans)) {
        issues.push({ level: "error", code: "RESPONSE_PLANS_ARRAY_REQUIRED", message: "plans must be an array." });
    }
    if (!Array.isArray(response.proposedObjects)) {
        issues.push({ level: "error", code: "RESPONSE_PROPOSED_OBJECTS_ARRAY_REQUIRED", message: "proposedObjects must be an array." });
    }
    if (!Array.isArray(response.unresolvedQuestions)) {
        issues.push({ level: "error", code: "RESPONSE_UNRESOLVED_ARRAY_REQUIRED", message: "unresolvedQuestions must be an array." });
    }
    if (!Array.isArray(response.rationale)) {
        issues.push({ level: "error", code: "RESPONSE_RATIONALE_ARRAY_REQUIRED", message: "rationale must be an array." });
    }
    const promptMode = options?.promptMode;
    const isCompactRecovery = promptMode === "compact-route-recovery";
    const hasValidRecoveryDecision = typeof response.recoveryDecision === "string" &&
        ["repaired_plan", "no_safe_action", "needs_more_context"].includes(response.recoveryDecision);
    if (!hasValidRecoveryDecision) {
        issues.push({
            level: "error",
            code: "RESPONSE_MISSING_RECOVERY_DECISION",
            message: "Agent response missing recoveryDecision. Must be one of: repaired_plan, no_safe_action, needs_more_context."
        });
    }
    // --- Placeholder detection (all modes) ---
    const rawJson = JSON.stringify(response);
    const placeholderPatterns = [
        "<candidateId",
        "<iso timestamp>",
        "<ISO_TIMESTAMP>",
        "<candidate-id",
        "<object-id",
        "<route-id",
        "<plan-id",
        "<your_reasoning>",
        "<rationale>"
    ];
    const foundPlaceholders = placeholderPatterns.filter((p) => rawJson.includes(p));
    // --- generatedAt stricter validation (all modes) ---
    if (typeof response.generatedAt === "string" && response.generatedAt.length === 0) {
        issues.push({
            level: "error",
            code: "GENERATED_AT_EMPTY",
            message: "generatedAt must not be empty."
        });
    }
    // --- Placeholder validation (all modes) ---
    for (const placeholder of foundPlaceholders) {
        issues.push({
            level: "error",
            code: "PLACEHOLDER_NOT_REPLACED",
            message: `Placeholder '${placeholder}' found in response. Replace with actual value before submitting.`
        });
    }
    // --- compact-route-recovery specific validation ---
    if (isCompactRecovery) {
        if (response.recoveryDecision === "repaired_plan" && Array.isArray(response.plans) && response.plans.length === 0) {
            issues.push({
                level: "error",
                code: "REPAIRED_PLAN_EMPTY",
                message: "repaired_plan requires at least one plan."
            });
        }
        if (response.recoveryDecision === "no_safe_action" && (!Array.isArray(response.rationale) || response.rationale.length === 0)) {
            issues.push({
                level: "error",
                code: "NO_SAFE_ACTION_NO_RATIONALE",
                message: "no_safe_action requires rationale."
            });
        }
        if (response.recoveryDecision === "needs_more_context" && (!Array.isArray(response.unresolvedQuestions) || response.unresolvedQuestions.length === 0)) {
            issues.push({
                level: "error",
                code: "NEEDS_MORE_NO_QUESTIONS",
                message: "needs_more_context requires unresolvedQuestions."
            });
        }
        // For compact-route-recovery, skip generic RESPONSE_PLANS_EMPTY and RESPONSE_NOT_ACTIONABLE
        // because they are replaced by the specific checks above.
    }
    else {
        // --- Non-compact mode: original empty plans / not actionable checks ---
        const hasDecisionForEmpty = typeof response.recoveryDecision === "string" && ["no_safe_action", "needs_more_context"].includes(response.recoveryDecision);
        const plansCount = Array.isArray(response.plans) ? response.plans.length : 0;
        const proposedObjectsCount = Array.isArray(response.proposedObjects) ? response.proposedObjects.length : 0;
        const unresolvedCount = Array.isArray(response.unresolvedQuestions) ? response.unresolvedQuestions.length : 0;
        const rationaleCount = Array.isArray(response.rationale) ? response.rationale.length : 0;
        if (plansCount === 0 && proposedObjectsCount === 0 && unresolvedCount === 0 && rationaleCount === 0 && !hasDecisionForEmpty) {
            issues.push({
                level: "error",
                code: "RESPONSE_NOT_ACTIONABLE",
                message: "agent-response.json was found but is not actionable. All sections are empty: plans=0, proposedObjects=0, unresolvedQuestions=0, rationale=0."
            });
        }
        if (Array.isArray(response.plans) && response.plans.length === 0 && !hasDecisionForEmpty) {
            issues.push({
                level: "error",
                code: "RESPONSE_PLANS_EMPTY",
                message: `plans array is empty. The agent did not produce any ExecutionPlan. (plans: ${plansCount}, proposedObjects: ${proposedObjectsCount}, unresolvedQuestions: ${unresolvedCount}, rationale: ${rationaleCount})`
            });
        }
    }
    if (Array.isArray(response.plans)) {
        for (let planIndex = 0; planIndex < response.plans.length; planIndex += 1) {
            const plan = response.plans[planIndex];
            const result = (0, plans_1.validateExecutionPlan)(plan);
            for (const issue of result.issues) {
                issues.push({
                    level: issue.level,
                    code: `PLAN_${issue.code}`,
                    message: issue.message,
                    planIndex,
                    stepIndex: issue.stepIndex
                });
            }
            if (isObject(plan) && Array.isArray(plan.steps)) {
                for (const stepRaw of plan.steps) {
                    if (!isObject(stepRaw)) {
                        continue;
                    }
                    const stepIndex = typeof stepRaw.index === "number" ? stepRaw.index : undefined;
                    if (hasText(stepRaw.value) && looksSensitiveLiteral(String(stepRaw.value))) {
                        issues.push({
                            level: "error",
                            code: "PLAN_SENSITIVE_LITERAL_VALUE",
                            message: "Step contains suspicious literal value. Use valueKey instead.",
                            planIndex,
                            stepIndex
                        });
                    }
                    if (hasText(stepRaw.valueKey) && options?.availableDataKeys) {
                        const allowed = new Set(options.availableDataKeys);
                        const valueKey = String(stepRaw.valueKey);
                        if (!allowed.has(valueKey)) {
                            issues.push({
                                level: "error",
                                code: "PLAN_VALUEKEY_NOT_AVAILABLE",
                                message: `valueKey '${valueKey}' is not available in handoff request dataContextSummary.`,
                                planIndex,
                                stepIndex
                            });
                        }
                    }
                }
            }
        }
    }
    if (Array.isArray(response.proposedObjects)) {
        for (const item of response.proposedObjects) {
            if (!isObject(item)) {
                issues.push({ level: "error", code: "PROPOSED_OBJECT_INVALID", message: "Each proposedObject must be an object." });
                continue;
            }
            if (!hasText(item.key) || !hasText(item.name) || typeof item.confidence !== "number") {
                issues.push({
                    level: "error",
                    code: "PROPOSED_OBJECT_REQUIRED_FIELDS",
                    message: "proposedObject requires key, name and confidence."
                });
            }
            if (typeof item.confidence === "number" && item.confidence < 0.7) {
                issues.push({
                    level: "warning",
                    code: "PROPOSED_OBJECT_LOW_CONFIDENCE",
                    message: `proposedObject '${String(item.key ?? "unknown")}' has low confidence.`
                });
            }
        }
    }
    return {
        valid: !issues.some((issue) => issue.level === "error"),
        issues
    };
}
function assertValidAgentHandoffResponse(response) {
    const result = validateAgentHandoffResponse(response);
    if (!result.valid) {
        const message = result.issues
            .filter((issue) => issue.level === "error")
            .map((issue) => `${issue.code}: ${issue.message}`)
            .join("; ");
        throw new Error(`Invalid agent response: ${message || "unknown validation error"}`);
    }
}
/**
 * Validates a route recovery plan response against the route-recovery-pack constraints.
 * Checks: all IDs exist in pack, no free selectors, max actions, sensitive metadata, no invented data.
 */
function validateRouteRecoveryPlan(response, pack) {
    const issues = [];
    if (!response || typeof response !== "object") {
        return { valid: false, decision: "no_safe_action", issues: [{ level: "error", code: "RESPONSE_NOT_OBJECT", message: "Response must be an object." }] };
    }
    const resp = response;
    if (!["repaired_plan", "no_safe_action", "needs_more_context"].includes(String(resp.decision ?? ""))) {
        return { valid: false, decision: "no_safe_action", issues: [{ level: "error", code: "INVALID_DECISION", message: `decision must be one of: repaired_plan, no_safe_action, needs_more_context. Got: ${String(resp.decision)}` }] };
    }
    const decision = resp.decision;
    if (decision === "no_safe_action" || decision === "needs_more_context") {
        // No plan to validate; these are acceptable answers.
        return { valid: true, decision, issues: [] };
    }
    // --- Validate repaired_plan ---
    if (!Array.isArray(resp.actions)) {
        issues.push({ level: "error", code: "ACTIONS_REQUIRED", message: "repaired_plan requires an actions array." });
        return { valid: false, decision, issues };
    }
    if (resp.actions.length > pack.budget.maxProposedActions) {
        issues.push({ level: "error", code: "MAX_ACTIONS_EXCEEDED", message: `Actions (${resp.actions.length}) exceed maxProposedActions (${pack.budget.maxProposedActions}).` });
    }
    const allCandidateIds = new Set(pack.topVisibleCandidates.map((c) => c.id));
    const allObjectKeys = new Set(pack.topKnownObjects.map((o) => o.key).filter(Boolean));
    const allRouteIds = new Set(pack.topKnownRoutes.map((r) => r.sourcePlanId).filter(Boolean));
    const allPlanIds = new Set(pack.topKnownPlans.map((p) => p.id).filter(Boolean));
    for (let i = 0; i < resp.actions.length; i++) {
        const action = resp.actions[i];
        if (!action.actionType || typeof action.actionType !== "string") {
            issues.push({ level: "error", code: "ACTION_TYPE_REQUIRED", message: `Action ${i} is missing actionType.` });
        }
        const candidateId = String(action.candidateId ?? "");
        const objectId = String(action.objectId ?? "");
        const routeId = String(action.routeId ?? "");
        if (candidateId && !allCandidateIds.has(candidateId)) {
            issues.push({ level: "error", code: "CANDIDATE_ID_NOT_FOUND", message: `Action ${i} references candidateId '${candidateId}' not in pack.` });
        }
        if (objectId && !allObjectKeys.has(objectId)) {
            issues.push({ level: "error", code: "OBJECT_ID_NOT_FOUND", message: `Action ${i} references objectId '${objectId}' not in pack.` });
        }
        if (routeId && !allRouteIds.has(routeId) && !allPlanIds.has(routeId)) {
            issues.push({ level: "error", code: "ROUTE_ID_NOT_FOUND", message: `Action ${i} references routeId '${routeId}' not in pack.` });
        }
        if (typeof action.confidence === "number" && action.confidence < 0.3) {
            issues.push({ level: "warning", code: "LOW_CONFIDENCE", message: `Action ${i} has low confidence (${action.confidence}).` });
        }
        // Sensitive actions need metadata
        const type = String(action.actionType ?? "").toLowerCase();
        if (["submit", "confirm", "pay", "send", "login", "otp"].includes(type) && !action.sensitive) {
            issues.push({ level: "error", code: "SENSITIVE_MISSING_METADATA", message: `Action ${i} ('${type}') requires sensitive: true metadata.` });
        }
    }
    if (Array.isArray(resp.rationale)) {
        const totalChars = resp.rationale.reduce((sum, r) => sum + r.length, 0);
        if (totalChars > pack.budget.maxRationaleChars) {
            issues.push({ level: "warning", code: "RATIONALE_TOO_LONG", message: `Rationale (${totalChars} chars) exceeds maxRationaleChars (${pack.budget.maxRationaleChars}).` });
        }
    }
    if (Array.isArray(resp.unresolvedQuestions) && resp.unresolvedQuestions.length > pack.budget.maxUnresolvedQuestions) {
        issues.push({ level: "warning", code: "TOO_MANY_UNRESOLVED", message: `Unresolved questions (${resp.unresolvedQuestions.length}) exceed maxUnresolvedQuestions (${pack.budget.maxUnresolvedQuestions}).` });
    }
    return {
        valid: !issues.some((i) => i.level === "error"),
        decision,
        issues
    };
}
