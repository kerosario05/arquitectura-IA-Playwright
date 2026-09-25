"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const case_discovery_1 = require("../src/discovery/case-discovery");
const spec_execution_contract_1 = require("../src/automations/spec-execution-contract");
function assertion(overrides = {}) {
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
    };
}
function plan() {
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
(0, test_1.test)("T1/T2/T8/T9 canonical required not_found remains required and blocks pass", () => {
    const contract = (0, case_discovery_1.buildDiscoveryAssertionContract)({ steps: [assertion()], earlyCompletionSatisfied: true });
    (0, test_1.expect)(contract.pendingCriticalAssertions).toEqual(["Target A"]);
    const status = (0, case_discovery_1.resolveDiscoveryStatusFromAssertionContract)({
        initialStatus: "discovered_passed",
        unresolvedBlockingFailuresCount: 0,
        pendingDiscoveryCount: 1,
        someFound: true,
        contract,
    });
    (0, test_1.expect)(status.status).toBe("discovered_partial");
    (0, test_1.expect)(status.shouldExecuteFunctionalGate).toBe(false);
});
(0, test_1.test)("T3 noncanonical contextual assertion may remain contextual", () => {
    const step = assertion({ functionalRequired: false, assertionImportance: "contextual" });
    const contract = (0, case_discovery_1.buildDiscoveryAssertionContract)({ steps: [step], earlyCompletionSatisfied: true });
    (0, test_1.expect)(contract.unresolvedContextualAssertions).toEqual(["Target A"]);
});
(0, test_1.test)("T4 different successful target cannot recover Target A", () => {
    const recovered = (0, case_discovery_1.findAssertionRecoveryByLaterSuccess)("Target A", [
        assertion(),
        { index: 2, action: "click", targetText: "Target B", status: "found" },
    ], 1);
    (0, test_1.expect)(recovered).toBeUndefined();
});
(0, test_1.test)("T5 same target success can recover the assertion", () => {
    const recovered = (0, case_discovery_1.findAssertionRecoveryByLaterSuccess)("Target A", [
        assertion(),
        { index: 2, action: "assertVisible", targetText: "Target A", status: "found" },
    ], 1);
    (0, test_1.expect)(recovered).toBe(1);
});
(0, test_1.test)("T6/T7 only an authorized oracle for the same requirement can back it", () => {
    const backed = (0, spec_execution_contract_1.buildSpecExecutionContract)(plan(), {
        ...canonicalScenario,
        observableOracles: [{ id: "oracle-a", requirement: "visibility:target-a", type: "visibility", backed: true, source: "discovery", stepIndex: 1, target: "Target A", evidence: ["observed_assertion_match"] }],
    });
    (0, test_1.expect)(backed.steps[0].required).toBe(true);
    (0, test_1.expect)(backed.steps[0].oracle?.backed).toBe(true);
    const technicalOnly = (0, spec_execution_contract_1.buildSpecExecutionContract)(plan(), {
        ...canonicalScenario,
        observableOracles: [{ id: "nav", requirement: "other", type: "navigation_transition", backed: true, source: "discovery", stepIndex: 1, evidence: ["transition_observed"] }],
    });
    (0, test_1.expect)(technicalOnly.steps[0].required).toBe(true);
    (0, test_1.expect)(technicalOnly.steps[0].executionStatus).toBe("unresolved");
});
(0, test_1.test)("T10 all canonical assertions backed can pass", () => {
    const contract = (0, spec_execution_contract_1.buildSpecExecutionContract)(plan(), {
        ...canonicalScenario,
        observableOracles: [{ id: "oracle-a", requirement: "visibility:target-a", type: "visibility", backed: true, source: "discovery", stepIndex: 1, target: "Target A", evidence: ["observed_assertion_match"] }],
    });
    (0, test_1.expect)((0, spec_execution_contract_1.validateSpecExecutionContract)(contract).valid).toBe(true);
});
(0, test_1.test)("T12/T13 execution contract preserves canonical requiredness and unresolved assertion", () => {
    const contract = (0, spec_execution_contract_1.buildSpecExecutionContract)(plan(), canonicalScenario);
    (0, test_1.expect)(contract.steps[0].required).toBe(true);
    (0, test_1.expect)(contract.steps[0].executionStatus).toBe("unresolved");
    (0, test_1.expect)((0, spec_execution_contract_1.validateSpecExecutionContract)(contract).valid).toBe(false);
});
(0, test_1.test)("T14 authority comes from structured refs, not title or text", () => {
    const contract = (0, spec_execution_contract_1.buildSpecExecutionContract)(plan(), {
        title: "Target A",
        steps: [{ index: 1, action: "assertVisible", description: "Target A", expected: "Target A" }],
    });
    (0, test_1.expect)(contract.steps[0].required).toBe(true);
    (0, test_1.expect)(contract.steps[0].executionStatus).toBe("unresolved");
});
(0, test_1.test)("narrative and semantic destination metadata do not create observable authority", () => {
    (0, test_1.expect)((0, case_discovery_1.hasObservableAssertionAuthority)({ canonicalRequirementRefs: [], assertionDiagnostics: {} })).toBe(false);
    (0, test_1.expect)((0, case_discovery_1.hasObservableAssertionAuthority)({ canonicalRequirementRefs: [{ requirementId: "destination", facet: "destination" }], assertionDiagnostics: {} })).toBe(false);
    (0, test_1.expect)((0, case_discovery_1.hasObservableAssertionAuthority)({ canonicalRequirementRefs: [{ requirementId: "visible", facet: "visibility", claimId: "claim-visible" }], assertionDiagnostics: {} })).toBe(true);
});
(0, test_1.test)("reconciled assertion clears stale failure markers but an unresolved failure remains", () => {
    const markers = { failedAtStep: 5, failedTarget: "narrative destination", failedReason: "assertion_not_found_unrecovered" };
    (0, test_1.expect)((0, case_discovery_1.reconcileFailureMarkers)([
        { index: 5, action: "assert", status: "satisfied_by_previous_assertion", assertionStatus: "satisfied_by_previous_assertion" },
    ], markers)).toEqual({ failedAtStep: undefined, failedTarget: undefined, failedReason: undefined });
    (0, test_1.expect)((0, case_discovery_1.reconcileFailureMarkers)([
        { index: 5, action: "assert", status: "not_found", assertionClassification: "literal_observable", functionalRequired: true },
    ], markers)).toEqual(markers);
});
(0, test_1.test)("T11/T15 negative control keeps functional accounting separate from runtime success", () => {
    const scenario = {
        ...canonicalScenario,
        observableOracles: [{ id: "nav", requirement: "other", type: "navigation_transition", backed: true, source: "discovery", stepIndex: 1, target: "Target C", evidence: ["transition_observed"] }],
    };
    const contract = (0, spec_execution_contract_1.buildSpecExecutionContract)(plan(), scenario);
    (0, test_1.expect)(contract.steps[0].required).toBe(true);
    (0, test_1.expect)(contract.steps[0].oracle?.backed).not.toBe(true);
    (0, test_1.expect)(contract.steps[0].executionStatus).toBe("unresolved");
    (0, test_1.expect)(contract.diagnostics.requiredScenarioSteps).toBe(1);
});
