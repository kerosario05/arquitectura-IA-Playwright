import { test, expect } from "@playwright/test";
import {
  associateScenarioRequirements,
  classifyNonAutomatableRequirements,
  classifyScenarioPublicationEligibility,
} from "../src/scenarios/scenario-publication-eligibility";
import type { FunctionalRequirementAccount, McpScenario } from "../src/scenarios/scenario-types";
import { evaluateGenerationSuccess } from "../src/scenarios/scenario-preview.service";

function requirement(requirementId: string, status: FunctionalRequirementAccount["status"]): FunctionalRequirementAccount {
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

function scenario(refs: string[], overrides: Partial<McpScenario> = {}): McpScenario {
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

test("T1/T2/T3 pure nonAutomatable cannot become standard", () => {
  const requirements = [requirement("manual", "nonAutomatable")];
  for (const candidate of [
    scenario(["manual"]),
    scenario(["manual"], { mcpExecutable: true }),
    scenario(["manual"], { semanticValidity: "valid" }),
  ]) {
    const result = classifyScenarioPublicationEligibility(candidate, requirements);
    expect(result.standardExecutable).toBe(false);
    expect(result.launchClassification).toBe("nonAutomatable");
  }
});

test("T4 canonical nonAutomatable wins over legacy textual automatable signal", () => {
  const result = classifyScenarioPublicationEligibility(
    scenario(["manual"], { automationType: "automatable_ui" }),
    [requirement("manual", "nonAutomatable")],
  );
  expect(result.standardExecutable).toBe(false);
});

test("T5 mixed scenario remains executable for its covered requirement", () => {
  const result = classifyScenarioPublicationEligibility(
    scenario(["functional", "contextual"]),
    [requirement("functional", "covered"), requirement("contextual", "nonAutomatable")],
  );
  expect(result.standardExecutable).toBe(true);
  expect(result.hasNonAutomatable).toBe(true);
});

test("T6/T7 accounting state is preserved and not promoted", () => {
  const requirements = [requirement("manual", "nonAutomatable")];
  const states = classifyNonAutomatableRequirements(requirements);
  expect(states.get("manual")).toBe("nonAutomatable");
  expect(requirements[0].status).toBe("nonAutomatable");
  expect(requirements[0].coveredBy).toBeUndefined();
});

test("T8-T10 representation/publication remain separate from launch", () => {
  const result = classifyScenarioPublicationEligibility(scenario(["manual"]), [requirement("manual", "nonAutomatable")]);
  expect(result.functionalRepresentationAllowed).toBe(true);
  expect(result.publishableToTestManagement).toBe(true);
  expect(result.standardExecutable).toBe(false);
  expect(result.publicationClassification).toBe("documentation");
  expect(result.launchClassification).toBe("nonAutomatable");
  expect(evaluateGenerationSuccess(true, {
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

test("T11/T12 normal standard and adaptive authority are preserved", () => {
  expect(classifyScenarioPublicationEligibility(scenario(["functional"], { mcpExecutable: true }), [requirement("functional", "covered")]).launchClassification).toBe("standard");
  expect(classifyScenarioPublicationEligibility(scenario(["functional"], { mcpExecutable: false }), [requirement("functional", "covered")]).launchClassification).toBe("adaptive");
});

test("T13 association uses structured refs, not title or step text", () => {
  const first = associateScenarioRequirements(scenario(["manual"], { title: "unrelated" }), [requirement("manual", "nonAutomatable")]);
  const second = associateScenarioRequirements(scenario(["manual"], { title: "different", steps: ["different text"] }), [requirement("manual", "nonAutomatable")]);
  expect(first.requirementIds).toEqual(["manual"]);
  expect(second.requirementIds).toEqual(first.requirementIds);
  expect(first.hasNonAutomatable).toBe(second.hasNonAutomatable);
});

test("T14 eligibility has no scenario-specific production constants", () => {
  const result = classifyScenarioPublicationEligibility(scenario(["ref"]), [requirement("ref", "covered")]);
  expect(result.standardExecutable).toBe(true);
});
