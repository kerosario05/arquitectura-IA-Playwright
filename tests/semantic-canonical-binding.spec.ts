import { test, expect } from "@playwright/test";
import {
  assignFunctionalBranchesToScenarios,
  extractFunctionalBranchesFromHu,
  extractStructuredOptionFlows,
} from "../src/scenarios/scenario-preview.service";
import {
  buildCanonicalClaims,
  buildRequirementManifest,
  extractRequirements,
} from "../src/scenarios/scenario-functional-quality";
import { evaluateProviderClaimCompliance } from "../src/scenarios/codex-scenario-generator";

const SHARED_OUTCOME_HU = `
Seleccionar alternativas:
- Alpha, Beta, Gamma: Outcome X
- Delta: Outcome Y
`;

function branchesFor(text = SHARED_OUTCOME_HU) {
  const flows = extractStructuredOptionFlows(text);
  return extractFunctionalBranchesFromHu(text, flows.map((flow) => flow.optionLabel), [], flows);
}

test.describe("canonical branch and claim binding", () => {
  test("T1/T2: preserves shared and independent outcomes", () => {
    const branches = branchesFor();
    expect(branches.filter((branch) => ["Alpha", "Beta", "Gamma"].includes(branch.sourceLabel ?? "")).map((branch) => branch.expectedDestination)).toEqual(["Outcome X", "Outcome X", "Outcome X"]);
    expect(branches.find((branch) => branch.sourceLabel === "Delta")?.expectedDestination).toBe("Outcome Y");
  });

  test("T3: does not cross-propagate the shared outcome", () => {
    const branches = branchesFor();
    expect(branches.find((branch) => branch.sourceLabel === "Delta")?.expectedDestination).not.toBe("Outcome X");
  });

  test("T4: destinations contain outcome only, not selector expressions", () => {
    const branches = branchesFor();
    for (const branch of branches) {
      expect(branch.expectedDestination).not.toMatch(/Alpha|Beta|Gamma|Delta/);
    }
  });

  test("T5/T6: shared visibility is global while activation and destination stay scoped", () => {
    const branches = branchesFor();
    const requirements = extractRequirements(SHARED_OUTCOME_HU, branches);
    const visibility = requirements.filter((requirement) => requirement.category === "visibility");
    const branchRequirements = requirements.filter((requirement) => requirement.category === "branch");
    expect(visibility.length).toBe(4);
    expect(visibility.every((requirement) => requirement.associatedBranchId === undefined)).toBe(true);
    expect(branchRequirements.length).toBe(4);
    expect(branchRequirements.every((requirement) => Boolean(requirement.associatedBranchId))).toBe(true);
  });

  test("T7: canonical lineage produces zero invalid provider claims", () => {
    const branches = branchesFor();
    const claims = buildCanonicalClaims(buildRequirementManifest(SHARED_OUTCOME_HU, branches));
    const scenarios = branches.map((branch, index) => ({
      scenarioId: `scenario-${index}`,
      steps: [`Clic en "${branch.sourceLabel}".`],
      functionalBranch: branch,
      stepClaims: claims
        .filter((claim) => claim.scope !== "branch" || claim.scopeId === branch.branchId)
        .map((claim) => ({ stepIndex: 0, claimId: claim.claimId })),
    }));
    expect(evaluateProviderClaimCompliance(scenarios, claims).invalidClaims).toHaveLength(0);
  });

  test("T8: provider-only claims remain invalid", () => {
    const branches = branchesFor();
    const claims = buildCanonicalClaims(buildRequirementManifest(SHARED_OUTCOME_HU, branches));
    const result = evaluateProviderClaimCompliance([{
      scenarioId: "provider-only",
      steps: ["Clic en \"Alpha\"."],
      functionalBranch: branches[0],
      stepClaims: [{ stepIndex: 0, claimId: "provider-invented-claim" }],
    }], claims);
    expect(result.invalidClaims[0]?.reason).toBe("provider_only_claim");
  });

  test("T9: wrong branch claims remain invalid", () => {
    const branches = branchesFor();
    const claims = buildCanonicalClaims(buildRequirementManifest(SHARED_OUTCOME_HU, branches));
    const deltaActivation = claims.find((claim) => claim.scopeId === branches.find((branch) => branch.sourceLabel === "Delta")?.branchId && claim.facet === "activation");
    expect(deltaActivation).toBeDefined();
    const result = evaluateProviderClaimCompliance([{
      scenarioId: "wrong-branch",
      steps: ["Clic en \"Alpha\"."],
      functionalBranch: branches.find((branch) => branch.sourceLabel === "Alpha"),
      stepClaims: [{ stepIndex: 0, claimId: deltaActivation!.claimId }],
    }], claims);
    expect(result.invalidClaims[0]?.reason).toBe("branch_scope_mismatch");
  });

  test("T10: retains a single functional flow without inventing siblings", () => {
    const flows = extractStructuredOptionFlows("Seleccionar una alternativa:\n- Alpha: Outcome X");
    const branches = extractFunctionalBranchesFromHu("Seleccionar una alternativa:\n- Alpha: Outcome X", flows.map((flow) => flow.optionLabel), [], flows);
    expect(flows).toHaveLength(1);
    expect(branches).toHaveLength(1);
  });

  test("T11: informational lists do not become branches", () => {
    const text = "Elementos informativos:\n- Alpha: descripción\n- Beta: descripción";
    expect(extractStructuredOptionFlows(text)).toHaveLength(0);
    expect(extractFunctionalBranchesFromHu(text, [], [], [])).toHaveLength(0);
  });

  test("T12: scenario count does not affect claim validity", () => {
    const branches = branchesFor();
    const claims = buildCanonicalClaims(buildRequirementManifest(SHARED_OUTCOME_HU, branches));
    const claim = claims.find((candidate) => candidate.scope === "branch" && candidate.scopeId === branches[0]?.branchId)!;
    const scenario = { scenarioId: "count-independent", steps: ["Clic en \"Alpha\"."], functionalBranch: branches[0], stepClaims: [{ stepIndex: 0, claimId: claim.claimId }] };
    expect(evaluateProviderClaimCompliance([scenario], claims).invalidClaims).toHaveLength(0);
    expect(evaluateProviderClaimCompliance([scenario, scenario, scenario], claims).invalidClaims).toHaveLength(0);
  });

  test("branch assignment rejects a branchId with another branch's action", () => {
    const branches = branchesFor();
    const assigned = assignFunctionalBranchesToScenarios([{
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
    expect(assigned[0]?.functionalBranch?.branchId).not.toBe(branches[0]?.branchId);
  });

  test("branch assignment rejects a valid branchId with another destination", () => {
    const branches = branchesFor();
    const alpha = branches.find((branch) => branch.sourceLabel === "Alpha")!;
    const assigned = assignFunctionalBranchesToScenarios([{
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
    expect(assigned[0]?.functionalBranch).toBeUndefined();
    expect(assigned[0]?.branchAssociation?.reasonCode).toBe("branch_destination_mismatch");
  });
});
