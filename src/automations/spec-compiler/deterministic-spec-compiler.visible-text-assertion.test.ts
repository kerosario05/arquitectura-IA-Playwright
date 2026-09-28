import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import type { SpecExecutionContract, SpecExecutionContractStep } from "../spec-execution-contract";
import { buildSpecExecutionContract } from "../spec-execution-contract";
import { compileDeterministicSpec as compileDeterministicSpecRaw } from "./deterministic-spec-compiler";

/**
 * Run verify-20260928134856 (recording d4a2af4d, "roque 10"): discovery verified `Se muestra
 * "¡Hola!"` live after the last action, the promotion gate passed, and then deterministic spec
 * generation failed closed on `scenarioStepIndex=24:operation_unsupported:noop`.
 */

const TEST_TARGET_SPEC_PATH = path.resolve(
  process.cwd(),
  "automations/apps/synthetic-app/sections/synthetic-section/cases/synthetic-case/case.spec.ts",
);

function compile(contract: SpecExecutionContract) {
  return compileDeterministicSpecRaw(contract, { targetSpecPath: TEST_TARGET_SPEC_PATH });
}

function step(overrides: Partial<SpecExecutionContractStep>): SpecExecutionContractStep {
  return {
    contractStepIndex: 0,
    scenarioStepIndex: 0,
    originalText: "synthetic step",
    operation: "click",
    required: true,
    executionStatus: "executed",
    evidenceRefs: [],
    ...overrides,
  };
}

function contract(steps: SpecExecutionContractStep[]): SpecExecutionContract {
  return {
    version: "1",
    scenarioId: "REC-01",
    title: "roque 10",
    steps,
    unresolvedRequiredOracles: [],
    diagnostics: { requiredScenarioSteps: steps.length, representedScenarioSteps: steps.length, missingScenarioSteps: [] },
  } as SpecExecutionContract;
}

const CLICK = step({ scenarioStepIndex: 23, operation: "click", target: { strategy: "text", value: "Finalizar sesión" } });

function outcome(overrides: Partial<SpecExecutionContractStep> = {}) {
  return step({
    contractStepIndex: 1,
    scenarioStepIndex: 24,
    originalText: 'Se muestra "¡Hola!"',
    operation: "assertVisible",
    target: { strategy: "text", value: "¡Hola!" },
    polarity: "positive",
    oracle: { type: "literal_visible_text", backed: true },
    ...overrides,
  });
}

test("a backed, positive visible-text assertion compiles to expectPromotedVisible with a getByText check", () => {
  const result = compile(contract([CLICK, outcome()]));
  assert.deepEqual(result.unsupportedCapabilities, []);
  assert.match(result.source, /import \{ test, expect \} from '@playwright\/test';/);
  assert.match(result.source, /await promotedRuntime\.expectPromotedVisible\(\{/);
  assert.match(result.source, /stepIndex: 24,/);
  assert.match(result.source, /polarity: 'positive',/);
  assert.match(result.source, /await expect\(page\.getByText\("¡Hola!"\)\.first\(\)\)\.toBeVisible\(\);/);
  const binding = result.bindings.find((b) => b.scenarioStepIndex === 24);
  assert.equal(binding?.runtimeMethod, "expectPromotedVisible");
});

test("negative, unresolved polarity, unbacked or text-less assertions are never compiled (fail closed)", () => {
  const cases: Array<[Partial<SpecExecutionContractStep>, RegExp]> = [
    [{ polarity: "negative" }, /assertion_unsupported:polarity_negative/],
    [{ polarity: undefined }, /assertion_unsupported:polarity_unresolved/],
    [{ oracle: { type: "literal_visible_text", backed: false } }, /assertion_unsupported:oracle_not_backed/],
    [{ target: undefined }, /assertion_unsupported:text_target_missing/],
    [{ executionStatus: "unresolved" }, /assertion_unsupported:execution_status_unresolved/],
  ];
  for (const [overrides, expected] of cases) {
    const result = compile(contract([CLICK, outcome(overrides)]));
    assert.equal(result.unsupportedCapabilities.length, 1, JSON.stringify(overrides));
    assert.match(result.unsupportedCapabilities[0], expected);
    assert.doesNotMatch(result.source, /expectPromotedVisible/);
  }
});

test("the contract classifies a recorded 'Se muestra' outcome as assertVisible and keeps its explicit polarity", () => {
  const built = buildSpecExecutionContract(
    { version: "1.0", scenario: { title: "roque 10" }, steps: [{ index: 1, action: "click", target: { strategy: "text", value: "Finalizar sesión" }, description: 'Presionar "Finalizar sesión"' }] } as any,
    {
      title: "roque 10",
      expectedResult: 'Se muestra "¡Hola!"',
      steps: [
        { index: 1, action: 'Presionar "Finalizar sesión"', description: 'Presionar "Finalizar sesión"' },
        { index: 2, action: 'Se muestra "¡Hola!"', description: 'Se muestra "¡Hola!"', polarity: "positive" },
      ],
      observableOracles: [{ id: "observed-01", requirement: "¡Hola!", type: "literal_visible_text", backed: true, source: "discovery", evidence: ["assertion_resolved_during_discovery"] }],
    } as any,
  );
  const assertion = built.steps.find((s) => s.scenarioStepIndex === 2);
  assert.equal(assertion?.operation, "assertVisible");
  assert.equal(assertion?.polarity, "positive");
  assert.equal(assertion?.target?.value, "¡Hola!");
});
