"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_normalizer_1 = require("../src/automations/scenario-normalizer");
test_1.test.describe("Detail Guard: No ordinal invention from source-backed context", () => {
    const entrySteps = [
        { action: "click", target: "Iniciar", when: "before_first_functional_step" },
    ];
    const routeProfile = {
        name: "test-profile",
        entry: [{ visibleLabel: "Productos", businessLabel: "Products" }],
        entrySteps: [{ action: "click", target: "Iniciar", when: "before_first_functional_step" }],
        aliases: {},
        intermediates: {},
        domainTerms: {},
        visibleControls: [],
        representativeFixture: {},
        notes: [],
    };
    (0, test_1.test)("TEST 1: source-backed noun from assertions — uses noun, no ordinal", () => {
        // Scenario has list navigation beyond root + detail assertions but lost the selection step
        // Source context: "Seleccionar un producto del listado"
        const steps = [
            '1. Clic en "Productos".',
            '2. Clic en "Tarjetas".',
            '3. Validar que se muestre la sección "Beneficios".',
            '4. Validar que se muestre la sección "Detalles".',
        ];
        const result = (0, scenario_normalizer_1.ensureDetailScenarioHasItemSelection)(steps, "", routeProfile, entrySteps);
        (0, test_1.expect)(result.inserted).toBe(true);
        // Should use source-backed noun, NOT ordinal
        const insertedStep = result.steps.find((s, i) => s !== steps[i]);
        (0, test_1.expect)(insertedStep).toBeTruthy();
        (0, test_1.expect)(insertedStep).toMatch(/seleccionar un\/una producto/i);
        (0, test_1.expect)(insertedStep).not.toMatch(/primer/i);
    });
    (0, test_1.test)("TEST 2: source-backed noun from assertion target — uses noun, no ordinal", () => {
        // Source: "Seleccionar una cuenta"
        const steps = [
            '1. Clic en "Productos".',
            '2. Clic en "Cuentas".',
            '3. Validar que se muestre el nombre "Cuenta de Ahorros".',
        ];
        const result = (0, scenario_normalizer_1.ensureDetailScenarioHasItemSelection)(steps, "", routeProfile, entrySteps);
        (0, test_1.expect)(result.inserted).toBe(true);
        const insertedStep = result.steps.find((s, i) => s !== steps[i]);
        (0, test_1.expect)(insertedStep).toBeTruthy();
        (0, test_1.expect)(insertedStep).toMatch(/seleccionar un\/una cuenta/i);
        (0, test_1.expect)(insertedStep).not.toMatch(/primera/i);
    });
    (0, test_1.test)("TEST 3: explicit ordinal in existing step — preserved (already_has_selection)", () => {
        // Source has explicit ordinal: "Seleccionar la primera opción del listado"
        // This should be detected as already having a selection
        const steps = [
            '1. Clic en "Productos".',
            '2. Clic en "Tarjetas".',
            '3. Seleccionar la primera opción del listado.',
            '4. Validar que se muestre la sección "Detalle".',
        ];
        const result = (0, scenario_normalizer_1.ensureDetailScenarioHasItemSelection)(steps, "", routeProfile, entrySteps);
        (0, test_1.expect)(result.inserted).toBe(false);
        (0, test_1.expect)(result.reason).toBe("already_has_selection");
    });
    (0, test_1.test)("TEST 4: no source-backed noun — skips insertion entirely", () => {
        // Has detail assertions (strong signal: "saldo") but no selectable entity noun
        // No noun in assertions, click targets, or expectedResult
        const steps = [
            '1. Clic en "Operaciones".',
            '2. Validar que se muestre el saldo.',
        ];
        const result = (0, scenario_normalizer_1.ensureDetailScenarioHasItemSelection)(steps, "", routeProfile, entrySteps);
        (0, test_1.expect)(result.inserted).toBe(false);
        (0, test_1.expect)(result.reason).toBe("no_source_backed_dynamic_selection");
        // Steps should be unchanged
        (0, test_1.expect)(result.steps).toEqual(steps);
    });
});
