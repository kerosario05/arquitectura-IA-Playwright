"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const promotion_gate_1 = require("../src/automations/promotion-gate");
const automation_promotion_types_1 = require("../src/types/automation-promotion.types");
function makePlan() {
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
function makeResult(overrides) {
    const base = {
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
(0, test_1.test)("gate passes when POM policy is present and no missing objects", () => {
    const gate = (0, promotion_gate_1.evaluatePromotionGate)({
        discoveryResult: makeResult(),
        promotionPolicy: automation_promotion_types_1.DEFAULT_PROMOTION_POLICY
    });
    (0, test_1.expect)(gate.allowed).toBe(true);
    (0, test_1.expect)(gate.status).toBe("passed");
});
(0, test_1.test)("gate blocks when missing page objects provided", () => {
    const gate = (0, promotion_gate_1.evaluatePromotionGate)({
        discoveryResult: makeResult(),
        promotionPolicy: automation_promotion_types_1.DEFAULT_PROMOTION_POLICY,
        missingPageObjects: ["LoginPage", "MenuPage"]
    });
    (0, test_1.expect)(gate.allowed).toBe(false);
    (0, test_1.expect)(gate.status).toBe("blocked");
    (0, test_1.expect)(gate.reasons.some((r) => r.includes("missing page object"))).toBe(true);
    (0, test_1.expect)(gate.pomStatus).toBe("needs_page_object");
});
(0, test_1.test)("gate blocks when missing methods provided", () => {
    const gate = (0, promotion_gate_1.evaluatePromotionGate)({
        discoveryResult: makeResult(),
        promotionPolicy: automation_promotion_types_1.DEFAULT_PROMOTION_POLICY,
        missingMethods: ["click: Login button"]
    });
    (0, test_1.expect)(gate.allowed).toBe(false);
    (0, test_1.expect)(gate.status).toBe("blocked");
    (0, test_1.expect)(gate.pomStatus).toBe("needs_page_method");
});
(0, test_1.test)("gate allows when allowInlineFallback and not requirePageObjects", () => {
    const policy = { ...automation_promotion_types_1.DEFAULT_PROMOTION_POLICY, requirePageObjects: false, allowInlineFallback: true };
    const gate = (0, promotion_gate_1.evaluatePromotionGate)({
        discoveryResult: makeResult(),
        promotionPolicy: policy,
        missingMethods: ["click: Go"]
    });
    (0, test_1.expect)(gate.allowed).toBe(true);
});
(0, test_1.test)("gate reports pomStatus page_object_candidate_created", () => {
    const gate = (0, promotion_gate_1.evaluatePromotionGate)({
        discoveryResult: makeResult(),
        promotionPolicy: automation_promotion_types_1.DEFAULT_PROMOTION_POLICY,
        pomStatus: "page_object_candidate_created"
    });
    (0, test_1.expect)(gate.pomStatus).toBe("page_object_candidate_created");
    (0, test_1.expect)(gate.reasons.some((r) => r.includes("candidates"))).toBe(true);
});
(0, test_1.test)("gate reports pomStatus inline_debug_only as warning", () => {
    const gate = (0, promotion_gate_1.evaluatePromotionGate)({
        discoveryResult: makeResult(),
        promotionPolicy: automation_promotion_types_1.DEFAULT_PROMOTION_POLICY,
        pomStatus: "inline_debug_only"
    });
    (0, test_1.expect)(gate.pomStatus).toBe("inline_debug_only");
    (0, test_1.expect)(gate.warnings.some((w) => w.includes("inline-debug"))).toBe(true);
});
(0, test_1.test)("gate blocked by missing pages does not prevent validations", () => {
    const result = makeResult();
    result.status = "repaired_passed";
    const gate = (0, promotion_gate_1.evaluatePromotionGate)({
        discoveryResult: result,
        promotionPolicy: automation_promotion_types_1.DEFAULT_PROMOTION_POLICY,
        missingPageObjects: ["HomePage"]
    });
    (0, test_1.expect)(gate.allowed).toBe(false);
    (0, test_1.expect)(gate.reasons.some((r) => r.includes("missing page object"))).toBe(true);
});
(0, test_1.test)("gate does not require POM when not requirePageObjects", () => {
    const policy = { ...automation_promotion_types_1.DEFAULT_PROMOTION_POLICY, requirePageObjects: false };
    const gate = (0, promotion_gate_1.evaluatePromotionGate)({
        discoveryResult: makeResult(),
        promotionPolicy: policy,
        missingMethods: ["click: Go"]
    });
    (0, test_1.expect)(gate.pomStatus).toBeUndefined();
});
(0, test_1.test)("gate with blockPromotionWhenPageObjectMissing=false still reports but does not block", () => {
    const policy = { ...automation_promotion_types_1.DEFAULT_PROMOTION_POLICY, blockPromotionWhenPageObjectMissing: false };
    const gate = (0, promotion_gate_1.evaluatePromotionGate)({
        discoveryResult: makeResult(),
        promotionPolicy: policy,
        missingPageObjects: ["LoginPage"]
    });
    (0, test_1.expect)(gate.allowed).toBe(true);
    (0, test_1.expect)(gate.status).toBe("passed");
});
