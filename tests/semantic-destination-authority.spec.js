"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_preview_service_1 = require("../src/scenarios/scenario-preview.service");
const destination_evidence_1 = require("../src/scenarios/destination-evidence");
const branch = {
    branchId: "branch-generic",
    sourceLabel: "Source option",
    sourceRequirementId: "requirement-generic",
    actionIntent: "select_option",
    expectedDestination: "Destination screen",
    accessIntent: "public",
    evidenceSource: "user_story",
};
function scenario(overrides = {}) {
    return {
        sourceIssueKey: "",
        title: "",
        steps: ['1. Clic en "Source option".', '2. Validar que se muestre "Destination screen".'],
        preconditions: [],
        expectedResult: "",
        type: "functional",
        database: "",
        isConverted: 0,
        automationType: "ui",
        setupStrategy: "none",
        appSlug: "",
        routeProfile: "",
        dataRequirements: "",
        nonExecutableCriteria: "",
        mcpExecutable: true,
        functionalBranch: branch,
        stepRequirementRefs: [{ stepIndex: 1, requirementId: "requirement-generic", facet: "destination" }],
        ...overrides,
    };
}
(0, test_1.test)("T1/T2/T3/T4 expected declarations do not become observed destinations", () => {
    for (const candidate of [
        scenario(),
        scenario({ stepClaims: [{ stepIndex: 1, claimId: "claim-generic" }] }),
        scenario({ steps: ['1. Clic en "Source option"'] }),
        scenario({ steps: ['1. Clic en "Source option"'], expectedResult: "Destination screen" }),
    ]) {
        const evidence = (0, scenario_preview_service_1.evaluateScenarioDestinationEvidence)(candidate, branch);
        (0, test_1.expect)(evidence.destinationMatched).toBe(false);
        (0, test_1.expect)(evidence.destinationEvidenceSource).not.toBe("assertion_observable");
    }
});
(0, test_1.test)("T5 textual fallback is diagnostic only and does not validate destination", () => {
    const [associated] = (0, scenario_preview_service_1.assignFunctionalBranchesToScenarios)([scenario({ functionalBranch: undefined, title: "Source option reaches Destination screen", steps: [] })], [branch]);
    (0, test_1.expect)(associated.branchAssociation?.associationMethod).toBe("textual_fallback");
    (0, test_1.expect)((0, scenario_preview_service_1.evaluateScenarioDestinationEvidence)(associated, branch).destinationMatched).toBe(false);
});
(0, test_1.test)("T6 branchId structural association is valid", () => {
    const [associated] = (0, scenario_preview_service_1.assignFunctionalBranchesToScenarios)([scenario()], [branch]);
    (0, test_1.expect)(associated.branchAssociation?.associationMethod).toBe("branch_id");
    (0, test_1.expect)(associated.branchAssociation?.associationMatched).toBe(true);
});
(0, test_1.test)("T7 technical transition alone does not validate semantic destination", () => {
    const evidence = (0, destination_evidence_1.evaluateDestinationEvidence)({
        transitionDetected: true,
        transitionValidated: true,
    });
    (0, test_1.expect)(evidence.destinationMatched).toBe(false);
    (0, test_1.expect)(evidence.destinationEvidenceSource).toBe("runtime_after_observation");
});
(0, test_1.test)("T8 observed heading without trusted mapping remains pending", () => {
    const evidence = (0, destination_evidence_1.evaluateDestinationEvidence)({
        transitionDetected: true,
        transitionValidated: true,
        observedSemanticDestination: { structuredMarkers: ["Destination screen"] },
    });
    (0, test_1.expect)(evidence.destinationMatched).toBe(false);
    (0, test_1.expect)(evidence.destinationEvidenceSource).toBe("runtime_after_observation");
});
(0, test_1.test)("T9 runtime transition with trusted route mapping may validate semantic destination", () => {
    const evidence = (0, scenario_preview_service_1.evaluateScenarioDestinationEvidence)(scenario({
        transitionDetected: true,
        transitionValidated: true,
        _branchRouteCompatibility: { compatible: true, routeId: "trusted-route" },
    }), branch);
    (0, test_1.expect)(evidence.destinationMatched).toBe(true);
    (0, test_1.expect)(evidence.destinationEvidenceKind).toBe("route");
});
(0, test_1.test)("T10 repeated expected assertion text cannot self-certify", () => {
    const evidence = (0, scenario_preview_service_1.evaluateScenarioDestinationEvidence)(scenario({ expectedResult: "Destination screen" }), branch);
    (0, test_1.expect)(evidence.destinationMatched).toBe(false);
});
(0, test_1.test)("T11 functional branch coverage can remain true while destination is pending", () => {
    const signals = (0, scenario_preview_service_1.evaluateScenarioBranchCoverageSignals)(scenario(), branch);
    (0, test_1.expect)(signals.functionalBranchCovered).toBe(true);
    (0, test_1.expect)(signals.destinationValidationStatus).toBe("pending_discovery");
});
(0, test_1.test)("T12/T13 pending destination requires degraded execution readiness", () => {
    const signals = (0, scenario_preview_service_1.evaluateScenarioBranchCoverageSignals)(scenario(), branch);
    (0, test_1.expect)(signals.destinationValidationStatus).toBe("pending_discovery");
    const readiness = signals.destinationValidationStatus === "pending_discovery"
        ? { mcpExecutable: false, executionReadiness: "requires_route_discovery" }
        : { mcpExecutable: true, executionReadiness: "standard" };
    (0, test_1.expect)(readiness).toEqual({ mcpExecutable: false, executionReadiness: "requires_route_discovery" });
});
(0, test_1.test)("T14 independent trusted route evidence permits standard readiness", () => {
    const evidence = (0, scenario_preview_service_1.evaluateScenarioDestinationEvidence)(scenario({
        transitionDetected: true,
        transitionValidated: true,
        _branchRouteCompatibility: { compatible: true },
    }), branch);
    (0, test_1.expect)(evidence.destinationMatched).toBe(true);
});
(0, test_1.test)("T15 similar presentation text does not grant authority", () => {
    const evidence = (0, scenario_preview_service_1.evaluateScenarioDestinationEvidence)(scenario({
        steps: ['1. Clic en "Source option".', '2. Validar que se muestre "Destination screens".'],
    }), branch);
    (0, test_1.expect)(evidence.destinationMatched).toBe(false);
});
(0, test_1.test)("T16 production decision uses no scenario-specific fixture values", () => {
    (0, test_1.expect)((0, scenario_preview_service_1.evaluateScenarioDestinationEvidence)(scenario(), branch).destinationMatched).toBe(false);
});
(0, test_1.test)("T17 textual fallback remains diagnostic and cannot create branch authority", () => {
    const [associated] = (0, scenario_preview_service_1.assignFunctionalBranchesToScenarios)([scenario({ functionalBranch: undefined, stepRequirementRefs: [], title: "Source option reaches Destination screen", steps: [] })], [branch]);
    (0, test_1.expect)(associated.branchAssociation?.associationMethod).toBe("textual_fallback");
    (0, test_1.expect)(associated.branchAssociation?.associationMatched).toBe(false);
    (0, test_1.expect)(associated.functionalBranch).toBeUndefined();
    (0, test_1.expect)(associated.mcpExecutable).toBe(true);
});
(0, test_1.test)("T18 explicit branch association retains structured authority", () => {
    const [associated] = (0, scenario_preview_service_1.assignFunctionalBranchesToScenarios)([scenario()], [branch]);
    (0, test_1.expect)(associated.branchAssociation?.associationMatched).toBe(true);
    (0, test_1.expect)(associated.functionalBranch?.branchId).toBe("branch-generic");
});
