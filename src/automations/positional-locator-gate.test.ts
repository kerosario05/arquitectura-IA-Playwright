import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  structuralValidation,
  isFunctionalExecutionInfrastructureFailure,
  isInitialReadinessInfrastructureFailure,
} from "./spec-generation-hybrid";

/**
 * P2 fix: a candidate using .first()/.last()/.nth() to disambiguate a
 * required functional locator is a DOM-position fallback, which is forbidden
 * project-wide. It must fail a static candidate gate BEFORE any physical
 * runtime invocation, not merely contribute to a later "failed" verdict.
 * These tests are fully hermetic: no browser, no real AI, no QA Lab, no TestRail.
 */

function baseStructuralValidationInput(specContent: string) {
  return {
    specContent,
    expectedAppSlug: "synthetic",
    expectedSectionSlug: "synthetic-section",
    expectedScenarioId: "SYNTH-POS-1",
    expectedScenarioTitle: "Positional locator gate",
    sourceExpectedResultPresent: false,
    expectedResultText: "",
    scenarioSteps: [],
    requiredAssertions: [],
    observableOracles: [],
    executableStepIndexes: [1],
    planStepActions: new Map<number, string>([[1, "click"]]),
    response: {
      specContent,
      coveredStepIndexes: [1],
      coveredAssertions: [],
      usedPageObjects: [],
      declaredIdentifiers: [],
      unresolvedRequirements: [],
      warnings: [],
    },
    availablePageObjects: [],
    observedEvidencePhrases: [],
    promotedRuntimeMethodsAllowlist: ["clickPromotedTarget", "expectPromotedVisible"],
    mode: "ai_hybrid" as const,
  };
}

function candidateSpecWithLocator(locatorSuffix: string): string {
  return [
    "import { test, expect } from '@playwright/test';",
    "import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';",
    "export const PROMOTED_SPEC_STRATEGY = 'ai_hybrid';",
    "test('positional locator candidate', async ({ page }) => {",
    "  process.env.APP_SLUG = 'synthetic';",
    "  process.env.SECTION_SLUG = 'synthetic-section';",
    "  process.env.SCENARIO_ID = 'SYNTH-POS-1';",
    "  process.env.SCENARIO_TITLE = 'Positional locator gate';",
    "  const promotedRuntime = createPromotedSpecRuntime(page);",
    "  try {",
    "    await promotedRuntime.clickPromotedTarget({",
    "      stepIndex: 1,",
    "      target: 'Finalizar sesion',",
    "      actionIntent: 'click_step',",
    "      expectedEffect: 'ui_change',",
    "      sensitive: false,",
    "      previousStepReplays: [],",
    "      lastSelectionStep: undefined,",
    `      action: async () => { await page.${locatorSuffix}.click(); },`,
    "    });",
    "  } finally {",
    "    await promotedRuntime.finishEvidence();",
    "  }",
    "});",
  ].join("\n");
}

test("positional locator gate (static gate, fails before physical execution)", async (t) => {
  await t.test("9. .first() on a required functional locator fails the static gate", () => {
    const specContent = candidateSpecWithLocator("locator('div').filter({ hasText: 'Finalizar sesion' }).first()");
    const result = structuralValidation(baseStructuralValidationInput(specContent));
    assert.ok(
      result.structureErrors.some((error) => error.startsWith("positional_locator_forbidden:method=first")),
      "must report a positional_locator_forbidden error for .first()"
    );
    assert.ok(specContent.includes(".first()"), "the offending code must not be silently stripped");
  });

  await t.test("10. .last() on a required functional locator fails the static gate", () => {
    const specContent = candidateSpecWithLocator("locator('div').filter({ hasText: 'Finalizar sesion' }).last()");
    const result = structuralValidation(baseStructuralValidationInput(specContent));
    assert.ok(
      result.structureErrors.some((error) => error.startsWith("positional_locator_forbidden:method=last")),
      "must report a positional_locator_forbidden error for .last()"
    );
  });

  await t.test("11. .nth(N) on a required functional locator fails the static gate", () => {
    const specContent = candidateSpecWithLocator("locator('div').filter({ hasText: 'Finalizar sesion' }).nth(2)");
    const result = structuralValidation(baseStructuralValidationInput(specContent));
    assert.ok(
      result.structureErrors.some((error) => error.startsWith("positional_locator_forbidden:method=nth")),
      "must report a positional_locator_forbidden error for .nth(N)"
    );
  });

  await t.test("12. a positional-gate failure short-circuits before playwrightDiscovery/functionalExecution are invoked", () => {
    const source = fs.readFileSync(path.join(__dirname, "spec-generation-hybrid.ts"), "utf-8");
    const positionalGateIndex = source.indexOf('const positionalLocatorErrors = errors.filter((error) => error.startsWith("positional_locator_forbidden:"));');
    const discoveryInvocationIndex = source.indexOf("const listResult = await listRunner(validationPath, playwrightLaunchContext);");
    const functionalInvocationIndex = source.indexOf("const functionalResult = await functionalRunner(validationPath, playwrightLaunchContext);");
    assert.ok(positionalGateIndex >= 0, "positional locator gate must exist in spec-generation-hybrid.ts");
    assert.ok(discoveryInvocationIndex >= 0, "playwrightDiscovery invocation must exist in spec-generation-hybrid.ts");
    assert.ok(functionalInvocationIndex >= 0, "functionalExecution invocation must exist in spec-generation-hybrid.ts");
    assert.ok(
      positionalGateIndex < discoveryInvocationIndex,
      "the positional-locator gate must short-circuit before playwrightDiscovery is invoked"
    );
    assert.ok(
      positionalGateIndex < functionalInvocationIndex,
      "the positional-locator gate must short-circuit before functionalExecution is invoked"
    );
  });

  await t.test("13. a valid certified non-positional candidate remains eligible (no false positive)", () => {
    const specContent = candidateSpecWithLocator("getByRole('button', { name: /Finalizar sesion/i })");
    const result = structuralValidation(baseStructuralValidationInput(specContent));
    assert.equal(
      result.structureErrors.filter((error) => error.startsWith("positional_locator_forbidden:")).length,
      0,
      "a semantic (non-positional) locator must not trip the positional gate"
    );
  });

  await t.test("14. PRE_BUSINESS_INITIAL_READINESS classification still yields no proven pass/fail (untouched, regression)", () => {
    const combinedOutput = [
      "Total: 1 test in 1 file",
      "Error: initial_readiness_failure: APP_BASE_URL is required to navigate before first business action",
    ].join("\n");
    assert.equal(isFunctionalExecutionInfrastructureFailure(false, combinedOutput), true);
    assert.equal(isInitialReadinessInfrastructureFailure(combinedOutput), true);
  });
});
