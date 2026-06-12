import { test, expect } from "@playwright/test";
import { calculateDynamicScenarioLimit } from "../src/scenarios/mcp-scenario-prompt-builder";
import { generateDeterministicSeeds } from "../src/scenarios/scenario-deterministic-seeds";
import { validateScenario } from "../src/scenarios/scenario-validator";
import type { JiraIssueSource, McpScenario, McpRouteProfile, TargetPathDefinition } from "../src/scenarios/scenario-types";

test.describe("Scenario Coverage Corrections (AA-82 fixes)", () => {
  test("Test 1: HU with 14 aligned products + variants → dynamicLimit > 4", async () => {
    // Mock HU mentioning multiple categories and explicit variants
    const issues: JiraIssueSource[] = [
      {
        key: "AA-82",
        summary: "Visualizar categorías oficiales del kiosco",
        description:
          "Como usuario quiero visualizar todas las categorías de productos: " +
          "Tarjetas de Crédito, Cuentas de Efectivo (Pesos, Dólares, Euros), " +
          "Depósitos a Plazo (Pesos, Dólares), Préstamos.",
        acceptanceCriteria: "1. Visualizar Tarjetas\n2. Visualizar Cuentas en todas las monedas\n3. Visualizar Depósitos\n4. Visualizar Préstamos",
        labels: [],
        components: [],
        status: "Open",
        issueType: "Story",
      },
    ];

    const routeProfile = null; // Minimal test

    // Aligned categories detected: 4 (Tarjetas, Cuentas, Depósitos, Préstamos)
    const alignedCategories = ["Tarjetas de Crédito", "Cuentas de Efectivo", "Depósitos a Plazo", "Préstamos"];

    const dynamicLimit = calculateDynamicScenarioLimit(issues, routeProfile, alignedCategories);

    // Expected: 4 categories + 3 explicit variants (Pesos/Dólares/Euros) = 7
    // HU mentions products, is broad (mentions "todas"), and has explicit variants
    expect(dynamicLimit).toBeGreaterThan(4);
    expect(dynamicLimit).toBeGreaterThanOrEqual(7);

    console.log(`[test] dynamicLimit=${dynamicLimit} for 4 categories + 3 variants`);
  });

  test("Test 2: Representative mode generates seeds per uncovered category", async () => {
    // Mock route profile with 14 products across 4 categories
    const targetPaths: Record<string, TargetPathDefinition> = {
      "Tarjeta Visa Gold": {
        target: "Tarjeta Visa Gold",
        requiredIntermediates: ["Información de productos", "Tarjetas de Crédito"],
        confidence: "high",
        source: "runtime_discovery",
        productMetadata: {
          category: "Tarjetas de Crédito",
          variant: undefined,
          productLabel: "Tarjeta Visa Gold",
          normalizedLabel: "tarjeta visa gold",
          isRepresentative: true,
          groupKey: "tarjetas_credito_visa_gold",
          discoveredAt: "2026-06-11T10:00:00Z",
          detailSections: ["Detalles", "Beneficios"],
          actionButtons: ["Solicitar", "Volver"],
          presentationType: "detail_page",
          validationStatus: "validated_detail",
        },
      },
      "Cuenta de Ahorros en Pesos": {
        target: "Cuenta de Ahorros en Pesos",
        requiredIntermediates: ["Información de productos", "Cuentas de Efectivo"],
        confidence: "high",
        source: "runtime_discovery",
        productMetadata: {
          category: "Cuentas de Efectivo",
          variant: "Pesos",
          productLabel: "Cuenta de Ahorros en Pesos",
          normalizedLabel: "cuenta de ahorros en pesos",
          isRepresentative: true,
          groupKey: "cuentas_efectivo_pesos",
          discoveredAt: "2026-06-11T10:00:00Z",
          detailSections: ["Detalles", "Requisitos"],
          actionButtons: ["Solicitar", "Volver"],
          presentationType: "detail_page",
          validationStatus: "validated_detail",
        },
      },
      "Depósito a Plazo en Pesos": {
        target: "Depósito a Plazo en Pesos",
        requiredIntermediates: ["Información de productos", "Depósitos a Plazo"],
        confidence: "high",
        source: "runtime_discovery",
        productMetadata: {
          category: "Depósitos a Plazo",
          variant: "Pesos",
          productLabel: "Depósito a Plazo en Pesos",
          normalizedLabel: "depósito a plazo en pesos",
          isRepresentative: true,
          groupKey: "depositos_plazo_pesos",
          discoveredAt: "2026-06-11T10:00:00Z",
          detailSections: ["Detalles", "Condiciones"],
          actionButtons: ["Solicitar", "Volver"],
          presentationType: "detail_page",
          validationStatus: "validated_detail",
        },
      },
      "Préstamo Personal": {
        target: "Préstamo Personal",
        requiredIntermediates: ["Información de productos", "Préstamos"],
        confidence: "high",
        source: "runtime_discovery",
        productMetadata: {
          category: "Préstamos",
          variant: undefined,
          productLabel: "Préstamo Personal",
          normalizedLabel: "préstamo personal",
          isRepresentative: true,
          groupKey: "prestamos_personal",
          discoveredAt: "2026-06-11T10:00:00Z",
          detailSections: ["Detalles", "Requisitos"],
          actionButtons: ["Solicitar", "Volver"],
          presentationType: "detail_page",
          validationStatus: "validated_detail",
        },
      },
    };

    const routeProfile: McpRouteProfile = {
      name: "informacion-productos",
      entry: [{ businessLabel: "Iniciar", visibleLabel: "Iniciar" }],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: ["Tarjeta Visa Gold", "Cuenta de Ahorros en Pesos", "Depósito a Plazo en Pesos", "Préstamo Personal"],
      representativeFixture: {},
      notes: [],
      targetPaths,
    };

    // Mock issue context
    const issueContext: JiraIssueSource = {
      key: "AA-82",
      summary: "Visualizar categorías oficiales del kiosco",
      description: "Tarjetas, Cuentas, Depósitos, Préstamos",
      acceptanceCriteria: null,
      labels: [],
      components: [],
      status: "Open",
      issueType: "Story",
    };

    // AI generated 2 scenarios but only covered "Cuentas de Efectivo"
    const existingScenarios: McpScenario[] = [
      {
        sourceIssueKey: "AA-82",
        title: "Visualizar Cuenta en Pesos",
        steps: [
          '1. Clic en "Iniciar".',
          '2. Clic en "Información de productos".',
          '3. Clic en "Cuentas de Efectivo".',
          '4. Validar que se muestre "Cuenta de Ahorros en Pesos".',
        ],
        preconditions: [],
        expectedResult: "Cuenta visible",
        type: "functional",
        database: "",
        isConverted: 0,
        automationType: "ui_with_auth_gate",
        setupStrategy: "auth_gate",
        appSlug: "kiosko",
        routeProfile: "informacion-productos",
        dataRequirements: "N/A",
        nonExecutableCriteria: "",
        mcpExecutable: true,
      },
    ];

    const seeds = generateDeterministicSeeds(
      routeProfile,
      existingScenarios,
      issueContext,
      "kiosko",
      "representative",
      { automationType: "ui_with_auth_gate", setupStrategy: "auth_gate" }
    );

    // Representative mode: should generate 1 seed per uncovered category
    // Covered: Cuentas de Efectivo
    // Uncovered: Tarjetas de Crédito, Depósitos a Plazo, Préstamos
    expect(seeds.length).toBe(3);

    // Verify seeds cover the missing categories
    const seedTitles = seeds.map((s) => s.title);
    expect(seedTitles.some((t) => t.includes("Tarjeta Visa Gold"))).toBe(true);
    expect(seedTitles.some((t) => t.includes("Depósito a Plazo en Pesos"))).toBe(true);
    expect(seedTitles.some((t) => t.includes("Préstamo Personal"))).toBe(true);

    console.log(`[test] representative mode: ${seeds.length} seeds generated for uncovered categories`);
  });

  test("Test 3: Exhaustive mode generates 1 seed per uncovered product", async () => {
    // Same route profile as Test 2
    const targetPaths: Record<string, TargetPathDefinition> = {
      "Tarjeta Visa Gold": {
        target: "Tarjeta Visa Gold",
        requiredIntermediates: ["Información de productos", "Tarjetas de Crédito"],
        confidence: "high",
        source: "runtime_discovery",
        productMetadata: {
          category: "Tarjetas de Crédito",
          productLabel: "Tarjeta Visa Gold",
          normalizedLabel: "tarjeta visa gold",
          isRepresentative: true,
          groupKey: "tarjetas_credito_visa_gold",
          presentationType: "detail_page",
        },
      },
      "Tarjeta Mastercard Platinum": {
        target: "Tarjeta Mastercard Platinum",
        requiredIntermediates: ["Información de productos", "Tarjetas de Crédito"],
        confidence: "high",
        source: "runtime_discovery",
        productMetadata: {
          category: "Tarjetas de Crédito",
          productLabel: "Tarjeta Mastercard Platinum",
          normalizedLabel: "tarjeta mastercard platinum",
          groupKey: "tarjetas_credito_mastercard_platinum",
          presentationType: "detail_page",
        },
      },
      "Cuenta de Ahorros en Pesos": {
        target: "Cuenta de Ahorros en Pesos",
        requiredIntermediates: ["Información de productos", "Cuentas de Efectivo"],
        confidence: "high",
        source: "runtime_discovery",
        productMetadata: {
          category: "Cuentas de Efectivo",
          variant: "Pesos",
          productLabel: "Cuenta de Ahorros en Pesos",
          normalizedLabel: "cuenta de ahorros en pesos",
          isRepresentative: true,
          groupKey: "cuentas_efectivo_pesos",
          presentationType: "detail_page",
        },
      },
    };

    const routeProfile: McpRouteProfile = {
      name: "informacion-productos",
      entry: [{ businessLabel: "Iniciar", visibleLabel: "Iniciar" }],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: ["Tarjeta Visa Gold", "Tarjeta Mastercard Platinum", "Cuenta de Ahorros en Pesos"],
      representativeFixture: {},
      notes: [],
      targetPaths,
    };

    const issueContext: JiraIssueSource = {
      key: "AA-82",
      summary: "Visualizar todos los productos",
      description: "Tarjetas, Cuentas",
      acceptanceCriteria: null,
      labels: [],
      components: [],
      status: "Open",
      issueType: "Story",
    };

    // AI generated 1 scenario covering only "Cuenta de Ahorros en Pesos"
    const existingScenarios: McpScenario[] = [
      {
        sourceIssueKey: "AA-82",
        title: "Visualizar Cuenta en Pesos",
        steps: ['4. Validar que se muestre "Cuenta de Ahorros en Pesos".'],
        preconditions: [],
        expectedResult: "Cuenta visible",
        type: "functional",
        database: "",
        isConverted: 0,
        automationType: "ui_with_auth_gate",
        setupStrategy: "auth_gate",
        appSlug: "kiosko",
        routeProfile: "informacion-productos",
        dataRequirements: "N/A",
        nonExecutableCriteria: "",
        mcpExecutable: true,
      },
    ];

    const seeds = generateDeterministicSeeds(
      routeProfile,
      existingScenarios,
      issueContext,
      "kiosko",
      "exhaustive"
    );

    // Exhaustive mode: should generate 1 seed per uncovered product
    // Covered: Cuenta de Ahorros en Pesos
    // Uncovered: Tarjeta Visa Gold, Tarjeta Mastercard Platinum
    expect(seeds.length).toBe(2);

    const seedTitles = seeds.map((s) => s.title);
    expect(seedTitles.some((t) => t.includes("Tarjeta Visa Gold"))).toBe(true);
    expect(seedTitles.some((t) => t.includes("Tarjeta Mastercard Platinum"))).toBe(true);

    console.log(`[test] exhaustive mode: ${seeds.length} seeds generated for uncovered products`);
  });

  test("Test 4: Seeds use sourceIssueKey from HU and generationSource=deterministic_seed", async () => {
    const targetPaths: Record<string, TargetPathDefinition> = {
      "Tarjeta Visa Gold": {
        target: "Tarjeta Visa Gold",
        requiredIntermediates: ["Información de productos", "Tarjetas de Crédito"],
        confidence: "high",
        source: "runtime_discovery",
        productMetadata: {
          category: "Tarjetas de Crédito",
          productLabel: "Tarjeta Visa Gold",
          normalizedLabel: "tarjeta visa gold",
          presentationType: "detail_page",
          detailSections: ["Detalles"],
          actionButtons: ["Volver"],
        },
      },
    };

    const routeProfile: McpRouteProfile = {
      name: "informacion-productos",
      entry: [{ businessLabel: "Iniciar", visibleLabel: "Iniciar" }],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: ["Tarjeta Visa Gold"],
      representativeFixture: {},
      notes: [],
      targetPaths,
    };

    const issueContext: JiraIssueSource = {
      key: "AA-82",
      summary: "Visualizar Tarjetas",
      description: "Tarjetas de Crédito",
      acceptanceCriteria: null,
      labels: [],
      components: [],
      status: "Open",
      issueType: "Story",
    };

    const existingScenarios: McpScenario[] = []; // No coverage, seed needed

    const seeds = generateDeterministicSeeds(
      routeProfile,
      existingScenarios,
      issueContext,
      "kiosko",
      "representative",
      { automationType: "ui_with_auth_gate", setupStrategy: "auth_gate" }
    );

    expect(seeds.length).toBe(1);
    expect(seeds[0].sourceIssueKey).toBe("AA-82"); // From HU, NOT "SEED"
    expect(seeds[0].generationSource).toBe("deterministic_seed"); // Traceability
    expect(seeds[0].mcpExecutable).toBe(true);
    expect(seeds[0].steps.length).toBeGreaterThan(0);
    expect(seeds[0].automationType).toBe("ui_with_auth_gate"); // Valid type
    expect(seeds[0].setupStrategy).toBe("auth_gate"); // Valid strategy

    console.log(`[test] seed uses sourceIssueKey=${seeds[0].sourceIssueKey} generationSource=${seeds[0].generationSource}`);
  });

  test("Test 5: Validator allows 'Validar que el botón Solicitar esté visible'", async () => {
    const scenario: McpScenario = {
      sourceIssueKey: "AA-82",
      title: "Validar botón Solicitar visible en detalle de producto",
      steps: [
        '1. Clic en "Iniciar".',
        '2. Clic en "Información de productos".',
        '3. Clic en "Tarjetas de Crédito".',
        '4. Clic en "Tarjeta Visa Gold".',
        '5. Validar que el botón "Solicitar" esté visible.',
      ],
      preconditions: [],
      expectedResult: 'Botón "Solicitar" visible',
      type: "functional",
      database: "",
      isConverted: 0,
      automationType: "ui_with_auth_gate",
      setupStrategy: "auth_gate",
      appSlug: "kiosko",
      routeProfile: "informacion-productos",
      dataRequirements: "N/A",
      nonExecutableCriteria: "",
      mcpExecutable: true,
    };

    const routeProfile: McpRouteProfile = {
      name: "informacion-productos",
      entry: [{ businessLabel: "Iniciar", visibleLabel: "Iniciar" }],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: ["Información de productos", "Tarjetas de Crédito", "Tarjeta Visa Gold", "Solicitar"],
      representativeFixture: {},
      notes: [],
    };

    const validation = validateScenario(scenario, routeProfile);

    // Should be valid - validation context is allowed for sensitive actions
    expect(validation.valid).toBe(true);
    expect(validation.errors.length).toBe(0);

    console.log(`[test] validator allows "Validar que el botón Solicitar esté visible"`);
  });

  test("Test 6: Validator rejects 'Clic en Solicitar'", async () => {
    const scenario: McpScenario = {
      sourceIssueKey: "AA-82",
      title: "Solicitar Tarjeta Visa Gold",
      steps: [
        '1. Clic en "Iniciar".',
        '2. Clic en "Información de productos".',
        '3. Clic en "Tarjetas de Crédito".',
        '4. Clic en "Tarjeta Visa Gold".',
        '5. Clic en "Solicitar".',
      ],
      preconditions: [],
      expectedResult: "Tarjeta solicitada",
      type: "functional",
      database: "",
      isConverted: 0,
      automationType: "ui_with_auth_gate",
      setupStrategy: "auth_gate",
      appSlug: "kiosko",
      routeProfile: "informacion-productos",
      dataRequirements: "N/A",
      nonExecutableCriteria: "",
      mcpExecutable: true,
    };

    const routeProfile: McpRouteProfile = {
      name: "informacion-productos",
      entry: [{ businessLabel: "Iniciar", visibleLabel: "Iniciar" }],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: ["Información de productos", "Tarjetas de Crédito", "Tarjeta Visa Gold", "Solicitar"],
      representativeFixture: {},
      notes: [],
    };

    const validation = validateScenario(scenario, routeProfile);

    // Should be invalid - sensitive action execution not allowed
    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);
    expect(validation.errors.some((e) => e.includes("sensitive_action_not_allowed"))).toBe(true);

    console.log(`[test] validator rejects "Clic en Solicitar"`);
  });

  test("Test 7: Validator allows 'Validar que se muestre Solicitar' (validation context)", async () => {
    const scenario: McpScenario = {
      sourceIssueKey: "AA-82",
      title: "Validar botón Solicitar visible",
      steps: [
        '1. Clic en "Iniciar".',
        '2. Clic en "Información de productos".',
        '3. Clic en "Tarjetas de Crédito".',
        '4. Validar que se muestre "Solicitar".',
      ],
      preconditions: [],
      expectedResult: 'Botón "Solicitar" visible',
      type: "functional",
      database: "",
      isConverted: 0,
      automationType: "ui_with_auth_gate",
      setupStrategy: "auth_gate",
      appSlug: "kiosko",
      routeProfile: "informacion-productos",
      dataRequirements: "N/A",
      nonExecutableCriteria: "",
      mcpExecutable: true,
    };

    const routeProfile: McpRouteProfile = {
      name: "informacion-productos",
      entry: [{ businessLabel: "Iniciar", visibleLabel: "Iniciar" }],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: ["Información de productos", "Tarjetas de Crédito", "Solicitar"],
      representativeFixture: {},
      notes: [],
    };

    const validation = validateScenario(scenario, routeProfile);

    // Should be valid - "Validar que se muestre" is a safe validation pattern
    expect(validation.valid).toBe(true);
    expect(validation.errors.length).toBe(0);

    console.log(`[test] validator allows "Validar que se muestre Solicitar"`);
  });

  test("Test 8: Dynamic limit calculation with explicit variants detection", async () => {
    // HU explicitly mentions Pesos, Dólares, Euros
    const issues: JiraIssueSource[] = [
      {
        key: "AA-82",
        summary: "Visualizar productos en múltiples monedas",
        description:
          "Como usuario quiero visualizar productos en Pesos, Dólares y Euros. " +
          "Debo poder acceder a Cuentas de Efectivo, Depósitos a Plazo y Tarjetas.",
        acceptanceCriteria: "1. Visualizar en Pesos\n2. Visualizar en Dólares\n3. Visualizar en Euros",
        labels: [],
        components: [],
        status: "Open",
        issueType: "Story",
      },
    ];

    const routeProfile = null;
    const alignedCategories = ["Cuentas de Efectivo", "Depósitos a Plazo", "Tarjetas de Crédito"];

    const dynamicLimit = calculateDynamicScenarioLimit(issues, routeProfile, alignedCategories);

    // Expected: 3 categories + 3 explicit variants (Pesos/Dólares/Euros) = 6
    expect(dynamicLimit).toBeGreaterThanOrEqual(6);

    console.log(`[test] dynamicLimit=${dynamicLimit} with 3 categories + 3 explicit variants`);
  });

  test("Test 9: Product card clickable genera click + validaciones detalle", async () => {
    const targetPaths: Record<string, TargetPathDefinition> = {
      "Tarjeta Visa Gold": {
        target: "Tarjeta Visa Gold",
        requiredIntermediates: ["Información de productos", "Tarjetas de Crédito"],
        confidence: "high",
        source: "runtime_discovery",
        productMetadata: {
          category: "Tarjetas de Crédito",
          productLabel: "Tarjeta Visa Gold",
          normalizedLabel: "tarjeta visa gold",
          presentationType: "product_card",
          clickableToDetail: true, // Card abre detalle
          detailSections: ["Beneficios", "Detalles", "Requisitos"],
          actionButtons: ["Solicitar", "Volver"],
        },
      },
    };

    const routeProfile: McpRouteProfile = {
      name: "informacion-productos",
      entry: [{ businessLabel: "Iniciar", visibleLabel: "Iniciar" }],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: [],
      representativeFixture: {},
      notes: [],
      targetPaths,
    };

    const issueContext: JiraIssueSource = {
      key: "AA-82",
      summary: "Visualizar Tarjetas",
      description: "Tarjetas de Crédito",
      acceptanceCriteria: null,
      labels: [],
      components: [],
      status: "Open",
      issueType: "Story",
    };

    const seeds = generateDeterministicSeeds(
      routeProfile,
      [],
      issueContext,
      "kiosko",
      "representative",
      { automationType: "ui_with_auth_gate", setupStrategy: "auth_gate" }
    );

    expect(seeds.length).toBe(1);
    const seed = seeds[0];

    // Debe tener click en target
    expect(seed.steps.some((s) => s.includes('Clic en "Tarjeta Visa Gold"'))).toBe(true);

    // Debe validar target después del click
    expect(seed.steps.some((s) => s.includes('Validar que se muestre "Tarjeta Visa Gold"'))).toBe(true);

    // Debe validar secciones
    expect(seed.steps.some((s) => s.includes('"Beneficios"'))).toBe(true);
    expect(seed.steps.some((s) => s.includes('"Detalles"'))).toBe(true);
    expect(seed.steps.some((s) => s.includes('"Requisitos"'))).toBe(true);

    // Debe validar botones (como visible, no click)
    expect(seed.steps.some((s) => s.includes('Validar que el botón "Solicitar" esté visible'))).toBe(true);
    expect(seed.steps.some((s) => s.includes('Validar que el botón "Volver" esté visible'))).toBe(true);

    // NO debe hacer click en Solicitar
    expect(seed.steps.some((s) => s.includes('Clic en "Solicitar"'))).toBe(false);

    console.log(`[test] product_card clickable generates click + detail validations`);
  });

  test("Test 10: Representative mode con variantes genera múltiples seeds", async () => {
    const targetPaths: Record<string, TargetPathDefinition> = {
      "Cuenta en Pesos": {
        target: "Cuenta en Pesos",
        requiredIntermediates: ["Información de productos", "Cuentas de Efectivo"],
        confidence: "high",
        source: "runtime_discovery",
        productMetadata: {
          category: "Cuentas de Efectivo",
          variant: "Pesos",
          productLabel: "Cuenta en Pesos",
          normalizedLabel: "cuenta en pesos",
          presentationType: "detail_page",
          detailSections: ["Detalles"],
          actionButtons: ["Solicitar"],
        },
      },
      "Cuenta en Dólares": {
        target: "Cuenta en Dólares",
        requiredIntermediates: ["Información de productos", "Cuentas de Efectivo"],
        confidence: "high",
        source: "runtime_discovery",
        productMetadata: {
          category: "Cuentas de Efectivo",
          variant: "Dólares",
          productLabel: "Cuenta en Dólares",
          normalizedLabel: "cuenta en dólares",
          presentationType: "detail_page",
          detailSections: ["Detalles"],
          actionButtons: ["Solicitar"],
        },
      },
      "Cuenta en Euros": {
        target: "Cuenta en Euros",
        requiredIntermediates: ["Información de productos", "Cuentas de Efectivo"],
        confidence: "high",
        source: "runtime_discovery",
        productMetadata: {
          category: "Cuentas de Efectivo",
          variant: "Euros",
          productLabel: "Cuenta en Euros",
          normalizedLabel: "cuenta en euros",
          presentationType: "detail_page",
          detailSections: ["Detalles"],
          actionButtons: ["Solicitar"],
        },
      },
    };

    const routeProfile: McpRouteProfile = {
      name: "informacion-productos",
      entry: [{ businessLabel: "Iniciar", visibleLabel: "Iniciar" }],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: [],
      representativeFixture: {},
      notes: [],
      targetPaths,
    };

    const issueContext: JiraIssueSource = {
      key: "AA-82",
      summary: "Visualizar Cuentas en todas las monedas",
      description: "Cuentas en Pesos, Dólares y Euros",
      acceptanceCriteria: null,
      labels: [],
      components: [],
      status: "Open",
      issueType: "Story",
    };

    const seeds = generateDeterministicSeeds(
      routeProfile,
      [],
      issueContext,
      "kiosko",
      "representative",
      { automationType: "ui_with_auth_gate", setupStrategy: "auth_gate" }
    );

    // Representative mode debe generar 3 seeds (1 por variante)
    expect(seeds.length).toBe(3);

    const seedTitles = seeds.map((s) => s.title);
    expect(seedTitles.some((t) => t.includes("Pesos"))).toBe(true);
    expect(seedTitles.some((t) => t.includes("Dólares"))).toBe(true);
    expect(seedTitles.some((t) => t.includes("Euros"))).toBe(true);

    console.log(`[test] representative mode with variants generates ${seeds.length} seeds for 3 variants`);
  });

  test("Test 11: Validator acepta secciones genéricas", async () => {
    const scenario: McpScenario = {
      sourceIssueKey: "AA-82",
      title: "Validar secciones de detalle",
      steps: [
        '1. Clic en "Iniciar".',
        '2. Clic en "Información de productos".',
        '3. Clic en "Tarjetas de Crédito".',
        '4. Clic en "Tarjeta Visa Gold".',
        '5. Validar que se muestre "Beneficios".',
        '6. Validar que se muestre "Detalles".',
        '7. Validar que se muestre "Requisitos".',
        '8. Validar que se muestre "Información del Producto".',
        '9. Validar que el botón "Solicitar" esté visible.',
        '10. Validar que el botón "Volver" esté visible.',
      ],
      preconditions: [],
      expectedResult: "Secciones y botones visibles",
      type: "functional",
      database: "",
      isConverted: 0,
      automationType: "ui_with_auth_gate",
      setupStrategy: "auth_gate",
      appSlug: "kiosko",
      routeProfile: "informacion-productos",
      dataRequirements: "N/A",
      nonExecutableCriteria: "",
      mcpExecutable: true,
    };

    const routeProfile: McpRouteProfile = {
      name: "informacion-productos",
      entry: [{ businessLabel: "Iniciar", visibleLabel: "Iniciar" }],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: [
        "Información de productos",
        "Tarjetas de Crédito",
        "Tarjeta Visa Gold",
        "Beneficios",
        "Detalles",
        "Requisitos",
        "Información del Producto",
        "Solicitar",
        "Volver",
      ],
      representativeFixture: {},
      notes: [],
    };

    const validation = validateScenario(scenario, routeProfile);

    expect(validation.valid).toBe(true);
    expect(validation.errors.length).toBe(0);

    console.log(`[test] validator accepts generic sections: Beneficios, Detalles, Requisitos, etc.`);
  });
});
