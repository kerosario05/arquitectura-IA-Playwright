import { expect, test } from "@playwright/test";
import { revalidateExistingSpecDeterministically } from "../src/automations/existing-spec-revalidation";

test("revalidates existing spec without generation or AI", async () => {
  const result = await revalidateExistingSpecDeterministically({ specText: "spec", specPath: __filename, sourceScenario: { steps: [], observableOracles: [] } as any, executionContract: { steps: [], unresolvedRequiredOracles: [] } as any, semanticContext: { requiredAssertions: [], observableOracles: [], scenarioSteps: [] }, runTypeScriptValidation: async () => ({ ok: true, stdout: "", stderr: "", exitCode: 0 }), runPlaywrightDiscovery: async () => ({ ok: true, stdout: "1 test", stderr: "", exitCode: 0 }) });
  expect(result.status).toBe("passed");
  expect(result.aiInvocationCount).toBe(0);
  expect(result.candidateGenerated).toBe(false);
});

test("returns insufficient_context without invoking AI", async () => {
  const result = await revalidateExistingSpecDeterministically({ specText: "spec" });
  expect(result.status).toBe("insufficient_context");
  expect(result.allRequiredGatesPassed).toBe(false);
});
