"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_publication_eligibility_1 = require("../src/scenarios/scenario-publication-eligibility");
const scenario_preview_service_1 = require("../src/scenarios/scenario-preview.service");
function requirement(requirementId, status) {
    return {
        requirementId,
        sourceRequirementId: requirementId,
        sourceIssueKey: "",
        category: "action",
        sourceText: "",
        expectedBehavior: "",
        status,
    };
}
function scenario(refs, overrides = {}) {
    return {
        sourceIssueKey: "",
        title: "",
        steps: ["structured step"],
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
        stepRequirementRefs: refs.map((requirementId, stepIndex) => ({ requirementId, stepIndex })),
        ...overrides,
    };
}
(0, test_1.test)("T1/T2/T3 pure nonAutomatable cannot become standard", () => {
    const requirements = [requirement("manual", "nonAutomatable")];
    for (const candidate of [
        scenario(["manual"]),
        scenario(["manual"], { mcpExecutable: true }),
        scenario(["manual"], { semanticValidity: "valid" }),
    ]) {
        const result = (0, scenario_publication_eligibility_1.classifyScenarioPublicationEligibility)(candidate, requirements);
        (0, test_1.expect)(result.standardExecutable).toBe(false);
        (0, test_1.expect)(result.launchClassification).toBe("nonAutomatable");
    }
});
(0, test_1.test)("T4 canonical nonAutomatable wins over legacy textual automatable signal", () => {
    const result = (0, scenario_publication_eligibility_1.classifyScenarioPublicationEligibility)(scenario(["manual"], { automationType: "automatable_ui" }), [requirement("manual", "nonAutomatable")]);
    (0, test_1.expect)(result.standardExecutable).toBe(false);
});
(0, test_1.test)("T5 mixed scenario remains executable for its covered requirement", () => {
    const result = (0, scenario_publication_eligibility_1.classifyScenarioPublicationEligibility)(scenario(["functional", "contextual"]), [requirement("functional", "covered"), requirement("contextual", "nonAutomatable")]);
    (0, test_1.expect)(result.standardExecutable).toBe(true);
    (0, test_1.expect)(result.hasNonAutomatable).toBe(true);
});
(0, test_1.test)("T6/T7 accounting state is preserved and not promoted", () => {
    const requirements = [requirement("manual", "nonAutomatable")];
    const states = (0, scenario_publication_eligibility_1.classifyNonAutomatableRequirements)(requirements);
    (0, test_1.expect)(states.get("manual")).toBe("nonAutomatable");
    (0, test_1.expect)(requirements[0].status).toBe("nonAutomatable");
    (0, test_1.expect)(requirements[0].coveredBy).toBeUndefined();
});
(0, test_1.test)("T8-T10 representation/publication remain separate from launch", () => {
    const result = (0, scenario_publication_eligibility_1.classifyScenarioPublicationEligibility)(scenario(["manual"]), [requirement("manual", "nonAutomatable")]);
    (0, test_1.expect)(result.functionalRepresentationAllowed).toBe(true);
    (0, test_1.expect)(result.publishableToTestManagement).toBe(true);
    (0, test_1.expect)(result.standardExecutable).toBe(false);
    (0, test_1.expect)(result.publicationClassification).toBe("documentation");
    (0, test_1.expect)(result.launchClassification).toBe("nonAutomatable");
    (0, test_1.expect)((0, scenario_preview_service_1.evaluateGenerationSuccess)(true, {
        required: 0,
        covered: 0,
        missing: [],
        pending: [],
        unexpected: [],
        requiredBranchIds: [],
        coveredBranchIds: [],
        pendingBranchIds: [],
        valid: true,
    }, true).generationSuccess).toBe(true);
});
(0, test_1.test)("T11/T12 normal standard and adaptive authority are preserved", () => {
    (0, test_1.expect)((0, scenario_publication_eligibility_1.classifyScenarioPublicationEligibility)(scenario(["functional"], { mcpExecutable: true }), [requirement("functional", "covered")]).launchClassification).toBe("standard");
    (0, test_1.expect)((0, scenario_publication_eligibility_1.classifyScenarioPublicationEligibility)(scenario(["functional"], { mcpExecutable: false }), [requirement("functional", "covered")]).launchClassification).toBe("adaptive");
});
(0, test_1.test)("T13 association uses structured refs, not title or step text", () => {
    const first = (0, scenario_publication_eligibility_1.associateScenarioRequirements)(scenario(["manual"], { title: "unrelated" }), [requirement("manual", "nonAutomatable")]);
    const second = (0, scenario_publication_eligibility_1.associateScenarioRequirements)(scenario(["manual"], { title: "different", steps: ["different text"] }), [requirement("manual", "nonAutomatable")]);
    (0, test_1.expect)(first.requirementIds).toEqual(["manual"]);
    (0, test_1.expect)(second.requirementIds).toEqual(first.requirementIds);
    (0, test_1.expect)(first.hasNonAutomatable).toBe(second.hasNonAutomatable);
});
(0, test_1.test)("T14 eligibility has no scenario-specific production constants", () => {
    const result = (0, scenario_publication_eligibility_1.classifyScenarioPublicationEligibility)(scenario(["ref"]), [requirement("ref", "covered")]);
    (0, test_1.expect)(result.standardExecutable).toBe(true);
});
