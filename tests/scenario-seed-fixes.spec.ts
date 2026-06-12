import { test, expect } from "@playwright/test";
import { generateDeterministicSeeds } from "../src/scenarios/scenario-deterministic-seeds";
import { validateScenario } from "../src/scenarios/scenario-validator";
import type { McpRouteProfile, McpScenario, JiraIssueSource } from "../src/scenarios/scenario-types";

test.describe("Scenario Seed Fixes", () => {
  const mockIssue: JiraIssueSource = {
    key: "AA-82",
    summary: "Visualizar información de productos",
    description: "Visualizar tarjetas, cuentas, depósitos y préstamos",
    acceptanceCriteria: null,
    labels: [],
    components: [],
    status: "In Progress",
    issueType: "Story",
  };

  test("Fix 1: No duplica 'Información de productos' en steps", () => {
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
        "Tarjeta Visa Gold": {
          target: "Tarjeta Visa Gold",
          requiredIntermediates: ["Información de productos", "Tarjetas", "Tarjeta de Crédito"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "General",
            productLabel: "Tarjeta Visa Gold",
            normalizedLabel: "tarjeta_visa_gold",
            presentationType: "detail_page",
            discoveredAt: new Date().toISOString(),
            detailSections: ["Beneficios", "Detalles"],
            actionButtons: ["Solicitar", "Volver"],
            clickableToDetail: true,
          },
        },
      },
    };

    const seeds = generateDeterministicSeeds(
      routeProfile,
      [],
      mockIssue,
      "test-app",
      "exhaustive",
      { automationType: "ui_discovery", setupStrategy: "no_login" }
    );

    expect(seeds.length).toBe(1);
    const seed = seeds[0];

    // Count occurrences of "Información de productos"
    const informacionCount = seed.steps.filter((s) =>
      s.toLowerCase().includes("información de productos")
    ).length;

    expect(informacionCount).toBe(1); // Should appear only ONCE
    console.log(`Steps for "${seed.title}":`);
    console.log(seed.steps.join("\n"));
  });

  test("Fix 2: Préstamo Personal no queda agrupado en General", () => {
    const routeProfile: McpRouteProfile = {
      name: "test-profile",
      entry: [{ visibleLabel: "Información de productos", businessLabel: "Products" }],
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
            category: "General", // Wrongly categorized as General
            productLabel: "Préstamo Personal",
            normalizedLabel: "prestamo_personal",
            presentationType: "detail_page",
            discoveredAt: new Date().toISOString(),
            detailSections: ["Detalles", "Requisitos"],
            actionButtons: ["Solicitar", "Volver"],
            clickableToDetail: true,
          },
        },
        "Tarjeta Visa Gold": {
          target: "Tarjeta Visa Gold",
          requiredIntermediates: ["Información de productos", "Tarjetas", "Tarjeta de Crédito"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "General",
            productLabel: "Tarjeta Visa Gold",
            normalizedLabel: "tarjeta_visa_gold",
            presentationType: "detail_page",
            discoveredAt: new Date().toISOString(),
            detailSections: ["Beneficios"],
            actionButtons: ["Solicitar", "Volver"],
            clickableToDetail: true,
          },
        },
      },
    };

    const seeds = generateDeterministicSeeds(
      routeProfile,
      [],
      mockIssue,
      "test-app",
      "representative",
      { automationType: "ui_discovery", setupStrategy: "no_login" }
    );

    // Should generate seeds for both "Préstamos" and "Tarjetas" functional groups
    // NOT grouped under "General"
    expect(seeds.length).toBeGreaterThanOrEqual(2);

    const prestamoSeed = seeds.find((s) => s.title.includes("Préstamo Personal"));
    const tarjetaSeed = seeds.find((s) => s.title.includes("Tarjeta"));

    expect(prestamoSeed).toBeDefined();
    expect(tarjetaSeed).toBeDefined();

    console.log(`Generated ${seeds.length} seeds for representative mode`);
    console.log(`Préstamo seed: ${prestamoSeed?.title}`);
    console.log(`Tarjeta seed: ${tarjetaSeed?.title}`);
  });

  test("Fix 3: Representative incluye Préstamo Personal", () => {
    const routeProfile: McpRouteProfile = {
      name: "test-profile",
      entry: [{ visibleLabel: "Información de productos", businessLabel: "Products" }],
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
            category: "General",
            productLabel: "Préstamo Personal",
            normalizedLabel: "prestamo_personal",
            presentationType: "detail_page",
            discoveredAt: new Date().toISOString(),
            detailSections: ["Detalles"],
            actionButtons: ["Solicitar", "Volver"],
            clickableToDetail: true,
          },
        },
        "Tarjeta Visa Gold": {
          target: "Tarjeta Visa Gold",
          requiredIntermediates: ["Información de productos", "Tarjetas"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "Tarjetas",
            productLabel: "Tarjeta Visa Gold",
            normalizedLabel: "tarjeta_visa_gold",
            presentationType: "detail_page",
            discoveredAt: new Date().toISOString(),
            detailSections: ["Beneficios"],
            actionButtons: ["Solicitar", "Volver"],
            clickableToDetail: true,
          },
        },
        "Cuenta en Pesos": {
          target: "Cuenta en Pesos",
          requiredIntermediates: ["Información de productos", "Cuentas"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "Cuentas",
            productLabel: "Cuenta en Pesos",
            normalizedLabel: "cuenta_en_pesos",
            presentationType: "detail_page",
            discoveredAt: new Date().toISOString(),
            detailSections: ["Detalles"],
            actionButtons: ["Volver"],
            clickableToDetail: true,
          },
        },
      },
    };

    const seeds = generateDeterministicSeeds(
      routeProfile,
      [],
      mockIssue,
      "test-app",
      "representative",
      { automationType: "ui_discovery", setupStrategy: "no_login" }
    );

    // Representative mode should include at least one from each major category
    const hasPrestamoPersonal = seeds.some((s) => s.title.includes("Préstamo Personal"));
    const hasTarjeta = seeds.some((s) => s.title.includes("Tarjeta"));
    const hasCuenta = seeds.some((s) => s.title.includes("Cuenta"));

    expect(hasPrestamoPersonal).toBe(true);
    expect(hasTarjeta).toBe(true);
    expect(hasCuenta).toBe(true);

    console.log(`Representative seeds (${seeds.length}):`);
    for (const seed of seeds) {
      console.log(`  - ${seed.title}`);
    }
  });

  test("Fix 4: Validator acepta botones visibles", () => {
    const scenario: McpScenario = {
      title: "Test scenario with button validations",
      steps: [
        '1. Clic en "Iniciar".',
        '2. Clic en "Información de productos".',
        '3. Clic en "Tarjetas".',
        '4. Clic en "Tarjeta Visa Gold".',
        '5. Validar que se muestre la sección "Beneficios".',
        '6. Validar que el botón "Volver al listado de productos" esté visible.',
        '7. Validar que el botón "Solicitar" esté visible.',
        '8. Validar que el botón "Finalizar sesión" esté visible.',
      ],
      expectedResult: "Se muestran botones visibles",
      preconditions: ["Usuario autenticado"],
      appSlug: "test-app",
      routeProfile: "test-profile",
      dataRequirements: "",
      mcpExecutable: true,
      type: "functional",
      automationType: "ui_discovery",
      setupStrategy: "no_login",
      sourceIssueKey: "TEST-1",
      database: "",
      isConverted: 0,
      nonExecutableCriteria: "",
    };

    const validation = validateScenario(scenario, null);

    expect(validation.valid).toBe(true);
    expect(validation.errors.length).toBe(0);

    console.log("Validation passed for button visibility steps");
  });

  test("Fix 5: Validator acepta botones con mojibake", () => {
    // Steps with mojibake that should be corrected before validation
    const scenario: McpScenario = {
      title: "Test scenario with mojibake",
      steps: [
        '1. Clic en "Iniciar".',
        '2. Clic en "InformaciÃ³n de productos".', // Mojibake
        '3. Clic en "Tarjetas".',
        '4. Validar que el botÃ³n "Solicitar" estÃ© visible.', // Mojibake
      ],
      expectedResult: "Se corrige mojibake",
      preconditions: ["Usuario autenticado"],
      appSlug: "test-app",
      routeProfile: "test-profile",
      dataRequirements: "",
      mcpExecutable: true,
      type: "functional",
      automationType: "ui_discovery",
      setupStrategy: "no_login",
      sourceIssueKey: "TEST-1",
      database: "",
      isConverted: 0,
      nonExecutableCriteria: "",
    };

    const validation = validateScenario(scenario, null);

    if (!validation.valid) {
      console.log("Validation errors:", validation.errors);
    }

    expect(validation.valid).toBe(true);
    expect(validation.errors.length).toBe(0);

    console.log("Validation passed after mojibake correction");
  });

  test("Fix 6: Representative coverage completo para HU amplia", () => {
    const routeProfile: McpRouteProfile = {
      name: "test-profile",
      entry: [{ visibleLabel: "Información de productos", businessLabel: "Products" }],
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
            category: "General",
            productLabel: "Tarjeta Crédito Visa Clásica",
            normalizedLabel: "tarjeta_credito_visa_clasica",
            presentationType: "detail_page",
            discoveredAt: new Date().toISOString(),
            clickableToDetail: true,
          },
        },
        "Tarjeta de Crédito Visa Platinum": {
          target: "Tarjeta de Crédito Visa Platinum",
          requiredIntermediates: ["Información de productos", "Tarjetas", "Tarjeta de Crédito"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "General",
            productLabel: "Tarjeta de Crédito Visa Platinum",
            normalizedLabel: "tarjeta_de_credito_visa_platinum",
            presentationType: "detail_page",
            discoveredAt: new Date().toISOString(),
            clickableToDetail: true,
          },
        },
        "Cuenta de Ahorros Personal en Pesos": {
          target: "Cuenta de Ahorros Personal en Pesos",
          requiredIntermediates: ["Información de productos", "Cuentas", "Cuenta de Ahorro"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "General",
            productLabel: "Cuenta de Ahorros Personal en Pesos",
            normalizedLabel: "cuenta_de_ahorros_personal_en_pesos",
            presentationType: "detail_page",
            discoveredAt: new Date().toISOString(),
            clickableToDetail: true,
          },
        },
        "Cuenta de Ahorros Personal en Dólares": {
          target: "Cuenta de Ahorros Personal en Dólares",
          requiredIntermediates: ["Información de productos", "Cuentas", "Cuenta de Ahorro"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "General",
            productLabel: "Cuenta de Ahorros Personal en Dólares",
            normalizedLabel: "cuenta_de_ahorros_personal_en_dolares",
            presentationType: "detail_page",
            discoveredAt: new Date().toISOString(),
            clickableToDetail: true,
          },
        },
        "Cuenta de Ahorros Personal en Euros": {
          target: "Cuenta de Ahorros Personal en Euros",
          requiredIntermediates: ["Información de productos", "Cuentas", "Cuenta de Ahorro"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "General",
            productLabel: "Cuenta de Ahorros Personal en Euros",
            normalizedLabel: "cuenta_de_ahorros_personal_en_euros",
            presentationType: "detail_page",
            discoveredAt: new Date().toISOString(),
            clickableToDetail: true,
          },
        },
        "Depósito a Plazo en Pesos": {
          target: "Depósito a Plazo en Pesos",
          requiredIntermediates: ["Información de productos", "Depósitos a plazo"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "General",
            productLabel: "Depósito a Plazo en Pesos",
            normalizedLabel: "deposito_a_plazo_en_pesos",
            presentationType: "detail_page",
            discoveredAt: new Date().toISOString(),
            clickableToDetail: true,
          },
        },
        "Depósito a Plazo en Dólares": {
          target: "Depósito a Plazo en Dólares",
          requiredIntermediates: ["Información de productos", "Depósitos a plazo"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "General",
            productLabel: "Depósito a Plazo en Dólares",
            normalizedLabel: "deposito_a_plazo_en_dolares",
            presentationType: "detail_page",
            discoveredAt: new Date().toISOString(),
            clickableToDetail: true,
          },
        },
        "Préstamo Personal": {
          target: "Préstamo Personal",
          requiredIntermediates: ["Información de productos", "Préstamos"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "General",
            productLabel: "Préstamo Personal",
            normalizedLabel: "prestamo_personal",
            presentationType: "detail_page",
            discoveredAt: new Date().toISOString(),
            clickableToDetail: true,
          },
        },
      },
    };

    const seeds = generateDeterministicSeeds(
      routeProfile,
      [],
      mockIssue,
      "test-app",
      "representative",
      { automationType: "ui_discovery", setupStrategy: "no_login" }
    );

    // Expected coverage for AA-82 (broad HU)
    const expectedProducts = [
      "Tarjeta Crédito Visa Clásica",
      "Tarjeta de Crédito Visa Platinum",
      "Cuenta de Ahorros Personal en Pesos",
      "Cuenta de Ahorros Personal en Dólares",
      "Cuenta de Ahorros Personal en Euros",
      "Depósito a Plazo en Pesos",
      "Depósito a Plazo en Dólares",
      "Préstamo Personal",
    ];

    const coveredProducts = expectedProducts.filter((product) =>
      seeds.some((s) => s.title.includes(product))
    );

    console.log(`Representative coverage: ${coveredProducts.length}/${expectedProducts.length}`);
    console.log("Covered products:");
    for (const product of coveredProducts) {
      console.log(`  ✓ ${product}`);
    }

    console.log("Missing products:");
    for (const product of expectedProducts) {
      if (!coveredProducts.includes(product)) {
        console.log(`  ✗ ${product}`);
      }
    }

    // Should cover ALL expected products in representative mode
    expect(coveredProducts.length).toBe(expectedProducts.length);
  });
});
