import { test, expect } from "@playwright/test";
import {
  computeTraceFidelity,
  type SpecExecutionContract,
} from "../src/automations/spec-execution-contract";

function makeContract(opts: { method: string }): SpecExecutionContract {
  return {
    version: "1",
    scenarioId: "T1",
    title: "callback check",
    steps: [
      {
        contractStepIndex: 0,
        scenarioStepIndex: 2,
        originalText: "Clic en Explora nuestros productos",
        operation: "click",
        target: { strategy: "text", value: "Explora nuestros productos" },
        implementation: {
          kind: "page_object",
          owner: "HomePage",
          method: opts.method,
        },
        executionStatus: "executed",
        evidenceRefs: [],
      },
    ],
    unresolvedRequiredOracles: [],
    diagnostics: {
      requiredScenarioSteps: 1,
      representedScenarioSteps: 1,
      missingScenarioSteps: [],
    },
  };
}

const INVALID_SPEC = [
  "await promotedRuntime.clickPromotedTarget({",
  "  stepIndex: 2,",
  "  target: 'Explora nuestros productos',",
  "  action: async () => {",
  "    await homePage.start();",
  "  },",
  "});",
].join("\n");

const VALID_SPEC = [
  "await promotedRuntime.clickPromotedTarget({",
  "  stepIndex: 2,",
  "  target: 'Explora nuestros productos',",
  "  action: async () => {",
  "    await homePage.openProducts();",
  "  },",
  "});",
].join("\n");

test("trace fidelity: callback_implementation_mismatch when action calls wrong method", () => {
  const contract = makeContract({ method: "openProducts" });
  const result = computeTraceFidelity(INVALID_SPEC, contract);

  expect(result.status).toBe("failed");
  const mismatchError = result.errors.find((e) =>
    e.startsWith("callback_implementation_mismatch")
  );
  expect(mismatchError).toBeDefined();
  expect(mismatchError).toContain("expectedOwner=HomePage");
  expect(mismatchError).toContain("expectedMethod=openProducts");
  expect(mismatchError).toContain("homePage.start");
});

test("trace fidelity: no mismatch when action calls correct method", () => {
  const contract = makeContract({ method: "openProducts" });
  const result = computeTraceFidelity(VALID_SPEC, contract);

  const mismatchErrors = result.errors.filter((e) =>
    e.startsWith("callback_implementation_mismatch")
  );
  expect(mismatchErrors).toHaveLength(0);
});
