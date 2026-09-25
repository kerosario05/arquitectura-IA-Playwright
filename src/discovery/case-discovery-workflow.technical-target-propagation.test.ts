import assert from "node:assert/strict";
import test from "node:test";
import { buildPromotionSourceScenario } from "./case-discovery-workflow";
import { buildSpecExecutionContract } from "../automations/spec-execution-contract";
import type { CaseDiscoveryResult } from "../types/discovery.types";
import type { TestScenario } from "../types/testrail.types";

/**
 * Regression coverage for the physical first-loss-boundary found in the real
 * ce1cc899-8511-47af-8e7a-336543f4f37f run (REC-BC075766 / "Consulta Tarjeta"): the recording's
 * technicalTargetCandidates were present all the way through preview-scenarios.json and the
 * loaded TestScenario, but buildPromotionSourceScenario's own scenarioSteps mapping (the
 * function that builds the persisted plan.json `sourceScenario`) silently dropped
 * technicalTargetRef/technicalTargetRefs/technicalTargetCandidates — forcing every step through
 * the weaker Discovery PlanTarget path regardless of recordingReplay=true.
 *
 * These tests chain the REAL two functions the physical pipeline calls
 * (buildPromotionSourceScenario -> buildSpecExecutionContract) with synthetic, hermetic
 * fixtures — not the real (and previously observed to be live/mutable) kiosko artifacts.
 */

const LONG_LABEL =
  "Tarjeta Crédito Visa Clásica Programa Puntos Santa Cruz por cada RD$100 o UD$3.00 generas un (1) Punto Santa Cruz. Pagos en línea con disponibilidad inmediata.";

function buildCaseResult(overrides: Partial<CaseDiscoveryResult> = {}): CaseDiscoveryResult {
  return {
    version: "1.0",
    caseId: 0,
    caseTitle: "Consulta Tarjeta",
    discoveredAt: new Date().toISOString(),
    status: "discovered_passed",
    steps: [],
    discoveredObjects: [],
    ...overrides,
  };
}

function step4TechnicalTargetCandidates(): Array<Record<string, unknown>> {
  return [{
    targetType: "display",
    semanticRole: "display",
    locatorCandidates: [{ strategy: "role", value: `div|${LONG_LABEL}`, confidence: 0.85 }],
    structuralContext: {
      owner: { tag: "div" },
      stableDescendants: [
        { relation: "descendant", tag: "img", stableAttributes: { alt: "Tarjeta Crédito Visa Clásica", src: "/assets/images/tarjetas-de-credito-visa-clasica.png" } },
      ],
      semanticShape: ["div", "h3"],
      stableDirectAttributes: {},
      deterministicStructuralIdentity: true,
      structuralIdentityMatchCount: 1,
    },
    stableAttributes: {},
    interactionEvidence: ["click", LONG_LABEL],
    confidence: 0.45,
    validatedByInteraction: true,
  }];
}

function buildRecordingScenario(): TestScenario {
  return {
    source: "jira",
    externalId: "REC-BC075766-01",
    caseId: 0,
    title: "Consulta Tarjeta",
    recordingId: "bc075766-708b-4862-a207-0e6c8d07fad5",
    recordedScenarioId: "REC-BC075766-01",
    steps: [
      {
        index: 4,
        action: `Presionar "${LONG_LABEL}"`,
        dataHints: [],
        technicalTargetRefs: [`role:div|${LONG_LABEL}`],
        technicalTargetCandidates: step4TechnicalTargetCandidates(),
      } as TestScenario["steps"][number],
    ],
  };
}

function buildPlan(target: unknown) {
  return {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    scenario: { source: "jira", caseId: 0, externalId: "REC-BC075766-01", title: "Consulta Tarjeta" },
    requiredData: [],
    steps: [{ index: 4, action: "click", target, description: "Clic en tarjeta" }],
    createdAt: new Date().toISOString(),
  } as any;
}

// CASE 1 / CASE 5: recording technical evidence survives buildPromotionSourceScenario ->
// buildSpecExecutionContract for the real bug's exact Step 4 shape.
test("recordingPropagationPhysicalShapeTest / step4StructuralContractTest (CASE 1, CASE 5): recording structuralContext survives buildPromotionSourceScenario into the execution contract", () => {
  const scenario = buildRecordingScenario();
  const sourceScenario = buildPromotionSourceScenario(scenario, buildCaseResult());

  const propagatedStep = sourceScenario.steps?.find((s) => s.index === 4);
  assert.ok(propagatedStep, "step 4 must survive buildPromotionSourceScenario");
  assert.ok(
    (propagatedStep as any).technicalTargetCandidates?.length,
    "technicalTargetCandidates must not be dropped by buildPromotionSourceScenario",
  );

  const contract = buildSpecExecutionContract(
    buildPlan({ strategy: "recorded:structural-owner", value: LONG_LABEL }),
    sourceScenario,
  );
  const step = contract.steps.find((s) => s.scenarioStepIndex === 4);
  assert.ok(step, "contract must contain scenarioStepIndex 4");
  assert.ok(step!.certifiedTechnicalTarget, "step 4 must be certified — this is the physical fix");
  assert.equal(step!.certifiedTechnicalTarget!.certifiedFrom, "recording");
  assert.equal(step!.certifiedTechnicalTarget!.structuralContext?.owner?.tag, "div");
  assert.deepEqual(step!.certifiedTechnicalTarget!.structuralContext?.semanticShape, ["div", "h3"]);
  // Never the long display label used as the primary locator value.
  assert.ok(!step!.certifiedTechnicalTarget!.locatorCandidates[0].value.includes(LONG_LABEL));
});

// CASE 2: when a step carries BOTH recording technicalTargetCandidates AND a Discovery
// PlanTarget text fallback, recording authority must win — never degraded to PlanTarget text.
test("recordingBeatsTextPlanTest (CASE 2): recording evidence wins over a Discovery text PlanTarget on the same step", () => {
  const scenario = buildRecordingScenario();
  const sourceScenario = buildPromotionSourceScenario(scenario, buildCaseResult());
  const contract = buildSpecExecutionContract(
    // The plan's own target is a plain, non-recording text strategy — the weaker fallback.
    buildPlan({ strategy: "text", value: LONG_LABEL }),
    sourceScenario,
  );
  const step = contract.steps.find((s) => s.scenarioStepIndex === 4);
  assert.ok(step?.certifiedTechnicalTarget);
  assert.equal(step!.certifiedTechnicalTarget!.certifiedFrom, "recording", "recording authority must not be discarded in favor of the discovery PlanTarget");
});
