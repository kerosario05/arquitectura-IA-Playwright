import assert from "node:assert";
import test from "node:test";
import { evaluatePromotionGate } from "./promotion-gate";
import type { CaseDiscoveryResult } from "../types/discovery.types";
import type { ExecutionPlan } from "../types/execution-plan.types";

function buildPlan(): ExecutionPlan {
  return {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    createdAt: new Date().toISOString(),
    scenario: {
      source: "manual",
      externalId: "PREVIEW-001",
      title: "Visualizacion inicial"
    },
    requiredData: [],
    steps: [
      { index: 1, action: "click", description: "Iniciar", target: { strategy: "text", value: "Iniciar" } },
      { index: 2, action: "assertVisible", description: "Validar boton iniciar", target: { strategy: "text", value: "Iniciar" }, expected: "Boton iniciar visible" }
    ]
  };
}

function buildCaseResult(overrides: Partial<CaseDiscoveryResult> = {}): CaseDiscoveryResult {
  return {
    version: "1.0",
    caseId: 0,
    caseTitle: "Escenario de prueba",
    discoveredAt: new Date().toISOString(),
    status: "discovered_passed",
    steps: [],
    discoveredObjects: [],
    candidatePlan: buildPlan(),
    ...overrides,
  };
}

test("required unsupported_or_unresolved oracle blocks promotion with clear reason", () => {
  const result = evaluatePromotionGate({
    discoveryResult: buildCaseResult(),
    candidatePlan: buildPlan(),
    observableOracles: [
      { requirement: "Descripción general del depósito", type: "literal_visible_text", backed: true },
      { requirement: "Tasas y beneficios mostrados", type: "unsupported_or_unresolved", backed: false },
    ],
  });

  assert.strictEqual(result.allowed, false);
  assert.ok(
    result.reasons.some((reason) => reason.includes("Required observable oracle unresolved")),
    `expected unresolved-oracle reason, got: ${result.reasons.join(" | ")}`
  );
  assert.strictEqual(result.status, "blocked");
});

test("backed literal_visible_text oracles do not block promotion", () => {
  const result = evaluatePromotionGate({
    discoveryResult: buildCaseResult(),
    candidatePlan: buildPlan(),
    observableOracles: [
      { requirement: "Descripción general del depósito", type: "literal_visible_text", backed: true },
      { requirement: "Tasas y beneficios mostrados", type: "literal_visible_text", backed: true },
    ],
  });

  assert.strictEqual(result.allowed, true);
  assert.ok(
    !result.reasons.some((reason) => reason.includes("Required observable oracle unresolved")),
    `unexpected unresolved-oracle reason, got: ${result.reasons.join(" | ")}`
  );
});

test("no unresolved oracles leaves promotion gate allowed", () => {
  const result = evaluatePromotionGate({
    discoveryResult: buildCaseResult(),
    candidatePlan: buildPlan(),
  });

  assert.strictEqual(result.allowed, true);
});