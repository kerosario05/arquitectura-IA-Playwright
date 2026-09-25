import assert from "node:assert";
import test from "node:test";
import { evaluatePromotionGate, detectFragileTargetPatterns } from "./promotion-gate";
import type { CaseDiscoveryResult } from "../types/discovery.types";
import type { ExecutionPlan } from "../types/execution-plan.types";

/**
 * The gate that would have caught the Kiosko2 / Step 4 defect at promotion time: a candidate
 * spec whose click target is a long exact-text getByText built from a concatenated,
 * multi-node display label, or a position-based (.first/.last/.nth) selection, is now
 * rejected before it can ever be promoted — regardless of how well everything else validated.
 */

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

const STRUCTURAL_OWNER_SPEC = `
await promotedRuntime.clickPromotedTarget({
  stepIndex: 4,
  target: "Tarjeta Crédito Visa Gold",
  action: async () => {
    await page.getByRole('img', { name: 'Tarjeta Crédito Visa Gold' }).click();
  }
});
`;

const LONG_CONCATENATED_TEXT = "Tarjeta Crédito Visa Gold Programa Puntos Santa Cruz por cada RD$100 o UD$3.00 generas un (1) Punto Santa Cruz. Mayor plazo para pagar: 26 días después de la fe";

const LONG_EXACT_TEXT_SPEC = `
await promotedRuntime.clickPromotedTarget({
  stepIndex: 4,
  target: "${LONG_CONCATENATED_TEXT}",
  action: async () => {
    await page.getByText("${LONG_CONCATENATED_TEXT}", { exact: true }).click();
  }
});
`;

const FIRST_SPEC = `
await page.getByRole('button', { name: /continuar/i }).first().click();
`;

const NTH_SPEC = `
await page.locator('.card').nth(2).click();
`;

// CASE A: structural/short target -> gate passes cleanly.
test("CASE A: a short, role-based target passes the technical executability gate", () => {
  assert.deepEqual(detectFragileTargetPatterns(STRUCTURAL_OWNER_SPEC), []);
  const gate = evaluatePromotionGate({ discoveryResult: buildCaseResult(), specContent: STRUCTURAL_OWNER_SPEC });
  assert.equal(gate.allowed, true);
  assert.equal(gate.failedGate, undefined);
});

// CASE B: the exact real-world failure — long concatenated exact-text target rejected.
test("CASE B: a long exact-text getByText target (concatenated panel text) is rejected", () => {
  const reasons = detectFragileTargetPatterns(LONG_EXACT_TEXT_SPEC);
  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /technical_target_not_executable/);

  const gate = evaluatePromotionGate({ discoveryResult: buildCaseResult(), specContent: LONG_EXACT_TEXT_SPEC });
  assert.equal(gate.allowed, false);
  assert.equal(gate.failedGate, "technical_target_not_executable");
});

// CASE E: .first() is rejected.
test("CASE E: .first() positional selection is rejected by the promotion gate", () => {
  const reasons = detectFragileTargetPatterns(FIRST_SPEC);
  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /positional selection detected \(first\)/);

  const gate = evaluatePromotionGate({ discoveryResult: buildCaseResult(), specContent: FIRST_SPEC });
  assert.equal(gate.allowed, false);
  assert.equal(gate.failedGate, "technical_target_not_executable");
});

// CASE F: .nth() is rejected.
test("CASE F: .nth() positional selection is rejected by the promotion gate", () => {
  const reasons = detectFragileTargetPatterns(NTH_SPEC);
  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /positional selection detected \(nth\)/);

  const gate = evaluatePromotionGate({ discoveryResult: buildCaseResult(), specContent: NTH_SPEC });
  assert.equal(gate.allowed, false);
});

// .last() too, for completeness — same family as CASE E/F.
test(".last() positional selection is rejected by the promotion gate", () => {
  const reasons = detectFragileTargetPatterns(`await page.getByRole('link').last().click();`);
  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /positional selection detected \(last\)/);
});

// A short exact-text target (well under the threshold, single accessible name) must still be
// allowed — the gate targets concatenated multi-node labels, not exact matching itself.
test("a short exact-text target under the length threshold is not flagged as fragile", () => {
  const spec = `await page.getByText("Tarjetas", { exact: true }).click();`;
  assert.deepEqual(detectFragileTargetPatterns(spec), []);
});

// CASE G-equivalent at this gate: no specContent at all still allows other checks to run
// (this gate is additive, never the sole source of truth) — proven by not throwing.
test("no specContent provided does not crash the gate (fragile-target check is opportunistic)", () => {
  const gate = evaluatePromotionGate({ discoveryResult: buildCaseResult() });
  assert.equal(gate.allowed, true);
});
