import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { buildSpecExecutionContract } from "../spec-execution-contract";
import { compileDeterministicSpec as compileDeterministicSpecRaw } from "./deterministic-spec-compiler";
import type { SpecExecutionContract, SpecExecutionContractStep } from "../spec-execution-contract";

/**
 * FIRST_LOSS (recording 34034233-6dee-4ee9-9fc1-56b276205985, job 8e1ec8ae-8ca8-4eb8-a954-
 * 70870a5982d3): Discovery already knows `target_selection_state_changed` (a prior ticket's
 * causal, target-scoped completion signal), but that semantic never reached the compiler/promoted
 * runtime -- the compiler unconditionally emitted `expectedEffect: 'ui_change'` for every click,
 * so a real option click ("Web") with no route/DOM change failed promotion with
 * `no_observable_post_action_outcome`. `TestScenarioStep.controlIdentity`/`recordingActionType`
 * (already transported to `TestScenarioStep` in an earlier ticket) now also transport through
 * `SpecExecutionContractStep`, and the compiler recognizes a selection-like recorded ARIA role
 * (option/checkbox/radio/switch/tab) with a verified-unique control lineage to emit
 * `expectedEffect: 'selection_state_change'` instead -- structural authority only, never target
 * text, never a positional join.
 */

const TARGET_SPEC_PATH = path.resolve(
  process.cwd(),
  "automations/apps/synthetic-app/sections/synthetic-section/cases/synthetic-case/case.spec.ts",
);

function compileDeterministicSpec(c: SpecExecutionContract) {
  return compileDeterministicSpecRaw(c, { targetSpecPath: TARGET_SPEC_PATH });
}

function step(overrides: Partial<SpecExecutionContractStep>): SpecExecutionContractStep {
  return {
    contractStepIndex: 0,
    scenarioStepIndex: 0,
    originalText: "synthetic step",
    operation: "click",
    required: true,
    executionStatus: "executed",
    evidenceRefs: [],
    ...overrides,
  };
}

function contract(steps: SpecExecutionContractStep[]): SpecExecutionContract {
  return {
    version: "1",
    scenarioId: "SYN-001",
    title: "synthetic scenario",
    steps,
    unresolvedRequiredOracles: [],
    diagnostics: { requiredScenarioSteps: steps.length, representedScenarioSteps: steps.length, missingScenarioSteps: [] },
  };
}

function buildPlan() {
  return {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    scenario: { source: "testrail", caseId: 1, externalId: "C1", title: "Scenario" },
    requiredData: [],
    steps: [{ index: 1, action: "click", target: { strategy: "role", value: "Web" }, description: "Presionar Web" }],
    createdAt: new Date().toISOString(),
  } as any;
}

// ── STEP -> CONTRACT transport ──

test("1/stepContractTransport. controlIdentity + recordingActionType are transported verbatim from ContractSourceScenario into SpecExecutionContractStep", () => {
  const built = buildSpecExecutionContract(buildPlan(), {
    steps: [{
      index: 1,
      action: "click",
      controlIdentity: "abc123|Web|role|option|Web",
      recordingActionType: "click",
    }],
  });
  assert.equal(built.steps[0].controlIdentity, "abc123|Web|role|option|Web");
  assert.equal(built.steps[0].recordingActionType, "click");
});

test("no upstream controlIdentity is never fabricated on the contract step", () => {
  const built = buildSpecExecutionContract(buildPlan(), { steps: [{ index: 1, action: "click" }] });
  assert.equal(built.steps[0].controlIdentity, undefined);
  assert.equal(built.steps[0].recordingActionType, undefined);
});

// ── SELECTION SEMANTICS at compiler level (direct SpecExecutionContractStep construction) ──

const WEB_STEP = step({
  scenarioStepIndex: 9,
  operation: "click",
  target: { strategy: "role", role: "option", name: "Web" },
  technicalTargetRef: "role:option|Web",
  controlIdentity: "abc123|Web|role|option|Web",
  recordingActionType: "click",
});

const MOBILE_STEP = step({
  scenarioStepIndex: 10,
  operation: "click",
  target: { strategy: "role", role: "option", name: "Mobile" },
  technicalTargetRef: "role:option|Mobile",
  controlIdentity: "abc123|Mobile|role|option|Mobile",
  recordingActionType: "click",
});

const SUCURSAL_STEP = step({
  scenarioStepIndex: 11,
  operation: "click",
  target: { strategy: "role", role: "option", name: "Sucursal" },
  technicalTargetRef: "role:option|Sucursal",
  controlIdentity: "abc123|Sucursal|role|option|Sucursal",
  recordingActionType: "click",
});

const GENERIC_BUTTON_STEP = step({
  scenarioStepIndex: 12,
  operation: "click",
  target: { strategy: "role", role: "button", name: "Guardar" },
  technicalTargetRef: "role:button|Guardar",
  controlIdentity: "abc123|Guardar|role|button|Guardar",
  recordingActionType: "click",
});

test("4/selectionSemanticPassed. a recorded role=option click with unique control lineage compiles to expectedEffect=selection_state_change", () => {
  const result = compileDeterministicSpec(contract([WEB_STEP, MOBILE_STEP, SUCURSAL_STEP]));
  assert.equal(result.unsupportedCapabilities.length, 0);
  assert.match(result.source, /target: 'role:option\|Web'[\s\S]*?expectedEffect: 'selection_state_change'/);
});

test("6/genericClickRegressionPassed. a recorded role=button click keeps expectedEffect=ui_change unchanged", () => {
  const result = compileDeterministicSpec(contract([GENERIC_BUTTON_STEP]));
  assert.equal(result.unsupportedCapabilities.length, 0);
  assert.match(result.source, /target: 'role:button\|Guardar'[\s\S]*?expectedEffect: 'ui_change'/);
});

test("7/kioskoFixturePassed. Web, Mobile, and Sucursal each independently map to selection_state_change with distinct control lineage -- no index/order dependency", () => {
  const result = compileDeterministicSpec(contract([SUCURSAL_STEP, WEB_STEP, MOBILE_STEP]));
  assert.equal(result.unsupportedCapabilities.length, 0);
  for (const label of ["Web", "Mobile", "Sucursal"]) {
    assert.match(
      result.source,
      new RegExp(`target: 'role:option\\|${label}'[\\s\\S]*?expectedEffect: 'selection_state_change'`),
      `${label} should compile with selection_state_change`,
    );
  }
});

test("2/reorderPassed. reordering the steps array never changes which step gets which expectedEffect", () => {
  const orderA = compileDeterministicSpec(contract([WEB_STEP, GENERIC_BUTTON_STEP]));
  const orderB = compileDeterministicSpec(contract([GENERIC_BUTTON_STEP, WEB_STEP]));
  assert.match(orderA.source, /target: 'role:option\|Web'[\s\S]*?expectedEffect: 'selection_state_change'/);
  assert.match(orderB.source, /target: 'role:option\|Web'[\s\S]*?expectedEffect: 'selection_state_change'/);
  assert.match(orderA.source, /target: 'role:button\|Guardar'[\s\S]*?expectedEffect: 'ui_change'/);
  assert.match(orderB.source, /target: 'role:button\|Guardar'[\s\S]*?expectedEffect: 'ui_change'/);
});

// ── LINEAGE INVARIANT: collision fails closed ──

test("3/collisionFailsClosed. two steps sharing the SAME controlIdentity+recordingActionType never get semantic enrichment -- fails closed to ui_change, never resolved by position", () => {
  const collidingA = step({
    scenarioStepIndex: 20,
    operation: "click",
    target: { strategy: "role", role: "option", name: "Aceptar" },
    technicalTargetRef: "role:option|Aceptar",
    controlIdentity: "abc123|Aceptar|role|option|Aceptar",
    recordingActionType: "click",
  });
  const collidingB = step({
    scenarioStepIndex: 25,
    operation: "click",
    target: { strategy: "role", role: "option", name: "Aceptar" },
    technicalTargetRef: "role:option|Aceptar",
    controlIdentity: "abc123|Aceptar|role|option|Aceptar",
    recordingActionType: "click",
  });
  const result = compileDeterministicSpec(contract([collidingA, collidingB]));
  assert.equal(result.unsupportedCapabilities.length, 0);
  const matches = result.source.match(/expectedEffect: 'ui_change'/g) ?? [];
  assert.equal(matches.length, 2, "both colliding steps fail closed to the existing generic ui_change, never guessed by position");
  assert.equal((result.source.match(/expectedEffect: 'selection_state_change'/g) ?? []).length, 0);
});

// ── COMPILER regression ──

test("8/compilerRegressionPassed. 13-required/13-compiled/0-unsupported shape is preserved with mixed selection-like and generic steps", () => {
  const steps = [WEB_STEP, MOBILE_STEP, SUCURSAL_STEP, GENERIC_BUTTON_STEP];
  const result = compileDeterministicSpec(contract(steps));
  assert.equal(result.bindings.length, steps.length);
  assert.equal(result.unsupportedCapabilities.length, 0);
});
