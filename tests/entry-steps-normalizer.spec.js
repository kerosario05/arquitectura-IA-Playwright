"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_preview_service_1 = require("../src/scenarios/scenario-preview.service");
function makeScenario(steps) {
    return {
        sourceIssueKey: "AA-123",
        title: "Test scenario",
        steps,
        preconditions: [],
        expectedResult: "Test result",
        type: "Functional",
        database: "QA",
        isConverted: 0,
        automationType: "ui_with_auth_gate",
        setupStrategy: "auth_gate",
        appSlug: "kiosko",
        routeProfile: "informacion_productos",
        dataRequirements: "cliente_fixture",
        nonExecutableCriteria: "",
        mcpExecutable: true,
    };
}
const entryBranch = {
    branchId: "branch-a",
    sourceLabel: "A",
    actionIntent: "select_option",
    expectedDestination: "B",
    accessIntent: "public",
    evidenceSource: "user_story",
    prerequisiteRequirementIds: ["prerequisite:1"],
};
(0, test_1.test)("entry authority: assertion-only scenario rejects routeProfile entry", () => {
    const scenario = makeScenario(['1. Validar que se muestre "X".']);
    (0, test_1.expect)((0, scenario_preview_service_1.isEntryStepInsertionAuthorized)(scenario, [entryBranch])).toBe(false);
});
(0, test_1.test)("entry authority: snapshot/inferred entry does not authorize without refs", () => {
    const scenario = makeScenario(['1. Validar que se muestre "X".']);
    (0, test_1.expect)((0, scenario_preview_service_1.isEntryStepInsertionAuthorized)(scenario, [])).toBe(false);
});
(0, test_1.test)("entry authority: canonical prerequisite action authorizes trusted implementation", () => {
    const scenario = makeScenario(['1. Validar que se muestre "X".']);
    scenario.stepRequirementRefs = [{ stepIndex: 0, requirementId: "prerequisite:1", facet: "action" }];
    (0, test_1.expect)((0, scenario_preview_service_1.isEntryStepInsertionAuthorized)(scenario, [entryBranch])).toBe(true);
});
(0, test_1.test)("entry canonicalization preserves assertions-before-existing-action order", () => {
    const result = (0, scenario_preview_service_1.applyCanonicalRoutePrefix)(['1. Validar que se muestre "X".', '2. Clic en "A".'], [], [{ action: "click", target: "A", when: "before_first_functional_step" }]);
    (0, test_1.expect)(result.steps).toEqual(['1. Validar que se muestre "X".', '2. Clic en "A".']);
    (0, test_1.expect)(result.changed).toBe(false);
});
// ── Entry step insertion ──────────────────────────────────────────
(0, test_1.test)("insertEntrySteps: prepends all entry steps when none present", () => {
    const scenario = makeScenario([
        '1. Clic en "Información de productos".',
        '2. Validar que se muestre "Tarjetas de crédito".',
    ]);
    const result = (0, scenario_preview_service_1.insertEntrySteps)(scenario, ["Iniciar", "Información de productos"]);
    (0, test_1.expect)(result.steps[0]).toBe('1. Clic en "Iniciar".');
    (0, test_1.expect)(result.steps[1]).toBe('2. Clic en "Información de productos".');
    (0, test_1.expect)(result.steps[2]).toBe('3. Validar que se muestre "Tarjetas de crédito".');
    (0, test_1.expect)(result.steps).toHaveLength(3);
});
(0, test_1.test)("insertEntrySteps: does not duplicate when entry steps already present", () => {
    const scenario = makeScenario([
        '1. Clic en "Iniciar".',
        '2. Clic en "Información de productos".',
        '3. Validar que se muestre "Tarjetas de crédito".',
    ]);
    const result = (0, scenario_preview_service_1.insertEntrySteps)(scenario, ["Iniciar", "Información de productos"]);
    (0, test_1.expect)(result.steps).toEqual(scenario.steps);
    (0, test_1.expect)(result.steps).toHaveLength(3);
});
(0, test_1.test)("insertEntrySteps: inserts only missing prefix when scenario starts at step 2", () => {
    const scenario = makeScenario([
        '1. Clic en "Información de productos".',
        '2. Validar que se muestre "Tarjetas de crédito".',
    ]);
    const result = (0, scenario_preview_service_1.insertEntrySteps)(scenario, ["Iniciar", "Información de productos"]);
    (0, test_1.expect)(result.steps[0]).toBe('1. Clic en "Iniciar".');
    (0, test_1.expect)(result.steps[1]).toBe('2. Clic en "Información de productos".');
    (0, test_1.expect)(result.steps[2]).toBe('3. Validar que se muestre "Tarjetas de crédito".');
    (0, test_1.expect)(result.steps).toHaveLength(3);
});
(0, test_1.test)("insertEntrySteps: handles three entry steps", () => {
    const scenario = makeScenario([
        '1. Validar que se muestre "Tarjetas de crédito".',
    ]);
    const result = (0, scenario_preview_service_1.insertEntrySteps)(scenario, ["Iniciar", "Transacciones y servicios", "Tarjetas de crédito"]);
    (0, test_1.expect)(result.steps[0]).toBe('1. Clic en "Iniciar".');
    (0, test_1.expect)(result.steps[1]).toBe('2. Clic en "Transacciones y servicios".');
    (0, test_1.expect)(result.steps[2]).toBe('3. Clic en "Tarjetas de crédito".');
    (0, test_1.expect)(result.steps[3]).toBe('4. Validar que se muestre "Tarjetas de crédito".');
    (0, test_1.expect)(result.steps).toHaveLength(4);
});
(0, test_1.test)("insertEntrySteps: returns same scenario when no entry steps", () => {
    const scenario = makeScenario([
        '1. Clic en "Información de productos".',
    ]);
    const result = (0, scenario_preview_service_1.insertEntrySteps)(scenario, []);
    (0, test_1.expect)(result).toBe(scenario);
});
(0, test_1.test)("insertEntrySteps: returns same scenario when no scenario steps", () => {
    const scenario = makeScenario([]);
    const result = (0, scenario_preview_service_1.insertEntrySteps)(scenario, ["Iniciar"]);
    (0, test_1.expect)(result).toBe(scenario);
});
(0, test_1.test)("insertEntrySteps: renumbers steps correctly after insertion", () => {
    const scenario = makeScenario([
        '1. Clic en "Información de productos".',
        '2. Validar que se muestre "Tarjetas de crédito".',
        '3. Clic en "Volver".',
    ]);
    const result = (0, scenario_preview_service_1.insertEntrySteps)(scenario, ["Iniciar", "Información de productos"]);
    (0, test_1.expect)(result.steps[0]).toBe('1. Clic en "Iniciar".');
    (0, test_1.expect)(result.steps[1]).toBe('2. Clic en "Información de productos".');
    (0, test_1.expect)(result.steps[2]).toBe('3. Validar que se muestre "Tarjetas de crédito".');
    (0, test_1.expect)(result.steps[3]).toBe('4. Clic en "Volver".');
    (0, test_1.expect)(result.steps).toHaveLength(4);
});
// ── Scenario appSlug normalization ────────────────────────────────
(0, test_1.test)("scenarios use targetAppSlug=kiosko for Detalle_KIOSKO", () => {
    // This is verified by the integration flow:
    // resolveAppForPreview({ testrailSectionName: "Detalle_KIOSKO" }) → kiosko
    // Then normalizeScenariosToTargetApp forces appSlug=kiosko
    const { resolveAppForPreview } = require("../src/automations/app-auto-resolver");
    const result = resolveAppForPreview({
        testrailSectionName: "Detalle_KIOSKO",
        requestAppSlug: "arquitectura-automatizacion",
    });
    (0, test_1.expect)(result.appSlug).toBe("kiosko");
    (0, test_1.expect)(result.appName).toBe("KIOSKO");
    (0, test_1.expect)(result.source).toBe("testrail_section");
    (0, test_1.expect)(result.confidence).toBe("high");
});
