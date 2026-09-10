import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_SCENARIO_SCHEMA_VERSION,
  type CanonicalScenario,
} from "./canonical-scenario";

const shared = {
  title: "Complete account recovery",
  preconditions: ["The account exists"],
  steps: [{
    order: 1,
    action: "Start account recovery",
    expected: "Recovery form is displayed",
    requirementRefs: ["req-recovery"],
    origin: { originRef: "step-1", sourcePath: "steps[0]" },
  }],
  expectedResults: ["The account recovery flow is available"],
  requirements: [{
    requirementId: "req-recovery",
    kind: "action",
    description: "The user can start account recovery",
    origin: { originRef: "requirement-1" },
    coverability: "coverable" as const,
  }],
  branches: [{
    branchId: "branch-main",
    requirementRefs: ["req-recovery"],
    conditions: ["The account exists"],
    destinationIntent: "Recovery form",
  }],
};

function scenario(sourceRef: CanonicalScenario["sourceRef"], originRef: string): CanonicalScenario {
  return {
    canonicalSchemaVersion: CANONICAL_SCENARIO_SCHEMA_VERSION,
    scenarioId: "scenario-recovery",
    ...shared,
    sourceRef,
    provenance: {
      sourceRef,
      adapterOrGenerator: originRef,
      canonicalizationMode: "deterministic_normalized",
      originRefs: [originRef],
      canonicalSchemaVersion: CANONICAL_SCENARIO_SCHEMA_VERSION,
    },
  };
}

test("TestRail and Jira use the same functional CanonicalScenario shape", () => {
  const testrail = scenario({ kind: "testrail", caseId: 101, sectionId: 7, suiteId: 3, projectId: 5 }, "testrail-adapter");
  const jira = scenario({ kind: "jira", issueKey: "QA-101", sprintId: 8, projectKey: "QA" }, "jira-generator");

  assert.deepEqual({ ...testrail, sourceRef: undefined, provenance: undefined }, { ...jira, sourceRef: undefined, provenance: undefined });
  assert.equal(testrail.sourceRef.kind, "testrail");
  assert.equal(jira.sourceRef.kind, "jira");
  assert.equal(testrail.provenance.sourceRef, testrail.sourceRef);
  assert.equal(jira.provenance.sourceRef, jira.sourceRef);
});

test("execution and local input bindings are outside the canonical functional contract", () => {
  const canonical = scenario({ kind: "testrail", caseId: 102 }, "testrail-adapter");
  const forbidden = canonical as unknown as Record<string, unknown>;

  assert.equal("source" in forbidden, false);
  assert.equal("sourceId" in forbidden, false);
  assert.equal("inputRequirements" in forbidden, false);
  assert.equal("executionReadiness" in forbidden, false);
  assert.equal("requirementAccounting" in forbidden, false);
  assert.equal("mcpExecutable" in forbidden, false);
  assert.equal("namedProfileRef" in canonical.requirements[0], false);
  assert.equal("routeAuthority" in canonical.branches![0], false);
  assert.equal(CANONICAL_SCENARIO_SCHEMA_VERSION, "canonical-scenario-1");
});
