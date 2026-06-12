import { test, expect } from "@playwright/test";
import { calculateDynamicScenarioLimit } from "../src/scenarios/mcp-scenario-prompt-builder";
import { filterTargetPathsByIssueScope } from "../src/scenarios/scenario-hu-scope-filter";
import { generateDeterministicSeeds } from "../src/scenarios/scenario-deterministic-seeds";
import { validateScenario } from "../src/scenarios/scenario-validator";
import type {
  JiraIssueSource,
  McpRouteProfile,
  TargetPathDefinition,
  McpScenario,
} from "../src/scenarios/scenario-types";

test.describe("Scenario Preview Corrections", () => {
  test("Correction 1: broad HU with 4 aligned categories generates budget > 3", async () => {
    // Mock HU mentioning multiple categories
    const issues: JiraIssueSource[] = [
      {
        key: "AA-82",
        summary: "Visualizar catálogo de productos bancarios",
        description:
          "Como usuario quiero ver todos los productos del kiosco: Tarjetas de Crédito, Cuentas de Efectivo, Préstamos y Depósitos a Plazo",
        acceptanceCriteria: "Validar que se muestren todas las categorías oficiales",
        labels: [],
        components: [],
        status: "Open",
        issueType: "Story",
      },
    ];

    // Mock routeProfile with 4 categories
    const routeProfile: McpRouteProfile = {
      name: "informacion-productos",
      entry: [{ businessLabel: "Información de productos", visibleLabel: "Información de productos" }],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: [],
      representativeFixture: {},
      notes: [],
      targetPaths: {
        "Tarjeta de Crédito Platinum": {
          target: "Tarjeta de Crédito Platinum",
          requiredIntermediates: ["Información de productos", "Tarjetas de Crédito"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "Tarjetas de Crédito",
            productLabel: "Tarjeta de Crédito Platinum",
            normalizedLabel: "tarjeta de credito platinum",
            groupKey: "tarjetas_credito",
          },
        },
        "Cuenta de Ahorros Personal": {
          target: "Cuenta de Ahorros Personal",
          requiredIntermediates: ["Información de productos", "Cuentas de Efectivo"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "Cuentas de Efectivo",
            productLabel: "Cuenta de Ahorros Personal",
            normalizedLabel: "cuenta de ahorros personal",
            groupKey: "cuentas_efectivo",
          },
        },
        "Préstamo Personal": {
          target: "Préstamo Personal",
          requiredIntermediates: ["Información de productos", "Préstamos"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "Préstamos",
            productLabel: "Préstamo Personal",
            normalizedLabel: "prestamo personal",
            groupKey: "prestamos",
          },
        },
        "Depósito a Plazo Fijo 90 días": {
          target: "Depósito a Plazo Fijo 90 días",
          requiredIntermediates: ["Información de productos", "Depósitos a Plazo"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "Depósitos a Plazo",
            productLabel: "Depósito a Plazo Fijo 90 días",
            normalizedLabel: "deposito a plazo fijo 90 dias",
            groupKey: "depositos_plazo",
          },
        },
      },
    };

    // Filter by HU scope to get aligned categories
    const { alignedTargetPaths } = filterTargetPathsByIssueScope(issues[0], routeProfile.targetPaths!, routeProfile);

    const categorySet = new Set<string>();
    for (const tp of Object.values(alignedTargetPaths)) {
      if (tp.productMetadata?.category) {
        categorySet.add(tp.productMetadata.category);
      }
    }
    const alignedCategories = Array.from(categorySet);

    // Calculate dynamic limit
    const dynamicLimit = calculateDynamicScenarioLimit(issues, routeProfile, alignedCategories);

    // Expect limit to be at least 4 (one per category) and not default 3
    expect(dynamicLimit).toBeGreaterThan(3);
    expect(dynamicLimit).toBeGreaterThanOrEqual(4);
    expect(dynamicLimit).toBeLessThanOrEqual(12);

    console.log(`[test] broadHU dynamicLimit=${dynamicLimit} categories=${alignedCategories.length}`);
  });

  test("Correction 3: HU with explicit categories doesn't bias to single category", async () => {
    // Mock HU explicitly mentioning "Tarjetas de Crédito" and "Cuentas de Efectivo"
    const issueContext: JiraIssueSource = {
      key: "AA-82",
      summary: "Visualizar Tarjetas de Crédito y Cuentas de Efectivo",
      description:
        "Como usuario quiero visualizar las categorías de Tarjetas de Crédito y Cuentas de Efectivo del kiosco",
      acceptanceCriteria: "Validar que ambas categorías sean visibles",
      labels: [],
      components: [],
      status: "Open",
      issueType: "Story",
    };

    // Mock targetPaths with multiple categories
    const targetPaths: Record<string, TargetPathDefinition> = {
      "Tarjeta Platinum": {
        target: "Tarjeta Platinum",
        requiredIntermediates: ["Información de productos", "Tarjetas de Crédito"],
        confidence: "high",
        source: "runtime_discovery",
        productMetadata: {
          category: "Tarjetas de Crédito",
          productLabel: "Tarjeta Platinum",
          normalizedLabel: "tarjeta platinum",
          groupKey: "tarjetas_credito",
        },
      },
      "Cuenta de Ahorros": {
        target: "Cuenta de Ahorros",
        requiredIntermediates: ["Información de productos", "Cuentas de Efectivo"],
        confidence: "high",
        source: "runtime_discovery",
        productMetadata: {
          category: "Cuentas de Efectivo",
          productLabel: "Cuenta de Ahorros",
          normalizedLabel: "cuenta de ahorros",
          groupKey: "cuentas_efectivo",
        },
      },
      "Préstamo Hipotecario": {
        target: "Préstamo Hipotecario",
        requiredIntermediates: ["Información de productos", "Préstamos"],
        confidence: "high",
        source: "runtime_discovery",
        productMetadata: {
          category: "Préstamos",
          productLabel: "Préstamo Hipotecario",
          normalizedLabel: "prestamo hipotecario",
          groupKey: "prestamos",
        },
      },
    };

    const routeProfile: McpRouteProfile = {
      name: "informacion-productos",
      entry: [{ businessLabel: "Información de productos", visibleLabel: "Información de productos" }],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: [],
      representativeFixture: {},
      notes: [],
      targetPaths,
    };

    // Filter by HU scope
    const { alignedTargetPaths, diagnostics } = filterTargetPathsByIssueScope(
      issueContext,
      targetPaths,
      routeProfile
    );

    // Extract aligned categories
    const alignedCategories = new Set<string>();
    for (const tp of Object.values(alignedTargetPaths)) {
      if (tp.productMetadata?.category) {
        alignedCategories.add(tp.productMetadata.category);
      }
    }

    // Expect BOTH explicitly mentioned categories to be aligned
    expect(alignedCategories.has("Tarjetas de Crédito")).toBe(true);
    expect(alignedCategories.has("Cuentas de Efectivo")).toBe(true);
    expect(alignedCategories.size).toBeGreaterThanOrEqual(2);

    // Expect Préstamos to NOT be aligned (not mentioned in HU)
    expect(alignedCategories.has("Préstamos")).toBe(false);

    console.log(`[test] explicitCategories aligned=${alignedCategories.size} diagnostics=${JSON.stringify(diagnostics)}`);
  });

  test("Correction 2: seed context generates 1+ seed per aligned category", async () => {
    // Mock routeProfile with 3 categories
    const routeProfile: McpRouteProfile = {
      name: "informacion-productos",
      entry: [{ businessLabel: "Información de productos", visibleLabel: "Información de productos" }],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: [],
      representativeFixture: {},
      notes: [],
      targetPaths: {
        "Tarjeta Gold": {
          target: "Tarjeta Gold",
          requiredIntermediates: ["Información de productos", "Tarjetas de Crédito"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "Tarjetas de Crédito",
            productLabel: "Tarjeta Gold",
            normalizedLabel: "tarjeta gold",
            groupKey: "tarjetas_credito",
            presentationType: "detail_page",
            detailSections: ["Detalles", "Requisitos"],
            actionButtons: ["Solicitar", "Volver"],
          },
        },
        "Cuenta Corriente": {
          target: "Cuenta Corriente",
          requiredIntermediates: ["Información de productos", "Cuentas de Efectivo"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "Cuentas de Efectivo",
            productLabel: "Cuenta Corriente",
            normalizedLabel: "cuenta corriente",
            groupKey: "cuentas_efectivo",
            presentationType: "detail_page",
            detailSections: ["Detalles"],
            actionButtons: ["Solicitar", "Volver"],
          },
        },
        "Préstamo Automotriz": {
          target: "Préstamo Automotriz",
          requiredIntermediates: ["Información de productos", "Préstamos"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "Préstamos",
            productLabel: "Préstamo Automotriz",
            normalizedLabel: "prestamo automotriz",
            groupKey: "prestamos",
            presentationType: "detail_page",
            detailSections: ["Detalles"],
            actionButtons: ["Solicitar", "Volver"],
          },
        },
      },
    };

    // Mock existing AI scenarios (empty - none covered yet)
    const existingScenarios: McpScenario[] = [];

    // Mock issue context (HU mentioning all categories)
    const issueContext: JiraIssueSource = {
      key: "AA-82",
      summary: "Visualizar productos bancarios",
      description: "Como usuario quiero ver Tarjetas de Crédito, Cuentas de Efectivo y Préstamos",
      acceptanceCriteria: "Validar que se muestren los productos",
      labels: [],
      components: [],
      status: "Open",
      issueType: "Story",
    };

    // Generate seeds in exhaustive mode
    const seeds = generateDeterministicSeeds(
      routeProfile,
      existingScenarios,
      issueContext,
      "kiosko",
      "exhaustive",
      { automationType: "ui_with_auth_gate", setupStrategy: "auth_gate" }
    );

    // Expect at least 3 seeds (1 per category)
    expect(seeds.length).toBeGreaterThanOrEqual(3);

    // Extract categories from seeds
    const seedCategories = new Set<string>();
    for (const seed of seeds) {
      // Detect category from steps by matching against targetPaths
      for (const [target, tp] of Object.entries(routeProfile.targetPaths!)) {
        if (seed.steps?.some((step) => step.includes(target)) && tp.productMetadata?.category) {
          seedCategories.add(tp.productMetadata.category);
          break;
        }
      }
    }

    // Expect seeds cover all 3 categories
    expect(seedCategories.has("Tarjetas de Crédito")).toBe(true);
    expect(seedCategories.has("Cuentas de Efectivo")).toBe(true);
    expect(seedCategories.has("Préstamos")).toBe(true);
    expect(seedCategories.size).toBe(3);

    console.log(`[test] seedsPerCategory seeds=${seeds.length} categories=${seedCategories.size}`);
  });

  test("Correction 4: validator accepts Iniciar + Información de productos", async () => {
    // Mock scenario with both "Iniciar" and "Información de productos" steps
    const scenario: McpScenario = {
      sourceIssueKey: "AA-82",
      title: "Visualizar categorías del kiosco",
      steps: [
        '1. Clic en "Iniciar".',
        '2. Clic en "Información de productos".',
        '3. Validar que se muestre "Tarjetas de Crédito".',
        '4. Validar que se muestre "Cuentas de Efectivo".',
      ],
      preconditions: ["Usuario autenticado"],
      expectedResult: "Se muestran las categorías del kiosco",
      type: "functional",
      database: "",
      isConverted: 0,
      automationType: "ui_with_auth_gate",
      setupStrategy: "auth_gate",
      appSlug: "kiosko",
      routeProfile: "informacion-productos",
      dataRequirements: "Usuario válido",
      nonExecutableCriteria: "",
      mcpExecutable: true,
    };

    // Mock routeProfile with BOTH entry steps
    const routeProfile: McpRouteProfile = {
      name: "informacion-productos",
      entry: [
        { businessLabel: "Iniciar", visibleLabel: "Iniciar" },
        { businessLabel: "Información de productos", visibleLabel: "Información de productos" },
      ],
      entrySteps: [
        { action: "click", target: "Iniciar", when: "" },
        { action: "click", target: "Información de productos", when: "" },
      ],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: ["Tarjetas de Crédito", "Cuentas de Efectivo"],
      representativeFixture: {},
      notes: [],
    };

    // Validate scenario
    const validation = validateScenario(scenario, routeProfile);

    // Expect validation to pass (no errors)
    expect(validation.valid).toBe(true);
    expect(validation.errors.length).toBe(0);

    // Should NOT have error about missing entry steps
    const hasMissingEntryError = validation.errors.some((err) => err.includes("missing_required_entry_step"));
    expect(hasMissingEntryError).toBe(false);

    console.log(`[test] validatorEntrySteps valid=${validation.valid} errors=${validation.errors.length}`);
  });

  test("Correction 4 EDGE: validator rejects scenario missing required entry step", async () => {
    // Mock scenario with ONLY "Información de productos" (missing "Iniciar")
    const scenario: McpScenario = {
      sourceIssueKey: "AA-82",
      title: "Visualizar categorías del kiosco",
      steps: [
        '1. Clic en "Información de productos".',
        '2. Validar que se muestre "Tarjetas de Crédito".',
      ],
      preconditions: ["Usuario autenticado"],
      expectedResult: "Se muestran las categorías del kiosco",
      type: "functional",
      database: "",
      isConverted: 0,
      automationType: "ui_with_auth_gate",
      setupStrategy: "auth_gate",
      appSlug: "kiosko",
      routeProfile: "informacion-productos",
      dataRequirements: "Usuario válido",
      nonExecutableCriteria: "",
      mcpExecutable: true,
    };

    // Mock routeProfile requiring BOTH "Iniciar" and "Información de productos"
    const routeProfile: McpRouteProfile = {
      name: "informacion-productos",
      entry: [
        { businessLabel: "Iniciar", visibleLabel: "Iniciar" },
        { businessLabel: "Información de productos", visibleLabel: "Información de productos" },
      ],
      entrySteps: [
        { action: "click", target: "Iniciar", when: "" },
        { action: "click", target: "Información de productos", when: "" },
      ],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: ["Tarjetas de Crédito"],
      representativeFixture: {},
      notes: [],
    };

    // Validate scenario
    const validation = validateScenario(scenario, routeProfile);

    // Expect validation to FAIL (missing "Iniciar")
    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);

    // Should have error about missing "Iniciar"
    const hasMissingIniciarError = validation.errors.some(
      (err) => err.includes("missing_required_entry_step") && err.includes("Iniciar")
    );
    expect(hasMissingIniciarError).toBe(true);

    console.log(`[test] validatorMissingEntry valid=${validation.valid} errors=${validation.errors.join("; ")}`);
  });

  test("Correction 6: Solicitar validated visible but not executed", async () => {
    // Mock scenario validating "Solicitar" button visible (allowed)
    const scenarioValidation: McpScenario = {
      sourceIssueKey: "AA-82",
      title: "Validar botón Solicitar visible en detalle de producto",
      steps: [
        '1. Clic en "Iniciar".',
        '2. Clic en "Información de productos".',
        '3. Clic en "Tarjetas de Crédito".',
        '4. Clic en "Tarjeta Platinum".',
        '5. Validar que el botón "Solicitar" esté visible.',
      ],
      preconditions: ["Usuario autenticado"],
      expectedResult: 'El botón "Solicitar" está visible en el detalle',
      type: "functional",
      database: "",
      isConverted: 0,
      automationType: "ui_with_auth_gate",
      setupStrategy: "auth_gate",
      appSlug: "kiosko",
      routeProfile: "informacion-productos",
      dataRequirements: "Usuario válido",
      nonExecutableCriteria: "",
      mcpExecutable: true,
    };

    // Mock scenario CLICKING "Solicitar" (not allowed)
    const scenarioClick: McpScenario = {
      sourceIssueKey: "AA-83",
      title: "Solicitar tarjeta de crédito",
      steps: [
        '1. Clic en "Iniciar".',
        '2. Clic en "Información de productos".',
        '3. Clic en "Tarjetas de Crédito".',
        '4. Clic en "Tarjeta Platinum".',
        '5. Clic en "Solicitar".',
      ],
      preconditions: ["Usuario autenticado"],
      expectedResult: "Se inicia el proceso de solicitud",
      type: "functional",
      database: "",
      isConverted: 0,
      automationType: "ui_with_auth_gate",
      setupStrategy: "auth_gate",
      appSlug: "kiosko",
      routeProfile: "informacion-productos",
      dataRequirements: "Usuario válido",
      nonExecutableCriteria: "",
      mcpExecutable: true,
    };

    const routeProfile: McpRouteProfile = {
      name: "informacion-productos",
      entry: [{ businessLabel: "Iniciar", visibleLabel: "Iniciar" }],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: ["Información de productos", "Tarjetas de Crédito", "Tarjeta Platinum", "Solicitar"],
      representativeFixture: {},
      notes: [],
    };

    // Validate VALIDATION scenario (should pass)
    const validationResult = validateScenario(scenarioValidation, routeProfile);
    expect(validationResult.valid).toBe(true);
    expect(validationResult.errors.length).toBe(0);

    // Validate CLICK scenario (should fail)
    const clickResult = validateScenario(scenarioClick, routeProfile);
    expect(clickResult.valid).toBe(false);
    expect(clickResult.errors.length).toBeGreaterThan(0);

    // Should have error about sensitive action
    const hasSensitiveError = clickResult.errors.some((err) => err.includes("sensitive_action_not_allowed"));
    expect(hasSensitiveError).toBe(true);

    console.log(
      `[test] solicitarValidation validation.valid=${validationResult.valid} click.valid=${clickResult.valid}`
    );
  });

  test("Correction 1: env override takes precedence over dynamic calculation", async () => {
    // Set env var to fixed limit
    const originalEnvValue = process.env.AI_SCENARIO_MAX_PER_ISSUE;
    process.env.AI_SCENARIO_MAX_PER_ISSUE = "5";

    try {
      const issues: JiraIssueSource[] = [
        {
          key: "AA-82",
          summary: "Visualizar productos",
          description: "HU amplia con 10 categorías",
          acceptanceCriteria: "",
          labels: [],
          components: [],
          status: "Open",
          issueType: "Story",
        },
      ];

      const routeProfile: McpRouteProfile = {
        name: "test",
        entry: [],
        aliases: {},
        intermediates: {},
        domainTerms: {},
        visibleControls: [],
        representativeFixture: {},
        notes: [],
      };

      // Mock 10 aligned categories (would normally generate limit > 5)
      const alignedCategories = Array.from({ length: 10 }, (_, i) => `Category${i + 1}`);

      const dynamicLimit = calculateDynamicScenarioLimit(issues, routeProfile, alignedCategories);

      // Expect limit to be 5 (env override), NOT > 5
      expect(dynamicLimit).toBe(5);

      console.log(`[test] envOverride dynamicLimit=${dynamicLimit} (expected 5 from env)`);
    } finally {
      // Restore original env value
      if (originalEnvValue !== undefined) {
        process.env.AI_SCENARIO_MAX_PER_ISSUE = originalEnvValue;
      } else {
        delete process.env.AI_SCENARIO_MAX_PER_ISSUE;
      }
    }
  });

  test("Correction 1: failure scenarios add to budget", async () => {
    // Mock HU with explicit failure scenarios
    const issues: JiraIssueSource[] = [
      {
        key: "AA-100",
        summary: "Validar manejo de errores en productos",
        description:
          "Como usuario quiero validar escenarios de fallo: producto no disponible, datos inválidos, timeout",
        acceptanceCriteria:
          "Escenario de fallo 1: producto inexistente. Escenario de error 2: datos inválidos. Escenario negativo 3: timeout",
        labels: [],
        components: [],
        status: "Open",
        issueType: "Story",
      },
    ];

    const routeProfile: McpRouteProfile = {
      name: "test",
      entry: [],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: [],
      representativeFixture: {},
      notes: [],
    };

    // 2 aligned categories (would normally get limit of 2-3)
    const alignedCategories = ["Category1", "Category2"];

    const dynamicLimit = calculateDynamicScenarioLimit(issues, routeProfile, alignedCategories);

    // Expect limit to include +3 for failure scenarios
    // Base: 2-3, +3 for failures = 5-6
    expect(dynamicLimit).toBeGreaterThanOrEqual(5);

    console.log(`[test] failureScenarioBudget dynamicLimit=${dynamicLimit} (expected >= 5)`);
  });
});
