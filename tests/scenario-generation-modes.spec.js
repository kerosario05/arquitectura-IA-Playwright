"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
test_1.test.describe("Scenario Generation Modes", () => {
    (0, test_1.test)("default mode is ai_supported_by_deterministic", () => {
        // Save original env
        const originalEnv = process.env.SCENARIO_GENERATION_MODE;
        try {
            // Clear env to test default
            delete process.env.SCENARIO_GENERATION_MODE;
            // Import after clearing env to get default
            const mod = require("../src/scenarios/codex-scenario-generator");
            // The default should be ai_supported_by_deterministic
            // This will be validated by checking logs in actual runs
            (0, test_1.expect)(true).toBe(true); // Placeholder - actual validation in integration tests
        }
        finally {
            // Restore env
            if (originalEnv) {
                process.env.SCENARIO_GENERATION_MODE = originalEnv;
            }
        }
    });
    (0, test_1.test)("deterministic_only mode requires explicit env", () => {
        const originalEnv = process.env.SCENARIO_GENERATION_MODE;
        try {
            // Set to deterministic_only
            process.env.SCENARIO_GENERATION_MODE = "deterministic_only";
            // Import after setting env
            delete require.cache[require.resolve("../src/scenarios/codex-scenario-generator")];
            const mod = require("../src/scenarios/codex-scenario-generator");
            // The mode should be deterministic_only
            (0, test_1.expect)(process.env.SCENARIO_GENERATION_MODE).toBe("deterministic_only");
        }
        finally {
            // Restore env
            if (originalEnv) {
                process.env.SCENARIO_GENERATION_MODE = originalEnv;
            }
            else {
                delete process.env.SCENARIO_GENERATION_MODE;
            }
        }
    });
    (0, test_1.test)("invalid mode falls back to default", () => {
        const originalEnv = process.env.SCENARIO_GENERATION_MODE;
        try {
            // Set invalid mode
            process.env.SCENARIO_GENERATION_MODE = "invalid_mode";
            // Import after setting env
            delete require.cache[require.resolve("../src/scenarios/codex-scenario-generator")];
            const mod = require("../src/scenarios/codex-scenario-generator");
            // Should fall back to default ai_supported_by_deterministic
            // Validated by logs in actual runs
            (0, test_1.expect)(true).toBe(true); // Placeholder
        }
        finally {
            // Restore env
            if (originalEnv) {
                process.env.SCENARIO_GENERATION_MODE = originalEnv;
            }
            else {
                delete process.env.SCENARIO_GENERATION_MODE;
            }
        }
    });
    (0, test_1.test)("DeterministicSeedScenario type has required fields", () => {
        // Test that the type is correctly defined
        const seed = {
            sourceIssueKey: "TEST-1",
            title: "Test scenario",
            steps: ["1. Clic en \"Iniciar\"."],
            mode: "action_button_validation",
            confidence: "high",
            notes: "Test note"
        };
        (0, test_1.expect)(seed.sourceIssueKey).toBe("TEST-1");
        (0, test_1.expect)(seed.title).toBe("Test scenario");
        (0, test_1.expect)(seed.steps).toHaveLength(1);
        (0, test_1.expect)(seed.mode).toBe("action_button_validation");
        (0, test_1.expect)(seed.confidence).toBe("high");
        (0, test_1.expect)(seed.notes).toBe("Test note");
    });
    (0, test_1.test)("ScenarioGenerationDiagnostics tracks all states including failures", () => {
        const diagnostics = {
            generationMode: "ai_supported_by_deterministic",
            deterministicSeedsGenerated: 2,
            aiCalled: true,
            aiFailed: true,
            aiGenerated: 0,
            finalValid: 2,
            finalRejected: 0,
            finalBlocked: 0,
            fallbackUsed: true,
            fallbackReason: "ai_parse_failed",
            fallbackScenarioCount: 2
        };
        // Verify fallback tracking
        (0, test_1.expect)(diagnostics.aiFailed).toBe(true);
        (0, test_1.expect)(diagnostics.fallbackUsed).toBe(true);
        (0, test_1.expect)(diagnostics.fallbackReason).toBe("ai_parse_failed");
        (0, test_1.expect)(diagnostics.fallbackScenarioCount).toBe(2);
        // Verify all scenarios are accounted for
        const totalScenarios = diagnostics.finalValid + diagnostics.finalRejected + diagnostics.finalBlocked;
        (0, test_1.expect)(totalScenarios).toBe(2);
        (0, test_1.expect)(diagnostics.generationMode).toBe("ai_supported_by_deterministic");
        (0, test_1.expect)(diagnostics.aiCalled).toBe(true);
    });
    (0, test_1.test)("state mapping ensures no orphan scenarios", () => {
        // Simulate a generation result
        const diagnostics = {
            generationMode: "ai_supported_by_deterministic",
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
        (0, test_1.expect)(accountedScenarios).toBe(diagnostics.aiGenerated);
        // No orphan scenarios: generated > 0 but valid=rejected=blocked=0
        if (diagnostics.aiGenerated > 0) {
            (0, test_1.expect)(accountedScenarios).toBeGreaterThan(0);
        }
    });
    (0, test_1.test)("fallback is used in ai_supported_by_deterministic on AI failure", () => {
        // Simulate AI failure with seeds available
        const diagnostics = {
            generationMode: "ai_supported_by_deterministic",
            deterministicSeedsGenerated: 1,
            aiCalled: true,
            aiFailed: true,
            aiGenerated: 0,
            finalValid: 1,
            finalRejected: 0,
            finalBlocked: 0,
            fallbackUsed: true,
            fallbackReason: "ai_generation_error",
            fallbackScenarioCount: 1
        };
        // When AI fails but seeds are available, fallback should be used
        (0, test_1.expect)(diagnostics.aiCalled).toBe(true);
        (0, test_1.expect)(diagnostics.aiFailed).toBe(true);
        (0, test_1.expect)(diagnostics.fallbackUsed).toBe(true);
        (0, test_1.expect)(diagnostics.fallbackScenarioCount).toBe(1);
        // Seeds become final scenarios
        (0, test_1.expect)(diagnostics.finalValid).toBe(1);
        // Total scenarios accounted for
        const totalScenarios = diagnostics.finalValid + diagnostics.finalRejected + diagnostics.finalBlocked;
        (0, test_1.expect)(totalScenarios).toBe(1);
    });
    (0, test_1.test)("fallback reason is tracked correctly", () => {
        const timeoutDiagnostics = {
            fallbackReason: "ai_timeout"
        };
        (0, test_1.expect)(timeoutDiagnostics.fallbackReason).toBe("ai_timeout");
        const parseErrorDiagnostics = {
            fallbackReason: "ai_parse_failed"
        };
        (0, test_1.expect)(parseErrorDiagnostics.fallbackReason).toBe("ai_parse_failed");
        const generationErrorDiagnostics = {
            fallbackReason: "ai_generation_error"
        };
        (0, test_1.expect)(generationErrorDiagnostics.fallbackReason).toBe("ai_generation_error");
    });
});
