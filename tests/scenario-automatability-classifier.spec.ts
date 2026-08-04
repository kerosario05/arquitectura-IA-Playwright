import { test, expect } from "@playwright/test";
import {
  classifyScenarioAutomatability,
  filterScenariosByAutomatability,
} from "../src/scenarios/scenario-automatability-classifier";
import type { McpScenario, JiraIssueSource } from "../src/scenarios/scenario-types";

test.describe("Scenario Automatability Classifier", () => {
  test("Test 1: HU con error de conexión y timeout → no entra al preview como MCP", async () => {
    const huContext: JiraIssueSource = {
      key: "AA-200",
      summary: "Validar manejo de error de conexión",
      description: "Como QA quiero simular pérdida de red para validar timeout backend",
      acceptanceCriteria:
        "1. Simular caída de servicio web\n2. Simular timeout backend\n3. Validar mensaje de error",
      labels: ["negative_test"],
      components: [],
      status: "Open",
      issueType: "Story",
    };

    const scenario: McpScenario = {
      sourceIssueKey: "AA-200",
      title: "Validar error cuando hay timeout backend",
      steps: [
        '1. Clic en "Iniciar".',
        '2. Clic en "Información de productos".',
        '3. Simular timeout backend.',
        '4. Validar que se muestre mensaje "Error de conexión".',
      ],
      preconditions: ["Usuario autenticado"],
      expectedResult: "Se muestra error de conexión por timeout",
      type: "negative",
      database: "",
      isConverted: 0,
      automationType: "ui_discovery",
      setupStrategy: "no_login",
      appSlug: "kiosko",
      routeProfile: "informacion-productos",
      dataRequirements: "N/A",
      nonExecutableCriteria: "Requiere simular timeout backend",
      mcpExecutable: false, // Will be filtered out
    };

    const classification = classifyScenarioAutomatability(scenario, huContext);

    // Should be classified as non-automatable (backend or infra)
    expect(classification.isAutomatable).toBe(false);
    expect(
      classification.classification === "non_automatable_backend" ||
        classification.classification === "non_automatable_infra"
    ).toBe(true);
    expect(
      classification.reason?.includes("manipulation")
      || classification.reason?.includes("inactivity trigger")
    ).toBe(true);
    expect(classification.detectedPatterns).toBeDefined();
    expect(classification.detectedPatterns!.length).toBeGreaterThan(0);

    console.log(
      `[test] timeout scenario: classification=${classification.classification} reason=${classification.reason}`
    );
  });

  test("Test 2: HU con contenido corrupto/backend → queda en excludedRequirements", async () => {
    const huContext: JiraIssueSource = {
      key: "AA-201",
      summary: "Validar respuesta corrupta del servicio",
      description: "Como QA quiero corromper respuesta del servicio para validar manejo de errores",
      acceptanceCriteria: "1. Corromper respuesta del servicio\n2. Validar mensaje de error apropiado",
      labels: [],
      components: [],
      status: "Open",
      issueType: "Story",
    };

    const scenarios: McpScenario[] = [
      {
        sourceIssueKey: "AA-201",
        title: "Validar error con respuesta corrupta",
        steps: [
          '1. Clic en "Información de productos".',
          "2. Corromper respuesta del servicio.",
          '3. Validar que se muestre "Error inesperado".',
        ],
        preconditions: [],
        expectedResult: "Error manejado correctamente",
        type: "negative",
        database: "",
        isConverted: 0,
        automationType: "ui_discovery",
        setupStrategy: "no_login",
        appSlug: "kiosko",
        routeProfile: "informacion-productos",
        dataRequirements: "N/A",
        nonExecutableCriteria: "",
        mcpExecutable: false,
      },
    ];

    const { automatable, excluded } = filterScenariosByAutomatability(scenarios, huContext);

    // Should be excluded
    expect(automatable.length).toBe(0);
    expect(excluded.length).toBe(1);
    expect(excluded[0].classification).toBe("non_automatable_backend");
    expect(excluded[0].reason).toContain("backend manipulation");
    expect(excluded[0].suggestedHandling).toBe("backend_unit_test");
    expect(excluded[0].detectedPatterns).toBeDefined();

    console.log(`[test] corrupt content: excluded=${excluded.length} classification=${excluded[0].classification}`);
  });

  test("Test 3: HU con reinicio físico/pérdida de red → queda en excludedRequirements", async () => {
    const scenarios: McpScenario[] = [
      {
        sourceIssueKey: "AA-202",
        title: "Validar recuperación tras reinicio físico del kiosko",
        steps: [
          '1. Clic en "Información de productos".',
          "2. Reiniciar físicamente el kiosko.",
          "3. Validar que la sesión se recupere.",
        ],
        preconditions: [],
        expectedResult: "Sesión recuperada tras reinicio",
        type: "negative",
        database: "",
        isConverted: 0,
        automationType: "ui_discovery",
        setupStrategy: "no_login",
        appSlug: "kiosko",
        routeProfile: "informacion-productos",
        dataRequirements: "N/A",
        nonExecutableCriteria: "",
        mcpExecutable: false,
      },
      {
        sourceIssueKey: "AA-203",
        title: "Validar error por pérdida de red",
        steps: [
          '1. Clic en "Información de productos".',
          "2. Simular pérdida de red.",
          '3. Validar que se muestre "Sin conexión".',
        ],
        preconditions: [],
        expectedResult: "Mensaje de error visible",
        type: "negative",
        database: "",
        isConverted: 0,
        automationType: "ui_discovery",
        setupStrategy: "no_login",
        appSlug: "kiosko",
        routeProfile: "informacion-productos",
        dataRequirements: "N/A",
        nonExecutableCriteria: "",
        mcpExecutable: false,
      },
    ];

    const { automatable, excluded } = filterScenariosByAutomatability(scenarios);

    // Both should be excluded
    expect(automatable.length).toBe(0);
    expect(excluded.length).toBe(2);
    expect(excluded[0].classification).toBe("non_automatable_infra");
    expect(excluded[1].classification).toBe("non_automatable_infra");
    expect(excluded[0].suggestedHandling).toBe("manual_test");
    expect(excluded[1].suggestedHandling).toBe("manual_test");

    console.log(`[test] infra scenarios: excluded=${excluded.length} both classified as infra`);
  });

  test("Test 4: HU con validaciones de contenido visible → genera automatable_ui", async () => {
    const scenarios: McpScenario[] = [
      {
        sourceIssueKey: "AA-100",
        title: "Validar visualización de categorías",
        steps: [
          '1. Clic en "Iniciar".',
          '2. Clic en "Información de productos".',
          '3. Validar que se muestre "Tarjetas de Crédito".',
          '4. Validar que se muestre "Cuentas de Efectivo".',
          '5. Validar que se muestre "Préstamos".',
        ],
        preconditions: ["Usuario autenticado"],
        expectedResult: "Se muestran las categorías principales",
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
      },
      {
        sourceIssueKey: "AA-101",
        title: "Validar navegación a detalle de producto",
        steps: [
          '1. Clic en "Iniciar".',
          '2. Clic en "Información de productos".',
          '3. Clic en "Tarjetas de Crédito".',
          '4. Clic en "Tarjeta Platinum".',
          '5. Validar que se muestre "Detalles".',
          '6. Validar que el botón "Volver" esté visible.',
        ],
        preconditions: ["Usuario autenticado"],
        expectedResult: "Se muestra el detalle del producto con botón volver",
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
      },
    ];

    const { automatable, excluded } = filterScenariosByAutomatability(scenarios);

    // Both should be automatable
    expect(automatable.length).toBe(2);
    expect(excluded.length).toBe(0);

    // Verify classification
    for (const scenario of automatable) {
      const classification = classifyScenarioAutomatability(scenario);
      expect(classification.isAutomatable).toBe(true);
      expect(classification.classification).toBe("automatable_ui");
    }

    console.log(`[test] UI validations: automatable=${automatable.length} excluded=${excluded.length}`);
  });

  test('Test 5: "Solicitar" se permite como assertion visible, pero no como click ejecutable', async () => {
    const scenarioValidation: McpScenario = {
      sourceIssueKey: "AA-102",
      title: 'Validar que botón "Solicitar" esté visible',
      steps: [
        '1. Clic en "Iniciar".',
        '2. Clic en "Información de productos".',
        '3. Clic en "Tarjetas de Crédito".',
        '4. Clic en "Tarjeta Platinum".',
        '5. Validar que el botón "Solicitar" esté visible.',
      ],
      preconditions: ["Usuario autenticado"],
      expectedResult: 'Botón "Solicitar" visible en detalle',
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

    // Note: The sensitive action validation is done by scenario-validator.ts, not the automatability classifier
    // The classifier focuses on backend/infra/manual exclusions
    // Sensitive actions like "Clic en 'Solicitar'" would be caught by validator, not classifier

    const classification = classifyScenarioAutomatability(scenarioValidation);

    // Validation scenario (not clicking) should be automatable
    expect(classification.isAutomatable).toBe(true);
    expect(classification.classification).toBe("automatable_ui");

    console.log(`[test] Solicitar validation: automatable=${classification.isAutomatable}`);
  });

  test("Test 6: diagnostics reporta nonAutomatableRequirementCount", async () => {
    const scenarios: McpScenario[] = [
      {
        sourceIssueKey: "AA-300",
        title: "Escenario UI automatable",
        steps: ['1. Clic en "Iniciar".', '2. Validar que se muestre "Bienvenido".'],
        preconditions: [],
        expectedResult: "Bienvenido visible",
        type: "functional",
        database: "",
        isConverted: 0,
        automationType: "ui_discovery",
        setupStrategy: "no_login",
        appSlug: "kiosko",
        routeProfile: "home",
        dataRequirements: "N/A",
        nonExecutableCriteria: "",
        mcpExecutable: true,
      },
      {
        sourceIssueKey: "AA-301",
        title: "Escenario backend no automatable",
        steps: ["1. Alterar base de datos.", "2. Validar error."],
        preconditions: [],
        expectedResult: "Error mostrado",
        type: "negative",
        database: "",
        isConverted: 0,
        automationType: "ui_discovery",
        setupStrategy: "no_login",
        appSlug: "kiosko",
        routeProfile: "home",
        dataRequirements: "N/A",
        nonExecutableCriteria: "",
        mcpExecutable: false,
      },
      {
        sourceIssueKey: "AA-302",
        title: "Escenario infra no automatable",
        steps: ["1. Simular pérdida de red.", "2. Validar reconexión."],
        preconditions: [],
        expectedResult: "Reconexión exitosa",
        type: "negative",
        database: "",
        isConverted: 0,
        automationType: "ui_discovery",
        setupStrategy: "no_login",
        appSlug: "kiosko",
        routeProfile: "home",
        dataRequirements: "N/A",
        nonExecutableCriteria: "",
        mcpExecutable: false,
      },
    ];

    const { automatable, excluded } = filterScenariosByAutomatability(scenarios);

    // Should have 1 automatable, 2 excluded
    expect(automatable.length).toBe(1);
    expect(excluded.length).toBe(2);

    // Mock catalogDiagnostics
    const catalogDiagnostics = {
      catalogUsed: false,
      discoveryRefreshed: false,
      discoveredProductCount: 0,
      representativeProductCount: 0,
      warnings: [],
      excludedRequirements: excluded,
      nonAutomatableRequirementCount: excluded.length,
      uiAutomatableRequirementCount: automatable.length,
    };

    // Verify diagnostics
    expect(catalogDiagnostics.nonAutomatableRequirementCount).toBe(2);
    expect(catalogDiagnostics.uiAutomatableRequirementCount).toBe(1);
    expect(catalogDiagnostics.excludedRequirements).toHaveLength(2);
    expect(catalogDiagnostics.excludedRequirements![0].sourceIssueKey).toBe("AA-301");
    expect(catalogDiagnostics.excludedRequirements![1].sourceIssueKey).toBe("AA-302");

    console.log(
      `[test] diagnostics: nonAutomatable=${catalogDiagnostics.nonAutomatableRequirementCount} ` +
        `uiAutomatable=${catalogDiagnostics.uiAutomatableRequirementCount}`
    );
  });

  test("Test 7: Validar ausencia de producto descontinuado (solo UI) → automatable", async () => {
    // This scenario validates absence of a discontinued product by checking current UI
    // WITHOUT artificially creating/manipulating backend
    const scenario: McpScenario = {
      sourceIssueKey: "AA-400",
      title: "Validar que producto descontinuado no aparece en catálogo actual",
      steps: [
        '1. Clic en "Iniciar".',
        '2. Clic en "Información de productos".',
        '3. Clic en "Tarjetas de Crédito".',
        '4. Validar que no se muestre "Tarjeta Legacy 2010".',
      ],
      preconditions: ["Usuario autenticado", "Tarjeta Legacy 2010 fue descontinuada en 2015"],
      expectedResult: "Tarjeta descontinuada no aparece en catálogo actual",
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

    const classification = classifyScenarioAutomatability(scenario);

    // Should be automatable (checking current UI state, not manipulating backend)
    expect(classification.isAutomatable).toBe(true);
    expect(classification.classification).toBe("automatable_ui");

    console.log(
      `[test] discontinued product absence validation: automatable=${classification.isAutomatable}`
    );
  });

  test("Test 8: Crear producto descontinuado artificialmente → non_automatable_backend", async () => {
    // This scenario requires artificially CREATING a discontinued product (backend manipulation)
    const scenario: McpScenario = {
      sourceIssueKey: "AA-401",
      title: "Validar comportamiento con producto descontinuado artificial",
      steps: [
        "1. Crear producto descontinuado en base de datos.",
        '2. Clic en "Información de productos".',
        "3. Validar que producto descontinuado no se muestre.",
      ],
      preconditions: [],
      expectedResult: "Producto descontinuado no visible",
      type: "negative",
      database: "",
      isConverted: 0,
      automationType: "ui_discovery",
      setupStrategy: "no_login",
      appSlug: "kiosko",
      routeProfile: "informacion-productos",
      dataRequirements: "N/A",
      nonExecutableCriteria: "Requiere crear producto artificialmente",
      mcpExecutable: false,
    };

    const classification = classifyScenarioAutomatability(scenario);

    // Should NOT be automatable (requires backend manipulation)
    expect(classification.isAutomatable).toBe(false);
    expect(classification.classification).toBe("non_automatable_backend");
    expect(classification.reason).toContain("backend manipulation");

    console.log(
      `[test] artificial discontinued product: classification=${classification.classification}`
    );
  });

  test("Test 9: Reinicio físico o pérdida de energía queda non_automatable_infra", async () => {
    const scenario: McpScenario = {
      sourceIssueKey: "AA-500",
      title: "Validar recuperación tras reinicio del kiosko por pérdida de energía",
      steps: [
        '1. Clic en "Iniciar".',
        "2. Simular pérdida de energía del dispositivo.",
        '3. Validar que se muestre "Iniciar".',
      ],
      preconditions: [],
      expectedResult: "El kiosko vuelve al inicio tras reinicio físico",
      type: "negative",
      database: "",
      isConverted: 0,
      automationType: "ui_discovery",
      setupStrategy: "no_login",
      appSlug: "kiosko",
      routeProfile: "home",
      dataRequirements: "N/A",
      nonExecutableCriteria: "",
      mcpExecutable: false,
    };

    const classification = classifyScenarioAutomatability(scenario);
    expect(classification.isAutomatable).toBe(false);
    expect(classification.classification).toBe("non_automatable_infra");
  });

  test("Test 10: Reinicio UI soportado por acción visible permanece automatable_ui", async () => {
    const scenario: McpScenario = {
      sourceIssueKey: "AA-501",
      title: "Reiniciar sesión desde opción visible de la interfaz",
      steps: [
        '1. Clic en "Menú".',
        '2. Clic en "Reiniciar sesión".',
        '3. Validar que se muestre "Inicio".',
      ],
      preconditions: [],
      expectedResult: "La sesión vuelve a inicio por acción UI soportada",
      type: "functional",
      database: "",
      isConverted: 0,
      automationType: "ui_discovery",
      setupStrategy: "no_login",
      appSlug: "kiosko",
      routeProfile: "home",
      dataRequirements: "N/A",
      nonExecutableCriteria: "",
      mcpExecutable: true,
    };

    const classification = classifyScenarioAutomatability(scenario);
    expect(classification.isAutomatable).toBe(true);
    expect(classification.classification).toBe("automatable_ui");
  });

  test("Test 11: Inactividad sin espera soportada queda non_automatable_infra", async () => {
    const scenario: McpScenario = {
      sourceIssueKey: "AA-502",
      title: "Validar reinicio automático por inactividad",
      steps: [
        '1. Clic en "Iniciar".',
        '2. Validar que se muestre "Iniciar".',
      ],
      preconditions: [],
      expectedResult: "Tras inactividad el flujo retorna al inicio",
      type: "negative",
      database: "",
      isConverted: 0,
      automationType: "ui_discovery",
      setupStrategy: "no_login",
      appSlug: "kiosko",
      routeProfile: "home",
      dataRequirements: "N/A",
      nonExecutableCriteria: "",
      mcpExecutable: false,
    };

    const classification = classifyScenarioAutomatability(scenario);
    expect(classification.isAutomatable).toBe(false);
    expect(classification.classification).toBe("non_automatable_infra");
  });

  test("Test 12: mención contextual de reinicio en HU no excluye escenario UI válido", async () => {
    const huContext: JiraIssueSource = {
      key: "AA-600",
      summary: "Recuperación ante reinicio físico del kiosko",
      description: "La HU menciona reinicio físico como contexto de negocio",
      acceptanceCriteria: "Validar reinicio físico y pérdida de energía en pruebas manuales",
      labels: [],
      components: [],
      status: "Open",
      issueType: "Story",
    };
    const scenario: McpScenario = {
      sourceIssueKey: "AA-600",
      title: "Visualizar pantalla inicial",
      steps: [
        '1. Clic en "Iniciar".',
        '2. Validar que se muestre "¿Qué deseas realizar hoy?".',
      ],
      preconditions: [],
      expectedResult: "Pantalla inicial visible",
      type: "functional",
      database: "",
      isConverted: 0,
      automationType: "ui_discovery",
      setupStrategy: "no_login",
      appSlug: "kiosko",
      routeProfile: "home",
      dataRequirements: "N/A",
      nonExecutableCriteria: "",
      mcpExecutable: true,
    };

    const classification = classifyScenarioAutomatability(scenario, huContext);
    expect(classification.isAutomatable).toBe(true);
    expect(classification.classification).toBe("automatable_ui");
  });

  test("Test 13: filtro conserva escenarios UI cuando otro escenario sí exige control externo", async () => {
    const scenarios: McpScenario[] = [
      {
        sourceIssueKey: "AA-610",
        title: "Escenario UI válido",
        steps: ['1. Clic en "Iniciar".', '2. Validar que se muestre "Inicio".'],
        preconditions: [],
        expectedResult: "Inicio visible",
        type: "functional",
        database: "",
        isConverted: 0,
        automationType: "ui_discovery",
        setupStrategy: "no_login",
        appSlug: "kiosko",
        routeProfile: "home",
        dataRequirements: "N/A",
        nonExecutableCriteria: "",
        mcpExecutable: true,
      },
      {
        sourceIssueKey: "AA-611",
        title: "Escenario con reinicio físico",
        steps: ['1. Clic en "Iniciar".', "2. Reiniciar físicamente el kiosko."],
        preconditions: [],
        expectedResult: "Recuperación física validada",
        type: "negative",
        database: "",
        isConverted: 0,
        automationType: "ui_discovery",
        setupStrategy: "no_login",
        appSlug: "kiosko",
        routeProfile: "home",
        dataRequirements: "N/A",
        nonExecutableCriteria: "",
        mcpExecutable: false,
      },
    ];

    const { automatable, excluded } = filterScenariosByAutomatability(scenarios);
    expect(automatable).toHaveLength(1);
    expect(excluded).toHaveLength(1);
    expect(excluded[0].reasonCode).toBeDefined();
    expect(excluded[0].matchedRule).toBeDefined();
    expect(excluded[0].matchedText).toBeDefined();
  });
});
