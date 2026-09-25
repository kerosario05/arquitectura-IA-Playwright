"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const spec_execution_contract_1 = require("../src/automations/spec-execution-contract");
const spec_generation_hybrid_1 = require("../src/automations/spec-generation-hybrid");
const semantic_text_normalization_1 = require("../src/automations/semantic-text-normalization");
test_1.test.describe("semantic Unicode equivalence", () => {
    (0, test_1.test)("T1-T4 equivalent representations compare equal", () => {
        (0, test_1.expect)((0, semantic_text_normalization_1.semanticallyEqualText)("módulo", "m\\u00f3dulo")).toBe(true);
        (0, test_1.expect)((0, semantic_text_normalization_1.semanticallyEqualText)("é", "\\u00e9")).toBe(true);
        (0, test_1.expect)((0, semantic_text_normalization_1.semanticallyEqualText)("¿Qué?", "\\u00bfQu\\u00e9?")).toBe(true);
        (0, test_1.expect)((0, semantic_text_normalization_1.semanticallyEqualText)("café", "cafe\\u0301")).toBe(true);
    });
    (0, test_1.test)("T5-T6 real changes remain different", () => {
        (0, test_1.expect)((0, semantic_text_normalization_1.semanticallyEqualText)("módulo", "modulo")).toBe(false);
        (0, test_1.expect)((0, semantic_text_normalization_1.semanticallyEqualText)("Continuar", "Iniciar")).toBe(false);
    });
    (0, test_1.test)("T7-T8 mojibake repair is preserved and idempotent", () => {
        const repaired = (0, semantic_text_normalization_1.normalizeSemanticText)("Â¿QuÃ©?");
        (0, test_1.expect)(repaired).toBe("¿Qué?");
        (0, test_1.expect)((0, semantic_text_normalization_1.normalizeSemanticText)(repaired)).toBe(repaired);
    });
    (0, test_1.test)("T9-T10 trace fidelity compares decoded literal values", () => {
        const contract = {
            steps: [{ scenarioStepIndex: 0, contractStepIndex: 0, operation: "click", target: { strategy: "text", value: "¿Qué?" } }],
        };
        const equivalent = String.raw `await promotedRuntime.clickPromotedTarget({ stepIndex: 0, target: "\u00bfQu\u00e9?", action: async () => {} });`;
        const changed = String.raw `await promotedRuntime.clickPromotedTarget({ stepIndex: 0, target: "Continuar", action: async () => {} });`;
        (0, test_1.expect)((0, spec_execution_contract_1.computeTraceFidelity)(equivalent, contract).status).toBe("passed");
        (0, test_1.expect)((0, spec_execution_contract_1.computeTraceFidelity)(changed, contract).errors.some((error) => error.startsWith("contract_target_changed:"))).toBe(true);
    });
    (0, test_1.test)("T11-T14 metadata values are validated structurally", () => {
        const base = {
            expectedAppSlug: "app-test",
            expectedSectionSlug: "section-test",
            expectedScenarioId: "scenario-test",
            expectedScenarioTitle: "¿Qué módulo?",
        };
        const common = `createPromotedSpecRuntime(); finally { finishEvidence(); }`;
        const equivalent = `${common}\nprocess.env.APP_SLUG = 'app-test';\nprocess.env.SECTION_SLUG = 'section-test';\nprocess.env.SCENARIO_ID = 'scenario-test';\nprocess.env.SCENARIO_TITLE = '\\u00bfQu\\u00e9 m\\u00f3dulo?';`;
        const validate = (specContent) => (0, spec_generation_hybrid_1.structuralValidation)({
            ...base,
            specContent,
            sourceExpectedResultPresent: false,
            expectedResultText: "",
            scenarioSteps: [],
            requiredAssertions: [],
            observableOracles: [],
            executableStepIndexes: [],
            planStepActions: new Map(),
            response: { usedPageObjects: [], declaredIdentifiers: [], unresolvedRequirements: [] },
            availablePageObjects: [],
            observedEvidencePhrases: [],
            promotedRuntimeMethodsAllowlist: [],
            mode: "deterministic",
        });
        (0, test_1.expect)(validate(equivalent).structureErrors.some((error) => error.startsWith("missing_metadata_line:"))).toBe(false);
        (0, test_1.expect)(validate(equivalent.replace("scenario-test", "wrong-id")).structureErrors).toContain("missing_metadata_line:SCENARIO_ID");
        (0, test_1.expect)(validate(equivalent.replace("app-test", "wrong-app")).structureErrors).toContain("missing_metadata_line:APP_SLUG");
        (0, test_1.expect)(validate(equivalent.replace("SCENARIO_TITLE =", "SCENARIO_TITLE = 'wrong'; /* ")).structureErrors).toContain("missing_metadata_line:SCENARIO_TITLE");
        (0, test_1.expect)((0, semantic_text_normalization_1.decodeJsStringLiteralBody)("\\u00bfQu\\u00e9?")).toBe("¿Qué?");
    });
    (0, test_1.test)("T15-T16 production remains bounded and app-agnostic", () => {
        const utilitySource = require("fs").readFileSync(require.resolve("../src/automations/semantic-text-normalization"), "utf8");
        (0, test_1.expect)(utilitySource).not.toMatch(/\b(?:eval|new Function)\b/);
        (0, test_1.expect)(utilitySource).not.toMatch(/kiosko|AA-\d+|http/i);
    });
});
