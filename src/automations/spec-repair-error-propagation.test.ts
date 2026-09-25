import assert from "node:assert/strict";
import test from "node:test";
import { buildSpecRepairContext, buildSpecRepairConstraints, isRepairNoChange, summarizeRepairGateError, type SpecGenerationDiagnostics } from "./spec-generation-hybrid";

/**
 * scenarioStepIndex=4 (recording d8dbd8f9-b353-4175-b365-e5f8957bae36) proved: a genuine
 * candidate runtime defect threw "Promoted click failed at step 4 ... error='click callback
 * timed out after 15000ms'", which landed in diagnostics.errors as
 * functional_execution_error:<line> exactly as intended — yet [spec-repair] logged
 * error=no_exact_error_available and the AI repair prompt received nothing actionable.
 *
 * Root cause: buildSpecRepairContext's execution_contract-mode branch only kept errors matching
 * the six trace-fidelity prefixes (missing_contract_step:, contract_step_order_changed:, etc.)
 * — it silently dropped every functional-execution and playwright-discovery error, unlike the
 * legacy-mode branch right next to it, which already included them. Fixed by adding those
 * prefixes to the execution_contract branch too.
 */

function baseDiagnostics(overrides: Partial<SpecGenerationDiagnostics> = {}): SpecGenerationDiagnostics {
  return {
    mode: "ai_hybrid",
    provider: "codex",
    model: "gpt-5.6-luna",
    skill: { name: "playwright-spec-generation", version: "1.0.0", hash: null, loaded: true },
    invocations: 1,
    invocationsConsumed: 1,
    durationMs: 0,
    usage: {} as SpecGenerationDiagnostics["usage"],
    validation: {
      schema: "passed",
      structure: "passed",
      traceFidelity: "passed",
      typescript: "passed",
      playwrightDiscovery: "passed",
      semanticCoverage: "passed",
      functionalExecution: "failed",
    },
    promotionAllowed: false,
    specsRequested: 1,
    specsValidated: 0,
    specsRejected: 1,
    specGenerationAttempts: 1,
    specRepairAttempts: 0,
    firstPassPromotion: false,
    failedGatesAttempt1: [],
    regressedGates: [],
    missingRequirements: [],
    oracleTypes: [],
    errors: [],
    warnings: [],
    finalSpec: { origin: "ai_candidate", generatedBy: "ai", strategy: "ai_candidate", fallback: null },
    ...overrides,
  };
}

test("BUG scenarioStepIndex=4 repro: execution_contract mode used to drop functional_execution_error entirely, reporting no_exact_error_available", () => {
  const diagnostics = baseDiagnostics({
    errors: [
      "functional_execution_failed:exitCode=1",
      'functional_execution_error:Error: Promoted click failed at step 4 target="Tarjeta Crédito Visa Clásica...". failureClass=ACTION_CALLBACK_TIMEOUT exactRuntimeError="click callback timed out after 15000ms" currentUrl=https://172.27.4.50/',
    ],
  });
  const repairContext = buildSpecRepairContext({
    diagnostics,
    previousCandidate: "// candidate source",
    observableOracles: [],
    missingRequirements: [],
    specInputMode: "execution_contract",
  });
  assert.notDeepEqual(repairContext.exactErrors, [], "the exact functional-execution error must reach the repair context, not be silently dropped");
  const summary = summarizeRepairGateError("functionalExecution", repairContext.exactErrors);
  assert.notEqual(summary, "no_exact_error_available");
  assert.match(summary, /Promoted click failed at step 4/);
  assert.match(summary, /click callback timed out after 15000ms/);
});

test("legacy mode already carried functional_execution_error through (regression guard, unchanged behavior)", () => {
  const diagnostics = baseDiagnostics({
    errors: ["functional_execution_error:some exact error line"],
  });
  const repairContext = buildSpecRepairContext({
    diagnostics,
    previousCandidate: "// candidate source",
    observableOracles: [],
    missingRequirements: [],
    specInputMode: "legacy",
  });
  const summary = summarizeRepairGateError("functionalExecution", repairContext.exactErrors);
  assert.equal(summary, "functional_execution_error:some exact error line");
});

test("no_exact_error_available still correctly reported when diagnostics truly carries no functional-execution error", () => {
  const diagnostics = baseDiagnostics({ errors: [] });
  const repairContext = buildSpecRepairContext({
    diagnostics,
    previousCandidate: "// candidate source",
    observableOracles: [],
    missingRequirements: [],
    specInputMode: "execution_contract",
  });
  const summary = summarizeRepairGateError("functionalExecution", repairContext.exactErrors);
  assert.equal(summary, "no_exact_error_available");
});

test("execution_contract mode still prioritizes trace-fidelity errors when both trace-fidelity and functional-execution errors are present", () => {
  const diagnostics = baseDiagnostics({
    validation: {
      schema: "passed",
      structure: "passed",
      traceFidelity: "failed",
      typescript: "passed",
      playwrightDiscovery: "passed",
      semanticCoverage: "passed",
      functionalExecution: "failed",
    },
    errors: [
      "contract_target_changed:stepIndex=2:reason=locator_mismatch",
      "functional_execution_error:some line",
    ],
  });
  const repairContext = buildSpecRepairContext({
    diagnostics,
    previousCandidate: "// candidate source",
    observableOracles: [],
    missingRequirements: [],
    specInputMode: "execution_contract",
  });
  assert.ok(repairContext.exactErrors.some((e) => e.startsWith("contract_target_changed:")));
  assert.ok(repairContext.exactErrors.some((e) => e.startsWith("functional_execution_error:")), "functional-execution errors must coexist with trace-fidelity errors, not be excluded by them");
});

/**
 * FIRST_LOSS (jobId e90a8550-a3a2-4d61-b0b2-4df82088c5d1): execution-contract mode's
 * semanticCoverage gate (structuralValidation's operation<->runtimeMethod check, plus the
 * page_object/contract-coverage checks) produces real, exact error strings in diagnostics.errors
 * -- but neither buildSpecRepairContext's execution-contract prioritization nor
 * summarizeRepairGateError's semanticCoverage lookup recognized this vocabulary, so
 * [spec-repair] always logged error=no_exact_error_available even with the exact defect present.
 */
function semanticCoverageFailedDiagnostics(errors: string[]): SpecGenerationDiagnostics {
  return baseDiagnostics({
    validation: {
      schema: "passed",
      structure: "passed",
      traceFidelity: "passed",
      typescript: "passed",
      playwrightDiscovery: "passed",
      semanticCoverage: "failed",
      functionalExecution: "skipped",
    },
    errors,
  });
}

test("1/executionContractOperationMismatchReachesRepair. runtime_method_operation_mismatch in execution_contract mode reaches exactErrors", () => {
  const diagnostics = semanticCoverageFailedDiagnostics([
    "runtime_method_operation_mismatch:step=3:operation=press:expected=pressPromotedTarget:actual=clickPromotedTarget",
  ]);
  const repairContext = buildSpecRepairContext({
    diagnostics,
    previousCandidate: "// candidate source",
    observableOracles: [],
    missingRequirements: [],
    specInputMode: "execution_contract",
  });
  assert.ok(repairContext.exactErrors.includes("runtime_method_operation_mismatch:step=3:operation=press:expected=pressPromotedTarget:actual=clickPromotedTarget"));
});

test("2/summarizeSemanticCoverageReturnsExactError. summarizeRepairGateError('semanticCoverage', ...) returns the exact runtime_method_operation_mismatch line, not no_exact_error_available", () => {
  const exactErrors = ["runtime_method_operation_mismatch:step=3:operation=press:expected=pressPromotedTarget:actual=clickPromotedTarget"];
  const summary = summarizeRepairGateError("semanticCoverage", exactErrors);
  assert.equal(summary, "runtime_method_operation_mismatch:step=3:operation=press:expected=pressPromotedTarget:actual=clickPromotedTarget");
});

test("3/otherFourPrefixesReachRepairAndSummarize. the remaining 4 new semanticCoverage prefixes all reach exactErrors and summarize correctly", () => {
  const cases = [
    "runtime_step_binding_unresolved:step=5:operation=fill:expected=fillPromotedField",
    "runtime_step_binding_ambiguous:step=7:operation=click:matchCount=2",
    "page_object_method_semantic_mismatch:step=2:expected=FormPage.submit",
    "missing_contract_semantic_coverage:scenarioStepIndex=6:operation=click",
  ];
  for (const errorLine of cases) {
    const diagnostics = semanticCoverageFailedDiagnostics([errorLine]);
    const repairContext = buildSpecRepairContext({
      diagnostics,
      previousCandidate: "// candidate source",
      observableOracles: [],
      missingRequirements: [],
      specInputMode: "execution_contract",
    });
    assert.ok(repairContext.exactErrors.includes(errorLine), `expected ${errorLine} in exactErrors`);
    assert.equal(summarizeRepairGateError("semanticCoverage", repairContext.exactErrors), errorLine);
  }
});

test("4/legacySemanticCoverageUnaffected. legacy-mode semanticCoverage error vocabulary (unresolved_requirement:) still summarizes exactly as before", () => {
  const diagnostics = baseDiagnostics({
    validation: {
      schema: "passed", structure: "passed", traceFidelity: "passed", typescript: "passed",
      playwrightDiscovery: "passed", semanticCoverage: "failed", functionalExecution: "skipped",
    },
    errors: ["unresolved_requirement:La aplicación muestra el saldo"],
  });
  const repairContext = buildSpecRepairContext({
    diagnostics,
    previousCandidate: "// candidate source",
    observableOracles: [],
    missingRequirements: [],
    specInputMode: "legacy",
  });
  assert.equal(summarizeRepairGateError("semanticCoverage", repairContext.exactErrors), "unresolved_requirement:La aplicación muestra el saldo");
});

test("5/nonAllowlistedErrorNotArbitrarilyIntroduced. an execution_contract error matching none of the known prefixes is not admitted into exactErrors", () => {
  const diagnostics = semanticCoverageFailedDiagnostics(["some_unrelated_future_error:step=9"]);
  const repairContext = buildSpecRepairContext({
    diagnostics,
    previousCandidate: "// candidate source",
    observableOracles: [],
    missingRequirements: [],
    specInputMode: "execution_contract",
  });
  assert.ok(!repairContext.exactErrors.includes("some_unrelated_future_error:step=9"));
});

test("6/integrationDiagnosticsToRepairExactError. integration: diagnostics.errors -> buildSpecRepairContext -> summarizeRepairGateError produces the exact error, matching the physical job's shape", () => {
  const diagnostics = semanticCoverageFailedDiagnostics([
    "runtime_method_operation_mismatch:step=3:operation=press:expected=pressPromotedTarget:actual=clickPromotedTarget",
  ]);
  const repairContext = buildSpecRepairContext({
    diagnostics,
    previousCandidate: "// candidate source",
    observableOracles: [],
    missingRequirements: [],
    specInputMode: "execution_contract",
  });
  const summary = summarizeRepairGateError("semanticCoverage", repairContext.exactErrors);
  assert.notEqual(summary, "no_exact_error_available");
  assert.match(summary, /operation=press/);
  assert.match(summary, /actual=clickPromotedTarget/);
});

/**
 * FIRST_LOSS (jobId 92755fda-677f-44c7-881e-00c802214534): AI repair, told a step's outer runtime
 * wrapper was wrong (page_object_method_semantic_mismatch), fixed it ADDITIVELY -- adding a new,
 * correct pressPromotedTarget call while leaving the old, incorrect clickPromotedTarget call in
 * place for the SAME scenarioStepIndex. That produced runtime_step_binding_ambiguous (two outer
 * wrappers). `buildSpecRepairConstraints` now derives a short, generic, replacement-based
 * directive per affected scenarioStepIndex directly from exactErrors -- never hardcoding a
 * stepIndex/appSlug/POM class/method/target/business text.
 */
function contextWithErrors(exactErrors: string[]): { diagnostics: SpecGenerationDiagnostics; repairContext: ReturnType<typeof buildSpecRepairContext> } {
  const diagnostics = baseDiagnostics({
    validation: {
      schema: "passed", structure: "passed", traceFidelity: "passed", typescript: "passed",
      playwrightDiscovery: "passed", semanticCoverage: "failed", functionalExecution: "skipped",
    },
    errors: exactErrors,
  });
  const repairContext = buildSpecRepairContext({
    diagnostics,
    previousCandidate: "// candidate source",
    observableOracles: [],
    missingRequirements: [],
    specInputMode: "execution_contract",
  });
  return { diagnostics, repairContext };
}

test("7/pageObjectMismatchGetsReplacementDirective. page_object_method_semantic_mismatch produces a replacement-based, no-duplicate-wrapper directive naming the affected scenarioStepIndex", () => {
  const { diagnostics, repairContext } = contextWithErrors([
    "page_object_method_semantic_mismatch:step=3:expected=ProductListPage.executeAction",
  ]);
  const constraints = buildSpecRepairConstraints(diagnostics, repairContext, "execution_contract");
  const directive = constraints.find((c) => c.includes("edit the EXISTING outer action runtime call"));
  assert.ok(directive, "expected a replacement-based directive");
  assert.match(directive!, /\b3\b/);
  assert.match(directive!, /exactly one outer action runtime wrapper/);
  assert.match(directive!, /Never append a second outer wrapper/);
});

test("8/operationMismatchGetsSameDirective. runtime_method_operation_mismatch produces the same replacement rule", () => {
  const { diagnostics, repairContext } = contextWithErrors([
    "runtime_method_operation_mismatch:step=3:operation=press:expected=pressPromotedTarget:actual=clickPromotedTarget",
  ]);
  const constraints = buildSpecRepairConstraints(diagnostics, repairContext, "execution_contract");
  assert.ok(constraints.some((c) => c.includes("edit the EXISTING outer action runtime call") && /\b3\b/.test(c)));
});

test("9/ambiguousDemandsExactlyOneWrapper. runtime_step_binding_ambiguous additionally demands removing conflicting wrappers, keeping exactly the operation-matching one", () => {
  const { diagnostics, repairContext } = contextWithErrors([
    "runtime_step_binding_ambiguous:step=3:operation=press:matchCount=2",
  ]);
  const constraints = buildSpecRepairConstraints(diagnostics, repairContext, "execution_contract");
  const cleanupDirective = constraints.find((c) => c.includes("MORE THAN ONE outer action runtime call"));
  assert.ok(cleanupDirective, "expected an ambiguity-cleanup directive");
  assert.match(cleanupDirective!, /\b3\b/);
  assert.match(cleanupDirective!, /Remove every conflicting outer wrapper/);
});

test("10/directiveUsesStructuredDataOnly. the directive never hardcodes a business/app-specific string -- only the generic structural rule plus the numeric stepIndex derived from exactErrors", () => {
  const { diagnostics, repairContext } = contextWithErrors([
    "page_object_method_semantic_mismatch:step=5:expected=SomeOtherPage.someOtherMethod",
  ]);
  const constraints = buildSpecRepairConstraints(diagnostics, repairContext, "execution_contract");
  const directive = constraints.find((c) => c.includes("edit the EXISTING outer action runtime call"));
  assert.ok(directive);
  assert.doesNotMatch(directive!, /SomeOtherPage|someOtherMethod|portal-comercial|Contraseña/i);
  assert.match(directive!, /\b5\b/);
});

test("11/legacyRepairUnaffected. legacy mode (no execution-contract wrapper errors) produces no wrapper-replacement directive -- existing behavior preserved", () => {
  const diagnostics = baseDiagnostics({
    validation: {
      schema: "passed", structure: "passed", traceFidelity: "passed", typescript: "passed",
      playwrightDiscovery: "passed", semanticCoverage: "failed", functionalExecution: "skipped",
    },
    errors: ["unresolved_requirement:La aplicación muestra el saldo"],
  });
  const repairContext = buildSpecRepairContext({
    diagnostics,
    previousCandidate: "// candidate source",
    observableOracles: [],
    missingRequirements: [],
    specInputMode: "legacy",
  });
  const constraints = buildSpecRepairConstraints(diagnostics, repairContext, "legacy");
  assert.ok(!constraints.some((c) => c.includes("edit the EXISTING outer action runtime call")));
  assert.ok(!constraints.some((c) => c.includes("MORE THAN ONE outer action runtime call")));
});

test("12/noDuplicateDirectivePerStep. multiple wrapper-related errors affecting the SAME step produce exactly one replacement directive, not one per error", () => {
  const { diagnostics, repairContext } = contextWithErrors([
    "runtime_method_operation_mismatch:step=3:operation=press:expected=pressPromotedTarget:actual=clickPromotedTarget",
    "page_object_method_semantic_mismatch:step=3:expected=ProductListPage.executeAction",
  ]);
  const constraints = buildSpecRepairConstraints(diagnostics, repairContext, "execution_contract");
  const directives = constraints.filter((c) => c.includes("edit the EXISTING outer action runtime call"));
  assert.equal(directives.length, 1, "exactly one directive line, listing step 3 once, not duplicated per error");
});

/**
 * Objective 6: an AI repair that produces the same candidate it was asked to fix must be
 * classified REPAIR_NO_CHANGE, not silently re-run through functional execution as if it were a
 * genuine attempt. The ticket's own job showed rawChanged=false and an identical failure.
 */
test("REPAIR_NO_CHANGE: a repaired candidate identical to the previous one (whitespace aside) is detected", () => {
  const previous = `test('Tarjeta', async ({ page }) => {\n  await page.locator('div').click();\n});\n`;
  const repaired = `test('Tarjeta', async ({ page }) => {\n\tawait page.locator('div').click();\n});`;
  assert.equal(isRepairNoChange(repaired, previous), true, "whitespace-only differences (tabs vs spaces, trailing newline) must still count as no change");
});

test("REPAIR_NO_CHANGE: a genuinely different repaired candidate is not flagged", () => {
  const previous = `await page.locator('div').filter({ has: page.locator('img[alt="X"]') }).click();`;
  const repaired = `await page.getByRole('img', { name: 'X' }).click();`;
  assert.equal(isRepairNoChange(repaired, previous), false);
});
