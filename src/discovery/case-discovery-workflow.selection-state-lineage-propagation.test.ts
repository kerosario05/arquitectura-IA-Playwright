import assert from "node:assert/strict";
import test from "node:test";
import { buildPromotionSourceScenario } from "./case-discovery-workflow";
import { buildSpecExecutionContract } from "../automations/spec-execution-contract";
import { compileDeterministicSpec } from "../automations/spec-compiler/deterministic-spec-compiler";
import type { CaseDiscoveryResult } from "../types/discovery.types";
import type { TestScenario, TestScenarioStep } from "../types/testrail.types";
import path from "node:path";

/**
 * FIRST_LOSS (jobId 9523b444-3109-464a-a9c2-09264a1ed898): Discovery physically resolves a
 * selection-like click and emits `target_selection_state_changed`; the deterministic compiler
 * already knows how to turn that into `expectedEffect: 'selection_state_change'`
 * (`isSelectionLikeRecordedRole` + `hasUniqueControlLineage`, see
 * `deterministic-spec-compiler.selection-state-transport.test.ts`) -- but that logic depends on
 * `SpecExecutionContractStep.controlIdentity`/`recordingActionType`, and
 * `buildSpecExecutionContract` only ever transports those verbatim from whatever
 * `buildPromotionSourceScenario` (case-discovery-workflow.ts) already put on its OWN rebuilt step
 * objects. Both of that function's step-rebuilding blocks copied `technicalTargetRef`/
 * `technicalTargetRefs`/`associatedField` from the source `TestScenarioStep` but never
 * `controlIdentity`/`recordingActionType`, even though `TestScenarioStep` (testrail.types.ts)
 * already declares both. The candidate spec always fell back to `expectedEffect: 'ui_change'`.
 *
 * These tests chain the REAL pipeline functions (buildPromotionSourceScenario ->
 * buildSpecExecutionContract -> compileDeterministicSpec) with synthetic, hermetic fixtures --
 * mirroring case-discovery-workflow.technical-target-propagation.test.ts's own convention, never
 * relying on any real Kiosko/portal-comercial artifact or hardcoded field text.
 */

const TARGET_SPEC_PATH = path.resolve(
  process.cwd(),
  "automations/apps/synthetic-app/sections/synthetic-section/cases/synthetic-case/case.spec.ts",
);

function buildCaseResult(overrides: Partial<CaseDiscoveryResult> = {}): CaseDiscoveryResult {
  return {
    version: "1.0",
    caseId: 0,
    caseTitle: "Synthetic selection scenario",
    discoveredAt: new Date().toISOString(),
    status: "discovered_passed",
    steps: [],
    discoveredObjects: [],
    ...overrides,
  };
}

function selectionStep(index: number, label: string): TestScenarioStep {
  return {
    index,
    action: `Presionar "${label}"`,
    dataHints: [],
    technicalTargetRef: `role:option|${label}`,
    technicalTargetRefs: [`role:option|${label}`],
    controlIdentity: `synthetic-scope|${label}|role|option|${label}`,
    recordingActionType: "click",
  } as TestScenarioStep;
}

function genericButtonStep(index: number, label: string): TestScenarioStep {
  return {
    index,
    action: `Presionar "${label}"`,
    dataHints: [],
    technicalTargetRef: `role:button|${label}`,
    technicalTargetRefs: [`role:button|${label}`],
    controlIdentity: `synthetic-scope|${label}|role|button|${label}`,
    recordingActionType: "click",
  } as TestScenarioStep;
}

function buildScenario(steps: TestScenarioStep[]): TestScenario {
  return {
    source: "jira",
    externalId: "REC-SELECTION-01",
    caseId: 0,
    title: "Synthetic selection scenario",
    recordingId: "11111111-2222-3333-4444-555555555555",
    recordedScenarioId: "REC-SELECTION-01",
    steps,
  } as TestScenario;
}

function buildPlan(steps: Array<{ index: number; target: unknown }>) {
  return {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    scenario: { source: "jira", caseId: 0, externalId: "REC-SELECTION-01", title: "Synthetic selection scenario" },
    requiredData: [],
    steps: steps.map((s) => ({ index: s.index, action: "click", target: s.target, description: `Clic ${s.index}` })),
    createdAt: new Date().toISOString(),
  } as any;
}

test("1/lineageSurvivesScenarioBuild. controlIdentity + recordingActionType survive buildPromotionSourceScenario for a selection-like step", () => {
  const scenario = buildScenario([selectionStep(1, "OptionA")]);
  const sourceScenario = buildPromotionSourceScenario(scenario, buildCaseResult());
  const step = sourceScenario.steps?.find((s) => s.index === 1) as any;
  assert.ok(step, "step 1 must survive buildPromotionSourceScenario");
  assert.equal(step.controlIdentity, "synthetic-scope|OptionA|role|option|OptionA");
  assert.equal(step.recordingActionType, "click");
});

test("2/lineageSurvivesContractBuild. controlIdentity + recordingActionType + technical role survive into SpecExecutionContractStep", () => {
  const scenario = buildScenario([selectionStep(1, "OptionA")]);
  const sourceScenario = buildPromotionSourceScenario(scenario, buildCaseResult());
  const contract = buildSpecExecutionContract(buildPlan([{ index: 1, target: { strategy: "role", value: "OptionA" } }]), sourceScenario);
  const step = contract.steps.find((s) => s.scenarioStepIndex === 1);
  assert.ok(step);
  assert.equal(step!.controlIdentity, "synthetic-scope|OptionA|role|option|OptionA");
  assert.equal(step!.recordingActionType, "click");
  assert.equal(step!.technicalTargetRef, "role:option|OptionA");
});

test("3/compilerEmitsSelectionStateChange. the same authority, chained end-to-end, produces expectedEffect: 'selection_state_change' in the compiled candidate source", () => {
  const scenario = buildScenario([selectionStep(1, "OptionA")]);
  const sourceScenario = buildPromotionSourceScenario(scenario, buildCaseResult());
  const contract = buildSpecExecutionContract(buildPlan([{ index: 1, target: { strategy: "role", value: "OptionA" } }]), sourceScenario);
  const result = compileDeterministicSpec(contract, { targetSpecPath: TARGET_SPEC_PATH });
  assert.equal(result.unsupportedCapabilities.length, 0);
  assert.match(result.source, /stepIndex: 1,[\s\S]*?expectedEffect: 'selection_state_change'/);
});

test("4/candidateSourceLiteral. the compiled source literal is genuinely selection_state_change, not just the in-memory step object", () => {
  const scenario = buildScenario([selectionStep(1, "OptionA")]);
  const sourceScenario = buildPromotionSourceScenario(scenario, buildCaseResult());
  const contract = buildSpecExecutionContract(buildPlan([{ index: 1, target: { strategy: "role", value: "OptionA" } }]), sourceScenario);
  const result = compileDeterministicSpec(contract, { targetSpecPath: TARGET_SPEC_PATH });
  assert.doesNotMatch(result.source, /stepIndex: 1,[\s\S]*?expectedEffect: 'ui_change'/);
});

test("5/collisionFailsClosed. two steps sharing the SAME controlIdentity+recordingActionType never receive selection semantics, end-to-end", () => {
  const collidingA = selectionStep(1, "OptionA");
  const collidingB = { ...selectionStep(2, "OptionA"), controlIdentity: collidingA.controlIdentity } as TestScenarioStep;
  const scenario = buildScenario([collidingA, collidingB]);
  const sourceScenario = buildPromotionSourceScenario(scenario, buildCaseResult());
  const contract = buildSpecExecutionContract(
    buildPlan([{ index: 1, target: { strategy: "role", value: "OptionA" } }, { index: 2, target: { strategy: "role", value: "OptionA" } }]),
    sourceScenario,
  );
  const result = compileDeterministicSpec(contract, { targetSpecPath: TARGET_SPEC_PATH });
  assert.equal(result.unsupportedCapabilities.length, 0);
  assert.equal((result.source.match(/expectedEffect: 'selection_state_change'/g) ?? []).length, 0);
  assert.equal((result.source.match(/expectedEffect: 'ui_change'/g) ?? []).length, 2);
});

test("6/genericButtonUnaffected. a generic recorded role=button click still compiles to ui_change end-to-end", () => {
  const scenario = buildScenario([genericButtonStep(1, "Confirm")]);
  const sourceScenario = buildPromotionSourceScenario(scenario, buildCaseResult());
  const contract = buildSpecExecutionContract(buildPlan([{ index: 1, target: { strategy: "role", value: "Confirm" } }]), sourceScenario);
  const result = compileDeterministicSpec(contract, { targetSpecPath: TARGET_SPEC_PATH });
  assert.equal(result.unsupportedCapabilities.length, 0);
  assert.match(result.source, /stepIndex: 1,[\s\S]*?expectedEffect: 'ui_change'/);
});

test("7/multiOptionOrderIndependent. a structural fixture equivalent to three sibling selection options, no hardcoded business text, all receive selection_state_change regardless of order", () => {
  const optionOne = selectionStep(1, "OptionOne");
  const optionTwo = selectionStep(2, "OptionTwo");
  const optionThree = selectionStep(3, "OptionThree");
  const scenario = buildScenario([optionThree, optionOne, optionTwo]);
  const sourceScenario = buildPromotionSourceScenario(scenario, buildCaseResult());
  const contract = buildSpecExecutionContract(
    buildPlan([
      { index: 3, target: { strategy: "role", value: "OptionThree" } },
      { index: 1, target: { strategy: "role", value: "OptionOne" } },
      { index: 2, target: { strategy: "role", value: "OptionTwo" } },
    ]),
    sourceScenario,
  );
  const result = compileDeterministicSpec(contract, { targetSpecPath: TARGET_SPEC_PATH });
  assert.equal(result.unsupportedCapabilities.length, 0);
  for (const stepIndex of [1, 2, 3]) {
    assert.match(
      result.source,
      new RegExp(`stepIndex: ${stepIndex},[\\s\\S]*?expectedEffect: 'selection_state_change'`),
      `stepIndex ${stepIndex} should compile with selection_state_change`,
    );
  }
});
