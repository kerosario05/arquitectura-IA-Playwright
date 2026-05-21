import { test, expect } from "@playwright/test";
import { evaluatePromotionGate } from "../src/automations/promotion-gate";
import type { CaseDiscoveryResult, DiscoveryStepResult } from "../src/types/discovery.types";
import type { ExecutionPlan } from "../src/types/execution-plan.types";

function makePlan(status: ExecutionPlan["status"] = "validated"): ExecutionPlan {
  return {
    version: "1.0",
    source: "discovery_generated",
    status,
    scenario: {
      source: "testrail",
      caseId: 1000,
      externalId: "C1000",
      title: "Generic"
    },
    requiredData: [],
    steps: [{ index: 1, action: "click", target: { strategy: "text", value: "Go", exact: false } }],
    createdAt: new Date().toISOString()
  };
}

function makeResult(status: CaseDiscoveryResult["status"], failedReason?: string): CaseDiscoveryResult {
  return {
    version: "1.0",
    caseId: 1000,
    caseTitle: "Generic",
    discoveredAt: new Date().toISOString(),
    status,
    steps: [{ index: 1, action: "Click", status: "found" }],
    discoveredObjects: [],
    candidatePlan: makePlan("validated"),
    failedReason
  };
}

test("discovered_passed + validated + clean steps => allowed true", () => {
  const gate = evaluatePromotionGate({ discoveryResult: makeResult("discovered_passed") });
  expect(gate.allowed).toBe(true);
  expect(gate.status).toBe("passed");
});

test("discovered_partial => not_applicable", () => {
  const gate = evaluatePromotionGate({ discoveryResult: makeResult("discovered_partial") });
  expect(gate.allowed).toBe(false);
  expect(gate.status).toBe("not_applicable");
});

test("exploration_failed => not_applicable", () => {
  const gate = evaluatePromotionGate({ discoveryResult: makeResult("exploration_failed") });
  expect(gate.allowed).toBe(false);
  expect(gate.status).toBe("not_applicable");
});

test("candidatePlan needs_discovery => blocked", () => {
  const result = makeResult("discovered_passed");
  result.candidatePlan = makePlan("needs_discovery");
  const gate = evaluatePromotionGate({ discoveryResult: result });
  expect(gate.allowed).toBe(false);
});

test("candidatePlan needs_data => blocked", () => {
  const result = makeResult("discovered_passed");
  result.candidatePlan = makePlan("needs_data");
  const gate = evaluatePromotionGate({ discoveryResult: result });
  expect(gate.allowed).toBe(false);
});

test("failedReason target_not_found => blocked", () => {
  const gate = evaluatePromotionGate({ discoveryResult: makeFailureResult("target_not_found") });
  expect(gate.allowed).toBe(false);
});

test("failedReason ambiguous_target => blocked", () => {
  const gate = evaluatePromotionGate({ discoveryResult: makeFailureResult("ambiguous_target") });
  expect(gate.allowed).toBe(false);
});

test("failedReason locator_resolution_failed => blocked", () => {
  const gate = evaluatePromotionGate({ discoveryResult: makeFailureResult("locator_resolution_failed") });
  expect(gate.allowed).toBe(false);
});

test("failedReason fill_target_not_editable => blocked", () => {
  const gate = evaluatePromotionGate({ discoveryResult: makeFailureResult("fill_target_not_editable") });
  expect(gate.allowed).toBe(false);
});

test("failedReason needs_assertion_resolution => blocked", () => {
  const gate = evaluatePromotionGate({ discoveryResult: makeFailureResult("needs_assertion_resolution") });
  expect(gate.allowed).toBe(false);
});

test("requiredData unresolved => blocked", () => {
  const result = makeResult("discovered_passed");
  result.candidatePlan = {
    ...makePlan("validated"),
    requiredData: [{ key: "account", required: true, resolved: false }]
  };
  const gate = evaluatePromotionGate({ discoveryResult: result });
  expect(gate.allowed).toBe(false);
});

test("optional_assertion skipped does not block", () => {
  const result = makeResult("discovered_passed");
  result.steps.push({ index: 2, action: "Optional assertion", status: "skipped_semantic_descriptor" });
  const gate = evaluatePromotionGate({ discoveryResult: result });
  expect(gate.allowed).toBe(true);
});

test("semantic_descriptor satisfied_by_children does not block", () => {
  const result = makeResult("discovered_passed");
  result.steps.push({ index: 2, action: "Semantic", status: "satisfied_by_children" });
  const gate = evaluatePromotionGate({ discoveryResult: result });
  expect(gate.allowed).toBe(true);
});

test("optional_action executed as required => blocked", () => {
  const result = makeResult("discovered_passed");
  result.steps.push({ index: 2, action: "Optional action unresolved", status: "not_found" });
  const gate = evaluatePromotionGate({ discoveryResult: result });
  expect(gate.allowed).toBe(false);
});

test("sensitive action metadata requiresApproval => blocked", () => {
  const result = makeResult("discovered_passed");
  result.candidatePlan = {
    ...makePlan("validated"),
    steps: [{ index: 1, action: "click", requiresApproval: true } as any]
  };
  const gate = evaluatePromotionGate({ discoveryResult: result });
  expect(gate.allowed).toBe(false);
});

test("gate returns clear reasons", () => {
  const gate = evaluatePromotionGate({ discoveryResult: makeFailureResult("target_not_found") });
  expect(gate.reasons.length).toBeGreaterThan(0);
});

function makeFailureResult(failedReason: string, steps: DiscoveryStepResult[] = [{ index: 1, action: "Click", status: "not_found" }]): CaseDiscoveryResult {
  return {
    version: "1.0",
    caseId: 1000,
    caseTitle: "Generic",
    discoveredAt: new Date().toISOString(),
    status: "discovered_passed",
    steps,
    discoveredObjects: [],
    candidatePlan: makePlan("validated"),
    failedReason
  };
}

test("not_found step without recoveryStatus is blocking", () => {
  const gate = evaluatePromotionGate({ discoveryResult: makeFailureResult("target_not_found") });
  expect(gate.allowed).toBe(false);
  expect(gate.status).toBe("blocked");
});

test("not_found step with recoveryStatus recovered is NOT blocking", () => {
  const steps: DiscoveryStepResult[] = [{ index: 1, action: "Click", status: "not_found", recoveryStatus: "recovered" }];
  const gate = evaluatePromotionGate({ discoveryResult: makeFailureResult("target_not_found", steps) });
  expect(gate.allowed).toBe(true);
  expect(gate.status).toBe("passed");
});

test("not_found step with recoveryStatus repaired is NOT blocking", () => {
  const steps: DiscoveryStepResult[] = [{ index: 1, action: "Click", status: "not_found", recoveryStatus: "repaired" }];
  const gate = evaluatePromotionGate({ discoveryResult: makeFailureResult("target_not_found", steps) });
  expect(gate.allowed).toBe(true);
  expect(gate.status).toBe("passed");
});

test("repaired_passed status with all recovered steps passes", () => {
  const result = makeFailureResult("target_not_found");
  result.status = "repaired_passed";
  result.steps[0].recoveryStatus = "recovered";
  const gate = evaluatePromotionGate({ discoveryResult: result });
  expect(gate.allowed).toBe(true);
  expect(gate.status).toBe("passed");
});

test("mixed: recovered step + not_found step => blocked when unresolved", () => {
  const steps: DiscoveryStepResult[] = [
    { index: 1, action: "Click", status: "not_found", recoveryStatus: "recovered" },
    { index: 2, action: "Type", status: "not_found" }
  ];
  const gate = evaluatePromotionGate({ discoveryResult: makeFailureResult("target_not_found", steps) });
  expect(gate.allowed).toBe(false);
  expect(gate.status).toBe("blocked");
});
