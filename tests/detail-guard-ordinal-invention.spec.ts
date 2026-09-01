import { test, expect } from "@playwright/test";
import { ensureDetailScenarioHasItemSelection } from "../src/automations/scenario-normalizer";
import type { McpRouteProfile, EntryStepConfig } from "../src/scenarios/scenario-types";

test.describe("Detail Guard: No ordinal invention from source-backed context", () => {
  const entrySteps: EntryStepConfig[] = [
    { action: "click", target: "Iniciar", when: "before_first_functional_step" },
  ];

  const routeProfile: McpRouteProfile = {
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

  test("TEST 1: source-backed noun from assertions — uses noun, no ordinal", () => {
    // Scenario has list navigation beyond root + detail assertions but lost the selection step
    // Source context: "Seleccionar un producto del listado"
    const steps = [
      '1. Clic en "Productos".',
      '2. Clic en "Tarjetas".',
      '3. Validar que se muestre la sección "Beneficios".',
      '4. Validar que se muestre la sección "Detalles".',
    ];

    const result = ensureDetailScenarioHasItemSelection(steps, "", routeProfile, entrySteps);

    expect(result.inserted).toBe(true);
    // Should use source-backed noun, NOT ordinal
    const insertedStep = result.steps.find((s, i) => s !== steps[i]);
    expect(insertedStep).toBeTruthy();
    expect(insertedStep).toMatch(/seleccionar un\/una producto/i);
    expect(insertedStep).not.toMatch(/primer/i);
  });

  test("TEST 2: source-backed noun from assertion target — uses noun, no ordinal", () => {
    // Source: "Seleccionar una cuenta"
    const steps = [
      '1. Clic en "Productos".',
      '2. Clic en "Cuentas".',
      '3. Validar que se muestre el nombre "Cuenta de Ahorros".',
    ];

    const result = ensureDetailScenarioHasItemSelection(steps, "", routeProfile, entrySteps);

    expect(result.inserted).toBe(true);
    const insertedStep = result.steps.find((s, i) => s !== steps[i]);
    expect(insertedStep).toBeTruthy();
    expect(insertedStep).toMatch(/seleccionar un\/una cuenta/i);
    expect(insertedStep).not.toMatch(/primera/i);
  });

  test("TEST 3: explicit ordinal in existing step — preserved (already_has_selection)", () => {
    // Source has explicit ordinal: "Seleccionar la primera opción del listado"
    // This should be detected as already having a selection
    const steps = [
      '1. Clic en "Productos".',
      '2. Clic en "Tarjetas".',
      '3. Seleccionar la primera opción del listado.',
      '4. Validar que se muestre la sección "Detalle".',
    ];

    const result = ensureDetailScenarioHasItemSelection(steps, "", routeProfile, entrySteps);

    expect(result.inserted).toBe(false);
    expect(result.reason).toBe("already_has_selection");
  });

  test("TEST 4: no source-backed noun — skips insertion entirely", () => {
    // Has detail assertions (strong signal: "saldo") but no selectable entity noun
    // No noun in assertions, click targets, or expectedResult
    const steps = [
      '1. Clic en "Operaciones".',
      '2. Validar que se muestre el saldo.',
    ];

    const result = ensureDetailScenarioHasItemSelection(steps, "", routeProfile, entrySteps);

    expect(result.inserted).toBe(false);
    expect(result.reason).toBe("no_source_backed_dynamic_selection");
    // Steps should be unchanged
    expect(result.steps).toEqual(steps);
  });
});
