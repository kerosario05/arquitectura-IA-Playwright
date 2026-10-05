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

test("2A/RECORDED_OPTION_LINEAGE: an exact recorded option inherits only its preceding same-control owner field and passes its exact role ref to the shared resolver", () => {
  const sourceScenario = {
    source: "jira",
    externalId: "REC-SELECTION-LINEAGE-SYNTH",
    caseId: 0,
    title: "Synthetic recorded selection lineage",
    steps: [
      {
        index: 4,
        action: "Presionar campo",
        associatedField: "Campo propietario",
        controlIdentity: "recording-scope|owner",
        recordingActionType: "click",
      },
      {
        index: 5,
        action: "Presionar opción",
        associatedField: "Opción registrada",
        controlIdentity: "recording-scope|option|role|option|Opción registrada",
        recordingActionType: "click",
        technicalTargetRef: "role:option|Opción registrada",
        technicalTargetRefs: ["role:option|Opción registrada"],
        technicalTargetCandidates: [{
          validatedByInteraction: true,
          certifiedFrom: "recording",
          targetType: "structural",
          locatorCandidates: [{ strategy: "css", value: '[aria-labelledby="ephemeral-owner-id"][role="option"]', confidence: 0.85 }],
          structuralContext: {
            owner: { tag: "div", role: "option" },
            stableDirectAttributes: { "aria-labelledby": "ephemeral-owner-id", role: "option" },
            stableDescendants: [{ relation: "descendant", tag: "span", stableAttributes: { id: "ephemeral-owner-id" } }],
            semanticShape: ["span"],
            deterministicStructuralIdentity: true,
            structuralIdentityMatchCount: 1,
            scopeIdentity: { strategy: "id", value: "ephemeral-scope-id" },
            targetFingerprint: "synthetic-fingerprint",
            captureScopeUnique: true,
            captureTargetMatchCount: 1,
          },
          confidence: 0.85,
          certificationTier: 1,
        }],
      },
    ],
  } as any;
  const plan = {
    ...buildStep6Plan(),
    steps: [
      { index: 4, action: "click", target: { strategy: "text", value: "Campo propietario" }, description: "Presionar campo" },
      { index: 5, action: "click", target: { strategy: "text", value: "Opción registrada" }, description: "Presionar opción" },
    ],
  } as any;
  const contract = buildSpecExecutionContract(plan, sourceScenario);
  const optionStep = contract.steps.find((step) => step.scenarioStepIndex === 5);
  assert.ok(optionStep);
  assert.equal(optionStep!.associatedField, "Opción registrada", "the target's own association remains intact");
  assert.equal(optionStep!.selectionActivationField, "Campo propietario", "the trigger owner comes from same-control recorded lineage");

  const targetSpecPath = path.resolve(process.cwd(), "automations/apps/synthetic-app/sections/synthetic-section/cases/synthetic-case/case.spec.ts");
  const compiled = compileDeterministicSpecRaw(contract, { targetSpecPath });
  assert.match(compiled.source, /selectionActivationField: 'Campo propietario'/);
  assert.ok(compiled.source.includes("technicalTargetRefs: ['role:option|Opción registrada']"));
  assert.ok(compiled.source.includes("target: 'role:option|Opción registrada'"), "the stale structural CSS must not replace the exact role ref");

  const clickStart = RUNTIME_SOURCE.indexOf("async clickPromotedTarget(options: PromotedClickOptions)");
  const clickEnd = RUNTIME_SOURCE.indexOf("\n  async fillPromotedField(", clickStart);
  const clickSource = RUNTIME_SOURCE.slice(clickStart, clickEnd);
  assert.match(clickSource, /associatedField: options\.selectionActivationField \?\? options\.associatedField/);
  assert.match(clickSource, /recordedTechnicalTargetRefs: options\.technicalTargetRefs/);
});

test("2B/STRUCTURAL_OPTION_RETRY: recorded option owner-lineage resolution also supplies selection observation when structural scope resolves", () => {
  const start = RUNTIME_SOURCE.indexOf("private async clickPromotedTargetViaStructuralAuthority(options: PromotedClickOptions)");
  const end = RUNTIME_SOURCE.indexOf("\n  async clickPromotedTarget(", start);
  const fn = RUNTIME_SOURCE.slice(start, end);
  assert.match(fn, /recordedOptionRef && options\.selectionActivationField/);
  assert.doesNotMatch(fn, /!resolution && recordedOptionRef/);
  assert.match(fn, /const resolvedLocator = \(causalOptionResolution\?\.status === "resolved" \? causalOptionResolution\.locator : undefined\)\s*\?\? resolution\?\.locator/);
  assert.match(fn, /recordedTechnicalTargetRefs: options\.technicalTargetRefs/);
  assert.match(fn, /associatedField: options\.selectionActivationField/);
  assert.match(fn, /if \(!resolvedLocator\)[\s\S]*?structural_authority_not_unique_or_unresolved/);
  assert.match(fn, /capturePromotedSelectionStateProbe\([\s\S]*?options\.selectionActivationField/);
});

test("2C/SELECTION_STATE_RECOGNITION: runtime observes ARIA option selection and the recorded combobox value", () => {
  const start = RUNTIME_SOURCE.indexOf("async function readPromotedInteractiveState(");
  const end = RUNTIME_SOURCE.indexOf("\ntype PromotedSelectionStateProbe", start);
  const fn = RUNTIME_SOURCE.slice(start, end);
  assert.match(fn, /getAttribute\("aria-selected"\)/);
  assert.match(fn, /role === "combobox"/);
  assert.match(fn, /element\.innerText \|\| element\.textContent/);
  assert.match(fn, /const nativeValue = typeof element\.value === "string" \? element\.value\.trim\(\) : ""/);
  assert.match(fn, /const selectionValue = nativeValue \|\| ariaValue \|\|/);
  assert.match(RUNTIME_SOURCE, /expectedValue: semanticNameFromRef\(optionRef\)/);
  assert.match(RUNTIME_SOURCE, /signal=recorded_option_value_satisfied/);
  assert.match(RUNTIME_SOURCE, /optionAlreadySelected: optionBefore\?\.selected === true/);
  assert.match(RUNTIME_SOURCE, /signal=recorded_option_already_selected/);
  assert.match(RUNTIME_SOURCE, /causalOptionResolution\?\.status === "resolved" \? resolvedLocator : undefined/);
  assert.match(RUNTIME_SOURCE, /capturePromotedSelectionStateProbe\(this\.page, options\.target, targetIdentity, options\.selectionActivationField\)/);
  assert.match(RUNTIME_SOURCE, /strategy: `recorded-selection-owner:/);
  assert.match(RUNTIME_SOURCE, /includeRenderedText: selectionProbe\.strategy\.startsWith\("recorded-selection-owner:"\)/);
  assert.match(RUNTIME_SOURCE, /includeRenderedText: true/);
  assert.match(RUNTIME_SOURCE, /valuePresent=\$\{Boolean\(state\?\.value\)\}/);
  assert.match(RUNTIME_SOURCE, /signal=recorded_option_surface_closed/);
  assert.match(RUNTIME_SOURCE, /recorded_option_keyboard_activation_retry/);
  assert.match(RUNTIME_SOURCE, /exactOption\.press\("Enter"/);
});

test("2D/UNBOUND_GRID_FILL: an unbound field retries through the shared header/row/cell resolver before generated callback fallback", () => {
  const start = RUNTIME_SOURCE.indexOf("async fillPromotedField(options: PromotedFillOptions)");
  const end = RUNTIME_SOURCE.indexOf("\n  async ", start + 10);
  const fn = RUNTIME_SOURCE.slice(start, end);
  assert.match(fn, /unboundGridFieldResolution = !recorderRuntimeResolution/);
  assert.match(fn, /actionType: "action_fill", recordingActionType: "fill"/);
  assert.match(fn, /unboundGridFieldResolution\?\.status === "resolved"/);
  assert.match(fn, /locator: unboundGridFieldResolution\.locator/);
  assert.match(fn, /targetIdentity\.technicalTargetRefs\.length === 0/);
});

test("2D1/ENTITY_GRID_FILL: promoted fill activates and resolves the editor through the shared row-scoped fill resolver", () => {
  const start = RUNTIME_SOURCE.indexOf("async fillPromotedField(options: PromotedFillOptions)");
  const end = RUNTIME_SOURCE.indexOf("\n  async ", start + 10);
  const fn = RUNTIME_SOURCE.slice(start, end);
  assert.match(fn, /resolveFillTarget\(/);
  assert.match(fn, /rowScope: entityRowScope \?\? rowScopeFromPromotedRef\(parsedTargetRefs\.rowRef\)/);
  assert.match(fn, /entityScope: targetIdentity\.entityScope \?\? options\.entityScope/);
  assert.match(fn, /gridFillResolution\?\.status === "resolved"/);
  assert.match(fn, /locatorStrategy\?\.startsWith\("grid_cell_"\)/);
  assert.match(fn, /gridCellFillResolved=true strategy=\$\{gridFillResolution\.locatorStrategy\}/);
});

test("2E/RECORDED_FIELD_SELECTION: compiled selection value and owner field reach the shared grid-selection resolver", () => {
  const start = RUNTIME_SOURCE.indexOf("async selectPromotedItem(options: PromotedActionOptions)");
  const end = RUNTIME_SOURCE.indexOf("\n  async expectPromotedVisible(", start);
  const fn = RUNTIME_SOURCE.slice(start, end);
  assert.match(fn, /options\.selectionValue\?\.trim\(\)/);
  assert.match(fn, /options\.selectionField\?\.trim\(\)/);
  assert.match(fn, /actionType: "action_select"/);
  assert.match(fn, /selectionValue: runtimeValue/);
  assert.match(fn, /associatedField: options\.associatedField\?\.trim\(\) \|\| selectionField/);
  assert.match(fn, /applyPromotedNativeSelection\(structuredResolution\.locator, runtimeValue\)/);
  assert.match(RUNTIME_SOURCE, /matches\.length === 1 \? matches\[0\] : undefined/);
  assert.match(RUNTIME_SOURCE, /locator\.selectOption\(match\.value\)/);
  assert.match(fn, /structuredResolution\.selectionApplied/);
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
  assert.match(gateBlock, /options\.associatedField \|\| options\.selectionActivationField/);
  assert.match(gateBlock, /await resolveActionTarget\(/);
  assert.match(gateBlock, /associatedField: options\.selectionActivationField \?\? options\.associatedField/, "the shared resolver must prefer the recorded trigger field for transient options");
  assert.match(gateBlock, /recordedTechnicalTargetRefs: options\.technicalTargetRefs/, "the exact recorded option identity must reach the shared resolver");
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
