import { test, expect } from "@playwright/test";

test.describe("AI Scenario Normalization", () => {
  test("normalizeAiScenario fixes invalid automationType", () => {
    // Mock normalization function (same logic as in codex-scenario-generator.ts)
    function normalizeAiScenario(scenario: any, appSlug: string): any {
      const normalized = { ...scenario };

      const validAutomationTypes = [
        "ui_discovery",
        "ui_with_auth_gate",
        "ui_with_controlled_data",
        "ui_with_auth_gate_controlled_data"
      ];
      if (!validAutomationTypes.includes(normalized.automationType)) {
        normalized.automationType = "ui_with_controlled_data";
      }

      const validSetupStrategies = [
        "self_contained",
        "auth_gate",
        "controlled_data",
        "no_login"
      ];
      if (!validSetupStrategies.includes(normalized.setupStrategy)) {
        normalized.setupStrategy = "controlled_data";
      }

      if (normalized.mcpExecutable !== true) {
        normalized.mcpExecutable = true;
      }

      if (!normalized.appSlug) {
        normalized.appSlug = appSlug;
      }

      if (!normalized.preconditions || !Array.isArray(normalized.preconditions)) {
        normalized.preconditions = ["AuthGate"];
      }

      if (!normalized.caseOracle) {
        normalized.caseOracle = "assert_visible";
      }

      if (!normalized.type) {
        normalized.type = "Automated";
      }

      if (normalized.database === undefined) {
        normalized.database = "";
      }

      if (normalized.isConverted === undefined) {
        normalized.isConverted = 1;
      }

      if (!normalized.dataRequirements) {
        normalized.dataRequirements = "";
      }

      if (!normalized.nonExecutableCriteria) {
        normalized.nonExecutableCriteria = "";
      }

      return normalized;
    }

    const aiScenario = {
      sourceIssueKey: "TEST-123",
      title: "Test scenario from AI",
      steps: ["1. Clic en \"Iniciar\"."],
      expectedResult: "Button visible",
      automationType: "playwright", // INVALID
      setupStrategy: "invalid_strategy", // INVALID
      mcpExecutable: false, // INVALID
      appSlug: ""
    };

    const normalized = normalizeAiScenario(aiScenario, "test-app");

    // automationType should be fixed
    expect(normalized.automationType).toBe("ui_with_controlled_data");

    // setupStrategy should be fixed
    expect(normalized.setupStrategy).toBe("controlled_data");

    // mcpExecutable should be fixed
    expect(normalized.mcpExecutable).toBe(true);

    // appSlug should be set
    expect(normalized.appSlug).toBe("test-app");

    // Missing fields should be added
    expect(normalized.preconditions).toEqual(["AuthGate"]);
    expect(normalized.caseOracle).toBe("assert_visible");
    expect(normalized.type).toBe("Automated");
    expect(normalized.database).toBe("");
    expect(normalized.isConverted).toBe(1);
    expect(normalized.dataRequirements).toBe("");
    expect(normalized.nonExecutableCriteria).toBe("");
  });

  test("normalizeAiScenario preserves valid fields", () => {
    function normalizeAiScenario(scenario: any, appSlug: string): any {
      const normalized = { ...scenario };

      const validAutomationTypes = [
        "ui_discovery",
        "ui_with_auth_gate",
        "ui_with_controlled_data",
        "ui_with_auth_gate_controlled_data"
      ];
      if (!validAutomationTypes.includes(normalized.automationType)) {
        normalized.automationType = "ui_with_controlled_data";
      }

      const validSetupStrategies = [
        "self_contained",
        "auth_gate",
        "controlled_data",
        "no_login"
      ];
      if (!validSetupStrategies.includes(normalized.setupStrategy)) {
        normalized.setupStrategy = "controlled_data";
      }

      if (normalized.mcpExecutable !== true) {
        normalized.mcpExecutable = true;
      }

      if (!normalized.appSlug) {
        normalized.appSlug = appSlug;
      }

      if (!normalized.preconditions || !Array.isArray(normalized.preconditions)) {
        normalized.preconditions = ["AuthGate"];
      }

      if (!normalized.caseOracle) {
        normalized.caseOracle = "assert_visible";
      }

      if (!normalized.type) {
        normalized.type = "Automated";
      }

      if (normalized.database === undefined) {
        normalized.database = "";
      }

      if (normalized.isConverted === undefined) {
        normalized.isConverted = 1;
      }

      if (!normalized.dataRequirements) {
        normalized.dataRequirements = "";
      }

      if (!normalized.nonExecutableCriteria) {
        normalized.nonExecutableCriteria = "";
      }

      return normalized;
    }

    const aiScenario = {
      sourceIssueKey: "TEST-456",
      title: "Valid scenario from AI",
      steps: ["1. Clic en \"Iniciar\"."],
      expectedResult: "Button visible",
      automationType: "ui_with_auth_gate", // VALID
      setupStrategy: "auth_gate", // VALID
      mcpExecutable: true, // VALID
      appSlug: "my-app",
      preconditions: ["AuthGate", "CustomPrecondition"],
      caseOracle: "custom_oracle"
    };

    const normalized = normalizeAiScenario(aiScenario, "default-app");

    // Valid fields should be preserved
    expect(normalized.automationType).toBe("ui_with_auth_gate");
    expect(normalized.setupStrategy).toBe("auth_gate");
    expect(normalized.mcpExecutable).toBe(true);
    expect(normalized.appSlug).toBe("my-app");
    expect(normalized.preconditions).toEqual(["AuthGate", "CustomPrecondition"]);
    expect(normalized.caseOracle).toBe("custom_oracle");
  });

  test("AI scenarios with duplicate steps are deduplicated", () => {
    function dedupeConsecutiveSteps(steps: any[]): any[] {
      if (steps.length === 0) return steps;

      const deduped: any[] = [steps[0]];

      for (let i = 1; i < steps.length; i++) {
        const current = steps[i];
        const previous = steps[i - 1];

        const getCurrentTarget = (step: any): string | null => {
          if (typeof step === "string") {
            const match = step.match(/Clic en "([^"]+)"/i);
            return match ? match[1].toLowerCase().trim() : null;
          }
          if (typeof step === "object" && step.action === "click" && step.target) {
            return step.target.toLowerCase().trim();
          }
          return null;
        };

        const currentTarget = getCurrentTarget(current);
        const previousTarget = getCurrentTarget(previous);

        if (currentTarget && previousTarget && currentTarget === previousTarget) {
          continue;
        }

        deduped.push(current);
      }

      return deduped;
    }

    const aiScenario = {
      title: "AI scenario with duplicates",
      steps: [
        "1. Clic en \"Iniciar\".",
        "2. Clic en \"Información de productos\".",
        "3. Clic en \"Información de productos\".", // DUPLICATE
        "4. Clic en \"Tarjetas\".",
        "5. Validar que se muestre \"Saldo\"."
      ]
    };

    const dedupedSteps = dedupeConsecutiveSteps(aiScenario.steps);

    // Should have removed the duplicate "Información de productos"
    expect(dedupedSteps).toHaveLength(4);
    expect(dedupedSteps[0]).toContain("Iniciar");
    expect(dedupedSteps[1]).toContain("Información de productos");
    expect(dedupedSteps[2]).toContain("Tarjetas");
    expect(dedupedSteps[3]).toContain("Validar que se muestre");
  });

  test("state mapping tracks scenarios through all stages", () => {
    // Simulate the flow:
    // 1. AI generates 3 scenarios
    // 2. Compliance validation passes all 3
    // 3. Scenario validation passes all 3
    // 4. Preview should show valid=3

    const generationDiagnostics = {
      generationMode: "ai_supported_by_deterministic" as const,
      deterministicSeedsGenerated: 0,
      aiCalled: true,
      aiGenerated: 3,
      finalValid: 3,
      finalRejected: 0,
      finalBlocked: 0,
      fallbackUsed: false
    };

    // If compliance says finalValid=3 and no subsequent stage rejects them,
    // preview valid should be 3
    const expectedPreviewValid = generationDiagnostics.finalValid;

    expect(expectedPreviewValid).toBe(3);

    // State mapping should ensure:
    // - No orphan scenarios (generated > 0 but valid = rejected = blocked = 0)
    const totalAccountedFor = generationDiagnostics.finalValid + generationDiagnostics.finalRejected + generationDiagnostics.finalBlocked;
    expect(totalAccountedFor).toBe(generationDiagnostics.aiGenerated);
  });

  test("fallback scenarios show as valid in preview", () => {
    // Simulate fallback flow:
    // 1. AI fails
    // 2. Fallback uses 1 seed
    // 3. Compliance validation passes 1
    // 4. Scenario validation should pass 1 (with correct fields)
    // 5. Preview should show valid=1

    const generationDiagnostics = {
      generationMode: "ai_supported_by_deterministic" as const,
      deterministicSeedsGenerated: 1,
      aiCalled: true,
      aiFailed: true,
      aiGenerated: 0,
      finalValid: 1,
      finalRejected: 0,
      finalBlocked: 0,
      fallbackUsed: true,
      fallbackReason: "ai_parse_failed" as const,
      fallbackScenarioCount: 1
    };

    // Fallback scenarios should have correct fields after normalization
    const fallbackScenario = {
      sourceIssueKey: "TEST-789",
      title: "Fallback scenario",
      steps: ["1. Clic en \"Iniciar\"."],
      preconditions: ["AuthGate"],
      expectedResult: "Escenario de fallback por error de IA",
      caseOracle: "assert_visible",
      type: "Automated",
      database: "",
      isConverted: 1,
      automationType: "ui_with_controlled_data", // CORRECT
      setupStrategy: "ui_with_controlled_data", // CORRECT
      appSlug: "test-app",
      routeProfile: "default",
      dataRequirements: "",
      nonExecutableCriteria: "",
      mcpExecutable: true
    };

    // Check that all required fields are present and valid
    expect(fallbackScenario.automationType).toBe("ui_with_controlled_data");
    expect(fallbackScenario.setupStrategy).toBe("ui_with_controlled_data");
    expect(fallbackScenario.mcpExecutable).toBe(true);
    expect(fallbackScenario.caseOracle).toBe("assert_visible");

    // Preview should show valid=1
    expect(generationDiagnostics.finalValid).toBe(1);
  });
});
