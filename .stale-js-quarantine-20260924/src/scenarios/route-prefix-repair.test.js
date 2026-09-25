"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const scenario_preview_service_1 = require("./scenario-preview.service");
function test(label, fn) {
    try {
        fn();
        console.log(`  PASS  ${label}`);
    }
    catch (err) {
        console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    }
}
function describe(name, fn) {
    console.log(`\n${name}`);
    fn();
}
describe("applyCanonicalRoutePrefix", () => {
    test("repairs wrong order with entry step before functional route prefix", () => {
        const result = (0, scenario_preview_service_1.applyCanonicalRoutePrefix)([
            "Clic en \"Acción principal\".",
            "Clic en \"Entidad\".",
            "Clic en \"Entrada\".",
            "Validar el resultado visible."
        ], ["Acción principal", "Entidad"], [{ action: "click", target: "Entrada", when: "before_first_functional_step" }]);
        node_assert_1.default.deepStrictEqual(result.steps, [
            "Clic en \"Entrada\".",
            "Clic en \"Acción principal\".",
            "Clic en \"Entidad\".",
            "Validar el resultado visible."
        ]);
        node_assert_1.default.strictEqual(result.changed, true);
    });
    test("keeps already ordered scenario unchanged and without duplicates", () => {
        const original = [
            "Clic en \"Entrada\".",
            "Clic en \"Acción principal\".",
            "Clic en \"Entidad\".",
            "Validar el resultado visible."
        ];
        const result = (0, scenario_preview_service_1.applyCanonicalRoutePrefix)([...original], ["Acción principal", "Entidad"], [{ action: "click", target: "Entrada", when: "before_first_functional_step" }]);
        node_assert_1.default.deepStrictEqual(result.steps, original);
        node_assert_1.default.strictEqual(result.changed, false);
    });
    test("inserts missing functional click after entry and before validations", () => {
        const result = (0, scenario_preview_service_1.applyCanonicalRoutePrefix)([
            "Clic en \"Entrada\".",
            "Clic en \"Acción principal\".",
            "Validar el resultado visible."
        ], ["Acción principal", "Entidad"], [{ action: "click", target: "Entrada", when: "before_first_functional_step" }]);
        node_assert_1.default.deepStrictEqual(result.steps, [
            "Clic en \"Entrada\".",
            "Clic en \"Acción principal\".",
            "Clic en \"Entidad\".",
            "Validar el resultado visible."
        ]);
        node_assert_1.default.strictEqual(result.changed, true);
    });
    test("deduplicates repeated targets across case/accent variants", () => {
        const result = (0, scenario_preview_service_1.applyCanonicalRoutePrefix)([
            "Clic en \"entrada\".",
            "Clic en \"acción principal\".",
            "Clic en \"Entidad\".",
            "Validar el resultado visible."
        ], ["ACCION PRINCIPAL", "Acción principal", "Entidad"], [{ action: "click", target: "Entrada", when: "before_first_functional_step" }]);
        const clickSteps = result.steps.filter((step) => /^Clic en /i.test(step));
        node_assert_1.default.deepStrictEqual(clickSteps, [
            "Clic en \"entrada\".",
            "Clic en \"acción principal\".",
            "Clic en \"Entidad\"."
        ]);
        node_assert_1.default.strictEqual(result.steps[result.steps.length - 1], "Validar el resultado visible.");
    });
    test("does not insert entry click when when is not applicable", () => {
        const result = (0, scenario_preview_service_1.applyCanonicalRoutePrefix)([
            "Clic en \"Acción principal\".",
            "Validar el resultado visible."
        ], ["Acción principal"], [{ action: "click", target: "Entrada posterior", when: "after_authentication" }]);
        node_assert_1.default.deepStrictEqual(result.steps, [
            "Clic en \"Acción principal\".",
            "Validar el resultado visible."
        ]);
        node_assert_1.default.strictEqual(result.steps.some((step) => step.includes("Entrada posterior")), false);
        node_assert_1.default.strictEqual(result.changed, false);
    });
    test("ignores non-click entry actions in canonical prefix", () => {
        const result = (0, scenario_preview_service_1.applyCanonicalRoutePrefix)([
            "Clic en \"Acción principal\".",
            "Validar el resultado visible."
        ], ["Acción principal"], [{ action: "fill", target: "Entrada posterior", when: "before_first_functional_step" }]);
        node_assert_1.default.deepStrictEqual(result.steps, [
            "Clic en \"Acción principal\".",
            "Validar el resultado visible."
        ]);
        node_assert_1.default.strictEqual(result.steps.some((step) => step.includes("Entrada posterior")), false);
        node_assert_1.default.strictEqual(result.changed, false);
    });
});
function dedupeScenario(overrides = {}) {
    return {
        sourceIssueKey: "TEST-1",
        title: "Scenario",
        steps: ["Clic en \"Entrada\".", "Validar que se muestre \"Resultado\"."],
        preconditions: [],
        expectedResult: "Resultado",
        type: "functional",
        database: "",
        isConverted: 0,
        automationType: "ui_discovery",
        setupStrategy: "no_login",
        appSlug: "default",
        routeProfile: "",
        dataRequirements: "N/A",
        nonExecutableCriteria: "",
        mcpExecutable: true,
        ...overrides,
    };
}
describe("dedupeScenariosBySemanticSignature", () => {
    test("keeps both scenarios when requirement refs conflict", () => {
        const result = (0, scenario_preview_service_1.dedupeScenariosBySemanticSignature)([
            dedupeScenario({ scenarioId: "with-ref-a", stepRequirementRefs: [{ stepIndex: 1, requirementId: "REQ-A" }] }),
            dedupeScenario({ scenarioId: "with-ref-b", stepRequirementRefs: [{ stepIndex: 1, requirementId: "REQ-B" }] }),
        ]);
        node_assert_1.default.strictEqual(result.removed, 0);
        node_assert_1.default.strictEqual(result.scenarios.length, 2);
    });
    test("prefers structured metadata over semantic strength", () => {
        const result = (0, scenario_preview_service_1.dedupeScenariosBySemanticSignature)([
            dedupeScenario({ scenarioId: "without-ref", _branchRouteCompatibility: { compatible: true, routeId: "route" } }),
            dedupeScenario({ scenarioId: "with-ref", stepRequirementRefs: [{ stepIndex: 1, requirementId: "REQ-A" }] }),
        ]);
        node_assert_1.default.strictEqual(result.removed, 1);
        node_assert_1.default.strictEqual(result.scenarios[0].scenarioId, "with-ref");
    });
    test("allows dedupe when structured metadata is equivalent", () => {
        const refs = [{ stepIndex: 1, requirementId: "REQ-A" }];
        const result = (0, scenario_preview_service_1.dedupeScenariosBySemanticSignature)([
            dedupeScenario({ scenarioId: "first", stepRequirementRefs: refs }),
            dedupeScenario({ scenarioId: "second", stepRequirementRefs: [...refs] }),
        ]);
        node_assert_1.default.strictEqual(result.removed, 1);
        node_assert_1.default.strictEqual(result.scenarios.length, 1);
    });
});
