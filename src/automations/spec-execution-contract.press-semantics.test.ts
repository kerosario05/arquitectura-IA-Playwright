import assert from "node:assert/strict";
import test from "node:test";
import { buildSpecExecutionContract } from "./spec-execution-contract";

/**
 * FIRST_LOSS (jobId 4d7e0bc0-6742-4943-9b0c-c994a97372df): the validated plan correctly carried
 * `plan-step-4 type=press key=Enter target=<textbox>`, but the promoted execution-contract
 * discarded that structured authority: `classifyScenarioAction` recognizes "presionar" (Spanish,
 * genuinely ambiguous between "press [a key]" and "click/push [a button]") as a CLICK verb, and
 * `mapPlanAction` separately degraded `"press"` to `"click"` for matching purposes. The quoted
 * scenario text ("Enter") then became the contract step's TARGET (via buildScenarioStepTarget's
 * unconditional quoted-text extraction), producing `operation=click target="Enter"` -- a locator
 * search for literal text "Enter" that the real page never has, failing functional execution.
 *
 * Fixed: `findCompatiblePlanStep` is retried with a "press" candidate operation only when the
 * ambiguous "click"-classified text fails to match a real click-compatible plan step; when a
 * press-compatible one exists, its recorded action authoritatively corrects `operation`. A press
 * operation's target then comes from the plan step's own resolved target (the recorded textbox),
 * never from the scenario text's quoted key -- the key itself flows unchanged through the
 * existing generic `value` field (`planStep?.value`), the same field the raw execution-plan
 * executor already uses for a press action's key.
 */

function buildPlan(steps: unknown[]) {
  return {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    scenario: { source: "testrail", caseId: 1, externalId: "C1", title: "Scenario" },
    requiredData: [],
    steps,
    createdAt: new Date().toISOString(),
  } as any;
}

const textboxTarget = { strategy: "role", role: "textbox", name: "Contraseña", value: "role:textbox|Contraseña" };

test("1/structuredPress. structured press (target=textbox, key=Enter) survives into the contract as operation=press, key preserved, target remains the textbox", () => {
  const contract = buildSpecExecutionContract(
    buildPlan([{ index: 3, action: "press", target: textboxTarget, value: "Enter", description: 'Presionar "Enter"' }]),
    { steps: [{ index: 3, action: 'Presionar "Enter"' }] },
  );
  const step = contract.steps[0];
  assert.equal(step.operation, "press");
  assert.equal(step.value, "Enter", "the key must be preserved via the existing generic value field");
  assert.equal(step.target?.role, "textbox");
  assert.notEqual(step.target?.value, "Enter", "the key must never become the target");
});

test("2/validatedPlanTypePressNeverDegrades. a validated plan step of type=press must never degrade to click in the contract", () => {
  const contract = buildSpecExecutionContract(
    buildPlan([{ index: 3, action: "press", target: textboxTarget, value: "Enter", description: "Presionar Enter" }]),
    { steps: [{ index: 3, action: "Presionar Enter" }] },
  );
  assert.notEqual(contract.steps[0].operation, "click");
});

test("3/ordinaryClickUnchanged. an ordinary click with a genuinely click-compatible plan step is completely unaffected", () => {
  const contract = buildSpecExecutionContract(
    buildPlan([{ index: 1, action: "click", target: { strategy: "text", value: "Aceptar" }, description: 'Clic en "Aceptar"' }]),
    { steps: [{ index: 1, action: 'Presionar "Aceptar"' }] },
  );
  const step = contract.steps[0];
  assert.equal(step.operation, "click");
  assert.equal(step.target?.value, "Aceptar");
});

test("4/ordinaryFillUnchanged. an ordinary fill is completely unaffected by this fix", () => {
  const contract = buildSpecExecutionContract(
    buildPlan([{ index: 1, action: "fill", target: { strategy: "role", role: "textbox", name: "Usuario" }, value: "juan", description: 'Ingresar "juan"' }]),
    { steps: [{ index: 1, action: 'Ingresar "juan"' }] },
  );
  const step = contract.steps[0];
  assert.equal(step.operation, "fill");
  assert.equal(step.value, "juan");
});

test("7/fillTargetUsesField. a recorded fill description binds its field label as the promoted target, not its typed value", () => {
  const contract = buildSpecExecutionContract(
    buildPlan([{ index: 2, action: "fill", target: { strategy: "text", value: "sample-data" }, valueKey: "company_identifier", description: 'Ingresar "sample-data" en "Identificador fiscal"' }]),
    { steps: [{ index: 2, action: 'Ingresar "sample-data" en "Identificador fiscal"' }] },
  );
  const step = contract.steps[0];
  assert.equal(step.operation, "fill");
  assert.deepEqual(step.target, { strategy: "label", value: "Identificador fiscal" });
  assert.equal(step.valueKey, "company_identifier");
});

test("8/previewAuthFillAuthority. a parsed tax-identifier fill on an observed auth gate carries both field and gate authority", () => {
  const contract = buildSpecExecutionContract(
    buildPlan([{ index: 2, action: "fill", target: { strategy: "text", value: "sample-data" }, valueKey: "rnc_de_la_empresa", description: 'Ingresar "sample-data" en "Identificador fiscal"' }]),
    {
      auth: { gateDetected: true, required: true, detectedStage: "identification_input" },
      steps: [{ index: 2, action: 'Ingresar "sample-data" en "Identificador fiscal"' }],
    },
  );
  const step = contract.steps[0];
  assert.deepEqual(step.target, { strategy: "label", value: "Identificador fiscal" });
  assert.equal(step.authGateExpected, true);
});

test("5/textCannotOverrideStructuredAuthority. scenario text alone (\"Presionar X\", no compatible plan step at all) still classifies as click -- text is never promoted to press without real plan authority", () => {
  const contract = buildSpecExecutionContract(
    buildPlan([]),
    { steps: [{ index: 1, action: 'Presionar "Aceptar"' }] },
  );
  assert.equal(contract.steps[0].operation, "click");
});

test("6/pressBindingIsPress. the final contract step used for promoted binding carries operation=press, not click, when the recorded action is press", () => {
  const contract = buildSpecExecutionContract(
    buildPlan([{ index: 3, action: "press", target: textboxTarget, value: "Enter", description: 'Presionar "Enter"' }]),
    { steps: [{ index: 3, action: 'Presionar "Enter"' }] },
  );
  assert.equal(contract.steps[0].operation, "press");
});
