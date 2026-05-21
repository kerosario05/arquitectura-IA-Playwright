import { test, expect } from "@playwright/test";
import { evaluatePromotionGate } from "../src/automations/promotion-gate";
import { DEFAULT_PROMOTION_POLICY } from "../src/types/automation-promotion.types";
import type { CaseDiscoveryResult, DiscoveryStepResult } from "../src/types/discovery.types";
import type { ExecutionPlan } from "../src/types/execution-plan.types";

function makePlan(): ExecutionPlan {
  return {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    scenario: { source: "testrail", caseId: 1000, externalId: "C1000", title: "Generic" },
    requiredData: [],
    steps: [{ index: 1, action: "click", target: { strategy: "text", value: "Go", exact: false } }],
    createdAt: new Date().toISOString()
  };
}

function makeResult(overrides?: Partial<CaseDiscoveryResult>): CaseDiscoveryResult {
  const base: CaseDiscoveryResult = {
    version: "1.0",
    caseId: 1000,
    caseTitle: "Generic",
    discoveredAt: new Date().toISOString(),
    status: "discovered_passed",
    steps: [{ index: 1, action: "Click", status: "found" }],
    discoveredObjects: [],
    candidatePlan: makePlan()
  };
  return { ...base, ...overrides };
}

test("gate passes when POM policy is present and no missing objects", () => {
  const gate = evaluatePromotionGate({
    discoveryResult: makeResult(),
    promotionPolicy: DEFAULT_PROMOTION_POLICY
  });
  expect(gate.allowed).toBe(true);
  expect(gate.status).toBe("passed");
});

test("gate blocks when missing page objects provided", () => {
  const gate = evaluatePromotionGate({
    discoveryResult: makeResult(),
    promotionPolicy: DEFAULT_PROMOTION_POLICY,
    missingPageObjects: ["LoginPage", "MenuPage"]
  });
  expect(gate.allowed).toBe(false);
  expect(gate.status).toBe("blocked");
  expect(gate.reasons.some((r) => r.includes("missing page object"))).toBe(true);
  expect(gate.pomStatus).toBe("needs_page_object");
});

test("gate blocks when missing methods provided", () => {
  const gate = evaluatePromotionGate({
    discoveryResult: makeResult(),
    promotionPolicy: DEFAULT_PROMOTION_POLICY,
    missingMethods: ["click: Login button"]
  });
  expect(gate.allowed).toBe(false);
  expect(gate.status).toBe("blocked");
  expect(gate.pomStatus).toBe("needs_page_method");
});

test("gate allows when allowInlineFallback and not requirePageObjects", () => {
  const policy = { ...DEFAULT_PROMOTION_POLICY, requirePageObjects: false, allowInlineFallback: true };
  const gate = evaluatePromotionGate({
    discoveryResult: makeResult(),
    promotionPolicy: policy,
    missingMethods: ["click: Go"]
  });
  expect(gate.allowed).toBe(true);
});

test("gate reports pomStatus page_object_candidate_created", () => {
  const gate = evaluatePromotionGate({
    discoveryResult: makeResult(),
    promotionPolicy: DEFAULT_PROMOTION_POLICY,
    pomStatus: "page_object_candidate_created"
  });
  expect(gate.pomStatus).toBe("page_object_candidate_created");
  expect(gate.reasons.some((r) => r.includes("candidates"))).toBe(true);
});

test("gate reports pomStatus inline_debug_only as warning", () => {
  const gate = evaluatePromotionGate({
    discoveryResult: makeResult(),
    promotionPolicy: DEFAULT_PROMOTION_POLICY,
    pomStatus: "inline_debug_only"
  });
  expect(gate.pomStatus).toBe("inline_debug_only");
  expect(gate.warnings.some((w) => w.includes("inline-debug"))).toBe(true);
});

test("gate blocked by missing pages does not prevent validations", () => {
  const result = makeResult();
  result.status = "repaired_passed";
  const gate = evaluatePromotionGate({
    discoveryResult: result,
    promotionPolicy: DEFAULT_PROMOTION_POLICY,
    missingPageObjects: ["HomePage"]
  });
  expect(gate.allowed).toBe(false);
  expect(gate.reasons.some((r) => r.includes("missing page object"))).toBe(true);
});

test("gate does not require POM when not requirePageObjects", () => {
  const policy = { ...DEFAULT_PROMOTION_POLICY, requirePageObjects: false };
  const gate = evaluatePromotionGate({
    discoveryResult: makeResult(),
    promotionPolicy: policy,
    missingMethods: ["click: Go"]
  });
  expect(gate.pomStatus).toBeUndefined();
});

test("gate with blockPromotionWhenPageObjectMissing=false still reports but does not block", () => {
  const policy = { ...DEFAULT_PROMOTION_POLICY, blockPromotionWhenPageObjectMissing: false };
  const gate = evaluatePromotionGate({
    discoveryResult: makeResult(),
    promotionPolicy: policy,
    missingPageObjects: ["LoginPage"]
  });
  expect(gate.allowed).toBe(true);
  expect(gate.status).toBe("passed");
});
