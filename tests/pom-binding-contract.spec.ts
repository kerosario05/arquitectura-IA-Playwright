import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateSpecExecutionContract, type SpecExecutionContract } from "../src/automations/spec-execution-contract";

function contractWithImplementation(implementation: NonNullable<SpecExecutionContract["steps"][number]["implementation"]>): SpecExecutionContract {
  return {
    version: "1.0",
    scenarioId: "POM-BINDING",
    title: "POM binding",
    steps: [{
      contractStepIndex: 0,
      scenarioStepIndex: 0,
      originalText: "start session",
      operation: "click",
      executionStatus: "executed",
      implementation,
      evidenceRefs: []
    }],
    unresolvedRequiredOracles: [],
    diagnostics: {
      requiredScenarioSteps: 1,
      representedScenarioSteps: 1,
      missingScenarioSteps: []
    }
  };
}

describe("POM binding contract", () => {
  it("rejects a zero-argument method represented with an argument", () => {
    const result = validateSpecExecutionContract(contractWithImplementation({
      kind: "page_object",
      owner: "HomePage",
      method: "start",
      argument: "Start",
      expectedArgs: 0,
      semanticActionIdentity: "start_session"
    }));

    assert.ok(result.errors.includes(
      "page_object_method_signature_mismatch:HomePage.start:expectedArgs=0:actualArgs=1"
    ));
  });

  it("rejects a page-object binding without semantic identity", () => {
    const result = validateSpecExecutionContract(contractWithImplementation({
      kind: "page_object",
      owner: "HomePage",
      method: "start",
      expectedArgs: 0
    }));

    assert.ok(result.errors.includes("page_object_method_semantic_mismatch:step=0:missing_action_identity"));
  });
});
