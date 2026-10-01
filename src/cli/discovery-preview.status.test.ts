import assert from "node:assert";
import { resolvePreviewCompletion, virtualCaseToTestScenario } from "./discovery-preview";

function test(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

test("keeps valid discovered_partial as a successful event", () => {
  const result = resolvePreviewCompletion({
    caseResult: {
      status: "discovered_partial",
      steps: [{ status: "found" }, { status: "skipped" }],
    },
    promotionStatus: "pending",
  }, true);

  assert.strictEqual(result.eventStatus, "passed");
});

test("keeps failed for a real partial step error", () => {
  const result = resolvePreviewCompletion({
    caseResult: {
      status: "discovered_partial",
      steps: [{ status: "found" }, { status: "failed", error: "target not found" }],
      failedAtStep: 1,
      failedReason: "target not found",
    },
    promotionStatus: "pending",
  }, true);

  assert.strictEqual(result.eventStatus, "failed");
});

test("keeps authored recording steps as the executable sequence while retaining the contract", () => {
  const authoredSteps = ["Abrir la aplicación configurada", 'Seleccionar "DOP" en "Moneda"'];
  const scenario = virtualCaseToTestScenario({
    id: "preview-1",
    displayId: "PREVIEW-1",
    title: "recording replay",
    sourceIssueKey: "recording",
    steps: authoredSteps,
    expectedResult: "",
    preconditions: [],
    appSlug: "sample-app",
    routeProfile: "",
    dataRequirements: "",
    mcpExecutable: true,
    source: "scenario_preview",
    type: "Functional",
    automationType: "recorded_session",
    setupStrategy: "recorded_walkthrough",
    recordingExecutionContract: {
      actions: Array.from({ length: 5 }, (_, index) => ({
        actionType: "click",
        interactionId: `interaction-${index + 1}`,
        humanStep: `low-level event ${index + 1}`,
        stepIndex: index + 1,
      })),
      runtimeInputRequirements: [],
    },
  } as any);

  assert.deepEqual(scenario.steps.map((step) => step.action), authoredSteps);
  assert.equal(scenario.steps.length, authoredSteps.length);
  assert.equal(scenario.recordingExecutionContract?.actions.length, 5);
});

test("does not reintroduce a recorded dialog-container tap into promoted scenario steps", () => {
  const scenario = virtualCaseToTestScenario({
    id: "preview-dialog-container",
    displayId: "PREVIEW-DIALOG-CONTAINER",
    title: "recorded dialog action",
    sourceIssueKey: "recording",
    steps: ['Presionar "Review dialog"', 'Presionar "Continue"'],
    expectedResult: "",
    preconditions: [],
    appSlug: "sample-app",
    routeProfile: "",
    dataRequirements: "",
    mcpExecutable: true,
    source: "scenario_preview",
    type: "Functional",
    automationType: "recorded_session",
    setupStrategy: "recorded_walkthrough",
    recordingExecutionContract: {
      actions: [
        {
          actionType: "click",
          interactionId: "interaction-dialog",
          humanStep: 'Presionar "Review dialog"',
          stepIndex: 1,
          technicalTargetRef: "role:dialog|Review dialog",
        },
        {
          actionType: "click",
          interactionId: "interaction-control",
          humanStep: 'Presionar "Continue"',
          stepIndex: 2,
          technicalTargetRef: "role:button|Continue",
        },
      ],
      runtimeInputRequirements: [],
    },
  } as any);

  assert.deepEqual(scenario.steps.map((step) => step.action), ['Presionar "Continue"']);
  assert.equal(scenario.recordingExecutionContract?.actions.length, 2, "the source contract remains available as provenance");
});

test("restores matching recorded technical identity without changing authored step order", () => {
  const scenario = virtualCaseToTestScenario({
    id: "preview-recorded-target",
    displayId: "PREVIEW-RECORDED-TARGET",
    title: "recorded target transport",
    sourceIssueKey: "recording",
    steps: ["Abrir la aplicación configurada", 'Presionar "4"'],
    expectedResult: "",
    preconditions: [],
    appSlug: "sample-app",
    routeProfile: "",
    dataRequirements: "",
    mcpExecutable: true,
    source: "scenario_preview",
    type: "Functional",
    automationType: "recorded_session",
    setupStrategy: "recorded_walkthrough",
    recordingExecutionContract: {
      actions: [{
        actionType: "click",
        interactionId: "interaction-digit",
        humanStep: 'Presionar "4"',
        stepIndex: 1,
        technicalTargetRef: "role:button|4",
        technicalTargetRefs: ["role:button|4"],
        controlIdentity: "screen|digit-four",
      }],
      runtimeInputRequirements: [],
    },
  } as any);

  assert.deepEqual(scenario.steps.map((step) => step.action), ["Abrir la aplicación configurada", 'Presionar "4"']);
  assert.equal(scenario.steps[0].technicalTargetRef, undefined, "the generic setup row has no recording authority");
  assert.equal(scenario.steps[1].technicalTargetRef, "role:button|4");
  assert.deepEqual(scenario.steps[1].technicalTargetRefs, ["role:button|4"]);
  assert.equal(scenario.steps[1].controlIdentity, "screen|digit-four");
});

test("does not attach recording identity when repeated semantic labels have conflicting targets", () => {
  const scenario = virtualCaseToTestScenario({
    id: "preview-ambiguous-recorded-target",
    displayId: "PREVIEW-AMBIGUOUS-RECORDED-TARGET",
    title: "ambiguous recorded target transport",
    sourceIssueKey: "recording",
    steps: ['Presionar "Continuar"'],
    expectedResult: "",
    preconditions: [],
    appSlug: "sample-app",
    routeProfile: "",
    dataRequirements: "",
    mcpExecutable: true,
    source: "scenario_preview",
    type: "Functional",
    automationType: "recorded_session",
    setupStrategy: "recorded_walkthrough",
    recordingExecutionContract: {
      actions: [
        { actionType: "click", humanStep: 'Presionar "Continuar"', stepIndex: 1, technicalTargetRef: "role:button|Continuar" },
        { actionType: "click", humanStep: 'Presionar "Continuar"', stepIndex: 2, technicalTargetRef: "role:link|Continuar" },
      ],
      runtimeInputRequirements: [],
    },
  } as any);

  assert.equal(scenario.steps[0].technicalTargetRef, undefined);
  assert.equal(scenario.steps[0].technicalTargetRefs, undefined);
});
