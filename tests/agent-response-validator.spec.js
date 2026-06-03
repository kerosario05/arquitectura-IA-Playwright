"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const agent_response_validator_1 = require("../src/agent/agent-response-validator");
const validPack = {
    topVisibleCandidates: [
        { id: "btn-login" },
        { id: "inp-user" }
    ],
    topKnownObjects: [
        { key: "obj-login" },
        { key: "obj-user" }
    ],
    topKnownRoutes: [
        { sourcePlanId: "plan-login" }
    ],
    topKnownPlans: [
        { id: "plan-1" },
        { id: "plan-2" }
    ],
    budget: {
        maxProposedActions: 5,
        maxRationaleChars: 1200,
        maxUnresolvedQuestions: 5
    }
};
// --- repaired_plan validation tests ---
(0, test_1.test)("validateRouteRecoveryPlan accepts valid repaired_plan", () => {
    const result = (0, agent_response_validator_1.validateRouteRecoveryPlan)({
        decision: "repaired_plan",
        actions: [
            { actionType: "click", candidateId: "btn-login", confidence: 0.8, rationale: "Found login button" }
        ],
        rationale: ["Short rationale"]
    }, validPack);
    (0, test_1.expect)(result.valid).toBe(true);
    (0, test_1.expect)(result.decision).toBe("repaired_plan");
});
(0, test_1.test)("validateRouteRecoveryPlan rejects nonexistent candidateId", () => {
    const result = (0, agent_response_validator_1.validateRouteRecoveryPlan)({
        decision: "repaired_plan",
        actions: [
            { actionType: "click", candidateId: "nonexistent", confidence: 0.8 }
        ]
    }, validPack);
    (0, test_1.expect)(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.code === "CANDIDATE_ID_NOT_FOUND");
    (0, test_1.expect)(issue).toBeDefined();
});
(0, test_1.test)("validateRouteRecoveryPlan rejects nonexistent objectId", () => {
    const result = (0, agent_response_validator_1.validateRouteRecoveryPlan)({
        decision: "repaired_plan",
        actions: [
            { actionType: "click", objectId: "no-such-obj", confidence: 0.8 }
        ]
    }, validPack);
    (0, test_1.expect)(result.valid).toBe(false);
    (0, test_1.expect)(result.issues.some((i) => i.code === "OBJECT_ID_NOT_FOUND")).toBe(true);
});
(0, test_1.test)("validateRouteRecoveryPlan accepts no_safe_action without actions", () => {
    const result = (0, agent_response_validator_1.validateRouteRecoveryPlan)({
        decision: "no_safe_action",
        rationale: ["No route found"]
    }, validPack);
    (0, test_1.expect)(result.valid).toBe(true);
    (0, test_1.expect)(result.decision).toBe("no_safe_action");
});
(0, test_1.test)("validateRouteRecoveryPlan accepts needs_more_context without actions", () => {
    const result = (0, agent_response_validator_1.validateRouteRecoveryPlan)({
        decision: "needs_more_context",
        unresolvedQuestions: ["Need more snapshot data"],
        rationale: ["Missing context"]
    }, validPack);
    (0, test_1.expect)(result.valid).toBe(true);
    (0, test_1.expect)(result.decision).toBe("needs_more_context");
});
(0, test_1.test)("validateRouteRecoveryPlan rejects decision string not in enum", () => {
    const result = (0, agent_response_validator_1.validateRouteRecoveryPlan)({
        decision: "invalid_decision"
    }, validPack);
    (0, test_1.expect)(result.valid).toBe(false);
    (0, test_1.expect)(result.issues.some((i) => i.code === "INVALID_DECISION")).toBe(true);
});
(0, test_1.test)("validateRouteRecoveryPlan rejects over maxProposedActions", () => {
    const result = (0, agent_response_validator_1.validateRouteRecoveryPlan)({
        decision: "repaired_plan",
        actions: Array.from({ length: 6 }, (_, i) => ({
            actionType: "click", candidateId: "btn-login", confidence: 0.8
        }))
    }, validPack);
    (0, test_1.expect)(result.valid).toBe(false);
    (0, test_1.expect)(result.issues.some((i) => i.code === "MAX_ACTIONS_EXCEEDED")).toBe(true);
});
(0, test_1.test)("validateRouteRecoveryPlan rejects sensitive action without metadata", () => {
    const result = (0, agent_response_validator_1.validateRouteRecoveryPlan)({
        decision: "repaired_plan",
        actions: [
            { actionType: "submit", candidateId: "btn-login", confidence: 0.8 }
        ]
    }, validPack);
    (0, test_1.expect)(result.valid).toBe(false);
    (0, test_1.expect)(result.issues.some((i) => i.code === "SENSITIVE_MISSING_METADATA")).toBe(true);
});
(0, test_1.test)("validateRouteRecoveryPlan accepts sensitive action with metadata", () => {
    const result = (0, agent_response_validator_1.validateRouteRecoveryPlan)({
        decision: "repaired_plan",
        actions: [
            { actionType: "submit", candidateId: "btn-login", confidence: 0.8, sensitive: true }
        ]
    }, validPack);
    (0, test_1.expect)(result.valid).toBe(true);
});
(0, test_1.test)("validateRouteRecoveryPlan warns on low confidence", () => {
    const result = (0, agent_response_validator_1.validateRouteRecoveryPlan)({
        decision: "repaired_plan",
        actions: [
            { actionType: "click", candidateId: "btn-login", confidence: 0.2 }
        ]
    }, validPack);
    (0, test_1.expect)(result.valid).toBe(true);
    (0, test_1.expect)(result.issues.some((i) => i.code === "LOW_CONFIDENCE" && i.level === "warning")).toBe(true);
});
(0, test_1.test)("validateRouteRecoveryPlan warns on too many unresolved questions", () => {
    const result = (0, agent_response_validator_1.validateRouteRecoveryPlan)({
        decision: "repaired_plan",
        actions: [
            { actionType: "click", candidateId: "btn-login", confidence: 0.8 }
        ],
        unresolvedQuestions: ["q1", "q2", "q3", "q4", "q5", "q6"]
    }, validPack);
    (0, test_1.expect)(result.issues.some((i) => i.code === "TOO_MANY_UNRESOLVED" && i.level === "warning")).toBe(true);
});
(0, test_1.test)("validateRouteRecoveryPlan rejects non-object response", () => {
    const result = (0, agent_response_validator_1.validateRouteRecoveryPlan)("invalid", validPack);
    (0, test_1.expect)(result.valid).toBe(false);
    (0, test_1.expect)(result.issues.some((i) => i.code === "RESPONSE_NOT_OBJECT")).toBe(true);
});
// --- validateAgentHandoffResponse with recoveryDecision ---
const agent_response_validator_2 = require("../src/agent/agent-response-validator");
(0, test_1.test)("validateAgentHandoffResponse accepts no_safe_action with empty plans", () => {
    const result = (0, agent_response_validator_2.validateAgentHandoffResponse)({
        version: "1.0",
        generatedAt: new Date().toISOString(),
        recoveryDecision: "no_safe_action",
        plans: [],
        proposedObjects: [],
        unresolvedQuestions: [],
        rationale: ["No safe action available"]
    });
    (0, test_1.expect)(result.valid).toBe(true);
});
(0, test_1.test)("validateAgentHandoffResponse accepts needs_more_context with empty plans", () => {
    const result = (0, agent_response_validator_2.validateAgentHandoffResponse)({
        version: "1.0",
        generatedAt: new Date().toISOString(),
        recoveryDecision: "needs_more_context",
        plans: [],
        proposedObjects: [],
        unresolvedQuestions: ["Need more context"],
        rationale: ["Missing data"]
    });
    (0, test_1.expect)(result.valid).toBe(true);
});
(0, test_1.test)("validateAgentHandoffResponse rejects empty plans without recoveryDecision", () => {
    const result = (0, agent_response_validator_2.validateAgentHandoffResponse)({
        version: "1.0",
        generatedAt: new Date().toISOString(),
        plans: [],
        proposedObjects: [],
        unresolvedQuestions: [],
        rationale: []
    });
    (0, test_1.expect)(result.valid).toBe(false);
    (0, test_1.expect)(result.issues.some((i) => i.code === "RESPONSE_PLANS_EMPTY")).toBe(true);
});
(0, test_1.test)("validateAgentHandoffResponse accepts empty plans with recoveryDecision no_safe_action even when all empty", () => {
    const result = (0, agent_response_validator_2.validateAgentHandoffResponse)({
        version: "1.0",
        generatedAt: new Date().toISOString(),
        recoveryDecision: "no_safe_action",
        plans: [],
        proposedObjects: [],
        unresolvedQuestions: [],
        rationale: []
    });
    // no_safe_action with all empty is valid because the decision itself is actionable
    (0, test_1.expect)(result.valid).toBe(true);
});
(0, test_1.test)("validateAgentHandoffResponse rejects plans empty with no recoveryDecision even with rationale", () => {
    const result = (0, agent_response_validator_2.validateAgentHandoffResponse)({
        version: "1.0",
        generatedAt: new Date().toISOString(),
        plans: [],
        proposedObjects: [],
        unresolvedQuestions: [],
        rationale: ["Some rationale"]
    });
    (0, test_1.expect)(result.valid).toBe(false);
    (0, test_1.expect)(result.issues.some((i) => i.code === "RESPONSE_PLANS_EMPTY")).toBe(true);
});
// --- compact-route-recovery specific validation tests ---
(0, test_1.test)("compact-route-recovery rejects plans=[] and no recoveryDecision", () => {
    const result = (0, agent_response_validator_2.validateAgentHandoffResponse)({
        version: "1.0",
        generatedAt: new Date().toISOString(),
        plans: [],
        proposedObjects: [],
        unresolvedQuestions: [],
        rationale: []
    }, { promptMode: "compact-route-recovery" });
    (0, test_1.expect)(result.valid).toBe(false);
    (0, test_1.expect)(result.issues.some((i) => i.code === "RESPONSE_MISSING_RECOVERY_DECISION")).toBe(true);
});
(0, test_1.test)("compact-route-recovery accepts no_safe_action with rationale", () => {
    const result = (0, agent_response_validator_2.validateAgentHandoffResponse)({
        version: "1.0",
        generatedAt: new Date().toISOString(),
        recoveryDecision: "no_safe_action",
        plans: [],
        proposedObjects: [],
        unresolvedQuestions: [],
        rationale: ["No safe action available"]
    }, { promptMode: "compact-route-recovery" });
    (0, test_1.expect)(result.valid).toBe(true);
});
(0, test_1.test)("compact-route-recovery rejects no_safe_action without rationale", () => {
    const result = (0, agent_response_validator_2.validateAgentHandoffResponse)({
        version: "1.0",
        generatedAt: new Date().toISOString(),
        recoveryDecision: "no_safe_action",
        plans: [],
        proposedObjects: [],
        unresolvedQuestions: [],
        rationale: []
    }, { promptMode: "compact-route-recovery" });
    (0, test_1.expect)(result.valid).toBe(false);
    (0, test_1.expect)(result.issues.some((i) => i.code === "NO_SAFE_ACTION_NO_RATIONALE")).toBe(true);
});
(0, test_1.test)("compact-route-recovery accepts needs_more_context with unresolvedQuestions", () => {
    const result = (0, agent_response_validator_2.validateAgentHandoffResponse)({
        version: "1.0",
        generatedAt: new Date().toISOString(),
        recoveryDecision: "needs_more_context",
        plans: [],
        proposedObjects: [],
        unresolvedQuestions: ["Cannot determine the current screen state."],
        rationale: ["More context needed"]
    }, { promptMode: "compact-route-recovery" });
    (0, test_1.expect)(result.valid).toBe(true);
});
(0, test_1.test)("compact-route-recovery rejects needs_more_context without unresolvedQuestions", () => {
    const result = (0, agent_response_validator_2.validateAgentHandoffResponse)({
        version: "1.0",
        generatedAt: new Date().toISOString(),
        recoveryDecision: "needs_more_context",
        plans: [],
        proposedObjects: [],
        unresolvedQuestions: [],
        rationale: ["Missing data"]
    }, { promptMode: "compact-route-recovery" });
    (0, test_1.expect)(result.valid).toBe(false);
    (0, test_1.expect)(result.issues.some((i) => i.code === "NEEDS_MORE_NO_QUESTIONS")).toBe(true);
});
(0, test_1.test)("compact-route-recovery rejects repaired_plan with empty plans", () => {
    const result = (0, agent_response_validator_2.validateAgentHandoffResponse)({
        version: "1.0",
        generatedAt: new Date().toISOString(),
        recoveryDecision: "repaired_plan",
        plans: [],
        proposedObjects: [],
        unresolvedQuestions: [],
        rationale: ["Attempted repair but no plans"]
    }, { promptMode: "compact-route-recovery" });
    (0, test_1.expect)(result.valid).toBe(false);
    (0, test_1.expect)(result.issues.some((i) => i.code === "REPAIRED_PLAN_EMPTY")).toBe(true);
});
(0, test_1.test)("compact-route-recovery accepts repaired_plan with valid plans", () => {
    const result = (0, agent_response_validator_2.validateAgentHandoffResponse)({
        version: "1.0",
        generatedAt: new Date().toISOString(),
        recoveryDecision: "repaired_plan",
        plans: [{
                version: "1.0",
                source: "ai_generated",
                status: "validated",
                scenario: { source: "testrail", caseId: 1, title: "Test" },
                requiredData: [],
                steps: [{ index: 1, action: "click", target: { strategy: "id", value: "btn-login" } }],
                createdAt: new Date().toISOString()
            }],
        proposedObjects: [],
        unresolvedQuestions: [],
        rationale: ["Found login button"]
    }, { promptMode: "compact-route-recovery" });
    (0, test_1.expect)(result.valid).toBe(true);
});
// --- Schema validation ---
const agent_response_schema_1 = require("../src/agent/agent-response.schema");
(0, test_1.test)("agent-response.schema requires recoveryDecision", () => {
    const schema = agent_response_schema_1.agentHandoffResponseJsonSchema;
    (0, test_1.expect)(schema.required).toContain("recoveryDecision");
    (0, test_1.expect)(schema.properties).toHaveProperty("recoveryDecision");
    const rdProp = schema.properties.recoveryDecision;
    (0, test_1.expect)(rdProp).toBeDefined();
    const rdEnum = rdProp.enum;
    (0, test_1.expect)(rdEnum).toContain("repaired_plan");
    (0, test_1.expect)(rdEnum).toContain("no_safe_action");
    (0, test_1.expect)(rdEnum).toContain("needs_more_context");
});
(0, test_1.test)("agent-response.schema requires generatedAt with minLength", () => {
    const schema = agent_response_schema_1.agentHandoffResponseJsonSchema;
    (0, test_1.expect)(schema.required).toContain("generatedAt");
    const gaProp = schema.properties.generatedAt;
    (0, test_1.expect)(gaProp).toBeDefined();
    (0, test_1.expect)(gaProp.minLength).toBeGreaterThanOrEqual(1);
});
// --- generatedAt empty / placeholder validation ---
(0, test_1.test)("validateAgentHandoffResponse rejects empty generatedAt", () => {
    const result = (0, agent_response_validator_2.validateAgentHandoffResponse)({
        version: "1.0",
        generatedAt: "",
        recoveryDecision: "no_safe_action",
        plans: [],
        proposedObjects: [],
        unresolvedQuestions: [],
        rationale: ["Something"]
    }, { promptMode: "compact-route-recovery" });
    (0, test_1.expect)(result.valid).toBe(false);
    (0, test_1.expect)(result.issues.some((i) => i.code === "GENERATED_AT_EMPTY")).toBe(true);
});
(0, test_1.test)("validateAgentHandoffResponse detects placeholder in target value", () => {
    const result = (0, agent_response_validator_2.validateAgentHandoffResponse)({
        version: "1.0",
        generatedAt: new Date().toISOString(),
        recoveryDecision: "repaired_plan",
        plans: [{
                version: "1.0",
                source: "ai_generated",
                status: "validated",
                scenario: { source: "testrail", caseId: 1, title: "Test" },
                requiredData: [],
                steps: [{ index: 1, action: "click", target: { strategy: "id", value: "<candidateId from route-recovery-pack.json>" } }],
                createdAt: new Date().toISOString()
            }],
        proposedObjects: [],
        unresolvedQuestions: [],
        rationale: ["Selected candidate"]
    }, { promptMode: "compact-route-recovery" });
    (0, test_1.expect)(result.valid).toBe(false);
    (0, test_1.expect)(result.issues.some((i) => i.code === "PLACEHOLDER_NOT_REPLACED")).toBe(true);
});
(0, test_1.test)("validateAgentHandoffResponse detects <iso timestamp> placeholder in generatedAt", () => {
    const result = (0, agent_response_validator_2.validateAgentHandoffResponse)({
        version: "1.0",
        generatedAt: "<iso timestamp>",
        recoveryDecision: "no_safe_action",
        plans: [],
        proposedObjects: [],
        unresolvedQuestions: [],
        rationale: ["No safe option"]
    }, { promptMode: "compact-route-recovery" });
    (0, test_1.expect)(result.valid).toBe(false);
    (0, test_1.expect)(result.issues.some((i) => i.code === "PLACEHOLDER_NOT_REPLACED")).toBe(true);
});
(0, test_1.test)("normalizeAgentHandoffResponse wraps legacy single plan field", () => {
    const normalized = (0, agent_response_validator_2.normalizeAgentHandoffResponse)({
        version: "1.0",
        generatedAt: new Date().toISOString(),
        plan: {
            version: "1.0",
            source: "ai_generated",
            status: "validated",
            scenario: { source: "testrail", caseId: 1, title: "Test" },
            requiredData: [],
            steps: [{ index: 1, action: "click", target: { strategy: "text", value: "Continue" } }],
            createdAt: new Date().toISOString()
        }
    });
    (0, test_1.expect)(normalized.recoveryDecision).toBe("repaired_plan");
    (0, test_1.expect)(normalized.plans).toHaveLength(1);
});
(0, test_1.test)("normalizeAgentHandoffResponse wraps legacy singleton plans object", () => {
    const normalized = (0, agent_response_validator_2.normalizeAgentHandoffResponse)({
        version: "1.0",
        generatedAt: new Date().toISOString(),
        plans: {
            version: "1.0",
            source: "ai_generated",
            status: "validated",
            scenario: { source: "testrail", caseId: 1, title: "Test" },
            requiredData: [],
            steps: [{ index: 1, action: "click", target: { strategy: "text", value: "Continue" } }],
            createdAt: new Date().toISOString()
        }
    });
    (0, test_1.expect)(normalized.recoveryDecision).toBe("repaired_plan");
    (0, test_1.expect)(normalized.plans).toHaveLength(1);
});
(0, test_1.test)("normalizeAgentHandoffResponse fills missing recoveryDecision for legacy plans array response", () => {
    const createdAt = new Date().toISOString();
    const normalized = (0, agent_response_validator_2.normalizeAgentHandoffResponse)({
        version: "1.0",
        generatedAt: "",
        plans: [
            {
                version: "1.0",
                source: "ai_generated",
                status: "validated",
                scenario: { source: "testrail", caseId: 1, title: "Test" },
                requiredData: [],
                steps: [{ index: 1, action: "click", target: { strategy: "text", value: "Continue" } }],
                createdAt
            }
        ],
        proposedObjects: [],
        unresolvedQuestions: [],
        rationale: ["Recovered plan"]
    });
    (0, test_1.expect)(normalized.recoveryDecision).toBe("repaired_plan");
    (0, test_1.expect)(normalized.generatedAt).toBe(createdAt);
    (0, test_1.expect)(normalized.plans).toHaveLength(1);
});
(0, test_1.test)("normalizeAgentHandoffResponse wraps legacy top-level ExecutionPlan array", () => {
    const createdAt = new Date().toISOString();
    const normalized = (0, agent_response_validator_2.normalizeAgentHandoffResponse)([
        {
            version: "1.0",
            source: "ai_generated",
            status: "validated",
            scenario: { source: "testrail", caseId: 1, title: "Test array" },
            requiredData: [],
            steps: [{ index: 1, action: "click", target: { strategy: "text", value: "Continue" } }],
            createdAt
        }
    ]);
    (0, test_1.expect)(normalized.recoveryDecision).toBe("repaired_plan");
    (0, test_1.expect)(normalized.generatedAt).toBe(createdAt);
    (0, test_1.expect)(normalized.plans).toHaveLength(1);
});
