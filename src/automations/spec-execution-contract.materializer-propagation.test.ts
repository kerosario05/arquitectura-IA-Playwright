import assert from "node:assert/strict";
import test from "node:test";
import { buildSpecExecutionContract } from "./spec-execution-contract";

const LONG_PANEL_LABEL =
  "Tarjeta Crédito Visa Gold Programa Puntos Santa Cruz por cada RD$100 o UD$3.00 generas un (1) Punto Santa Cruz. Mayor plazo para pagar: 26 días después de la fe";

function buildPlan(target: unknown) {
  return {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    scenario: { source: "testrail", caseId: 1, externalId: "C1", title: "Scenario" },
    requiredData: [],
    steps: [{ index: 1, action: "click", target, description: "Clic en tarjeta" }],
    createdAt: new Date().toISOString(),
  } as any;
}

test("recordingContractPropagationTest: recording-sourced technicalTargetCandidates survive into the execution contract as certifiedTechnicalTarget", () => {
  const contract = buildSpecExecutionContract(
    buildPlan({ strategy: "text", value: LONG_PANEL_LABEL }),
    {
      steps: [{
        index: 1,
        action: `Clic en "${LONG_PANEL_LABEL}"`,
        technicalTargetCandidates: [{
          targetType: "display",
          locatorCandidates: [{ strategy: "role", value: `div|${LONG_PANEL_LABEL}`, confidence: 0.85 }],
          structuralContext: {
            owner: { tag: "div" },
            stableDescendants: [{ relation: "descendant", tag: "img", stableAttributes: { alt: "Tarjeta Visa Gold" } }],
            semanticShape: ["div", "h3"],
            deterministicStructuralIdentity: true,
            structuralIdentityMatchCount: 1,
          },
          confidence: 0.45,
          validatedByInteraction: true,
        }],
      }],
    },
  );
  const step = contract.steps[0];
  assert.ok(step.certifiedTechnicalTarget, "recording evidence must survive into the execution contract");
  assert.equal(step.certifiedTechnicalTarget!.certifiedFrom, "recording");
  assert.equal(step.certifiedTechnicalTarget!.structuralContext?.owner?.tag, "div");
  // The long panel label used for the human-readable `target` must not become the certified
  // locator's primary value.
  assert.ok(!step.certifiedTechnicalTarget!.locatorCandidates[0].value.includes(LONG_PANEL_LABEL));
});

test("discoveryContractPropagationTest: discovery-sourced plan target survives into the execution contract as certifiedTechnicalTarget (same field/type as recording)", () => {
  const contract = buildSpecExecutionContract(
    buildPlan({ strategy: "testid", value: "visa-gold-card" }),
    { steps: [{ index: 1, action: "click" }] },
  );
  const step = contract.steps[0];
  assert.ok(step.certifiedTechnicalTarget, "discovery evidence must survive into the execution contract");
  assert.equal(step.certifiedTechnicalTarget!.certifiedFrom, "discovery");
  assert.equal(step.certifiedTechnicalTarget!.structuralContext?.stableDirectAttributes?.["data-testid"], "visa-gold-card");
});

test("longLabelNotPrimaryTest (contract level): a long display label with no structural/discovery evidence produces no certifiedTechnicalTarget", () => {
  const contract = buildSpecExecutionContract(
    buildPlan({ strategy: "text", value: LONG_PANEL_LABEL }),
    { steps: [{ index: 1, action: "click" }] },
  );
  const step = contract.steps[0];
  assert.equal(step.certifiedTechnicalTarget, undefined);
  // The human-readable business target is still present for evidence/reporting — just not
  // promoted to technical authority.
  assert.equal(step.target?.value, LONG_PANEL_LABEL);
});
