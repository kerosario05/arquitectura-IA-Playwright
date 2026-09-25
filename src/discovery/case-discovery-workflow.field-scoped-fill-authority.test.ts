import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildPromotionSourceScenario } from "./case-discovery-workflow";
import { buildSpecExecutionContract } from "../automations/spec-execution-contract";
import { compileDeterministicSpec as compileDeterministicSpecRaw } from "../automations/spec-compiler/deterministic-spec-compiler";
import type { CaseDiscoveryResult } from "../types/discovery.types";
import type { TestScenario } from "../types/testrail.types";

/**
 * FIRST_LOSS fix (jobId a74b4f6a-99d1-4bed-bcc7-9de038612b3f): the field-scoped structural
 * fallback (src/discovery/target-resolver.ts, tryFieldScopedStructuralFallback/resolveFillTarget)
 * already physically reconfirms a real CertifiedTechnicalTarget for a fill -- but discarded it
 * once the live Locator was obtained, returning only an execution-only Locator + a generic
 * strategy label. Fixed by:
 *   1. Carrying the exact CertifiedTechnicalTarget forward on RecordedLocatorResolution /
 *      FillTargetResolutionResult / TargetResolutionResult (target-resolver.ts) -- never
 *      reconstructed from locatorStrategy/text/the Locator.
 *   2. case-discovery.ts's fill success path persists it onto the pushed step entry
 *      (technicalTargetCandidates, the SAME field name/shape Recording-sourced steps already use).
 *   3. case-discovery-workflow.ts's buildPromotionSourceScenario merges it in as a fallback
 *      (mirroring the pre-existing discoveryStepByIndex.get(step.index)?.assertionImportance
 *      pattern) only when no Recording-sourced technicalTargetCandidates already exists.
 *
 * Resolver-level (target-resolver.ts) changes are verified structurally here (source-text),
 * matching this codebase's own established convention that resolveRecordedStructuralOwner's
 * live-Page DOM resolution requires a real browser and is not independently unit-testable (see
 * target-resolver.landmark-scoped-owner.test.ts's own doc comment). The persistence/contract/
 * compiler cross-boundary is exercised with the REAL functions and synthetic fixtures, following
 * the exact precedent of case-discovery-workflow.technical-target-propagation.test.ts.
 */

const TARGET_RESOLVER_SOURCE = fs.readFileSync(path.resolve(__dirname, "target-resolver.ts"), "utf8");

test("1/RESOLVER_STATIC: tryFieldScopedStructuralFallback's success returns include certifiedTechnicalTarget (never dropped)", () => {
  const start = TARGET_RESOLVER_SOURCE.indexOf("async function tryFieldScopedStructuralFallback(");
  const end = TARGET_RESOLVER_SOURCE.indexOf("\n/**", start + 50);
  const fn = TARGET_RESOLVER_SOURCE.slice(start, end === -1 ? start + 6000 : end);
  assert.match(fn, /return \{ \.\.\.reconfirmedScoped, certifiedTechnicalTarget: containerScoped\.target \};/);
  assert.match(fn, /return \{ \.\.\.reconfirmed, certifiedTechnicalTarget: materialization\.target \};/);
});

test("2/RESOLVER_STATIC: resolveFillTarget's field-scoped success return carries certifiedTechnicalTarget through from the fallback result, unreconstructed", () => {
  const start = TARGET_RESOLVER_SOURCE.indexOf("export async function resolveFillTarget(");
  const end = TARGET_RESOLVER_SOURCE.indexOf("\nexport function validateFillResolutionContract", start);
  const fn = TARGET_RESOLVER_SOURCE.slice(start, end);
  assert.match(fn, /certifiedTechnicalTarget: fallback\.certifiedTechnicalTarget/);
  // resolveActionTarget (the click/press path) must NOT be touched by this ticket.
  const actionStart = TARGET_RESOLVER_SOURCE.indexOf("export async function resolveActionTarget(");
  const actionEnd = TARGET_RESOLVER_SOURCE.indexOf("\nasync function trySemanticFallback", actionStart);
  const actionFn = TARGET_RESOLVER_SOURCE.slice(actionStart, actionEnd);
  assert.doesNotMatch(actionFn, /certifiedTechnicalTarget:/, "the click/press resolveActionTarget path must not consume certifiedTechnicalTarget in this ticket");
});

function buildCaseResult(overrides: Partial<CaseDiscoveryResult> = {}): CaseDiscoveryResult {
  return {
    version: "1.0",
    caseId: 0,
    caseTitle: "Synthetic field-scoped fill",
    discoveredAt: new Date().toISOString(),
    status: "discovered_passed",
    steps: [],
    discoveredObjects: [],
    ...overrides,
  };
}

function step5CertifiedTechnicalTarget(): Record<string, unknown> {
  return {
    targetType: "structural",
    locatorCandidates: [{ strategy: "css", value: '[data-field="synthetic-field"]', confidence: 0.95 }],
    structuralContext: { stableDirectAttributes: { "data-field": "synthetic-field" } },
    interactionEvidence: [],
    certifiedFrom: "discovery",
    certificationTier: 1,
    confidence: 0.95,
    validatedByInteraction: true,
  };
}

function buildScenario(): TestScenario {
  return {
    source: "jira",
    externalId: "REC-STEP5-SYNTH",
    caseId: 0,
    title: "Synthetic field-scoped fill",
    steps: [
      { index: 5, action: "Ingresar Synthetic Field", dataHints: [] } as TestScenario["steps"][number],
    ],
  };
}

function buildPlan(target: unknown) {
  return {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    scenario: { source: "jira", caseId: 0, externalId: "REC-STEP5-SYNTH", title: "Synthetic field-scoped fill" },
    requiredData: [],
    steps: [{ index: 5, action: "fill", target, description: "Ingresar Synthetic Field", valueKey: "synthetic_field" }],
    createdAt: new Date().toISOString(),
  } as any;
}

test("3/FILL_PLAN_PERSISTENCE: a Discovery-live-resolved technicalTargetCandidates (no Recording authority) is merged in by buildPromotionSourceScenario", () => {
  const scenario = buildScenario();
  const caseResult = buildCaseResult({
    steps: [{ index: 5, action: "fill", status: "found", targetText: "Synthetic Field", technicalTargetCandidates: [step5CertifiedTechnicalTarget()] } as any],
  });
  const sourceScenario = buildPromotionSourceScenario(scenario, caseResult);
  const propagatedStep = sourceScenario.steps?.find((s) => s.index === 5);
  assert.ok(propagatedStep);
  assert.ok((propagatedStep as any).technicalTargetCandidates?.length, "the field-scoped fallback's certified target must be merged in as a fallback");
  assert.equal((propagatedStep as any).technicalTargetCandidates[0].certifiedFrom, "discovery");
});

test("4/CROSS_BOUNDARY_STEP5: merged Discovery-live authority survives into SpecExecutionContract as a certified target, never degraded to tier-5 text", () => {
  const scenario = buildScenario();
  const caseResult = buildCaseResult({
    steps: [{ index: 5, action: "fill", status: "found", targetText: "Synthetic Field", technicalTargetCandidates: [step5CertifiedTechnicalTarget()] } as any],
  });
  const sourceScenario = buildPromotionSourceScenario(scenario, caseResult);
  const contract = buildSpecExecutionContract(
    buildPlan({ strategy: "text", value: "Synthetic Field" }),
    sourceScenario,
  );
  const step = contract.steps.find((s) => s.scenarioStepIndex === 5);
  assert.ok(step, "contract must contain scenarioStepIndex 5");
  assert.ok(step!.certifiedTechnicalTarget, "step 5 must be certified -- the physical fix");
  assert.equal(step!.certifiedTechnicalTarget!.certificationTier, 1, "must not degrade to tier 5 display/text");
  assert.notEqual(step!.certifiedTechnicalTarget!.targetType, "display");
});

test("5/COMPILER_STEP5: the deterministic compiler emits real technical authority for step 5, never only page.getByText(label).fill(...)", () => {
  const scenario = buildScenario();
  const caseResult = buildCaseResult({
    steps: [{ index: 5, action: "fill", status: "found", targetText: "Synthetic Field", technicalTargetCandidates: [step5CertifiedTechnicalTarget()] } as any],
  });
  const sourceScenario = buildPromotionSourceScenario(scenario, caseResult);
  const contract = buildSpecExecutionContract(
    buildPlan({ strategy: "text", value: "Synthetic Field" }),
    sourceScenario,
  );
  const targetSpecPath = path.resolve(
    process.cwd(),
    "automations/apps/synthetic-app/sections/synthetic-section/cases/synthetic-case/case.spec.ts",
  );
  const result = compileDeterministicSpecRaw(contract, { targetSpecPath });
  assert.equal(result.unsupportedCapabilities.length, 0);
  assert.match(result.source, /technicalTargetRefs: \['css:\[data-field="synthetic-field"\]'\]/);
  assert.doesNotMatch(result.source, /page\.getByText\('Synthetic Field'\)\.fill/);
});

test("6/CLICK_RUNTIME_RESOLUTION_REGRESSION: a Step6-like click with resolutionState=runtime_resolution_required is unaffected by this fill-only change", () => {
  const scenario: TestScenario = {
    source: "jira",
    externalId: "REC-STEP6-SYNTH",
    caseId: 0,
    title: "Synthetic step6-like click",
    steps: [{ index: 6, action: "Presionar Synthetic Button", dataHints: [] } as TestScenario["steps"][number]],
  };
  const caseResult = buildCaseResult({
    steps: [{ index: 6, action: "click", status: "found", targetText: "Synthetic Button" } as any],
  });
  const sourceScenario = buildPromotionSourceScenario(scenario, caseResult);
  const plan = {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    scenario: { source: "jira", caseId: 0, externalId: "REC-STEP6-SYNTH", title: "Synthetic step6-like click" },
    requiredData: [],
    steps: [{
      index: 6,
      action: "click",
      target: { strategy: "recorded:structural-owner", value: "Synthetic Button" },
      description: "Presionar Synthetic Button",
    }],
    createdAt: new Date().toISOString(),
  } as any;
  const contract = buildSpecExecutionContract(plan, sourceScenario);
  const step = contract.steps.find((s) => s.scenarioStepIndex === 6);
  assert.ok(step);
  assert.equal(step!.resolutionState, "runtime_resolution_required", "click semantics for a recorded:* plan marker with no certified authority must remain unchanged");
  // No rich (structural) certification exists for this step either way -- buildSpecExecutionContract's
  // own PRE-EXISTING discovery-text fallback still materializes the same weak Tier-5 display
  // certification it always did; the invariant this ticket must preserve is that it is NOT
  // upgraded to a structural/tier-1 certification by this fill-only change.
  assert.equal(step!.certifiedTechnicalTarget?.targetType, "display");
  assert.equal(step!.certifiedTechnicalTarget?.certificationTier, 5);
});

test("7/LEGACY_FILL: a fill step with no technicalTargetCandidates anywhere (no Recording, no Discovery-live) behaves exactly as before", () => {
  const scenario = buildScenario();
  const caseResult = buildCaseResult({
    steps: [{ index: 5, action: "fill", status: "found", targetText: "Synthetic Field" } as any],
  });
  const sourceScenario = buildPromotionSourceScenario(scenario, caseResult);
  const propagatedStep = sourceScenario.steps?.find((s) => s.index === 5);
  assert.ok(propagatedStep);
  assert.equal((propagatedStep as any).technicalTargetCandidates, undefined);

  const contract = buildSpecExecutionContract(
    buildPlan({ strategy: "text", value: "Synthetic Field" }),
    sourceScenario,
  );
  const step = contract.steps.find((s) => s.scenarioStepIndex === 5);
  assert.ok(step);
  // Same pre-existing, unmodified fallback as before this ticket: with no rich evidence anywhere,
  // buildSpecExecutionContract's own discovery-text adapter still materializes the same weak
  // Tier-5 display certification it always did (this IS the original bug's own exact symptom for
  // a genuinely-uncertified step -- correct, expected, and unrelated to this ticket's fix).
  assert.equal(step!.certifiedTechnicalTarget?.targetType, "display");
  assert.equal(step!.certifiedTechnicalTarget?.certificationTier, 5);
});
