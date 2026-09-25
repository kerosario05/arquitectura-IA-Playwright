import assert from "node:assert/strict";
import test from "node:test";
import { buildSpecExecutionContract } from "./spec-execution-contract";

/**
 * P1 fix: an oracle whose sourceActionStepIndex=N must bind to the corresponding
 * functional action N (scenario-step index space), never to whatever index the
 * validated plan's own (possibly shifted) step happens to carry. The validated plan
 * commonly retains a leading navigate step the scenario/recording does not count,
 * which previously caused resolveStepOracle to match oracle.stepIndex against the
 * plan step's own (shifted) index instead of the scenario step index -- silently
 * reattaching an oracle to the wrong, earlier scenario step. These tests are fully
 * hermetic: no browser, no real AI, no QA Lab, no TestRail.
 */

function buildPlanWithLeadingNavigateOffset() {
  return {
    scenario: { externalId: "C-oracle-binding", title: "oracle binding" },
    steps: [
      { index: 0, action: "navigate", target: "APP_BASE_URL" },
      { index: 5, action: "click", target: { strategy: "text", value: "Visa Clasica" } },
      { index: 6, action: "click", target: { strategy: "text", value: "Finalizar sesion" } },
    ],
  } as any;
}

function buildSourceScenarioWithOracleOnStep5() {
  return {
    title: "oracle binding",
    steps: [
      { index: 4, action: "click", description: "Seleccionar Visa Clasica" },
      { index: 5, action: "click", description: "Finalizar sesion" },
    ],
    observableOracles: [
      {
        id: "oracle-finalizar-sesion",
        requirement: "La aplicacion regresa a la pagina raiz",
        type: "navigation_transition",
        backed: true,
        stepIndex: 5,
        target: "Finalizar sesion",
        evidence: ["transition_observed:true"],
        details: { sourceActionStepIndex: 5, expectedUrl: "https://example.test/" },
      },
    ],
  } as any;
}

test("oracle step binding (sourceActionStepIndex authority, no off-by-one)", async (t) => {
  await t.test("5. oracle sourceActionStepIndex=5 remains attached to functional Step 5", () => {
    const contract = buildSpecExecutionContract(buildPlanWithLeadingNavigateOffset(), buildSourceScenarioWithOracleOnStep5());
    const step5 = contract.steps.find((s) => s.scenarioStepIndex === 5);
    assert.ok(step5?.oracle?.backed, "scenario step 5 must carry the backed navigation_transition oracle");
    assert.equal(step5?.oracle?.type, "navigation_transition");
    assert.equal(step5?.oracle?.sourceActionStepIndex, 5);
  });

  await t.test("6. Step 4 does NOT inherit Step 5's oracle", () => {
    const contract = buildSpecExecutionContract(buildPlanWithLeadingNavigateOffset(), buildSourceScenarioWithOracleOnStep5());
    const step4 = contract.steps.find((s) => s.scenarioStepIndex === 4);
    assert.equal(step4?.oracle, undefined, "scenario step 4 must not receive step 5's oracle due to a plan-step-index shift");
  });

  await t.test("7. the oracle assertion is bound to the same contract step as its own action, so it can never precede it", () => {
    const contract = buildSpecExecutionContract(buildPlanWithLeadingNavigateOffset(), buildSourceScenarioWithOracleOnStep5());
    const oracleStep = contract.steps.find((s) => s.oracle?.backed);
    assert.ok(oracleStep, "exactly one contract step should carry the backed oracle");
    assert.equal(oracleStep?.scenarioStepIndex, 5);
    assert.equal(oracleStep?.operation, "click", "the oracle must ride on the click action step it observes, not a separate earlier step");
  });

  await t.test("8. no off-by-one mapping for a first/middle/last step sequence", () => {
    const plan = {
      scenario: { externalId: "C-oracle-binding-3", title: "oracle binding 3 steps" },
      steps: [
        { index: 0, action: "navigate", target: "APP_BASE_URL" },
        { index: 4, action: "click", target: { strategy: "text", value: "Primero" } },
        { index: 5, action: "click", target: { strategy: "text", value: "Segundo" } },
        { index: 6, action: "click", target: { strategy: "text", value: "Tercero" } },
      ],
    } as any;
    const source = {
      title: "oracle binding 3 steps",
      steps: [
        { index: 3, action: "click", description: "Primero" },
        { index: 4, action: "click", description: "Segundo" },
        { index: 5, action: "click", description: "Tercero" },
      ],
      observableOracles: [
        {
          id: "oracle-tercero",
          requirement: "La aplicacion navega a la confirmacion",
          type: "navigation_transition",
          backed: true,
          stepIndex: 5,
          target: "Tercero",
          evidence: ["transition_observed:true"],
          details: { sourceActionStepIndex: 5 },
        },
      ],
    } as any;
    const contract = buildSpecExecutionContract(plan, source);
    const primero = contract.steps.find((s) => s.scenarioStepIndex === 3);
    const segundo = contract.steps.find((s) => s.scenarioStepIndex === 4);
    const tercero = contract.steps.find((s) => s.scenarioStepIndex === 5);
    assert.equal(primero?.oracle, undefined);
    assert.equal(segundo?.oracle, undefined);
    assert.ok(tercero?.oracle?.backed, "only the last (matching sourceActionStepIndex) step keeps the oracle");
  });
});
