"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const spec_execution_contract_1 = require("./spec-execution-contract");
const spec_generation_hybrid_1 = require("./spec-generation-hybrid");
const binding = {
    kind: "auth_flow",
    helper: "ensureAuthenticated",
    bindingId: "auth-flow-aggregate",
    coveredScenarioStepIndices: [1, 2, 3, 4],
};
function contract() {
    return {
        version: "1.0",
        scenarioId: "S-auth",
        title: "Auth aggregate",
        auth: { gateDetected: true, required: true, aggregate: binding },
        steps: [1, 2, 3, 4, 5].map((scenarioStepIndex) => ({
            contractStepIndex: scenarioStepIndex - 1,
            scenarioStepIndex,
            originalText: `step ${scenarioStepIndex}`,
            operation: scenarioStepIndex === 5 ? "click" : "fill",
            required: true,
            executionStatus: "executed",
            evidenceRefs: [],
        })),
        unresolvedRequiredOracles: [],
        diagnostics: { requiredScenarioSteps: 5, representedScenarioSteps: 5, missingScenarioSteps: [] },
    };
}
const validAuthCall = `await authFlow.ensureAuthenticated({ contractBinding: ${JSON.stringify(binding)} });`;
(0, node_test_1.default)("generator materializes the structured aggregate binding into the auth invocation", () => {
    const materialized = (0, spec_generation_hybrid_1.materializeAuthFlowAggregateBinding)("await authFlow.ensureAuthenticated();", binding);
    const bindings = (0, spec_execution_contract_1.extractAuthFlowAggregateBindings)(materialized);
    strict_1.default.equal(bindings.length, 1);
    strict_1.default.equal(bindings[0].bindingId, binding.bindingId);
    strict_1.default.deepEqual(bindings[0].coveredScenarioStepIndices, binding.coveredScenarioStepIndices);
});
(0, node_test_1.default)("aggregate auth binding covers every declared auth step exactly once", () => {
    const result = (0, spec_execution_contract_1.computeTraceFidelity)(`${validAuthCall}\nawait promotedRuntime.clickPromotedTarget({ stepIndex: 5, target: "Continue", action: async () => {} });`, contract());
    strict_1.default.equal(result.status, "passed");
    strict_1.default.equal(result.expected, 5);
    strict_1.default.equal(result.implemented, 5);
});
(0, node_test_1.default)("bare auth helper cannot receive aggregate coverage credit", () => {
    const result = (0, spec_execution_contract_1.computeTraceFidelity)(`await authFlow.ensureAuthenticated();\nawait promotedRuntime.clickPromotedTarget({ stepIndex: 5, target: "Continue", action: async () => {} });`, contract());
    strict_1.default.equal(result.status, "failed");
    strict_1.default.ok(result.errors.some((error) => error.startsWith("auth_flow_aggregate_partial_or_invalid_binding:")));
    strict_1.default.ok(result.errors.some((error) => error.startsWith("missing_contract_step:stepIndex=1:")));
});
(0, node_test_1.default)("partial aggregate binding fails closed", () => {
    const partial = { ...binding, coveredScenarioStepIndices: [1, 2] };
    const result = (0, spec_execution_contract_1.computeTraceFidelity)(`await authFlow.ensureAuthenticated({ contractBinding: ${JSON.stringify(partial)} });\nawait promotedRuntime.clickPromotedTarget({ stepIndex: 5, target: "Continue", action: async () => {} });`, contract());
    strict_1.default.equal(result.status, "failed");
    strict_1.default.ok(result.errors.some((error) => error.includes("auth_flow_aggregate_partial_or_invalid_binding")));
    strict_1.default.ok(result.errors.some((error) => error.startsWith("missing_contract_step:stepIndex=3:")));
});
(0, node_test_1.default)("duplicate aggregate execution is rejected", () => {
    const result = (0, spec_execution_contract_1.computeTraceFidelity)(`${validAuthCall}\n${validAuthCall}\nawait promotedRuntime.clickPromotedTarget({ stepIndex: 5, target: "Continue", action: async () => {} });`, contract());
    strict_1.default.equal(result.status, "failed");
    strict_1.default.ok(result.errors.some((error) => error.startsWith("auth_flow_aggregate_duplicate_execution:")));
});
(0, node_test_1.default)("canonical assertion remains required even when discovery marked it contextual", () => {
    const source = {
        steps: [{ index: 1, action: "Validar que el bloqueo sea visible", assertionImportance: "contextual" }],
        stepRequirementRefs: [{ stepIndex: 1, requirementId: "REQ-BLOCK" }],
        stepClaims: [{ stepIndex: 1, claimId: "CLAIM-BLOCK", requirementId: "REQ-BLOCK", required: true, coverable: true }],
        requirements: [{ requirementId: "REQ-BLOCK", description: "Validar que el bloqueo sea visible", coverability: "covered" }],
    };
    const built = (0, spec_execution_contract_1.buildSpecExecutionContract)({ scenario: { externalId: "S1", title: "s" }, steps: [] }, source);
    strict_1.default.equal(built.steps[0].required, true);
    strict_1.default.equal(built.steps[0].executionStatus, "unresolved");
    strict_1.default.equal((0, spec_execution_contract_1.validateSpecExecutionContract)(built).valid, false);
});
(0, node_test_1.default)("negative canonical oracle polarity is preserved", () => {
    const source = {
        steps: [{ index: 1, action: "Validar que no se muestre el aviso", assertionImportance: "contextual" }],
        observableOracles: [{
                id: "oracle-negative",
                requirement: "que no se muestre el aviso",
                type: "literal_visible_text",
                backed: true,
                source: "discovery",
                stepIndex: 1,
                polarity: "negative",
                evidence: ["assertion_resolved_during_discovery"],
            }],
    };
    const built = (0, spec_execution_contract_1.buildSpecExecutionContract)({ scenario: { externalId: "S2", title: "s" }, steps: [] }, source);
    strict_1.default.equal(built.steps[0].required, true);
    strict_1.default.equal(built.steps[0].oracle?.polarity, "negative");
});
(0, node_test_1.default)("unbacked non-canonical contextual assertion remains unresolved but non-required", () => {
    const source = {
        steps: [{ index: 1, action: "Validar información adicional", assertionImportance: "contextual" }],
    };
    const built = (0, spec_execution_contract_1.buildSpecExecutionContract)({ scenario: { externalId: "S3", title: "s" }, steps: [] }, source);
    strict_1.default.equal(built.steps[0].required, false);
    strict_1.default.equal(built.steps[0].executionStatus, "contextual_unresolved");
});
