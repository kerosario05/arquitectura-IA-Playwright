import { test, expect } from "@playwright/test";
import {
  buildDiscoveryAssertionContract,
  findAssertionRecoveryByLaterSuccess,
  resolveDiscoveryStatusFromAssertionContract,
  hasObservableAssertionAuthority,
  reconcileFailureMarkers,
} from "../src/discovery/case-discovery";
import {
  buildSpecExecutionContract,
  validateSpecExecutionContract,
} from "../src/automations/spec-execution-contract";
import type { ExecutionPlan } from "../src/types/execution-plan.types";

function assertion(overrides: Record<string, unknown> = {}) {
  return {
    index: 1,
    action: "assertVisible",
    targetText: "Target A",
    status: "not_found",
    assertionClassification: "passive_visibility",
    functionalRequired: true,
    runtimeBacked: false,
    pendingDiscovery: true,
    ...overrides,
  } as any;
}

function plan(): ExecutionPlan {
  return {
    version: "1.0",
    source: "discovery_generated",
    status: "needs_discovery",
    scenario: { source: "testrail", externalId: "PREVIEW-005", title: "Scenario" },
    requiredData: [],
    steps: [{ index: 1, action: "assertVisible", description: "Assert Target A", target: { strategy: "text", value: "Target A" } }],
  };
}

const canonicalScenario = {
  title: "Scenario",
  steps: [{ index: 1, action: "assertVisible", description: "Target A", expected: "Target A" }],
  stepRequirementRefs: [{ stepIndex: 1, requirementId: "visibility:target-a", facet: "visibility" }],
  stepClaims: [{ stepIndex: 1, claimId: "claim-target-a", requirementId: "visibility:target-a", facet: "visibility", required: true, coverable: true }],
};

test("T1/T2/T8/T9 canonical required not_found remains required and blocks pass", () => {
  const contract = buildDiscoveryAssertionContract({ steps: [assertion()], earlyCompletionSatisfied: true });
  expect(contract.pendingCriticalAssertions).toEqual(["Target A"]);
  const status = resolveDiscoveryStatusFromAssertionContract({
    initialStatus: "discovered_passed",
    unresolvedBlockingFailuresCount: 0,
    pendingDiscoveryCount: 1,
    someFound: true,
    contract,
  });
  expect(status.status).toBe("discovered_partial");
  expect(status.shouldExecuteFunctionalGate).toBe(false);
});

test("T3 noncanonical contextual assertion may remain contextual", () => {
  const step = assertion({ functionalRequired: false, assertionImportance: "contextual" });
  const contract = buildDiscoveryAssertionContract({ steps: [step], earlyCompletionSatisfied: true });
  expect(contract.unresolvedContextualAssertions).toEqual(["Target A"]);
});

test("T4 different successful target cannot recover Target A", () => {
  const recovered = findAssertionRecoveryByLaterSuccess("Target A", [
    assertion(),
    { index: 2, action: "click", targetText: "Target B", status: "found" } as any,
  ], 1);
  expect(recovered).toBeUndefined();
});

test("T5 same target success can recover the assertion", () => {
  const recovered = findAssertionRecoveryByLaterSuccess("Target A", [
    assertion(),
    { index: 2, action: "assertVisible", targetText: "Target A", status: "found" } as any,
  ], 1);
  expect(recovered).toBe(1);
});

test("T6/T7 only an authorized oracle for the same requirement can back it", () => {
  const backed = buildSpecExecutionContract(plan(), {
    ...canonicalScenario,
    observableOracles: [{ id: "oracle-a", requirement: "visibility:target-a", type: "visibility", backed: true, source: "discovery", stepIndex: 1, target: "Target A", evidence: ["observed_assertion_match"] }],
  });
  expect(backed.steps[0].required).toBe(true);
  expect(backed.steps[0].oracle?.backed).toBe(true);

  const technicalOnly = buildSpecExecutionContract(plan(), {
    ...canonicalScenario,
    observableOracles: [{ id: "nav", requirement: "other", type: "navigation_transition", backed: true, source: "discovery", stepIndex: 1, evidence: ["transition_observed"] }],
  });
  expect(technicalOnly.steps[0].required).toBe(true);
  expect(technicalOnly.steps[0].executionStatus).toBe("unresolved");
});

test("T10 all canonical assertions backed can pass", () => {
  const contract = buildSpecExecutionContract(plan(), {
    ...canonicalScenario,
    observableOracles: [{ id: "oracle-a", requirement: "visibility:target-a", type: "visibility", backed: true, source: "discovery", stepIndex: 1, target: "Target A", evidence: ["observed_assertion_match"] }],
  });
  expect(validateSpecExecutionContract(contract).valid).toBe(true);
});

test("T12/T13 execution contract preserves canonical requiredness and unresolved assertion", () => {
  const contract = buildSpecExecutionContract(plan(), canonicalScenario);
  expect(contract.steps[0].required).toBe(true);
  expect(contract.steps[0].executionStatus).toBe("unresolved");
  expect(validateSpecExecutionContract(contract).valid).toBe(false);
});

test("T14 authority comes from structured refs, not title or text", () => {
  const contract = buildSpecExecutionContract(plan(), {
    title: "Target A",
    steps: [{ index: 1, action: "assertVisible", description: "Target A", expected: "Target A" }],
  });
  expect(contract.steps[0].required).toBe(true);
  expect(contract.steps[0].executionStatus).toBe("unresolved");
});

test("narrative and semantic destination metadata do not create observable authority", () => {
  expect(hasObservableAssertionAuthority({ canonicalRequirementRefs: [], assertionDiagnostics: {} })).toBe(false);
  expect(hasObservableAssertionAuthority({ canonicalRequirementRefs: [{ requirementId: "destination", facet: "destination" }], assertionDiagnostics: {} })).toBe(false);
  expect(hasObservableAssertionAuthority({ canonicalRequirementRefs: [{ requirementId: "visible", facet: "visibility", claimId: "claim-visible" }], assertionDiagnostics: {} })).toBe(true);
});

test("reconciled assertion clears stale failure markers but an unresolved failure remains", () => {
  const markers = { failedAtStep: 5, failedTarget: "narrative destination", failedReason: "assertion_not_found_unrecovered" };
  expect(reconcileFailureMarkers([
    { index: 5, action: "assert", status: "satisfied_by_previous_assertion", assertionStatus: "satisfied_by_previous_assertion" } as any,
  ], markers)).toEqual({ failedAtStep: undefined, failedTarget: undefined, failedReason: undefined });
  expect(reconcileFailureMarkers([
    { index: 5, action: "assert", status: "not_found", assertionClassification: "literal_observable", functionalRequired: true } as any,
  ], markers)).toEqual(markers);
});

test("T11/T15 negative control keeps functional accounting separate from runtime success", () => {
  const scenario = {
    ...canonicalScenario,
    observableOracles: [{ id: "nav", requirement: "other", type: "navigation_transition", backed: true, source: "discovery", stepIndex: 1, target: "Target C", evidence: ["transition_observed"] }],
  };
  const contract = buildSpecExecutionContract(plan(), scenario);
  expect(contract.steps[0].required).toBe(true);
  expect(contract.steps[0].oracle?.backed).not.toBe(true);
  expect(contract.steps[0].executionStatus).toBe("unresolved");
  expect(contract.diagnostics.requiredScenarioSteps).toBe(1);
});
