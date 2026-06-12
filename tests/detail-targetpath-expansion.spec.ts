import { test, expect } from "@playwright/test";
import { ensureDetailScenarioHasItemSelection } from "../src/automations/scenario-normalizer";
import type { McpRouteProfile, EntryStepConfig } from "../src/scenarios/scenario-types";

test.describe("Detail Scenario TargetPath Expansion", () => {
  const entrySteps: EntryStepConfig[] = [
    { action: "click", target: "Iniciar", when: "before_first_functional_step" },
  ];

  test("Expands exact targetPath instead of inserting ordinal - Tarjeta Crédito Visa Clásica", () => {
    const routeProfile: McpRouteProfile = {
      name: "test-profile",
      entry: [{ visibleLabel: "Información de productos", businessLabel: "Products" }],
      entrySteps: [{ action: "click", target: "Iniciar", when: "before_first_functional_step" }],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: [],
      representativeFixture: {},
      notes: [],
      targetPaths: {
        "Tarjeta Crédito Visa Clásica": {
          target: "Tarjeta Crédito Visa Clásica",
          requiredIntermediates: ["Información de productos", "Tarjetas", "Tarjeta de Crédito"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "Tarjetas",
            productLabel: "Tarjeta Crédito Visa Clásica",
            normalizedLabel: "tarjeta_credito_visa_clasica",
            presentationType: "detail_page",
            clickableToDetail: true,
            discoveredAt: new Date().toISOString(),
            detailSections: ["Beneficios", "Detalles"],
            actionButtons: ["Solicitar", "Volver"],
          },
        },
      },
    };

    const steps = [
      '1. Clic en "Iniciar".',
      '2. Clic en "Información de productos".',
      '3. Validar que se muestre "Tarjeta Crédito Visa Clásica".',
      '4. Validar que se muestre la sección "Beneficios".',
      '5. Validar que se muestre la sección "Detalles".',
    ];

    const result = ensureDetailScenarioHasItemSelection(steps, "", routeProfile, entrySteps);

    expect(result.inserted).toBe(true);
    expect(result.reason).toBe("expanded_exact_targetPath");

    // Should expand full path WITHOUT ordinal
    expect(result.steps).toContain('Clic en "Tarjetas".');
    expect(result.steps).toContain('Clic en "Tarjeta de Crédito".');
    expect(result.steps).toContain('Clic en "Tarjeta Crédito Visa Clásica".');

    // Should NOT contain ordinal selection
    const hasOrdinal = result.steps.some((s) => /Seleccionar el primer/i.test(s));
    expect(hasOrdinal).toBe(false);

    console.log("Expanded steps:");
    result.steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  });

  test("Expands exact targetPath - Cuenta de Ahorros Personal en Euros", () => {
    const routeProfile: McpRouteProfile = {
      name: "test-profile",
      entry: [{ visibleLabel: "Información de productos", businessLabel: "Products" }],
      entrySteps: [{ action: "click", target: "Iniciar", when: "before_first_functional_step" }],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: [],
      representativeFixture: {},
      notes: [],
      targetPaths: {
        "Cuenta de Ahorros Personal en Euros": {
          target: "Cuenta de Ahorros Personal en Euros",
          requiredIntermediates: ["Información de productos", "Cuentas", "Cuenta de Ahorro"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "Cuentas",
            productLabel: "Cuenta de Ahorros Personal en Euros",
            normalizedLabel: "cuenta_de_ahorros_personal_en_euros",
            presentationType: "detail_page",
            clickableToDetail: true,
            discoveredAt: new Date().toISOString(),
          },
        },
      },
    };

    const steps = [
      '1. Clic en "Iniciar".',
      '2. Clic en "Información de productos".',
      '3. Validar que se muestre "Cuenta de Ahorros Personal en Euros".',
      '4. Validar que se muestre "Detalles".',
    ];

    const result = ensureDetailScenarioHasItemSelection(steps, "", routeProfile, entrySteps);

    expect(result.inserted).toBe(true);
    expect(result.reason).toBe("expanded_exact_targetPath");

    expect(result.steps).toContain('Clic en "Cuentas".');
    expect(result.steps).toContain('Clic en "Cuenta de Ahorro".');
    expect(result.steps).toContain('Clic en "Cuenta de Ahorros Personal en Euros".');

    const hasOrdinal = result.steps.some((s) => /Seleccionar el primer/i.test(s));
    expect(hasOrdinal).toBe(false);
  });

  test("Expands exact targetPath - Depósitos a plazo en Dólares", () => {
    const routeProfile: McpRouteProfile = {
      name: "test-profile",
      entry: [{ visibleLabel: "Información de productos", businessLabel: "Products" }],
      entrySteps: [{ action: "click", target: "Iniciar", when: "before_first_functional_step" }],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: [],
      representativeFixture: {},
      notes: [],
      targetPaths: {
        "Depósito a Plazo en Dólares": {
          target: "Depósito a Plazo en Dólares",
          requiredIntermediates: ["Información de productos", "Depósitos a plazo"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "Depósitos a plazo",
            productLabel: "Depósito a Plazo en Dólares",
            normalizedLabel: "deposito_a_plazo_en_dolares",
            presentationType: "detail_page",
            clickableToDetail: true,
            discoveredAt: new Date().toISOString(),
          },
        },
        "Depósito a Plazo en Pesos": {
          target: "Depósito a Plazo en Pesos",
          requiredIntermediates: ["Información de productos", "Depósitos a plazo"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "Depósitos a plazo",
            productLabel: "Depósito a Plazo en Pesos",
            normalizedLabel: "deposito_a_plazo_en_pesos",
            presentationType: "detail_page",
            clickableToDetail: true,
            discoveredAt: new Date().toISOString(),
          },
        },
      },
    };

    const steps = [
      '1. Clic en "Iniciar".',
      '2. Clic en "Información de productos".',
      '3. Validar que se muestre "Depósito a Plazo en Dólares".',
      '4. Validar que se muestre "Detalles del producto".',  // Detail keyword
    ];

    const result = ensureDetailScenarioHasItemSelection(steps, "", routeProfile, entrySteps);

    expect(result.inserted).toBe(true);
    expect(result.reason).toBe("expanded_exact_targetPath");

    expect(result.steps).toContain('Clic en "Depósitos a plazo".');
    expect(result.steps).toContain('Clic en "Depósito a Plazo en Dólares".');

    // CRITICAL: Should NOT select "Pesos" when "Dólares" is expected
    expect(result.steps).not.toContain('Clic en "Depósito a Plazo en Pesos".');

    const hasOrdinal = result.steps.some((s) => /Seleccionar el primer/i.test(s));
    expect(hasOrdinal).toBe(false);
  });

  test("Falls back to ordinal when no matching targetPath exists", () => {
    const routeProfile: McpRouteProfile = {
      name: "test-profile",
      entry: [{ visibleLabel: "Información de productos", businessLabel: "Products" }],
      entrySteps: [{ action: "click", target: "Iniciar", when: "before_first_functional_step" }],
      aliases: {},
      intermediates: {},
      domainTerms: { producto: 5, item: 2 },
      visibleControls: ["Tarjetas", "Cuentas"],
      representativeFixture: {},
      notes: [],
      targetPaths: {}, // NO targetPaths defined
    };

    const steps = [
      '1. Clic en "Iniciar".',
      '2. Clic en "Información de productos".',
      '3. Clic en "Tarjetas".',
      '4. Validar que se muestre "Beneficios".',  // Detail keyword present
      '5. Validar que se muestre "Detalles".',  // Detail keyword present
    ];

    const result = ensureDetailScenarioHasItemSelection(steps, "", routeProfile, entrySteps);

    console.log("Result:", {
      inserted: result.inserted,
      reason: result.reason,
      stepCount: result.steps.length,
      steps: result.steps,
    });

    expect(result.inserted).toBe(true);
    // Should fall back to ordinal because no targetPath exists
    expect(result.reason).not.toBe("expanded_exact_targetPath");

    // Should contain ordinal selection (flexible pattern)
    const hasOrdinal = result.steps.some((s) => /Seleccionar el primer/i.test(s));
    expect(hasOrdinal).toBe(true);
  });

  test("Skips non-clickable products (clickableToDetail=false)", () => {
    const routeProfile: McpRouteProfile = {
      name: "test-profile",
      entry: [{ visibleLabel: "Información de productos", businessLabel: "Products" }],
      entrySteps: [{ action: "click", target: "Iniciar", when: "before_first_functional_step" }],
      aliases: {},
      intermediates: {},
      domainTerms: { producto: 3 },
      visibleControls: ["Tarjetas"],
      representativeFixture: {},
      notes: [],
      targetPaths: {
        "Instructivo de Uso": {
          target: "Instructivo de Uso",
          requiredIntermediates: ["Información de productos", "Documentación"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "Documentación",
            productLabel: "Instructivo de Uso",
            normalizedLabel: "instructivo_de_uso",
            presentationType: "product_card",
            clickableToDetail: false, // NOT clickable
            discoveredAt: new Date().toISOString(),
          },
        },
      },
    };

    const steps = [
      '1. Clic en "Iniciar".',
      '2. Clic en "Información de productos".',
      '3. Clic en "Tarjetas".',
      '4. Validar que se muestre "Instructivo de Uso".',
      '5. Validar que se muestre "Detalles".',  // Detail keyword
      '6. Validar que se muestre "Información de seguridad".',  // Detail keyword
    ];

    const result = ensureDetailScenarioHasItemSelection(steps, "", routeProfile, entrySteps);

    expect(result.inserted).toBe(true);
    // Should NOT expand targetPath for non-clickable product
    expect(result.reason).not.toBe("expanded_exact_targetPath");

    // Should fall back to ordinal (flexible pattern)
    const hasOrdinal = result.steps.some((s) => /Seleccionar el primer/i.test(s));
    expect(hasOrdinal).toBe(true);
  });

  test("Deduplicates navigation steps during expansion", () => {
    const routeProfile: McpRouteProfile = {
      name: "test-profile",
      entry: [{ visibleLabel: "Información de productos", businessLabel: "Products" }],
      entrySteps: [{ action: "click", target: "Iniciar", when: "before_first_functional_step" }],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: [],
      representativeFixture: {},
      notes: [],
      targetPaths: {
        "Préstamo Personal": {
          target: "Préstamo Personal",
          requiredIntermediates: ["Información de productos", "Préstamos"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "Préstamos",
            productLabel: "Préstamo Personal",
            normalizedLabel: "prestamo_personal",
            presentationType: "detail_page",
            clickableToDetail: true,
            discoveredAt: new Date().toISOString(),
            detailSections: ["Detalles", "Requisitos"],  // Detail keywords
          },
        },
      },
    };

    const steps = [
      '1. Clic en "Iniciar".',
      '2. Clic en "Información de productos".', // Already present, should NOT duplicate
      '3. Validar que se muestre "Préstamo Personal".',
      '4. Validar que se muestre "Detalles".',  // Detail keyword
    ];

    const result = ensureDetailScenarioHasItemSelection(steps, "", routeProfile, entrySteps);

    expect(result.inserted).toBe(true);
    expect(result.reason).toBe("expanded_exact_targetPath");

    // Count how many times "Información de productos" appears
    const informacionCount = result.steps.filter((s) => s.includes('Información de productos')).length;
    expect(informacionCount).toBe(1); // Should appear only once

    expect(result.steps).toContain('Clic en "Préstamos".');
    expect(result.steps).toContain('Clic en "Préstamo Personal".');
  });
});
