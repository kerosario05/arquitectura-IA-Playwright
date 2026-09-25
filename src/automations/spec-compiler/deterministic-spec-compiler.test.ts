import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { SpecExecutionContract, SpecExecutionContractStep } from "../spec-execution-contract";
import { compileDeterministicSpec as compileDeterministicSpecRaw } from "./deterministic-spec-compiler";

// Real-shape target location (automations/apps/<slug>/sections/<section>/cases/<id>/case.spec.ts)
// -- controlled, explicit targetSpecPath per the compiler's required compile context.
const TEST_TARGET_SPEC_PATH = path.resolve(
  process.cwd(),
  "automations/apps/synthetic-app/sections/synthetic-section/cases/synthetic-case/case.spec.ts",
);

function compileDeterministicSpec(contract: SpecExecutionContract) {
  return compileDeterministicSpecRaw(contract, { targetSpecPath: TEST_TARGET_SPEC_PATH });
}

function step(overrides: Partial<SpecExecutionContractStep>): SpecExecutionContractStep {
  return {
    contractStepIndex: 0,
    scenarioStepIndex: 0,
    originalText: "synthetic step",
    operation: "fill",
    required: true,
    executionStatus: "executed",
    evidenceRefs: [],
    ...overrides,
  };
}

function contract(steps: SpecExecutionContractStep[], overrides: Partial<SpecExecutionContract> = {}): SpecExecutionContract {
  return {
    version: "1",
    scenarioId: "SYN-001",
    title: "synthetic scenario",
    steps,
    unresolvedRequiredOracles: [],
    diagnostics: { requiredScenarioSteps: steps.length, representedScenarioSteps: steps.length, missingScenarioSteps: [] },
    ...overrides,
  } as SpecExecutionContract;
}

const FILL_STEP = step({
  scenarioStepIndex: 1,
  operation: "fill",
  target: { strategy: "role", role: "textbox", name: "Usuario" },
  valueKey: "usuario",
});

const FILL_STEP_2 = step({
  scenarioStepIndex: 2,
  operation: "fill",
  target: { strategy: "role", role: "textbox", name: "Contraseña" },
  valueKey: "clave",
});

const PRESS_STEP = step({
  scenarioStepIndex: 3,
  operation: "press",
  target: { strategy: "role", role: "textbox", name: "Contraseña" },
  value: "Enter",
});

const CLICK_STEP = step({
  scenarioStepIndex: 4,
  operation: "click",
  target: { strategy: "role", role: "button", name: "Ingresar" },
});

const NAV_ORACLE_STEP = step({
  scenarioStepIndex: 5,
  operation: "assertUrl",
  oracle: {
    type: "navigation_transition",
    backed: true,
    polarity: "positive",
    mechanism: {
      source: "url_state",
      method: "detectAuthGate",
      expected: { oracleKind: "url_state", urlPattern: "**/dashboard" },
    },
  },
});

test("1/fill generates exactly the CORE fillPromotedField wrapper", () => {
  const result = compileDeterministicSpec(contract([FILL_STEP]));
  assert.equal(result.unsupportedCapabilities.length, 0);
  assert.match(result.source, /pageObject\.fill\(\{/);
  assert.equal((result.source.match(/pageObject\.fill\(/g) ?? []).length, 1);
  assert.equal(result.bindings.length, 1);
  assert.equal(result.bindings[0].runtimeMethod, "fillPromotedField");
});

test("2/press preserves operation, structured target, and key=Enter", () => {
  const result = compileDeterministicSpec(contract([PRESS_STEP]));
  assert.equal(result.unsupportedCapabilities.length, 0);
  assert.match(result.source, /pageObject\.press\(\{/);
  assert.match(result.source, /key: 'Enter'/);
  assert.match(result.source, /target: 'role:textbox\|Contraseña'/);
  assert.equal(result.bindings[0].runtimeMethod, "pressPromotedTarget");
});

test("3/click generates exactly one action", () => {
  const result = compileDeterministicSpec(contract([CLICK_STEP]));
  assert.equal(result.unsupportedCapabilities.length, 0);
  assert.equal((result.source.match(/pageObject\.click\(/g) ?? []).length, 1);
  assert.equal(result.bindings[0].runtimeMethod, "clickPromotedTarget");
});

test("4/sequence fill->fill->press->click preserves order and cardinality", () => {
  const result = compileDeterministicSpec(contract([FILL_STEP, FILL_STEP_2, PRESS_STEP, CLICK_STEP]));
  assert.equal(result.unsupportedCapabilities.length, 0);
  assert.equal(result.bindings.length, 4);
  assert.deepEqual(
    result.bindings.map((b) => b.operation),
    ["fill", "fill", "press", "click"],
  );
  const fillIdx = result.source.indexOf("pageObject.fill(");
  const fill2Idx = result.source.indexOf("pageObject.fill(", fillIdx + 1);
  const pressIdx = result.source.indexOf("pageObject.press(");
  const clickIdx = result.source.indexOf("pageObject.click(");
  assert.ok(fillIdx < fill2Idx && fill2Idx < pressIdx && pressIdx < clickIdx);
});

test("5/determinism: compiling the same input twice yields identical source", () => {
  const c = contract([FILL_STEP, FILL_STEP_2, PRESS_STEP, CLICK_STEP, NAV_ORACLE_STEP]);
  const first = compileDeterministicSpec(c);
  const second = compileDeterministicSpec(c);
  assert.equal(first.source, second.source);
  assert.deepEqual(first.bindings, second.bindings);
  assert.deepEqual(first.unsupportedCapabilities, second.unsupportedCapabilities);
});

test("6/unsupported operation is reported and never invents code", () => {
  const unsupportedStep = step({ scenarioStepIndex: 9, operation: "select", target: { strategy: "role", role: "combobox", name: "Pais" } });
  const result = compileDeterministicSpec(contract([unsupportedStep]));
  assert.equal(result.bindings.length, 0);
  assert.equal(result.unsupportedCapabilities.length, 1);
  assert.match(result.unsupportedCapabilities[0], /operation_unsupported:select/);
  assert.doesNotMatch(result.source, /selectPromotedItem/);
});

test("7/sensitive dataset: source carries the key/ref, never the literal value", () => {
  const sensitiveFill = step({
    scenarioStepIndex: 1,
    operation: "fill",
    target: { strategy: "role", role: "textbox", name: "Contraseña" },
    valueKey: "clave-secreta-usuario",
    value: "hunter2-should-never-appear",
  });
  const result = compileDeterministicSpec(contract([sensitiveFill]));
  assert.doesNotMatch(result.source, /hunter2/);
  assert.match(result.source, /PROMOTED_CLAVE_SECRETA_USUARIO/);
  assert.equal(result.bindings[0].dataRef, "clave-secreta-usuario");
});

test("8/no-POM-invention: incomplete metadata never generates executeAction or invented methods", () => {
  const unknownStep = step({ scenarioStepIndex: 1, operation: "fill", target: undefined, valueKey: "campo-x" });
  const result = compileDeterministicSpec(contract([unknownStep]));
  assert.equal(result.bindings.length, 0);
  assert.equal(result.unsupportedCapabilities.length, 1);
  assert.match(result.unsupportedCapabilities[0], /fill_missing_structured_target/);
  assert.doesNotMatch(result.source, /executeAction/);
});

test("9/navigation_transition materializes the oracle via the existing CORE API", () => {
  const result = compileDeterministicSpec(contract([NAV_ORACLE_STEP]));
  assert.equal(result.unsupportedCapabilities.length, 0);
  assert.match(result.source, /promotedRuntime\.expectPromotedVisible\(\{/);
  assert.match(result.source, /expectedUrl: '\*\*\/dashboard'/);
  assert.equal(result.bindings[0].runtimeMethod, "expectPromotedVisible");
});

test("9b/navigation_transition without a structured expected URL is unsupported, never defaults to current URL", () => {
  const noPatternStep = step({
    scenarioStepIndex: 5,
    operation: "assertUrl",
    oracle: { type: "navigation_transition", backed: true, mechanism: { source: "url_state", method: "detectAuthGate", expected: { oracleKind: "url_state" } } },
  });
  const result = compileDeterministicSpec(contract([noPatternStep]));
  assert.equal(result.bindings.length, 0);
  assert.match(result.unsupportedCapabilities[0], /oracle_unsupported/);
  assert.doesNotMatch(result.source, /page\.url\(\)/);
});

test("11/click step with an attached navigation_transition oracle emits both, action before oracle", () => {
  const clickWithOracle = step({
    scenarioStepIndex: 7,
    operation: "click",
    target: { strategy: "role", role: "button", name: "Depurar" },
    oracle: {
      type: "navigation_transition",
      backed: true,
      polarity: "positive",
      mechanism: {
        source: "url_state",
        method: "expectPromotedVisible",
        expected: { oracleKind: "navigation_transition", urlPattern: "**/requests/create/multiproduct" },
      },
    },
  });
  const result = compileDeterministicSpec(contract([clickWithOracle]));

  assert.equal(result.unsupportedCapabilities.length, 0);
  assert.equal((result.source.match(/pageObject\.click\(/g) ?? []).length, 1);
  assert.equal((result.source.match(/promotedRuntime\.expectPromotedVisible\(/g) ?? []).length, 1);

  const clickBinding = result.bindings.find((b) => b.runtimeMethod === "clickPromotedTarget");
  const oracleBinding = result.bindings.find((b) => b.runtimeMethod === "expectPromotedVisible");
  assert.ok(clickBinding, "click action binding must be emitted");
  assert.ok(oracleBinding, "oracle binding must be emitted");

  const clickIdx = result.source.indexOf("pageObject.click(");
  const oracleIdx = result.source.indexOf("expectPromotedVisible");
  assert.ok(clickIdx < oracleIdx, "action must precede oracle in emitted source");
});

test("10/binding manifest relates each action identity to operation + runtimeMethod + targetRef/dataRef", () => {
  const result = compileDeterministicSpec(contract([FILL_STEP, PRESS_STEP, CLICK_STEP]));
  assert.deepEqual(result.bindings, [
    { scenarioStepIndex: 1, operation: "fill", runtimeMethod: "fillPromotedField", pomMethod: "fill", targetRef: "Usuario", dataRef: "usuario" },
    { scenarioStepIndex: 3, operation: "press", runtimeMethod: "pressPromotedTarget", pomMethod: "press", targetRef: "role:textbox|Contraseña" },
    { scenarioStepIndex: 4, operation: "click", runtimeMethod: "clickPromotedTarget", pomMethod: "click", targetRef: "Ingresar" },
  ]);
});

test("12/click with an authoritative technicalTargetRef preserves it exactly, no reconstruction from display text", () => {
  const clickStep = step({
    scenarioStepIndex: 7,
    operation: "click",
    target: { strategy: "text", value: "Depurar" },
    technicalTargetRef: "role:button|Depurar",
  });
  const result = compileDeterministicSpec(contract([clickStep]));

  assert.equal(result.unsupportedCapabilities.length, 0);
  assert.equal(result.bindings.length, 1);
  assert.equal(result.bindings[0].targetRef, "role:button|Depurar");
  assert.equal((result.source.match(/pageObject\.click\(/g) ?? []).length, 1);
  assert.match(result.source, /parseSerializedTechnicalTargetString\('role:button\|Depurar'\)/);
  assert.doesNotMatch(result.source, /getByText\('Depurar'\)/);
  assert.doesNotMatch(result.source, /getByRole\(/);
});

test("13/press with an authoritative technicalTargetRef passes it through verbatim, no double-encoding", () => {
  const pressStep = step({
    scenarioStepIndex: 3,
    operation: "press",
    target: { strategy: "text", value: "role:textbox|Contraseña" },
    technicalTargetRef: "role:textbox|Contraseña",
    value: "Enter",
  });
  const result = compileDeterministicSpec(contract([pressStep]));

  assert.equal(result.unsupportedCapabilities.length, 0);
  assert.equal(result.bindings[0].targetRef, "role:textbox|Contraseña");
  assert.match(result.source, /target: 'role:textbox\|Contraseña',/);
  assert.match(result.source, /key: 'Enter'/);
  assert.doesNotMatch(result.source, /text:role:textbox\|Contraseña/);
});

test("14/no technicalTargetRef but a certified non-ambiguous structural target -- reuses the certified locator, not raw display text", () => {
  const fillStep = step({
    scenarioStepIndex: 1,
    operation: "fill",
    target: { strategy: "text", value: "Usuario" },
    valueKey: "usuario",
    certifiedTechnicalTarget: {
      interactionEvidence: [],
      validatedByInteraction: true,
      certifiedFrom: "recording",
      targetType: "structural",
      locatorCandidates: [{ strategy: "role", value: "textbox|Usuario", confidence: 0.85 }],
      confidence: 0.85,
      certificationTier: 2,
    } as any,
  });
  const result = compileDeterministicSpec(contract([fillStep]));

  assert.equal(result.unsupportedCapabilities.length, 0);
  assert.equal(result.bindings[0].targetRef, "role:textbox|Usuario");
  assert.match(result.source, /parseSerializedTechnicalTargetString\('role:textbox\|Usuario'\)/);
  assert.doesNotMatch(result.source, /getByText\('Usuario'\)/);
});

test("15/no technicalTargetRef and only an ambiguous certified structural target -- fails closed, no locator invented", () => {
  const clickStep = step({
    scenarioStepIndex: 6,
    operation: "click",
    target: { strategy: "text", value: "Número de identificación" },
    valueKey: "numero_de_identificacion",
    certifiedTechnicalTarget: {
      interactionEvidence: [],
      validatedByInteraction: true,
      certifiedFrom: "recording",
      targetType: "structural",
      locatorCandidates: [{ strategy: "role", value: "button", confidence: 0.85 }],
      structuralContext: { identityAmbiguous: true, structuralIdentityMatchCount: 2, deterministicStructuralIdentity: false },
      confidence: 0.85,
      certificationTier: 4,
    } as any,
  });
  const result = compileDeterministicSpec(contract([clickStep]));

  assert.equal(result.bindings.length, 0, "no locator may be invented from ambiguous certified evidence");
  assert.equal(result.unsupportedCapabilities.length, 1);
  assert.match(result.unsupportedCapabilities[0], /click_insufficient_authority:ambiguous_structural_certification/);
  assert.doesNotMatch(result.source, /getByRole\('button'\)/);
  assert.doesNotMatch(result.source, /getByText\('Número de identificación'\)/);
});

test("16/no technicalTargetRef and a tier-5 display certification -- keeps the existing target.strategy/value fallback unchanged", () => {
  const fillStep = step({
    scenarioStepIndex: 5,
    operation: "fill",
    target: { strategy: "text", value: "Número de identificación" },
    valueKey: "numero_de_identificacion",
    certifiedTechnicalTarget: {
      interactionEvidence: [],
      validatedByInteraction: false,
      certifiedFrom: "discovery",
      targetType: "display",
      locatorCandidates: [{ strategy: "text", value: "Número de identificación", confidence: 0.5 }],
      confidence: 0.5,
      certificationTier: 5,
    } as any,
  });
  const result = compileDeterministicSpec(contract([fillStep]));

  assert.equal(result.unsupportedCapabilities.length, 0);
  assert.equal(result.bindings.length, 1);
  assert.match(result.source, /getByText\('Número de identificación'\)/);
});

test("21/contract.appSlug present -- compiler emits APP_SLUG/SECTION_SLUG/SCENARIO_ID so the existing persisted-contract lookup (clickPromotedTarget's resolveActionTarget wiring) can activate", () => {
  const result = compileDeterministicSpec(
    contract([FILL_STEP], { appSlug: "portal-comercial", sectionSlug: "default-section", scenarioId: "PREVIEW-001" }),
  );
  assert.match(result.source, /process\.env\.APP_SLUG = 'portal-comercial';/);
  assert.match(result.source, /process\.env\.SECTION_SLUG = 'default-section';/);
  assert.match(result.source, /process\.env\.SCENARIO_ID = 'PREVIEW-001';/);
  assert.match(result.source, /process\.env\.SCENARIO_TITLE = 'synthetic scenario';/);
});

test("28/metadata: SCENARIO_TITLE is emitted from contract.title (the same authoritative field used for the test name), exactly one line", () => {
  const result = compileDeterministicSpec(
    contract([FILL_STEP], { appSlug: "portal-comercial", sectionSlug: "default-section", scenarioId: "PREVIEW-001", title: "Segunta Prueba" }),
  );
  const matches = result.source.match(/process\.env\.SCENARIO_TITLE = '[^']*';/g) ?? [];
  assert.equal(matches.length, 1);
  assert.match(result.source, /process\.env\.SCENARIO_TITLE = 'Segunta Prueba';/);
});

test("29/metadata escaping: a title with special characters (quote, backslash, newline) is escaped consistently and deterministically", () => {
  const specialTitle = "Segunta \"Prueba\" \\ con'quote\ny salto";
  const c = contract([FILL_STEP], { appSlug: "portal-comercial", sectionSlug: "default-section", scenarioId: "PREVIEW-001", title: specialTitle });
  const first = compileDeterministicSpec(c);
  const second = compileDeterministicSpec(c);
  assert.equal(first.source, second.source);
  // No raw, unescaped single-quote or newline breaks the single-quoted string literal.
  const titleLineMatch = first.source.match(/process\.env\.SCENARIO_TITLE = '((?:[^'\\]|\\.)*)';/);
  assert.ok(titleLineMatch, "SCENARIO_TITLE line must be present and syntactically closed on one line");
  assert.doesNotMatch(titleLineMatch![0], /\n/);
});

test("30/no oracle uses expect -- only { test } is imported, never unused expect", () => {
  const result = compileDeterministicSpec(contract([FILL_STEP, CLICK_STEP]));
  assert.match(result.source, /^import \{ test \} from '@playwright\/test';/m);
  assert.doesNotMatch(result.source, /import \{ test, expect \}/);
});

test("31/a navigation_transition oracle is present -- expect is imported exactly once", () => {
  const result = compileDeterministicSpec(contract([CLICK_STEP, NAV_ORACLE_STEP]));
  assert.match(result.source, /^import \{ test, expect \} from '@playwright\/test';/m);
  assert.equal((result.source.match(/import \{ test, expect \}/g) ?? []).length, 1);
});

test("32/an unsupported/missing-urlPattern oracle never triggers an expect import (mirrors compileNavigationTransitionOracle's own fail-closed condition)", () => {
  const noPatternStep = step({
    scenarioStepIndex: 5,
    operation: "assertUrl",
    oracle: { type: "navigation_transition", backed: true, mechanism: { source: "url_state", method: "detectAuthGate", expected: { oracleKind: "url_state" } } },
  });
  const result = compileDeterministicSpec(contract([FILL_STEP, noPatternStep]));
  assert.doesNotMatch(result.source, /import \{ test, expect \}/);
  assert.match(result.source, /^import \{ test \} from '@playwright\/test';/m);
});

test("22/contract.appSlug absent -- no env var lines emitted, source unchanged from before this fix", () => {
  const result = compileDeterministicSpec(contract([FILL_STEP]));
  assert.doesNotMatch(result.source, /process\.env\.APP_SLUG/);
});

test("23/POM: generated source is test -> Page Object -> promoted runtime, with explicit per-operation methods, never a generic executeAction", () => {
  const result = compileDeterministicSpec(contract([FILL_STEP, PRESS_STEP, CLICK_STEP]));
  assert.match(result.source, /class DeterministicPromotedPage \{/);
  assert.match(result.source, /fill\(options: Parameters<typeof this\.runtime\.fillPromotedField>\[0\]\) \{ return this\.runtime\.fillPromotedField\(options\); \}/);
  assert.match(result.source, /click\(options: Parameters<typeof this\.runtime\.clickPromotedTarget>\[0\]\) \{ return this\.runtime\.clickPromotedTarget\(options\); \}/);
  assert.match(result.source, /press\(options: Parameters<typeof this\.runtime\.pressPromotedTarget>\[0\]\) \{ return this\.runtime\.pressPromotedTarget\(options\); \}/);
  assert.match(result.source, /const pageObject = new DeterministicPromotedPage\(promotedRuntime\);/);
  assert.doesNotMatch(result.source, /executeAction/);
  // Every emitted action call goes through the Page Object, never the runtime directly.
  assert.doesNotMatch(result.source, /promotedRuntime\.(fillPromotedField|clickPromotedTarget|pressPromotedTarget)\(/);
});

test("24/POM authority: business text matching an existing Page Object/method name never influences class or method selection", () => {
  // "LoginPage"/"fillUsername" exist as real names in types/pom-ownership.ts's
  // SemanticMethodIntent-derived tables -- the compiler must never consult them
  // or react to business text resembling them.
  const loginLikeStep = step({
    scenarioStepIndex: 1,
    operation: "fill",
    target: { strategy: "text", value: "LoginPage fillUsername Usuario" },
    valueKey: "usuario",
  });
  const genericStep = step({
    scenarioStepIndex: 1,
    operation: "fill",
    target: { strategy: "text", value: "Completely unrelated business label" },
    valueKey: "usuario",
  });
  const loginLikeResult = compileDeterministicSpec(contract([loginLikeStep]));
  const genericResult = compileDeterministicSpec(contract([genericStep]));

  // The business text is legitimately embedded as display-fallback locator text
  // (getByText(...) on the exact scenario label -- unrelated, pre-existing behavior),
  // but it must never produce a business-named Page Object class or method.
  assert.doesNotMatch(loginLikeResult.source, /class LoginPage/);
  assert.doesNotMatch(loginLikeResult.source, /\bfillUsername\(/);
  // Both compilations produce the identical POM class + identical pomMethod
  // regardless of business text, proving text played no role in class/method selection.
  assert.equal(loginLikeResult.bindings[0].pomMethod, genericResult.bindings[0].pomMethod);
  assert.equal(loginLikeResult.bindings[0].pomMethod, "fill");
  assert.match(loginLikeResult.source, /class DeterministicPromotedPage \{/);
  assert.match(genericResult.source, /class DeterministicPromotedPage \{/);
});

test("25/POM authority: no keyword-based registry -- missing target authority still fails closed, never falls back to text/keyword inference", () => {
  const insufficientStep = step({
    scenarioStepIndex: 1,
    operation: "click",
    // No target, no certifiedTechnicalTarget, no technicalTargetRef -- runtime_resolution_required
    // with genuinely zero structured evidence must fail closed, never infer a locator from
    // business text like "Depurar" (which does not appear anywhere in this fixture).
    resolutionState: "runtime_resolution_required",
  } as any);
  const result = compileDeterministicSpec(contract([insufficientStep]));
  assert.equal(result.bindings.length, 0);
  assert.equal(result.unsupportedCapabilities.length, 1);
  assert.match(result.unsupportedCapabilities[0], /click_insufficient_authority:runtime_resolution_required_missing_structured_evidence/);
  assert.doesNotMatch(result.source, /getByText\(/);
});

test("26/runtime: generated source never bypasses the promoted runtime with raw Playwright calls or fixed sleeps", () => {
  const result = compileDeterministicSpec(contract([FILL_STEP, PRESS_STEP, CLICK_STEP, NAV_ORACLE_STEP]));
  assert.doesNotMatch(result.source, /waitForTimeout/);
  assert.doesNotMatch(result.source, /\bsleep\(/i);
  assert.doesNotMatch(result.source, /page\.click\(/);
  assert.doesNotMatch(result.source, /page\.fill\(/);
  assert.doesNotMatch(result.source, /page\.press\(/);
  // Locators are built and clicked/filled only inside the promoted-runtime action
  // callbacks (fill:/action:), never as a standalone page.<locator>().click()/.fill() call.
});

test("27/aiInvoked=false: no AI/provider import or call anywhere in the compiler module's own output", () => {
  const result = compileDeterministicSpec(contract([FILL_STEP, PRESS_STEP, CLICK_STEP]));
  assert.doesNotMatch(result.source, /openai|anthropic|codex|copilot|ai-provider|agent/i);
});

test("17/resolutionState=runtime_resolution_required + sufficient structured evidence -- action represented via existing runtime resolution, no technicalTargetRef invented, not marked certified", () => {
  const clickStep = step({
    scenarioStepIndex: 6,
    operation: "click",
    target: { strategy: "text", value: "Número de identificación" },
    valueKey: "numero_de_identificacion",
    resolutionState: "runtime_resolution_required",
    certifiedTechnicalTarget: {
      interactionEvidence: [],
      validatedByInteraction: true,
      certifiedFrom: "recording",
      targetType: "structural",
      locatorCandidates: [{ strategy: "role", value: "button", confidence: 0.85 }],
      structuralContext: { identityAmbiguous: true, structuralIdentityMatchCount: 2, deterministicStructuralIdentity: false },
      confidence: 0.85,
      certificationTier: 4,
    } as any,
  } as any);
  const result = compileDeterministicSpec(contract([clickStep]));

  assert.equal(result.unsupportedCapabilities.length, 0, "upstream explicitly deferred resolution -- not a compile-time failure");
  assert.equal(result.bindings.length, 1);
  assert.equal(result.bindings[0].targetRef, "role:button");
  assert.equal(result.bindings[0].runtimeResolutionRequired, true);
  assert.match(result.source, /parseSerializedTechnicalTargetString\('role:button'\)/);
  assert.match(result.source, /technicalTargetRefs: \['role:button'\]/);
  assert.doesNotMatch(result.source, /getByText\('Número de identificación'\)/);
});

test("18/resolutionState=runtime_resolution_required + no structured evidence at all -- fails closed", () => {
  const clickStep = step({
    scenarioStepIndex: 6,
    operation: "click",
    resolutionState: "runtime_resolution_required",
  } as any);
  const result = compileDeterministicSpec(contract([clickStep]));

  assert.equal(result.bindings.length, 0);
  assert.equal(result.unsupportedCapabilities.length, 1);
  assert.match(result.unsupportedCapabilities[0], /click_insufficient_authority:runtime_resolution_required_missing_structured_evidence/);
});

test("19/resolutionState=unresolved_unrecoverable -- fails closed regardless of any other evidence present", () => {
  const fillStep = step({
    scenarioStepIndex: 1,
    operation: "fill",
    target: { strategy: "role", role: "textbox", name: "Usuario" },
    technicalTargetRef: "role:textbox|Usuario",
    resolutionState: "unresolved_unrecoverable",
  } as any);
  const pressStep = step({
    scenarioStepIndex: 3,
    operation: "press",
    target: { strategy: "role", role: "textbox", name: "Contraseña" },
    value: "Enter",
    resolutionState: "unresolved_unrecoverable",
  } as any);
  const result = compileDeterministicSpec(contract([fillStep, pressStep]));

  assert.equal(result.bindings.length, 0);
  assert.deepEqual(
    result.unsupportedCapabilities.sort(),
    [
      "scenarioStepIndex=1:fill_insufficient_authority:unresolved_unrecoverable",
      "scenarioStepIndex=3:press_insufficient_authority:unresolved_unrecoverable",
    ].sort(),
  );
});

test("20/resolutionState=certified -- behavior unchanged from the default (no resolutionState) path", () => {
  const withCertified = compileDeterministicSpec(contract([{ ...FILL_STEP, resolutionState: "certified" } as any]));
  const withoutState = compileDeterministicSpec(contract([FILL_STEP]));
  assert.deepEqual(withCertified.bindings, withoutState.bindings);
  assert.equal(withCertified.source, withoutState.source);
});

// ---- Portable import path focal tests (real filesystem, no browser) ----

function importSpecifiersFrom(source: string): string[] {
  return [...source.matchAll(/from '([^']+)'/g)]
    .map((m) => m[1])
    .filter((spec) => spec.startsWith("."));
}

function assertAllRelativeImportsResolve(source: string, targetSpecPath: string) {
  const specifiers = importSpecifiersFrom(source);
  assert.ok(specifiers.length > 0, "fixture must actually emit at least one relative import to prove");
  for (const specifier of specifiers) {
    const resolved = path.resolve(path.dirname(targetSpecPath), specifier);
    const exists = fs.existsSync(`${resolved}.ts`) || fs.existsSync(resolved);
    assert.ok(exists, `import '${specifier}' from ${targetSpecPath} must resolve to a real file (resolved: ${resolved})`);
  }
}

test("A/portable promoted-spec-runtime import resolves from the real target case.spec.ts location", () => {
  const targetSpecPath = path.resolve(
    process.cwd(),
    "automations/apps/portal-comercial/sections/default-section/cases/preview-001-segunta-prueba/case.spec.ts",
  );
  const result = compileDeterministicSpecRaw(contract([FILL_STEP]), { targetSpecPath });
  assert.match(result.source, /from '(\.\.\/)+src\/automations\/runtime\/promoted-spec-runtime';/);
  assertAllRelativeImportsResolve(result.source, targetSpecPath);
});

test("B/portable target-resolver import resolves from the real target case.spec.ts location (technicalTargetRef path)", () => {
  const targetSpecPath = path.resolve(
    process.cwd(),
    "automations/apps/portal-comercial/sections/default-section/cases/preview-001-segunta-prueba/case.spec.ts",
  );
  const clickStep = step({ scenarioStepIndex: 1, operation: "click", technicalTargetRef: "role:button|Depurar", target: { strategy: "text", value: "Depurar" } });
  const result = compileDeterministicSpecRaw(contract([clickStep]), { targetSpecPath });
  assert.match(result.source, /from '(\.\.\/)+src\/discovery\/target-resolver';/);
  assertAllRelativeImportsResolve(result.source, targetSpecPath);
});

test("C/enumerate all compiler relative imports: every one resolves from a real target location", () => {
  const targetSpecPath = path.resolve(
    process.cwd(),
    "automations/apps/kiosko/sections/default-section/cases/synthetic-enumeration-case/case.spec.ts",
  );
  const clickStep = step({ scenarioStepIndex: 4, operation: "click", technicalTargetRef: "role:button|Depurar", target: { strategy: "text", value: "Depurar" } });
  const result = compileDeterministicSpecRaw(contract([FILL_STEP, PRESS_STEP, clickStep]), { targetSpecPath });
  const specifiers = importSpecifiersFrom(result.source);
  assert.ok(specifiers.length >= 2, "must cover both the promoted-runtime and target-resolver imports in one contract");
  assertAllRelativeImportsResolve(result.source, targetSpecPath);
});

test("D2/two different nesting depths -- both produce imports resolving to the SAME real modules (not tuned to one depth)", () => {
  const shallow = path.resolve(process.cwd(), "automations/apps/kiosko/sections/default-section/cases/depth-a/case.spec.ts");
  const deep = path.resolve(process.cwd(), "automations/apps/kiosko/sections/default-section/cases/nested/deeper/depth-b/case.spec.ts");
  const c = contract([FILL_STEP]);
  const resultShallow = compileDeterministicSpecRaw(c, { targetSpecPath: shallow });
  const resultDeep = compileDeterministicSpecRaw(c, { targetSpecPath: deep });
  assertAllRelativeImportsResolve(resultShallow.source, shallow);
  assertAllRelativeImportsResolve(resultDeep.source, deep);
  assert.notEqual(resultShallow.source, resultDeep.source, "the two different depths must produce different (correctly-adjusted) import paths");
});

test("E/determinism: same contract + same targetSpecPath -> byte-identical source (including imports)", () => {
  const targetSpecPath = path.resolve(process.cwd(), "automations/apps/kiosko/sections/default-section/cases/determinism-case/case.spec.ts");
  const c = contract([FILL_STEP, PRESS_STEP, CLICK_STEP]);
  const first = compileDeterministicSpecRaw(c, { targetSpecPath });
  const second = compileDeterministicSpecRaw(c, { targetSpecPath });
  assert.equal(first.source, second.source);
  assert.deepEqual(first.bindings, second.bindings);
});

test("21/authGateExpected transported. a contract step carrying the structured auth-gate credential authority emits it verbatim into the fill call", () => {
  const authFill = step({ scenarioStepIndex: 1, operation: "fill", target: { strategy: "role", role: "textbox", name: "Usuario" }, valueKey: "usuario", recordingActionType: "fill", authGateExpected: true });
  const result = compileDeterministicSpec(contract([authFill]));
  assert.match(result.source, /authGateExpected: true/);
});

test("22/business fill carries no authGateExpected. a business form fill is emitted without the auth-gate authority", () => {
  const businessFill = step({ scenarioStepIndex: 13, operation: "fill", target: { strategy: "role", role: "textbox", name: "Monto" }, valueKey: "monto", recordingActionType: "fill" });
  const result = compileDeterministicSpec(contract([businessFill]));
  assert.doesNotMatch(result.source, /authGateExpected/);
});
