"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const spec_execution_contract_1 = require("../src/automations/spec-execution-contract");
function makeContract(opts) {
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
(0, test_1.test)("trace fidelity: callback_implementation_mismatch when action calls wrong method", () => {
    const contract = makeContract({ method: "openProducts" });
    const result = (0, spec_execution_contract_1.computeTraceFidelity)(INVALID_SPEC, contract);
    (0, test_1.expect)(result.status).toBe("failed");
    const mismatchError = result.errors.find((e) => e.startsWith("callback_implementation_mismatch"));
    (0, test_1.expect)(mismatchError).toBeDefined();
    (0, test_1.expect)(mismatchError).toContain("expectedOwner=HomePage");
    (0, test_1.expect)(mismatchError).toContain("expectedMethod=openProducts");
    (0, test_1.expect)(mismatchError).toContain("homePage.start");
});
(0, test_1.test)("trace fidelity: no mismatch when action calls correct method", () => {
    const contract = makeContract({ method: "openProducts" });
    const result = (0, spec_execution_contract_1.computeTraceFidelity)(VALID_SPEC, contract);
    const mismatchErrors = result.errors.filter((e) => e.startsWith("callback_implementation_mismatch"));
    (0, test_1.expect)(mismatchErrors).toHaveLength(0);
});
