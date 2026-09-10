import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSpecExecutionContract,
  computeTraceFidelity,
  extractAuthFlowAggregateBindings,
  validateSpecExecutionContract,
  type ContractSourceScenario,
  type SpecExecutionContract,
} from "./spec-execution-contract";
import { materializeAuthFlowAggregateBinding } from "./spec-generation-hybrid";

const binding = {
  kind: "auth_flow" as const,
  helper: "ensureAuthenticated" as const,
  bindingId: "auth-flow-aggregate",
  coveredScenarioStepIndices: [1, 2, 3, 4],
};

function contract(): SpecExecutionContract {
  return {
    version: "1.0",
    scenarioId: "S-auth",
    title: "Auth aggregate",
    auth: { gateDetected: true, required: true, aggregate: binding },
    steps: [1, 2, 3, 4, 5].map((scenarioStepIndex) => ({
      contractStepIndex: scenarioStepIndex - 1,
      scenarioStepIndex,
      originalText: `step ${scenarioStepIndex}`,
      operation: scenarioStepIndex === 5 ? "click" as const : "fill" as const,
      required: true,
      executionStatus: "executed" as const,
      evidenceRefs: [],
    })),
    unresolvedRequiredOracles: [],
    diagnostics: { requiredScenarioSteps: 5, representedScenarioSteps: 5, missingScenarioSteps: [] },
  };
}

const validAuthCall = `await authFlow.ensureAuthenticated({ contractBinding: ${JSON.stringify(binding)} });`;

test("generator materializes the structured aggregate binding into the auth invocation", () => {
  const materialized = materializeAuthFlowAggregateBinding(
    "await authFlow.ensureAuthenticated();",
    binding,
  );
  const bindings = extractAuthFlowAggregateBindings(materialized);
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].bindingId, binding.bindingId);
  assert.deepEqual(bindings[0].coveredScenarioStepIndices, binding.coveredScenarioStepIndices);
});

test("aggregate auth binding covers every declared auth step exactly once", () => {
  const result = computeTraceFidelity(
    `${validAuthCall}\nawait promotedRuntime.clickPromotedTarget({ stepIndex: 5, target: "Continue", action: async () => {} });`,
    contract(),
  );
  assert.equal(result.status, "passed");
  assert.equal(result.expected, 5);
  assert.equal(result.implemented, 5);
});

test("bare auth helper cannot receive aggregate coverage credit", () => {
  const result = computeTraceFidelity(
    `await authFlow.ensureAuthenticated();\nawait promotedRuntime.clickPromotedTarget({ stepIndex: 5, target: "Continue", action: async () => {} });`,
    contract(),
  );
  assert.equal(result.status, "failed");
  assert.ok(result.errors.some((error) => error.startsWith("auth_flow_aggregate_partial_or_invalid_binding:")));
  assert.ok(result.errors.some((error) => error.startsWith("missing_contract_step:stepIndex=1:")));
});

test("partial aggregate binding fails closed", () => {
  const partial = { ...binding, coveredScenarioStepIndices: [1, 2] };
  const result = computeTraceFidelity(
    `await authFlow.ensureAuthenticated({ contractBinding: ${JSON.stringify(partial)} });\nawait promotedRuntime.clickPromotedTarget({ stepIndex: 5, target: "Continue", action: async () => {} });`,
    contract(),
  );
  assert.equal(result.status, "failed");
  assert.ok(result.errors.some((error) => error.includes("auth_flow_aggregate_partial_or_invalid_binding")));
  assert.ok(result.errors.some((error) => error.startsWith("missing_contract_step:stepIndex=3:")));
});

test("duplicate aggregate execution is rejected", () => {
  const result = computeTraceFidelity(
    `${validAuthCall}\n${validAuthCall}\nawait promotedRuntime.clickPromotedTarget({ stepIndex: 5, target: "Continue", action: async () => {} });`,
    contract(),
  );
  assert.equal(result.status, "failed");
  assert.ok(result.errors.some((error) => error.startsWith("auth_flow_aggregate_duplicate_execution:")));
});

test("canonical assertion remains required even when discovery marked it contextual", () => {
  const source: ContractSourceScenario = {
    steps: [{ index: 1, action: "Validar que el bloqueo sea visible", assertionImportance: "contextual" }],
    stepRequirementRefs: [{ stepIndex: 1, requirementId: "REQ-BLOCK" }],
    stepClaims: [{ stepIndex: 1, claimId: "CLAIM-BLOCK", requirementId: "REQ-BLOCK", required: true, coverable: true }],
    requirements: [{ requirementId: "REQ-BLOCK", description: "Validar que el bloqueo sea visible", coverability: "covered" }],
  };
  const built = buildSpecExecutionContract({ scenario: { externalId: "S1", title: "s" }, steps: [] } as any, source);
  assert.equal(built.steps[0].required, true);
  assert.equal(built.steps[0].executionStatus, "unresolved");
  assert.equal(validateSpecExecutionContract(built).valid, false);
});

test("negative canonical oracle polarity is preserved", () => {
  const source: ContractSourceScenario = {
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
  const built = buildSpecExecutionContract({ scenario: { externalId: "S2", title: "s" }, steps: [] } as any, source);
  assert.equal(built.steps[0].required, true);
  assert.equal(built.steps[0].oracle?.polarity, "negative");
});

test("unbacked non-canonical contextual assertion remains unresolved but non-required", () => {
  const source: ContractSourceScenario = {
    steps: [{ index: 1, action: "Validar información adicional", assertionImportance: "contextual" }],
  };
  const built = buildSpecExecutionContract({ scenario: { externalId: "S3", title: "s" }, steps: [] } as any, source);
  assert.equal(built.steps[0].required, false);
  assert.equal(built.steps[0].executionStatus, "contextual_unresolved");
});
