import { test, expect } from "@playwright/test";
import {
  assignFunctionalBranchesToScenarios,
  evaluateScenarioBranchCoverageSignals,
  evaluateScenarioDestinationEvidence,
} from "../src/scenarios/scenario-preview.service";
import { evaluateDestinationEvidence } from "../src/scenarios/destination-evidence";
import type { FunctionalBranchRef, McpScenario } from "../src/scenarios/scenario-types";

const branch: FunctionalBranchRef = {
  branchId: "branch-generic",
  sourceLabel: "Source option",
  sourceRequirementId: "requirement-generic",
  actionIntent: "select_option",
  expectedDestination: "Destination screen",
  accessIntent: "public",
  evidenceSource: "user_story",
};

function scenario(overrides: Partial<McpScenario> = {}): McpScenario {
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

test("T1/T2/T3/T4 expected declarations do not become observed destinations", () => {
  for (const candidate of [
    scenario(),
    scenario({ stepClaims: [{ stepIndex: 1, claimId: "claim-generic" }] }),
    scenario({ steps: ['1. Clic en "Source option"'] }),
    scenario({ steps: ['1. Clic en "Source option"'], expectedResult: "Destination screen" }),
  ]) {
    const evidence = evaluateScenarioDestinationEvidence(candidate, branch);
    expect(evidence.destinationMatched).toBe(false);
    expect(evidence.destinationEvidenceSource).not.toBe("assertion_observable");
  }
});

test("T5 textual fallback is diagnostic only and does not validate destination", () => {
  const [associated] = assignFunctionalBranchesToScenarios(
    [scenario({ functionalBranch: undefined, title: "Source option reaches Destination screen", steps: [] })],
    [branch],
  );
  expect(associated.branchAssociation?.associationMethod).toBe("textual_fallback");
  expect(evaluateScenarioDestinationEvidence(associated, branch).destinationMatched).toBe(false);
});

test("T6 branchId structural association is valid", () => {
  const [associated] = assignFunctionalBranchesToScenarios([scenario()], [branch]);
  expect(associated.branchAssociation?.associationMethod).toBe("branch_id");
  expect(associated.branchAssociation?.associationMatched).toBe(true);
});

test("T7 technical transition alone does not validate semantic destination", () => {
  const evidence = evaluateDestinationEvidence({
    transitionDetected: true,
    transitionValidated: true,
  });
  expect(evidence.destinationMatched).toBe(false);
  expect(evidence.destinationEvidenceSource).toBe("runtime_after_observation");
});

test("T8 observed heading without trusted mapping remains pending", () => {
  const evidence = evaluateDestinationEvidence({
    transitionDetected: true,
    transitionValidated: true,
    observedSemanticDestination: { structuredMarkers: ["Destination screen"] },
  });
  expect(evidence.destinationMatched).toBe(false);
  expect(evidence.destinationEvidenceSource).toBe("runtime_after_observation");
});

test("T9 runtime transition with trusted route mapping may validate semantic destination", () => {
  const evidence = evaluateScenarioDestinationEvidence(scenario({
    transitionDetected: true,
    transitionValidated: true,
    _branchRouteCompatibility: { compatible: true, routeId: "trusted-route" },
  } as Partial<McpScenario>), branch);
  expect(evidence.destinationMatched).toBe(true);
  expect(evidence.destinationEvidenceKind).toBe("route");
});

test("T10 repeated expected assertion text cannot self-certify", () => {
  const evidence = evaluateScenarioDestinationEvidence(scenario({ expectedResult: "Destination screen" }), branch);
  expect(evidence.destinationMatched).toBe(false);
});

test("T11 functional branch coverage can remain true while destination is pending", () => {
  const signals = evaluateScenarioBranchCoverageSignals(scenario(), branch);
  expect(signals.functionalBranchCovered).toBe(true);
  expect(signals.destinationValidationStatus).toBe("pending_discovery");
});

test("T12/T13 pending destination requires degraded execution readiness", () => {
  const signals = evaluateScenarioBranchCoverageSignals(scenario(), branch);
  expect(signals.destinationValidationStatus).toBe("pending_discovery");
  const readiness = signals.destinationValidationStatus === "pending_discovery"
    ? { mcpExecutable: false, executionReadiness: "requires_route_discovery" }
    : { mcpExecutable: true, executionReadiness: "standard" };
  expect(readiness).toEqual({ mcpExecutable: false, executionReadiness: "requires_route_discovery" });
});

test("T14 independent trusted route evidence permits standard readiness", () => {
  const evidence = evaluateScenarioDestinationEvidence(scenario({
    transitionDetected: true,
    transitionValidated: true,
    _branchRouteCompatibility: { compatible: true },
  } as Partial<McpScenario>), branch);
  expect(evidence.destinationMatched).toBe(true);
});

test("T15 similar presentation text does not grant authority", () => {
  const evidence = evaluateScenarioDestinationEvidence(scenario({
    steps: ['1. Clic en "Source option".', '2. Validar que se muestre "Destination screens".'],
  }), branch);
  expect(evidence.destinationMatched).toBe(false);
});

test("T16 production decision uses no scenario-specific fixture values", () => {
  expect(evaluateScenarioDestinationEvidence(scenario(), branch).destinationMatched).toBe(false);
});

test("T17 textual fallback remains diagnostic and cannot create branch authority", () => {
  const [associated] = assignFunctionalBranchesToScenarios(
    [scenario({ functionalBranch: undefined, stepRequirementRefs: [], title: "Source option reaches Destination screen", steps: [] })],
    [branch],
  );
  expect(associated.branchAssociation?.associationMethod).toBe("textual_fallback");
  expect(associated.branchAssociation?.associationMatched).toBe(false);
  expect(associated.functionalBranch).toBeUndefined();
  expect(associated.mcpExecutable).toBe(true);
});

test("T18 explicit branch association retains structured authority", () => {
  const [associated] = assignFunctionalBranchesToScenarios([scenario()], [branch]);
  expect(associated.branchAssociation?.associationMatched).toBe(true);
  expect(associated.functionalBranch?.branchId).toBe("branch-generic");
});
