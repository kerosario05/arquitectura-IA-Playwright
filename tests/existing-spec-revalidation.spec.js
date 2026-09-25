"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const existing_spec_revalidation_1 = require("../src/automations/existing-spec-revalidation");
(0, test_1.test)("revalidates existing spec without generation or AI", async () => {
    const result = await (0, existing_spec_revalidation_1.revalidateExistingSpecDeterministically)({ specText: "spec", specPath: __filename, sourceScenario: { steps: [], observableOracles: [] }, executionContract: { steps: [], unresolvedRequiredOracles: [] }, semanticContext: { requiredAssertions: [], observableOracles: [], scenarioSteps: [] }, runTypeScriptValidation: async () => ({ ok: true, stdout: "", stderr: "", exitCode: 0 }), runPlaywrightDiscovery: async () => ({ ok: true, stdout: "1 test", stderr: "", exitCode: 0 }) });
    (0, test_1.expect)(result.status).toBe("passed");
    (0, test_1.expect)(result.aiInvocationCount).toBe(0);
    (0, test_1.expect)(result.candidateGenerated).toBe(false);
});
(0, test_1.test)("returns insufficient_context without invoking AI", async () => {
    const result = await (0, existing_spec_revalidation_1.revalidateExistingSpecDeterministically)({ specText: "spec" });
    (0, test_1.expect)(result.status).toBe("insufficient_context");
    (0, test_1.expect)(result.allRequiredGatesPassed).toBe(false);
});
