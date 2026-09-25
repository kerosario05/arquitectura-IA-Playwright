"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_preview_service_1 = require("../src/scenarios/scenario-preview.service");
const scenario_functional_quality_1 = require("../src/scenarios/scenario-functional-quality");
const codex_scenario_generator_1 = require("../src/scenarios/codex-scenario-generator");
const SHARED_OUTCOME_HU = `
Seleccionar alternativas:
- Alpha, Beta, Gamma: Outcome X
- Delta: Outcome Y
`;
function branchesFor(text = SHARED_OUTCOME_HU) {
    const flows = (0, scenario_preview_service_1.extractStructuredOptionFlows)(text);
    return (0, scenario_preview_service_1.extractFunctionalBranchesFromHu)(text, flows.map((flow) => flow.optionLabel), [], flows);
}
test_1.test.describe("canonical branch and claim binding", () => {
    (0, test_1.test)("T1/T2: preserves shared and independent outcomes", () => {
        const branches = branchesFor();
        (0, test_1.expect)(branches.filter((branch) => ["Alpha", "Beta", "Gamma"].includes(branch.sourceLabel ?? "")).map((branch) => branch.expectedDestination)).toEqual(["Outcome X", "Outcome X", "Outcome X"]);
        (0, test_1.expect)(branches.find((branch) => branch.sourceLabel === "Delta")?.expectedDestination).toBe("Outcome Y");
    });
    (0, test_1.test)("T3: does not cross-propagate the shared outcome", () => {
        const branches = branchesFor();
        (0, test_1.expect)(branches.find((branch) => branch.sourceLabel === "Delta")?.expectedDestination).not.toBe("Outcome X");
    });
    (0, test_1.test)("T4: destinations contain outcome only, not selector expressions", () => {
        const branches = branchesFor();
        for (const branch of branches) {
            (0, test_1.expect)(branch.expectedDestination).not.toMatch(/Alpha|Beta|Gamma|Delta/);
        }
    });
    (0, test_1.test)("T5/T6: shared visibility is global while activation and destination stay scoped", () => {
        const branches = branchesFor();
        const requirements = (0, scenario_functional_quality_1.extractRequirements)(SHARED_OUTCOME_HU, branches);
        const visibility = requirements.filter((requirement) => requirement.category === "visibility");
        const branchRequirements = requirements.filter((requirement) => requirement.category === "branch");
        (0, test_1.expect)(visibility.length).toBe(4);
        (0, test_1.expect)(visibility.every((requirement) => requirement.associatedBranchId === undefined)).toBe(true);
        (0, test_1.expect)(branchRequirements.length).toBe(4);
        (0, test_1.expect)(branchRequirements.every((requirement) => Boolean(requirement.associatedBranchId))).toBe(true);
    });
    (0, test_1.test)("T7: canonical lineage produces zero invalid provider claims", () => {
        const branches = branchesFor();
        const claims = (0, scenario_functional_quality_1.buildCanonicalClaims)((0, scenario_functional_quality_1.buildRequirementManifest)(SHARED_OUTCOME_HU, branches));
        const scenarios = branches.map((branch, index) => ({
            scenarioId: `scenario-${index}`,
            steps: [`Clic en "${branch.sourceLabel}".`],
            functionalBranch: branch,
            stepClaims: claims
                .filter((claim) => claim.scope !== "branch" || claim.scopeId === branch.branchId)
                .map((claim) => ({ stepIndex: 0, claimId: claim.claimId })),
        }));
        (0, test_1.expect)((0, codex_scenario_generator_1.evaluateProviderClaimCompliance)(scenarios, claims).invalidClaims).toHaveLength(0);
    });
    (0, test_1.test)("T8: provider-only claims remain invalid", () => {
        const branches = branchesFor();
        const claims = (0, scenario_functional_quality_1.buildCanonicalClaims)((0, scenario_functional_quality_1.buildRequirementManifest)(SHARED_OUTCOME_HU, branches));
        const result = (0, codex_scenario_generator_1.evaluateProviderClaimCompliance)([{
                scenarioId: "provider-only",
                steps: ["Clic en \"Alpha\"."],
                functionalBranch: branches[0],
                stepClaims: [{ stepIndex: 0, claimId: "provider-invented-claim" }],
            }], claims);
        (0, test_1.expect)(result.invalidClaims[0]?.reason).toBe("provider_only_claim");
    });
    (0, test_1.test)("T9: wrong branch claims remain invalid", () => {
        const branches = branchesFor();
        const claims = (0, scenario_functional_quality_1.buildCanonicalClaims)((0, scenario_functional_quality_1.buildRequirementManifest)(SHARED_OUTCOME_HU, branches));
        const deltaActivation = claims.find((claim) => claim.scopeId === branches.find((branch) => branch.sourceLabel === "Delta")?.branchId && claim.facet === "activation");
        (0, test_1.expect)(deltaActivation).toBeDefined();
        const result = (0, codex_scenario_generator_1.evaluateProviderClaimCompliance)([{
                scenarioId: "wrong-branch",
                steps: ["Clic en \"Alpha\"."],
                functionalBranch: branches.find((branch) => branch.sourceLabel === "Alpha"),
                stepClaims: [{ stepIndex: 0, claimId: deltaActivation.claimId }],
            }], claims);
        (0, test_1.expect)(result.invalidClaims[0]?.reason).toBe("branch_scope_mismatch");
    });
    (0, test_1.test)("T10: retains a single functional flow without inventing siblings", () => {
        const flows = (0, scenario_preview_service_1.extractStructuredOptionFlows)("Seleccionar una alternativa:\n- Alpha: Outcome X");
        const branches = (0, scenario_preview_service_1.extractFunctionalBranchesFromHu)("Seleccionar una alternativa:\n- Alpha: Outcome X", flows.map((flow) => flow.optionLabel), [], flows);
        (0, test_1.expect)(flows).toHaveLength(1);
        (0, test_1.expect)(branches).toHaveLength(1);
    });
    (0, test_1.test)("T11: informational lists do not become branches", () => {
        const text = "Elementos informativos:\n- Alpha: descripción\n- Beta: descripción";
        (0, test_1.expect)((0, scenario_preview_service_1.extractStructuredOptionFlows)(text)).toHaveLength(0);
        (0, test_1.expect)((0, scenario_preview_service_1.extractFunctionalBranchesFromHu)(text, [], [], [])).toHaveLength(0);
    });
    (0, test_1.test)("T12: scenario count does not affect claim validity", () => {
        const branches = branchesFor();
        const claims = (0, scenario_functional_quality_1.buildCanonicalClaims)((0, scenario_functional_quality_1.buildRequirementManifest)(SHARED_OUTCOME_HU, branches));
        const claim = claims.find((candidate) => candidate.scope === "branch" && candidate.scopeId === branches[0]?.branchId);
        const scenario = { scenarioId: "count-independent", steps: ["Clic en \"Alpha\"."], functionalBranch: branches[0], stepClaims: [{ stepIndex: 0, claimId: claim.claimId }] };
        (0, test_1.expect)((0, codex_scenario_generator_1.evaluateProviderClaimCompliance)([scenario], claims).invalidClaims).toHaveLength(0);
        (0, test_1.expect)((0, codex_scenario_generator_1.evaluateProviderClaimCompliance)([scenario, scenario, scenario], claims).invalidClaims).toHaveLength(0);
    });
    (0, test_1.test)("branch assignment rejects a branchId with another branch's action", () => {
        const branches = branchesFor();
        const assigned = (0, scenario_preview_service_1.assignFunctionalBranchesToScenarios)([{
                sourceIssueKey: "SYNTHETIC",
                title: "Alpha",
                steps: ["Clic en \"Delta\"."],
                preconditions: [],
                expectedResult: "Outcome Y",
                type: "Functional",
                database: "",
                isConverted: 0,
                automationType: "ui",
                setupStrategy: "none",
                appSlug: "synthetic",
                routeProfile: "none",
                dataRequirements: "",
                nonExecutableCriteria: "",
                mcpExecutable: true,
                functionalBranch: branches[0],
            }], branches);
        (0, test_1.expect)(assigned[0]?.functionalBranch?.branchId).not.toBe(branches[0]?.branchId);
    });
    (0, test_1.test)("branch assignment rejects a valid branchId with another destination", () => {
        const branches = branchesFor();
        const alpha = branches.find((branch) => branch.sourceLabel === "Alpha");
        const assigned = (0, scenario_preview_service_1.assignFunctionalBranchesToScenarios)([{
                sourceIssueKey: "SYNTHETIC",
                title: "Alpha",
                steps: ["Clic en \"Alpha\"."],
                preconditions: [],
                expectedResult: "Outcome Y",
                type: "Functional",
                database: "",
                isConverted: 0,
                automationType: "ui",
                appSlug: "synthetic",
                routeProfile: "none",
                dataRequirements: "",
                nonExecutableCriteria: "",
                mcpExecutable: true,
                functionalBranch: { ...alpha, expectedDestination: "Outcome Y" },
            }], branches);
        (0, test_1.expect)(assigned[0]?.functionalBranch).toBeUndefined();
        (0, test_1.expect)(assigned[0]?.branchAssociation?.reasonCode).toBe("branch_destination_mismatch");
    });
});
