import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildPromotionSourceScenario } from "../../discovery/case-discovery-workflow";
import { buildSpecExecutionContract } from "../spec-execution-contract";
import { compileDeterministicSpec as compileDeterministicSpecRaw } from "../spec-compiler/deterministic-spec-compiler";
import type { CaseDiscoveryResult } from "../../types/discovery.types";
import type { TestScenario } from "../../types/testrail.types";

/**
 * FIRST_LOSS fix: Step6-shaped click (Discovery PASSes physically via the field-scoped fallback
 * using `associatedField`, resolutionState=runtime_resolution_required) had no way to carry that
 * same hint into the promoted runtime -- `PromotedClickOptions` had no `associatedField`, so
 * `clickPromotedTarget` only ever received the bare display ref (e.g. "role:button", 8 matches,
 * strict-mode FAIL). Fixed by transporting `associatedField` verbatim (never a new/upgraded
 * certification, never touching firstStructuredEvidenceRef/technicalTargetRefs) along:
 *   scenario/plan (TestScenario step / Discovery-persisted step) -> buildPromotionSourceScenario
 *   -> SpecExecutionContractStep.associatedField -> deterministic compiler (runtime_resolution_
 *   required clicks only) -> PromotedClickOptions.associatedField -> clickPromotedTarget's own
 *   gated resolveActionTarget retry (the SAME shared field-scoped resolver Discovery's live walk
 *   already used).
 *
 * Contract/compiler boundaries are exercised with the REAL functions and synthetic fixtures
 * (mirroring case-discovery-workflow.field-scoped-fill-authority.test.ts's established pattern).
 * The runtime-side wiring (clickPromotedTarget -> resolveActionTarget) is verified via source-text
 * extraction, matching this codebase's own established convention that resolveActionTarget's
 * live-Page DOM resolution requires a real browser and is not independently unit-testable here
 * (see promoted-spec-runtime.click-structural-authority.test.ts's own doc comment).
 */

const RUNTIME_SOURCE = fs.readFileSync(path.resolve(__dirname, "promoted-spec-runtime.ts"), "utf8");

function buildCaseResult(overrides: Partial<CaseDiscoveryResult> = {}): CaseDiscoveryResult {
  return {
    version: "1.0",
    caseId: 0,
    caseTitle: "Synthetic step6-like click",
    discoveredAt: new Date().toISOString(),
    status: "discovered_passed",
    steps: [],
    discoveredObjects: [],
    ...overrides,
  };
}

function buildStep6Scenario(): TestScenario {
  return {
    source: "jira",
    externalId: "REC-STEP6-SYNTH",
    caseId: 0,
    title: "Synthetic step6-like click",
    steps: [{ index: 6, action: "Presionar Synthetic Button", dataHints: [] } as TestScenario["steps"][number]],
  };
}

function buildStep6Plan() {
  return {
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
}

test("1/CONTRACT_TRANSPORT: a runtime_resolution_required Step6-like click with a Discovery-persisted associatedField reaches SpecExecutionContractStep.associatedField, resolutionState unchanged", () => {
  const scenario = buildStep6Scenario();
  const caseResult = buildCaseResult({
    steps: [{ index: 6, action: "click", status: "found", targetText: "Synthetic Button", associatedField: "Formulario de solicitud" } as any],
  });
  const sourceScenario = buildPromotionSourceScenario(scenario, caseResult);
  const propagatedStep = sourceScenario.steps?.find((s) => s.index === 6);
  assert.ok(propagatedStep);
  assert.equal((propagatedStep as any).associatedField, "Formulario de solicitud", "the Discovery-persisted associatedField must survive the scenario merge");

  const contract = buildSpecExecutionContract(buildStep6Plan(), sourceScenario);
  const step = contract.steps.find((s) => s.scenarioStepIndex === 6);
  assert.ok(step);
  assert.equal(step!.associatedField, "Formulario de solicitud");
  assert.equal(step!.resolutionState, "runtime_resolution_required", "the invariant this ticket must preserve");
});

test("2/COMPILER_EMISSION: the deterministic compiler emits associatedField into PromotedClickOptions for a runtime_resolution_required click, without altering technicalTargetRefs", () => {
  const scenario = buildStep6Scenario();
  const caseResult = buildCaseResult({
    steps: [{ index: 6, action: "click", status: "found", targetText: "Synthetic Button", associatedField: "Formulario de solicitud" } as any],
  });
  const sourceScenario = buildPromotionSourceScenario(scenario, caseResult);
  const contract = buildSpecExecutionContract(buildStep6Plan(), sourceScenario);
  const targetSpecPath = path.resolve(
    process.cwd(),
    "automations/apps/synthetic-app/sections/synthetic-section/cases/synthetic-case/case.spec.ts",
  );
  const result = compileDeterministicSpecRaw(contract, { targetSpecPath });

  assert.match(result.source, /associatedField: 'Formulario de solicitud'/, "compiler must emit associatedField for a runtime_resolution_required click");
  // The pre-existing runtime_deferred ref (firstStructuredEvidenceRef) is untouched by this
  // ticket -- same value with or without associatedField (see test 5's regression fixture).
  assert.match(result.source, /technicalTargetRefs: \['text:Presionar Synthetic Button'\]/);
});

test("3/RUNTIME_DISPATCH: clickPromotedTarget's own source passes options.associatedField into the SAME shared resolveActionTarget, gated to when the stronger structural/checkbox authorities didn't resolve", () => {
  const start = RUNTIME_SOURCE.indexOf("async clickPromotedTarget(options: PromotedClickOptions)");
  const end = RUNTIME_SOURCE.indexOf("\n  async fillPromotedField(", start);
  const fn = RUNTIME_SOURCE.slice(start, end);

  const gateStart = fn.indexOf("const associatedFieldResolution");
  assert.notEqual(gateStart, -1, "the gated associatedField resolution attempt must exist inside clickPromotedTarget");
  const gateBlock = fn.slice(gateStart, fn.indexOf("resolved = recordedStructuralResolution", gateStart));
  assert.match(gateBlock, /!recordedStructuralResolution\?\.locator/);
  assert.match(gateBlock, /!structuredCheckboxResolution\?\.locator/);
  assert.match(gateBlock, /options\.associatedField/);
  assert.match(gateBlock, /await resolveActionTarget\(/);
  assert.match(gateBlock, /associatedField: options\.associatedField/, "the shared resolver must be called with the transported associatedField");
});

test("4/RESOLUTION_STATE_INVARIANT: a Step6-like click with no certified authority and only associatedField still reports resolutionState=runtime_resolution_required and is never upgraded to certified_structural", () => {
  const scenario = buildStep6Scenario();
  const caseResult = buildCaseResult({
    steps: [{ index: 6, action: "click", status: "found", targetText: "Synthetic Button", associatedField: "Formulario de solicitud" } as any],
  });
  const sourceScenario = buildPromotionSourceScenario(scenario, caseResult);
  const contract = buildSpecExecutionContract(buildStep6Plan(), sourceScenario);
  const step = contract.steps.find((s) => s.scenarioStepIndex === 6);
  assert.ok(step);
  assert.equal(step!.resolutionState, "runtime_resolution_required");
  assert.equal(step!.certifiedTechnicalTarget?.targetType, "display", "no structural upgrade -- same pre-existing Tier-5 display fallback as before this ticket");
});

test("5/LEGACY_REGRESSION: a runtime_resolution_required click with no associatedField anywhere behaves exactly as before -- no associatedField field emitted at any boundary", () => {
  const scenario: TestScenario = {
    source: "jira",
    externalId: "REC-STEP6B-SYNTH",
    caseId: 0,
    title: "Synthetic step6-like click, no field hint",
    steps: [{ index: 6, action: "Presionar Synthetic Button", dataHints: [] } as TestScenario["steps"][number]],
  };
  const caseResult = buildCaseResult({
    steps: [{ index: 6, action: "click", status: "found", targetText: "Synthetic Button" } as any],
  });
  const sourceScenario = buildPromotionSourceScenario(scenario, caseResult);
  const propagatedStep = sourceScenario.steps?.find((s) => s.index === 6);
  assert.ok(propagatedStep);
  assert.equal((propagatedStep as any).associatedField, undefined);

  const contract = buildSpecExecutionContract(buildStep6Plan(), sourceScenario);
  const step = contract.steps.find((s) => s.scenarioStepIndex === 6);
  assert.ok(step);
  assert.equal(step!.associatedField, undefined);
  assert.equal(step!.resolutionState, "runtime_resolution_required");

  const targetSpecPath = path.resolve(
    process.cwd(),
    "automations/apps/synthetic-app/sections/synthetic-section/cases/synthetic-case/case.spec.ts",
  );
  const result = compileDeterministicSpecRaw(contract, { targetSpecPath });
  assert.doesNotMatch(result.source, /associatedField:/, "no associatedField must be emitted when none exists anywhere upstream");
});
