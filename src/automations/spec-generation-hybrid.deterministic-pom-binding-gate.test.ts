import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { structuralValidation } from "./spec-generation-hybrid";
import { compileDeterministicSpec as compileDeterministicSpecRaw } from "./spec-compiler/deterministic-spec-compiler";
import { buildSpecExecutionContract } from "./spec-execution-contract";

const TARGET_SPEC_PATH = path.resolve(
  process.cwd(),
  "automations/apps/portal-comercial/sections/default-section/cases/preview-001-segunta-prueba/case.spec.ts",
);

function compileDeterministicSpec(contract: Parameters<typeof compileDeterministicSpecRaw>[0]) {
  return compileDeterministicSpecRaw(contract, { targetSpecPath: TARGET_SPEC_PATH });
}

/**
 * Proves the EXISTING structuralValidation gate recognizes the deterministic
 * compiler's POM wrapper (`pageObject.fill/click/press(...)`, forwarding to
 * `this.runtime.<runtimeMethod>(...)`) as equivalent to a direct
 * `promotedRuntime.<runtimeMethod>(...)` outer wrapper call, per
 * scenarioStepIndex -- without weakening runtime_step_binding_unresolved /
 * _ambiguous / runtime_method_operation_mismatch, which are reused unchanged.
 */

const POM_CLASS = [
  "class DeterministicPromotedPage {",
  "  constructor(private readonly runtime: ReturnType<typeof createPromotedSpecRuntime>) {}",
  "  fill(options: Parameters<typeof this.runtime.fillPromotedField>[0]) { return this.runtime.fillPromotedField(options); }",
  "  click(options: Parameters<typeof this.runtime.clickPromotedTarget>[0]) { return this.runtime.clickPromotedTarget(options); }",
  "  press(options: Parameters<typeof this.runtime.pressPromotedTarget>[0]) { return this.runtime.pressPromotedTarget(options); }",
  "}",
].join("\n");

// A tampered class where `click` internally forwards to the WRONG runtime method.
const POM_CLASS_MISWIRED_CLICK = [
  "class DeterministicPromotedPage {",
  "  constructor(private readonly runtime: ReturnType<typeof createPromotedSpecRuntime>) {}",
  "  fill(options: Parameters<typeof this.runtime.fillPromotedField>[0]) { return this.runtime.fillPromotedField(options); }",
  "  click(options: Parameters<typeof this.runtime.clickPromotedTarget>[0]) { return this.runtime.fillPromotedField(options); }",
  "  press(options: Parameters<typeof this.runtime.pressPromotedTarget>[0]) { return this.runtime.pressPromotedTarget(options); }",
  "}",
].join("\n");

function pomCall(pomMethod: string, stepIndex: number, extra = ""): string {
  return `    await pageObject.${pomMethod}({ stepIndex: ${stepIndex}, target: 'x', ${extra} });`;
}

function specWithPom(pomClass: string, calls: string[]): string {
  return [
    "import { test } from '@playwright/test';",
    "import { createPromotedSpecRuntime } from './runtime/promoted-spec-runtime';",
    pomClass,
    "test('pom step', async ({ page }) => {",
    "  const promotedRuntime = createPromotedSpecRuntime(page);",
    "  const pageObject = new DeterministicPromotedPage(promotedRuntime);",
    "  try {",
    ...calls,
    "  } finally { await promotedRuntime.finishEvidence(); }",
    "});",
  ].join("\n");
}

function baseInput(specContent: string, executionContract?: any) {
  return {
    specContent,
    expectedAppSlug: "synthetic",
    expectedSectionSlug: "synthetic-section",
    expectedScenarioId: "SYNTH-POM-1",
    expectedScenarioTitle: "Deterministic POM binding gate",
    sourceExpectedResultPresent: false,
    expectedResultText: "",
    scenarioSteps: [],
    requiredAssertions: [],
    observableOracles: [],
    executableStepIndexes: executionContract?.steps?.map((s: any) => s.scenarioStepIndex) ?? [],
    planStepActions: new Map<number, string>((executionContract?.steps ?? []).map((s: any) => [s.scenarioStepIndex, s.operation])),
    response: {
      specContent,
      coveredStepIndexes: [],
      coveredAssertions: [],
      usedPageObjects: [],
      declaredIdentifiers: [],
      unresolvedRequirements: [],
      warnings: [],
    },
    executionContract,
    availablePageObjects: [],
    observedEvidencePhrases: [],
    promotedRuntimeMethodsAllowlist: ["fillPromotedField", "clickPromotedTarget", "pressPromotedTarget", "expectPromotedVisible", "finishEvidence"],
    mode: "deterministic" as const,
  };
}

function contractWithSteps(steps: Array<{ scenarioStepIndex: number; operation: string; required?: boolean }>): any {
  return {
    version: "1.0",
    scenarioId: "SYNTH-POM-1",
    title: "Deterministic POM binding gate",
    steps: steps.map((s) => ({
      contractStepIndex: s.scenarioStepIndex - 1,
      scenarioStepIndex: s.scenarioStepIndex,
      originalText: "synthetic",
      operation: s.operation,
      target: { strategy: "role", role: "textbox", name: "x" },
      required: s.required ?? true,
      executionStatus: "executed",
      implementation: { kind: "runtime", runtimeMethod: s.operation === "fill" ? "fillPromotedField" : s.operation === "press" ? "pressPromotedTarget" : "clickPromotedTarget" },
      evidenceRefs: [],
    })),
    unresolvedRequiredOracles: [],
    diagnostics: { requiredScenarioSteps: steps.length, representedScenarioSteps: steps.length, missingScenarioSteps: [] },
  };
}

test("A/existing direct-runtime candidate still passes unchanged (regression guard for the pre-existing gate path)", () => {
  const contract = contractWithSteps([{ scenarioStepIndex: 1, operation: "click" }]);
  const content = [
    "import { test } from '@playwright/test';",
    "import { createPromotedSpecRuntime } from './runtime/promoted-spec-runtime';",
    "test('direct', async ({ page }) => {",
    "  const promotedRuntime = createPromotedSpecRuntime(page);",
    "  await promotedRuntime.clickPromotedTarget({ stepIndex: 1, target: 'x', actionIntent: 'click', expectedEffect: 'ui_change', action: async () => {} });",
    "});",
  ].join("\n");
  const result = structuralValidation(baseInput(content, contract));
  assert.ok(!result.semanticErrors.some((e) => e.startsWith("runtime_")));
});

test("B/deterministic POM candidate with correct fill/click/press wrappers passes structuralValidation", () => {
  const contract = contractWithSteps([
    { scenarioStepIndex: 1, operation: "fill" },
    { scenarioStepIndex: 2, operation: "click" },
    { scenarioStepIndex: 3, operation: "press" },
  ]);
  const content = specWithPom(POM_CLASS, [
    pomCall("fill", 1, "value: 'v'"),
    pomCall("click", 2, "actionIntent: 'click', expectedEffect: 'ui_change'"),
    pomCall("press", 3, "key: 'Enter'"),
  ]);
  const result = structuralValidation(baseInput(content, contract));
  assert.deepEqual(result.semanticErrors.filter((e) => e.startsWith("runtime_")), []);
});

test("C/wrong POM operation: step operation=click but candidate calls pageObject.fill(...) -> FAIL", () => {
  const contract = contractWithSteps([{ scenarioStepIndex: 1, operation: "click" }]);
  const content = specWithPom(POM_CLASS, [pomCall("fill", 1, "value: 'v'")]);
  const result = structuralValidation(baseInput(content, contract));
  assert.ok(result.semanticErrors.some((e) => e === "runtime_method_operation_mismatch:step=1:operation=click:expected=clickPromotedTarget:actual=fillPromotedField"));
});

test("D/wrong internal runtime forward: pageObject.click(...) but method click forwards to fillPromotedField -> FAIL", () => {
  const contract = contractWithSteps([{ scenarioStepIndex: 1, operation: "click" }]);
  const content = specWithPom(POM_CLASS_MISWIRED_CLICK, [pomCall("click", 1, "actionIntent: 'click', expectedEffect: 'ui_change'")]);
  const result = structuralValidation(baseInput(content, contract));
  assert.ok(
    result.semanticErrors.some((e) => e === "runtime_method_operation_mismatch:step=1:operation=click:expected=clickPromotedTarget:actual=fillPromotedField"),
    "the gate must trust the method's ACTUAL forward, never the method's name",
  );
});

test("E/missing binding: 2 required actions, only 1 POM call -> FAIL for the missing step", () => {
  const contract = contractWithSteps([
    { scenarioStepIndex: 1, operation: "fill" },
    { scenarioStepIndex: 2, operation: "click" },
  ]);
  const content = specWithPom(POM_CLASS, [pomCall("fill", 1, "value: 'v'")]);
  const result = structuralValidation(baseInput(content, contract));
  assert.ok(result.semanticErrors.some((e) => e.startsWith("runtime_step_binding_unresolved:step=2")));
});

test("F/duplicate binding: same step represented twice via the POM wrapper -> FAIL ambiguous", () => {
  const contract = contractWithSteps([{ scenarioStepIndex: 1, operation: "click" }]);
  const content = specWithPom(POM_CLASS, [
    pomCall("click", 1, "actionIntent: 'click', expectedEffect: 'ui_change'"),
    pomCall("click", 1, "actionIntent: 'click', expectedEffect: 'ui_change'"),
  ]);
  const result = structuralValidation(baseInput(content, contract));
  assert.ok(result.semanticErrors.some((e) => e.startsWith("runtime_step_binding_ambiguous:step=1")));
});

test("G/real fresh PREVIEW-001-shape deterministic source: 7 required actions -> structuralValidation PASS (no runtime_ errors)", () => {
  const plan = {
    version: "1.0", source: "discovery_generated", status: "validated", createdAt: new Date().toISOString(),
    scenario: { source: "manual", externalId: "C-POM-1", title: "Fresh POM gate parity" },
    requiredData: [],
    steps: [
      { index: 1, action: "navigate" },
      { index: 2, action: "fill", target: { strategy: "text", value: "Usuario" } },
      { index: 3, action: "fill", target: { strategy: "text", value: "Contraseña" } },
      { index: 4, action: "press", value: "Enter", target: { strategy: "text", value: "role:textbox|Contraseña" } },
      { index: 5, action: "click", target: { strategy: "recorded:structural-owner", value: "Solicitud multiproducto" } },
      { index: 6, action: "fill", target: { strategy: "text", value: "Numero" } },
      { index: 7, action: "click", target: { strategy: "recorded:css", value: "Numero" } },
      { index: 8, action: "click", target: { strategy: "recorded:structural-owner", value: "Depurar" } },
    ],
  } as any;
  const sourceScenario = {
    title: "Fresh POM gate parity",
    steps: [
      { index: 1, action: "Ingresar usuario", technicalTargetRef: "role:textbox|Usuario" },
      { index: 2, action: "Ingresar contrasena", technicalTargetRef: "role:textbox|Contrasena" },
      { index: 3, action: "Presionar Enter", technicalTargetRef: "role:textbox|Contrasena" },
      { index: 4, action: "Clic en Solicitud", technicalTargetRef: "role:link|Solicitud" },
      { index: 5, action: "Ingresar numero" },
      {
        index: 6,
        action: "Presionar boton",
        technicalTargetCandidates: [{
          targetType: "structural",
          locatorCandidates: [{ strategy: "role", value: "button", confidence: 0.85 }],
          structuralContext: { owner: { tag: "button" }, identityAmbiguous: true, structuralIdentityMatchCount: 2, deterministicStructuralIdentity: false },
          confidence: 0.85,
          validatedByInteraction: true,
        }],
      },
      { index: 7, action: "Clic en Depurar", technicalTargetRef: "role:button|Depurar" },
    ],
  } as any;
  const contract = buildSpecExecutionContract(plan, sourceScenario);
  const compiled = compileDeterministicSpec(contract);
  assert.equal(compiled.unsupportedCapabilities.length, 0, `compiler itself must be 0 unsupported: ${JSON.stringify(compiled.unsupportedCapabilities)}`);

  const result = structuralValidation(baseInput(compiled.source, contract));
  assert.deepEqual(result.semanticErrors.filter((e) => e.startsWith("runtime_")), []);
});

test("H/step6 (runtime_resolution_required) structurally validates without inventing technicalTargetRef", () => {
  const plan = {
    version: "1.0", source: "discovery_generated", status: "validated", createdAt: new Date().toISOString(),
    scenario: { source: "manual", externalId: "C-POM-2", title: "Step6 gate parity" },
    requiredData: [],
    steps: [{ index: 1, action: "click", target: { strategy: "recorded:css", value: "Numero" } }],
  } as any;
  const sourceScenario = {
    title: "Step6 gate parity",
    steps: [{
      index: 1,
      action: "Presionar boton",
      technicalTargetCandidates: [{
        targetType: "structural",
        locatorCandidates: [{ strategy: "role", value: "button", confidence: 0.85 }],
        structuralContext: { owner: { tag: "button" }, identityAmbiguous: true, structuralIdentityMatchCount: 2, deterministicStructuralIdentity: false },
        confidence: 0.85,
        validatedByInteraction: true,
      }],
    }],
  } as any;
  const contract = buildSpecExecutionContract(plan, sourceScenario);
  assert.equal(contract.steps[0].resolutionState, "runtime_resolution_required");
  assert.equal(contract.steps[0].technicalTargetRef, undefined);

  const compiled = compileDeterministicSpec(contract);
  assert.equal(compiled.bindings[0].runtimeResolutionRequired, true);
  assert.equal(compiled.unsupportedCapabilities.length, 0);

  const result = structuralValidation(baseInput(compiled.source, contract));
  assert.deepEqual(result.semanticErrors.filter((e) => e.startsWith("runtime_")), []);
});
