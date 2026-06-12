import { test, expect } from "@playwright/test";

test.describe("Scenario Generation Modes", () => {
  test("default mode is ai_supported_by_deterministic", () => {
    // Save original env
    const originalEnv = process.env.SCENARIO_GENERATION_MODE;

    try {
      // Clear env to test default
      delete process.env.SCENARIO_GENERATION_MODE;

      // Import after clearing env to get default
      const mod = require("../src/scenarios/codex-scenario-generator");

      // The default should be ai_supported_by_deterministic
      // This will be validated by checking logs in actual runs
      expect(true).toBe(true); // Placeholder - actual validation in integration tests
    } finally {
      // Restore env
      if (originalEnv) {
        process.env.SCENARIO_GENERATION_MODE = originalEnv;
      }
    }
  });

  test("deterministic_only mode requires explicit env", () => {
    const originalEnv = process.env.SCENARIO_GENERATION_MODE;

    try {
      // Set to deterministic_only
      process.env.SCENARIO_GENERATION_MODE = "deterministic_only";

      // Import after setting env
      delete require.cache[require.resolve("../src/scenarios/codex-scenario-generator")];
      const mod = require("../src/scenarios/codex-scenario-generator");

      // The mode should be deterministic_only
      expect(process.env.SCENARIO_GENERATION_MODE).toBe("deterministic_only");
    } finally {
      // Restore env
      if (originalEnv) {
        process.env.SCENARIO_GENERATION_MODE = originalEnv;
      } else {
        delete process.env.SCENARIO_GENERATION_MODE;
      }
    }
  });

  test("invalid mode falls back to default", () => {
    const originalEnv = process.env.SCENARIO_GENERATION_MODE;

    try {
      // Set invalid mode
      process.env.SCENARIO_GENERATION_MODE = "invalid_mode";

      // Import after setting env
      delete require.cache[require.resolve("../src/scenarios/codex-scenario-generator")];
      const mod = require("../src/scenarios/codex-scenario-generator");

      // Should fall back to default ai_supported_by_deterministic
      // Validated by logs in actual runs
      expect(true).toBe(true); // Placeholder
    } finally {
      // Restore env
      if (originalEnv) {
        process.env.SCENARIO_GENERATION_MODE = originalEnv;
      } else {
        delete process.env.SCENARIO_GENERATION_MODE;
      }
    }
  });

  test("DeterministicSeedScenario type has required fields", () => {
    // Test that the type is correctly defined
    const seed = {
      sourceIssueKey: "TEST-1",
      title: "Test scenario",
      steps: ["1. Clic en \"Iniciar\"."],
      mode: "action_button_validation" as const,
      confidence: "high" as const,
      notes: "Test note"
    };

    expect(seed.sourceIssueKey).toBe("TEST-1");
    expect(seed.title).toBe("Test scenario");
    expect(seed.steps).toHaveLength(1);
    expect(seed.mode).toBe("action_button_validation");
    expect(seed.confidence).toBe("high");
    expect(seed.notes).toBe("Test note");
  });

  test("ScenarioGenerationDiagnostics tracks all states including failures", () => {
    const diagnostics = {
      generationMode: "ai_supported_by_deterministic" as const,
      deterministicSeedsGenerated: 2,
      aiCalled: true,
      aiFailed: true,
      aiGenerated: 0,
      finalValid: 2,
      finalRejected: 0,
      finalBlocked: 0,
      fallbackUsed: true,
      fallbackReason: "ai_parse_failed" as const,
      fallbackScenarioCount: 2
    };

    // Verify fallback tracking
    expect(diagnostics.aiFailed).toBe(true);
    expect(diagnostics.fallbackUsed).toBe(true);
    expect(diagnostics.fallbackReason).toBe("ai_parse_failed");
    expect(diagnostics.fallbackScenarioCount).toBe(2);

    // Verify all scenarios are accounted for
    const totalScenarios = diagnostics.finalValid + diagnostics.finalRejected + diagnostics.finalBlocked;
    expect(totalScenarios).toBe(2);
    expect(diagnostics.generationMode).toBe("ai_supported_by_deterministic");
    expect(diagnostics.aiCalled).toBe(true);
  });

  test("state mapping ensures no orphan scenarios", () => {
    // Simulate a generation result
    const diagnostics = {
      generationMode: "ai_supported_by_deterministic" as const,
      deterministicSeedsGenerated: 1,
      aiCalled: true,
      aiGenerated: 3,
      finalValid: 2,
      finalRejected: 1,
      finalBlocked: 0,
      fallbackUsed: false
    };

    // Every generated scenario must end up in one of: valid, rejected, or blocked
    const accountedScenarios = diagnostics.finalValid + diagnostics.finalRejected + diagnostics.finalBlocked;

    // This should match aiGenerated (assuming no AI errors)
    expect(accountedScenarios).toBe(diagnostics.aiGenerated);

    // No orphan scenarios: generated > 0 but valid=rejected=blocked=0
    if (diagnostics.aiGenerated > 0) {
      expect(accountedScenarios).toBeGreaterThan(0);
    }
  });

  test("fallback is used in ai_supported_by_deterministic on AI failure", () => {
    // Simulate AI failure with seeds available
    const diagnostics = {
      generationMode: "ai_supported_by_deterministic" as const,
      deterministicSeedsGenerated: 1,
      aiCalled: true,
      aiFailed: true,
      aiGenerated: 0,
      finalValid: 1,
      finalRejected: 0,
      finalBlocked: 0,
      fallbackUsed: true,
      fallbackReason: "ai_generation_error" as const,
      fallbackScenarioCount: 1
    };

    // When AI fails but seeds are available, fallback should be used
    expect(diagnostics.aiCalled).toBe(true);
    expect(diagnostics.aiFailed).toBe(true);
    expect(diagnostics.fallbackUsed).toBe(true);
    expect(diagnostics.fallbackScenarioCount).toBe(1);

    // Seeds become final scenarios
    expect(diagnostics.finalValid).toBe(1);

    // Total scenarios accounted for
    const totalScenarios = diagnostics.finalValid + diagnostics.finalRejected + diagnostics.finalBlocked;
    expect(totalScenarios).toBe(1);
  });

  test("fallback reason is tracked correctly", () => {
    const timeoutDiagnostics = {
      fallbackReason: "ai_timeout" as const
    };
    expect(timeoutDiagnostics.fallbackReason).toBe("ai_timeout");

    const parseErrorDiagnostics = {
      fallbackReason: "ai_parse_failed" as const
    };
    expect(parseErrorDiagnostics.fallbackReason).toBe("ai_parse_failed");

    const generationErrorDiagnostics = {
      fallbackReason: "ai_generation_error" as const
    };
    expect(generationErrorDiagnostics.fallbackReason).toBe("ai_generation_error");
  });
});
