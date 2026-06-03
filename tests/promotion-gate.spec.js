"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const promotion_gate_1 = require("../src/automations/promotion-gate");
function makePlan(status = "validated") {
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
function makeResult(status, failedReason) {
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
(0, test_1.test)("discovered_passed + validated + clean steps => allowed true", () => {
    const gate = (0, promotion_gate_1.evaluatePromotionGate)({ discoveryResult: makeResult("discovered_passed") });
    (0, test_1.expect)(gate.allowed).toBe(true);
    (0, test_1.expect)(gate.status).toBe("passed");
});
(0, test_1.test)("discovered_partial => not_applicable", () => {
    const gate = (0, promotion_gate_1.evaluatePromotionGate)({ discoveryResult: makeResult("discovered_partial") });
    (0, test_1.expect)(gate.allowed).toBe(false);
    (0, test_1.expect)(gate.status).toBe("not_applicable");
});
(0, test_1.test)("exploration_failed => not_applicable", () => {
    const gate = (0, promotion_gate_1.evaluatePromotionGate)({ discoveryResult: makeResult("exploration_failed") });
    (0, test_1.expect)(gate.allowed).toBe(false);
    (0, test_1.expect)(gate.status).toBe("not_applicable");
});
(0, test_1.test)("candidatePlan needs_discovery => blocked", () => {
    const result = makeResult("discovered_passed");
    result.candidatePlan = makePlan("needs_discovery");
    const gate = (0, promotion_gate_1.evaluatePromotionGate)({ discoveryResult: result });
    (0, test_1.expect)(gate.allowed).toBe(false);
});
(0, test_1.test)("candidatePlan needs_data => blocked", () => {
    const result = makeResult("discovered_passed");
    result.candidatePlan = makePlan("needs_data");
    const gate = (0, promotion_gate_1.evaluatePromotionGate)({ discoveryResult: result });
    (0, test_1.expect)(gate.allowed).toBe(false);
});
(0, test_1.test)("failedReason target_not_found => blocked", () => {
    const gate = (0, promotion_gate_1.evaluatePromotionGate)({ discoveryResult: makeFailureResult("target_not_found") });
    (0, test_1.expect)(gate.allowed).toBe(false);
});
(0, test_1.test)("failedReason ambiguous_target => blocked", () => {
    const gate = (0, promotion_gate_1.evaluatePromotionGate)({ discoveryResult: makeFailureResult("ambiguous_target") });
    (0, test_1.expect)(gate.allowed).toBe(false);
});
(0, test_1.test)("failedReason locator_resolution_failed => blocked", () => {
    const gate = (0, promotion_gate_1.evaluatePromotionGate)({ discoveryResult: makeFailureResult("locator_resolution_failed") });
    (0, test_1.expect)(gate.allowed).toBe(false);
});
(0, test_1.test)("failedReason fill_target_not_editable => blocked", () => {
    const gate = (0, promotion_gate_1.evaluatePromotionGate)({ discoveryResult: makeFailureResult("fill_target_not_editable") });
    (0, test_1.expect)(gate.allowed).toBe(false);
});
(0, test_1.test)("failedReason needs_assertion_resolution => blocked", () => {
    const gate = (0, promotion_gate_1.evaluatePromotionGate)({ discoveryResult: makeFailureResult("needs_assertion_resolution") });
    (0, test_1.expect)(gate.allowed).toBe(false);
});
(0, test_1.test)("requiredData unresolved => blocked", () => {
    const result = makeResult("discovered_passed");
    result.candidatePlan = {
        ...makePlan("validated"),
        requiredData: [{ key: "account", required: true, resolved: false }]
    };
    const gate = (0, promotion_gate_1.evaluatePromotionGate)({ discoveryResult: result });
    (0, test_1.expect)(gate.allowed).toBe(false);
});
(0, test_1.test)("optional_assertion skipped does not block", () => {
    const result = makeResult("discovered_passed");
    result.steps.push({ index: 2, action: "Optional assertion", status: "skipped_semantic_descriptor" });
    const gate = (0, promotion_gate_1.evaluatePromotionGate)({ discoveryResult: result });
    (0, test_1.expect)(gate.allowed).toBe(true);
});
(0, test_1.test)("semantic_descriptor satisfied_by_children does not block", () => {
    const result = makeResult("discovered_passed");
    result.steps.push({ index: 2, action: "Semantic", status: "satisfied_by_children" });
    const gate = (0, promotion_gate_1.evaluatePromotionGate)({ discoveryResult: result });
    (0, test_1.expect)(gate.allowed).toBe(true);
});
(0, test_1.test)("optional_action executed as required => blocked", () => {
    const result = makeResult("discovered_passed");
    result.steps.push({ index: 2, action: "Optional action unresolved", status: "not_found" });
    const gate = (0, promotion_gate_1.evaluatePromotionGate)({ discoveryResult: result });
    (0, test_1.expect)(gate.allowed).toBe(false);
});
(0, test_1.test)("sensitive action metadata requiresApproval => blocked", () => {
    const result = makeResult("discovered_passed");
    result.candidatePlan = {
        ...makePlan("validated"),
        steps: [{ index: 1, action: "click", requiresApproval: true }]
    };
    const gate = (0, promotion_gate_1.evaluatePromotionGate)({ discoveryResult: result });
    (0, test_1.expect)(gate.allowed).toBe(false);
});
(0, test_1.test)("gate returns clear reasons", () => {
    const gate = (0, promotion_gate_1.evaluatePromotionGate)({ discoveryResult: makeFailureResult("target_not_found") });
    (0, test_1.expect)(gate.reasons.length).toBeGreaterThan(0);
});
function makeFailureResult(failedReason, steps = [{ index: 1, action: "Click", status: "not_found" }]) {
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
(0, test_1.test)("not_found step without recoveryStatus is blocking", () => {
    const gate = (0, promotion_gate_1.evaluatePromotionGate)({ discoveryResult: makeFailureResult("target_not_found") });
    (0, test_1.expect)(gate.allowed).toBe(false);
    (0, test_1.expect)(gate.status).toBe("blocked");
});
(0, test_1.test)("not_found step with recoveryStatus recovered is NOT blocking", () => {
    const steps = [{ index: 1, action: "Click", status: "not_found", recoveryStatus: "recovered" }];
    const gate = (0, promotion_gate_1.evaluatePromotionGate)({ discoveryResult: makeFailureResult("target_not_found", steps) });
    (0, test_1.expect)(gate.allowed).toBe(true);
    (0, test_1.expect)(gate.status).toBe("passed");
});
(0, test_1.test)("not_found step with recoveryStatus repaired is NOT blocking", () => {
    const steps = [{ index: 1, action: "Click", status: "not_found", recoveryStatus: "repaired" }];
    const gate = (0, promotion_gate_1.evaluatePromotionGate)({ discoveryResult: makeFailureResult("target_not_found", steps) });
    (0, test_1.expect)(gate.allowed).toBe(true);
    (0, test_1.expect)(gate.status).toBe("passed");
});
(0, test_1.test)("repaired_passed status with all recovered steps passes", () => {
    const result = makeFailureResult("target_not_found");
    result.status = "repaired_passed";
    result.steps[0].recoveryStatus = "recovered";
    const gate = (0, promotion_gate_1.evaluatePromotionGate)({ discoveryResult: result });
    (0, test_1.expect)(gate.allowed).toBe(true);
    (0, test_1.expect)(gate.status).toBe("passed");
});
(0, test_1.test)("mixed: recovered step + not_found step => blocked when unresolved", () => {
    const steps = [
        { index: 1, action: "Click", status: "not_found", recoveryStatus: "recovered" },
        { index: 2, action: "Type", status: "not_found" }
    ];
    const gate = (0, promotion_gate_1.evaluatePromotionGate)({ discoveryResult: makeFailureResult("target_not_found", steps) });
    (0, test_1.expect)(gate.allowed).toBe(false);
    (0, test_1.expect)(gate.status).toBe("blocked");
});
