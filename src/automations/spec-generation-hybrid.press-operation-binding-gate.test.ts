import assert from "node:assert/strict";
import test from "node:test";
import { structuralValidation, buildSpecGenerationUserPromptFromContract } from "./spec-generation-hybrid";

/**
 * FIRST_LOSS (jobId 210649bd-ee18-4259-9ed7-b5af2f90d873): a required contract step with
 * operation=press and implementation={kind:"runtime", runtimeMethod:"pressPromotedTarget"} could
 * still be satisfied by a candidate calling `clickPromotedTarget` for that same stepIndex --
 * nothing checked that the runtime method actually invoked matched the operation's declared
 * authority. This generalizes to any operation/runtimeMethod pair, not just press.
 */

function baseInput(specContent: string, executionContract?: any) {
  return {
    specContent,
    expectedAppSlug: "synthetic",
    expectedSectionSlug: "synthetic-section",
    expectedScenarioId: "SYNTH-PRESS-1",
    expectedScenarioTitle: "Press operation binding gate",
    sourceExpectedResultPresent: false,
    expectedResultText: "",
    scenarioSteps: [],
    requiredAssertions: [],
    observableOracles: [],
    executableStepIndexes: [3],
    planStepActions: new Map<number, string>([[3, "press"]]),
    response: {
      specContent,
      coveredStepIndexes: [3],
      coveredAssertions: [],
      usedPageObjects: [],
      declaredIdentifiers: [],
      unresolvedRequirements: [],
      warnings: [],
    },
    executionContract,
    availablePageObjects: [],
    observedEvidencePhrases: [],
    promotedRuntimeMethodsAllowlist: ["clickPromotedTarget", "pressPromotedTarget", "expectPromotedVisible", "finishEvidence"],
    mode: "ai_hybrid" as const,
  };
}

function pressContract(): any {
  return {
    version: "1.0",
    scenarioId: "SYNTH-PRESS-1",
    title: "Press operation binding gate",
    steps: [{
      contractStepIndex: 0,
      scenarioStepIndex: 3,
      originalText: 'Presionar "Enter"',
      operation: "press",
      target: { strategy: "role", role: "textbox", name: "Contraseña" },
      required: true,
      executionStatus: "executed",
      implementation: { kind: "runtime", runtimeMethod: "pressPromotedTarget" },
      evidenceRefs: [],
    }],
    unresolvedRequiredOracles: [],
    diagnostics: { requiredScenarioSteps: 1, representedScenarioSteps: 1, missingScenarioSteps: [] },
  };
}

function specCallingMethod(method: string): string {
  return [
    "import { test } from '@playwright/test';",
    "import { createPromotedSpecRuntime } from './runtime/promoted-spec-runtime';",
    "test('press step', async ({ page }) => {",
    "  const promotedRuntime = createPromotedSpecRuntime(page);",
    "  try {",
    `    await promotedRuntime.${method}({`,
    "      stepIndex: 3,",
    "      target: 'role:textbox|Contraseña',",
    method === "pressPromotedTarget" ? "      key: 'Enter'," : "      actionIntent: 'press_key', expectedEffect: 'ui_change', action: async () => {},",
    "    });",
    "  } finally { await promotedRuntime.finishEvidence(); }",
    "});",
  ].join("\n");
}

test("1/pressBoundToPressApi. operation=press bound to pressPromotedTarget in the candidate produces no mismatch error", () => {
  const content = specCallingMethod("pressPromotedTarget");
  const result = structuralValidation(baseInput(content, pressContract()));
  assert.ok(!result.semanticErrors.some((e) => e.startsWith("runtime_method_operation_mismatch")));
});

test("2/pressImplementedAsClickRejected. operation=press implemented via clickPromotedTarget is rejected by the gate", () => {
  const content = specCallingMethod("clickPromotedTarget");
  const result = structuralValidation(baseInput(content, pressContract()));
  assert.ok(
    result.semanticErrors.some((e) => e === "runtime_method_operation_mismatch:step=3:operation=press:expected=pressPromotedTarget:actual=clickPromotedTarget"),
  );
});

test("3/ordinaryClickUnaffected. a click-operation step bound to clickPromotedTarget is unaffected by this gate", () => {
  const contract: any = pressContract();
  contract.steps[0].operation = "click";
  contract.steps[0].implementation = { kind: "runtime", runtimeMethod: "clickPromotedTarget" };
  const content = specCallingMethod("clickPromotedTarget");
  const result = structuralValidation(baseInput(content, contract));
  assert.ok(!result.semanticErrors.some((e) => e.startsWith("runtime_method_operation_mismatch")));
});

test("4/nonRequiredStepExempt. a non-required step is exempt from this gate (matches the existing required-only convention)", () => {
  const contract: any = pressContract();
  contract.steps[0].required = false;
  const content = specCallingMethod("clickPromotedTarget");
  const result = structuralValidation(baseInput(content, contract));
  assert.ok(!result.semanticErrors.some((e) => e.startsWith("runtime_method_operation_mismatch")));
});

test("5/pageObjectImplementationAlsoGated. a page_object-kind implementation is no longer exempt: the outer wrapper mismatch (clickPromotedTarget for operation=press) is caught IN ADDITION to the pre-existing POM-invocation check", () => {
  const contract: any = pressContract();
  contract.steps[0].implementation = { kind: "page_object", owner: "FormPage", method: "submit" };
  const content = specCallingMethod("clickPromotedTarget");
  const result = structuralValidation(baseInput(content, contract));
  assert.ok(result.semanticErrors.some((e) => e.startsWith("page_object_method_semantic_mismatch")), "the existing POM check must still run, unmodified");
  assert.ok(
    result.semanticErrors.some((e) => e === "runtime_method_operation_mismatch:step=3:operation=press:expected=pressPromotedTarget:actual=clickPromotedTarget"),
    "the operation<->runtimeMethod gate must now ALSO run for page_object-kind implementations",
  );
});

/**
 * FIRST_LOSS (jobId 979d5435-c4e6-464c-b743-435d80e58fd1): the ORIGINAL mismatch check
 * (`if (stepCall && stepCall.method !== implementation.runtimeMethod)`) silently no-op'd whenever
 * `runtimeStepCalls.find(...)` failed to find exactly one call for the step -- e.g. zero matches
 * (the candidate's real call shape wasn't extracted) or more than one. That let a required
 * press step pass structuralValidation even though clickPromotedTarget was actually invoked.
 * Fixed: zero or multiple matches now fail closed too, not just a found-but-wrong method.
 */
test("6/zeroMatchesFailsClosed. a required runtime step with NO extractable candidate call fails closed, never silently passes", () => {
  const contract: any = pressContract();
  const content = "import { test } from '@playwright/test';\ntest('press step', async () => {});";
  const result = structuralValidation(baseInput(content, contract));
  assert.ok(result.semanticErrors.some((e) => e.startsWith("runtime_step_binding_unresolved:step=3")));
});

test("7/ambiguousMatchesFailClosed. multiple candidate calls claiming the same required stepIndex fail closed rather than picking one", () => {
  const contract: any = pressContract();
  const content = [
    "import { test } from '@playwright/test';",
    "import { createPromotedSpecRuntime } from './runtime/promoted-spec-runtime';",
    "test('press step', async ({ page }) => {",
    "  const promotedRuntime = createPromotedSpecRuntime(page);",
    "  await promotedRuntime.clickPromotedTarget({ stepIndex: 3, target: 'x', actionIntent: 'a', expectedEffect: 'ui_change', action: async () => {} });",
    "  await promotedRuntime.pressPromotedTarget({ stepIndex: 3, target: 'x', key: 'Enter' });",
    "});",
  ].join("\n");
  const result = structuralValidation(baseInput(content, contract));
  assert.ok(result.semanticErrors.some((e) => e.startsWith("runtime_step_binding_ambiguous:step=3")));
});

test("8/realPromptContainsPressApi. the ACTUAL prompt-building function (not a static assumption) embeds pressPromotedTarget in the AI-facing runtime API descriptor", () => {
  const prompt = buildSpecGenerationUserPromptFromContract({
    skill: undefined,
    appSlug: "synthetic",
    sectionSlug: "synthetic-section",
    scenarioId: "SYNTH-PRESS-1",
    scenarioTitle: "Press operation binding gate",
    responseJsonSchema: {},
    executionContract: pressContract(),
    availablePageObjects: [],
    authFlowContext: null,
    promotedRuntimeImport: { exportName: "createPromotedSpecRuntime", exists: true },
    authGateDetectionImports: {
      detectAuthGate: { exportName: "detectAuthGate", exists: true },
      scanCurrentPage: { exportName: "scanCurrentPage", exists: true },
    },
    constraints: [],
  });
  assert.match(prompt, /pressPromotedTarget/);
});

/**
 * FIRST_LOSS (jobId cc5b0661-5393-4ebd-8eab-6516554d8072): the physical candidate for this exact
 * job had NO `implementation` at all on scenarioStepIndex=3 (`resolveImplementationDescriptor`
 * returned `undefined` -- e.g. a page-object method whose registered `intent` no longer matched)
 * -- neither the page_object nor the (then-only) `kind==="runtime"` gate ever evaluated it, so a
 * required press step bound to `clickPromotedTarget` passed structuralValidation clean. The same
 * job also showed `runtime_step_binding_ambiguous:step=7` firing FALSELY, because
 * `expectPromotedVisible` (step 7's oracle) legitimately shares scenarioStepIndex=7 with its
 * source click action, and the old filter counted ALL runtime calls, not just action calls.
 */
function pressStepNoImplementation(): any {
  const contract = pressContract();
  contract.steps[0].implementation = undefined;
  return contract;
}

test("6/undefinedImplementationStillGated. operation=press with NO implementation descriptor resolved (the real job's exact shape) still rejects a clickPromotedTarget candidate", () => {
  const result = structuralValidation(baseInput(specCallingMethod("clickPromotedTarget"), pressStepNoImplementation()));
  assert.ok(result.semanticErrors.some((e) => e === "runtime_method_operation_mismatch:step=3:operation=press:expected=pressPromotedTarget:actual=clickPromotedTarget"));
});

test("7/undefinedImplementationPressPasses. the same undefined-implementation step passes when the candidate correctly calls pressPromotedTarget", () => {
  const result = structuralValidation(baseInput(specCallingMethod("pressPromotedTarget"), pressStepNoImplementation()));
  assert.ok(!result.semanticErrors.some((e) => e.startsWith("runtime_")));
});

test("8/genericFillClickMismatchFailsClosed. a fill-operation step (undefined implementation) bound to clickPromotedTarget is rejected -- not press-specific", () => {
  const contract: any = pressStepNoImplementation();
  contract.steps[0].operation = "fill";
  const input = baseInput(specCallingMethod("clickPromotedTarget"), contract);
  input.planStepActions = new Map([[3, "fill"]]);
  const result = structuralValidation(input);
  assert.ok(result.semanticErrors.some((e) => e === "runtime_method_operation_mismatch:step=3:operation=fill:expected=fillPromotedField:actual=clickPromotedTarget"));
});

test("9/oracleSharingStepIndexNeverCountsAsAmbiguous. an assertion call (expectPromotedVisible) sharing the SAME scenarioStepIndex as its source click action never falsely ambiguates the action binding (reproduces job cc5b0661's step=7)", () => {
  const contract: any = pressContract();
  contract.steps[0].operation = "click";
  contract.steps[0].implementation = undefined;
  const content = [
    "import { test } from '@playwright/test';",
    "import { createPromotedSpecRuntime } from './runtime/promoted-spec-runtime';",
    "test('click with oracle', async ({ page }) => {",
    "  const promotedRuntime = createPromotedSpecRuntime(page);",
    "  await promotedRuntime.clickPromotedTarget({ stepIndex: 3, target: 'Depurar', actionIntent: 'click', expectedEffect: 'ui_change', action: async () => {} });",
    "  await promotedRuntime.expectPromotedVisible({ stepIndex: 3, target: 'Depurar', polarity: 'positive', assertion: async () => {} });",
    "});",
  ].join("\n");
  const result = structuralValidation(baseInput(content, contract));
  assert.ok(!result.semanticErrors.some((e) => e.startsWith("runtime_step_binding_ambiguous")));
});

test("10/integrationRealShapeFromJob. integration: contract with undefined implementation (press) + the exact clickPromotedTarget candidate shape from job cc5b0661 fails; the pressPromotedTarget shape passes", () => {
  const contract = pressStepNoImplementation();
  const failing = structuralValidation(baseInput(specCallingMethod("clickPromotedTarget"), contract));
  assert.ok(failing.semanticErrors.some((e) => e.startsWith("runtime_method_operation_mismatch:step=3")));
  const passing = structuralValidation(baseInput(specCallingMethod("pressPromotedTarget"), contract));
  assert.ok(!passing.semanticErrors.some((e) => e.startsWith("runtime_")));
});

test("11/integrationCrossingContractToValidation. contract operation=press -> real prompt lists pressPromotedTarget -> a candidate honoring it passes -> one that doesn't is rejected", () => {
  const contract = pressContract();
  const prompt = buildSpecGenerationUserPromptFromContract({
    skill: undefined,
    appSlug: "synthetic",
    sectionSlug: "synthetic-section",
    scenarioId: "SYNTH-PRESS-1",
    scenarioTitle: "Press operation binding gate",
    responseJsonSchema: {},
    executionContract: contract,
    availablePageObjects: [],
    authFlowContext: null,
    promotedRuntimeImport: { exportName: "createPromotedSpecRuntime", exists: true },
    authGateDetectionImports: {
      detectAuthGate: { exportName: "detectAuthGate", exists: true },
      scanCurrentPage: { exportName: "scanCurrentPage", exists: true },
    },
    constraints: [],
  });
  assert.match(prompt, /pressPromotedTarget/, "the AI must be told this API exists before it could ever use it correctly");

  const honoringCandidate = structuralValidation(baseInput(specCallingMethod("pressPromotedTarget"), contract));
  assert.ok(!honoringCandidate.semanticErrors.some((e) => e.startsWith("runtime_")));

  const violatingCandidate = structuralValidation(baseInput(specCallingMethod("clickPromotedTarget"), contract));
  assert.ok(violatingCandidate.semanticErrors.some((e) => e.startsWith("runtime_method_operation_mismatch")));
});

/**
 * FIRST_LOSS (jobId 28ccb2d3-f553-4e51-ac6a-90031aa5f696): a required press step whose
 * implementation resolved to `kind:"page_object"` (owner=ProductListPage, method=executeAction)
 * took the page_object branch and was NEVER subjected to the operation<->runtimeMethod check --
 * `structuralValidation` reported "passed" because `executeAction` was textually invoked
 * SOMEWHERE (as a callback nested inside the WRONG outer wrapper, `clickPromotedTarget`). Fixed:
 * the operation<->runtimeMethod gate now runs for every required, non-assertion action step
 * regardless of `implementation.kind` -- `implementation.kind` is never the condition for whether
 * it applies. The nested page-object call is validated separately and never substitutes for the
 * step's own outer wrapper.
 */
function specWithNestedPageObject(outerMethod: string, nestedCall: string): string {
  return [
    "import { test } from '@playwright/test';",
    "import { createPromotedSpecRuntime } from './runtime/promoted-spec-runtime';",
    "import { ProductListPage } from './pages/productlist.page';",
    "test('press step', async ({ page }) => {",
    "  const promotedRuntime = createPromotedSpecRuntime(page);",
    "  const productListPage = new ProductListPage(page);",
    outerMethod === "pressPromotedTarget"
      ? `  await promotedRuntime.pressPromotedTarget({ stepIndex: 3, target: 'role:textbox|Contraseña', key: 'Enter' });`
      : `  await promotedRuntime.${outerMethod}({ stepIndex: 3, target: 'role:textbox|Contraseña', actionIntent: 'press', expectedEffect: 'ui_change', action: async () => { ${nestedCall} } });`,
    "});",
  ].join("\n");
}

function pressStepPageObject(): any {
  const contract = pressContract();
  contract.steps[0].implementation = { kind: "page_object", owner: "ProductListPage", method: "executeAction" };
  return contract;
}

test("12/realShapePageObjectOuterClickRejected. EXACT real shape (job 28ccb2d3): operation=press, implementation.kind=page_object, outer=clickPromotedTarget, nested=productListPage.executeAction -> runtime_method_operation_mismatch", () => {
  const content = specWithNestedPageObject("clickPromotedTarget", "await productListPage.executeAction();");
  const result = structuralValidation(baseInput(content, pressStepPageObject()));
  assert.ok(result.semanticErrors.some((e) => e === "runtime_method_operation_mismatch:step=3:operation=press:expected=pressPromotedTarget:actual=clickPromotedTarget"));
});

test("13/realShapePageObjectOuterPressPasses. same page_object implementation, outer=pressPromotedTarget -> passes (no runtime_ error)", () => {
  const content = specWithNestedPageObject("pressPromotedTarget", "");
  const result = structuralValidation(baseInput(content, pressStepPageObject()));
  assert.ok(!result.semanticErrors.some((e) => e.startsWith("runtime_")));
});

test("14/pageObjectActionZeroOuterWrapperFailsUnresolved. a page_object action step with NO outer action wrapper at all fails unresolved, never silently passes", () => {
  const content = "import { test } from '@playwright/test';\ntest('press step', async () => {});";
  const result = structuralValidation(baseInput(content, pressStepPageObject()));
  assert.ok(result.semanticErrors.some((e) => e.startsWith("runtime_step_binding_unresolved:step=3")));
});

test("15/pageObjectActionTwoOuterWrappersFailsAmbiguous. a page_object action step with TWO action wrappers sharing the same stepIndex fails ambiguous", () => {
  const content = [
    "import { test } from '@playwright/test';",
    "import { createPromotedSpecRuntime } from './runtime/promoted-spec-runtime';",
    "test('press step', async ({ page }) => {",
    "  const promotedRuntime = createPromotedSpecRuntime(page);",
    "  await promotedRuntime.clickPromotedTarget({ stepIndex: 3, target: 'x', actionIntent: 'a', expectedEffect: 'ui_change', action: async () => {} });",
    "  await promotedRuntime.pressPromotedTarget({ stepIndex: 3, target: 'x', key: 'Enter' });",
    "});",
  ].join("\n");
  const result = structuralValidation(baseInput(content, pressStepPageObject()));
  assert.ok(result.semanticErrors.some((e) => e.startsWith("runtime_step_binding_ambiguous:step=3")));
});

test("16/oracleSharingStepIndexNeverAmbiguatesPageObjectStep. an assertion call sharing the same scenarioStepIndex never counts toward a page_object action step's ambiguity", () => {
  const contract: any = pressStepPageObject();
  const content = [
    "import { test } from '@playwright/test';",
    "import { createPromotedSpecRuntime } from './runtime/promoted-spec-runtime';",
    "import { ProductListPage } from './pages/productlist.page';",
    "test('press step', async ({ page }) => {",
    "  const promotedRuntime = createPromotedSpecRuntime(page);",
    "  const productListPage = new ProductListPage(page);",
    "  await promotedRuntime.pressPromotedTarget({ stepIndex: 3, target: 'role:textbox|Contraseña', key: 'Enter' });",
    "  await productListPage.executeAction();",
    "  await promotedRuntime.expectPromotedVisible({ stepIndex: 3, target: 'role:textbox|Contraseña', polarity: 'positive', assertion: async () => {} });",
    "});",
  ].join("\n");
  const result = structuralValidation(baseInput(content, contract));
  assert.ok(!result.semanticErrors.some((e) => e.startsWith("runtime_step_binding_ambiguous")));
});

test("17/integrationRealCandidateShape. integration: ExecutionContract (page_object, press) -> real candidate-call extraction -> structuralValidation, using the exact physical shape from job 28ccb2d3", () => {
  const contract = pressStepPageObject();
  const failing = structuralValidation(baseInput(
    specWithNestedPageObject("clickPromotedTarget", "await productListPage.executeAction();"),
    contract,
  ));
  assert.ok(failing.semanticErrors.some((e) => e.startsWith("runtime_method_operation_mismatch:step=3")));
  const passing = structuralValidation(baseInput(specWithNestedPageObject("pressPromotedTarget", ""), contract));
  assert.ok(!passing.semanticErrors.some((e) => e.startsWith("runtime_")));
});

/**
 * DIAGNOSE (jobId bf4f597b-0db2-4c2d-be67-5c8b99367b36): proves the added
 * [structural-validation-authority] instrumentation does not change any result -- same errors,
 * same pass/fail outcome -- it only logs which physical module/process ran.
 */
test("18/authorityLoggingDoesNotChangeBehavior. the new [structural-validation-authority] log appears with expected fields, and results are byte-identical to before this instrumentation", () => {
  const contract = pressStepPageObject();
  const content = specWithNestedPageObject("clickPromotedTarget", "await productListPage.executeAction();");

  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => { lines.push(args.join(" ")); };
  let result: ReturnType<typeof structuralValidation>;
  try {
    result = structuralValidation(baseInput(content, contract));
  } finally {
    console.log = originalLog;
  }

  const authorityLine = lines.find((line) => line.startsWith("[structural-validation-authority] module="));
  assert.ok(authorityLine, "expected a [structural-validation-authority] module line");
  assert.match(authorityLine!, /gateVersion=operation-runtime-all-kinds-v1/);
  assert.match(authorityLine!, /pid=\d+/);
  const enteredLine = lines.find((line) => line.startsWith("[structural-validation-authority] phase=entered"));
  assert.ok(enteredLine, "expected a phase=entered line");
  assert.match(enteredLine!, /requiredActionSteps=1/);

  // Same outcome as test 12 (identical input) -- instrumentation changed nothing.
  assert.ok(result.semanticErrors.some((e) => e === "runtime_method_operation_mismatch:step=3:operation=press:expected=pressPromotedTarget:actual=clickPromotedTarget"));
});
