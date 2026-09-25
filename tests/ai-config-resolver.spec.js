"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const ai_config_resolver_1 = require("../src/ai/ai-config-resolver");
function withEnv(values, fn) {
    const previous = {};
    for (const key of Object.keys(values)) {
        previous[key] = process.env[key];
        if (values[key] === undefined)
            delete process.env[key];
        else
            process.env[key] = values[key];
    }
    try {
        fn();
    }
    finally {
        for (const key of Object.keys(previous)) {
            if (previous[key] === undefined)
                delete process.env[key];
            else
                process.env[key] = previous[key];
        }
    }
}
test_1.test.describe("AI Config Resolver", () => {
    test_1.test.describe("resolveScenarioAiConfig", () => {
        (0, test_1.test)("should use AI_SCENARIO_* variables over AI_* fallback", () => {
            withEnv({
                AI_ENABLED: "true",
                AI_PROVIDER: "codex_cli",
                AI_MODEL: "codex",
                AI_TIMEOUT_MS: "30000",
                AI_SCENARIO_PROVIDER: "copilot_cli",
                AI_SCENARIO_MODEL: "claude-opus-4.8",
                AI_SCENARIO_TIMEOUT_MS: "240000",
                AI_SCENARIO_MAX_ATTEMPTS: "1",
            }, () => {
                const config = (0, ai_config_resolver_1.resolveScenarioAiConfig)();
                (0, test_1.expect)(config.provider).toBe("copilot_cli");
                (0, test_1.expect)(config.model).toBe("claude-opus-4.8");
                (0, test_1.expect)(config.timeoutMs).toBe(240000);
                (0, test_1.expect)(config.maxAttempts).toBe(1);
                (0, test_1.expect)(config.purpose).toBe("scenario_generation");
            });
        });
        (0, test_1.test)("should fall back to AI_* variables if AI_SCENARIO_* not set", () => {
            withEnv({
                AI_ENABLED: "true",
                AI_PROVIDER: "copilot_cli",
                AI_MODEL: "claude-sonnet-4.6",
                AI_TIMEOUT_MS: "60000",
                AI_SCENARIO_PROVIDER: undefined,
                AI_SCENARIO_MODEL: undefined,
                AI_SCENARIO_TIMEOUT_MS: undefined,
                AI_SCENARIO_MAX_ATTEMPTS: undefined,
            }, () => {
                const config = (0, ai_config_resolver_1.resolveScenarioAiConfig)();
                (0, test_1.expect)(config.provider).toBe("copilot_cli");
                (0, test_1.expect)(config.model).toBe("claude-sonnet-4.6");
                (0, test_1.expect)(config.timeoutMs).toBe(60000);
                (0, test_1.expect)(config.purpose).toBe("scenario_generation");
            });
        });
        (0, test_1.test)("should use default timeout if not specified", () => {
            withEnv({
                AI_ENABLED: "true",
                AI_PROVIDER: "copilot_cli",
                AI_MODEL: "claude-opus-4.8",
            }, () => {
                const config = (0, ai_config_resolver_1.resolveScenarioAiConfig)();
                (0, test_1.expect)(config.timeoutMs).toBe(240000); // Default for scenario generation
            });
        });
        (0, test_1.test)("should throw error if AI_PROVIDER not set", () => {
            withEnv({
                AI_ENABLED: "true",
                AI_PROVIDER: undefined,
                AI_SCENARIO_PROVIDER: undefined,
            }, () => {
                (0, test_1.expect)(() => (0, ai_config_resolver_1.resolveScenarioAiConfig)()).toThrow();
            });
        });
        (0, test_1.test)("should throw error if AI_MODEL not set", () => {
            withEnv({
                AI_ENABLED: "true",
                AI_PROVIDER: "copilot_cli",
                AI_MODEL: undefined,
                AI_SCENARIO_MODEL: undefined,
            }, () => {
                (0, test_1.expect)(() => (0, ai_config_resolver_1.resolveScenarioAiConfig)()).toThrow();
            });
        });
    });
    test_1.test.describe("resolveRepairAiConfig", () => {
        (0, test_1.test)("should use AI_REPAIR_* variables over AI_* fallback", () => {
            withEnv({
                AI_ENABLED: "true",
                AI_PROVIDER: "codex_cli",
                AI_MODEL: "codex",
                AI_TIMEOUT_MS: "120000",
                AI_REPAIR_PROVIDER: "copilot_cli",
                AI_REPAIR_MODEL: "claude-sonnet-4.6",
                AI_REPAIR_TIMEOUT_MS: "60000",
                AI_REPAIR_MAX_ATTEMPTS: "1",
            }, () => {
                const config = (0, ai_config_resolver_1.resolveRepairAiConfig)();
                (0, test_1.expect)(config.provider).toBe("copilot_cli");
                (0, test_1.expect)(config.model).toBe("claude-sonnet-4.6");
                (0, test_1.expect)(config.timeoutMs).toBe(60000);
                (0, test_1.expect)(config.maxAttempts).toBe(1);
                (0, test_1.expect)(config.purpose).toBe("repair");
            });
        });
        (0, test_1.test)("should fall back to AI_* variables if AI_REPAIR_* not set", () => {
            withEnv({
                AI_ENABLED: "true",
                AI_PROVIDER: "copilot_cli",
                AI_MODEL: "claude-sonnet-4.6",
                AI_TIMEOUT_MS: "30000",
                AI_REPAIR_PROVIDER: undefined,
                AI_REPAIR_MODEL: undefined,
                AI_REPAIR_TIMEOUT_MS: undefined,
                AI_REPAIR_MAX_ATTEMPTS: undefined,
            }, () => {
                const config = (0, ai_config_resolver_1.resolveRepairAiConfig)();
                (0, test_1.expect)(config.provider).toBe("copilot_cli");
                (0, test_1.expect)(config.model).toBe("claude-sonnet-4.6");
                (0, test_1.expect)(config.timeoutMs).toBe(30000);
                (0, test_1.expect)(config.purpose).toBe("repair");
            });
        });
        (0, test_1.test)("should use default timeout if not specified", () => {
            withEnv({
                AI_ENABLED: "true",
                AI_PROVIDER: "copilot_cli",
                AI_MODEL: "claude-sonnet-4.6",
                AI_SCENARIO_TIMEOUT_MS: undefined,
                AI_REPAIR_TIMEOUT_MS: undefined,
                AI_TIMEOUT_MS: undefined,
            }, () => {
                const config = (0, ai_config_resolver_1.resolveRepairAiConfig)();
                (0, test_1.expect)(config.timeoutMs).toBe(60000); // Default for repair
            });
        });
    });
    test_1.test.describe("resolveGeneralAiConfig", () => {
        (0, test_1.test)("should use AI_* variables", () => {
            withEnv({
                AI_ENABLED: "true",
                AI_PROVIDER: "copilot_cli",
                AI_MODEL: "claude-sonnet-4.6",
                AI_TIMEOUT_MS: "30000",
            }, () => {
                const config = (0, ai_config_resolver_1.resolveGeneralAiConfig)();
                (0, test_1.expect)(config.provider).toBe("copilot_cli");
                (0, test_1.expect)(config.model).toBe("claude-sonnet-4.6");
                (0, test_1.expect)(config.timeoutMs).toBe(30000);
                (0, test_1.expect)(config.purpose).toBe("general");
            });
        });
        (0, test_1.test)("should use default timeout if not specified", () => {
            withEnv({
                AI_ENABLED: "true",
                AI_PROVIDER: "copilot_cli",
                AI_MODEL: "claude-sonnet-4.6",
                AI_SCENARIO_TIMEOUT_MS: undefined,
                AI_REPAIR_TIMEOUT_MS: undefined,
                AI_TIMEOUT_MS: undefined,
            }, () => {
                const config = (0, ai_config_resolver_1.resolveGeneralAiConfig)();
                (0, test_1.expect)(config.timeoutMs).toBe(30000); // Default for general
            });
        });
    });
    test_1.test.describe("Provider Selection", () => {
        (0, test_1.test)("should support copilot_cli provider", () => {
            withEnv({
                AI_ENABLED: "true",
                AI_PROVIDER: "copilot_cli",
                AI_MODEL: "claude-opus-4.8",
                COPILOT_CLI_COMMAND: "copilot",
                COPILOT_CLI_EXTRA_ARGS: "--arg1 --arg2",
            }, () => {
                const config = (0, ai_config_resolver_1.resolveGeneralAiConfig)();
                (0, test_1.expect)(config.provider).toBe("copilot_cli");
                (0, test_1.expect)(config.command).toBe("copilot");
                (0, test_1.expect)(config.extraArgs).toEqual(["--arg1", "--arg2"]);
            });
        });
        (0, test_1.test)("should support codex_cli provider (legacy)", () => {
            withEnv({
                AI_ENABLED: "true",
                AI_PROVIDER: "codex_cli",
                AI_MODEL: "codex",
                CODEX_CLI_COMMAND: "codex",
                CODEX_CLI_EXTRA_ARGS: "--skip-git-repo-check",
            }, () => {
                const config = (0, ai_config_resolver_1.resolveGeneralAiConfig)();
                (0, test_1.expect)(config.provider).toBe("codex_cli");
                (0, test_1.expect)(config.command).toBe("codex");
                (0, test_1.expect)(config.extraArgs).toEqual(["--skip-git-repo-check"]);
            });
        });
        (0, test_1.test)("should support openai_compatible provider", () => {
            withEnv({
                AI_ENABLED: "true",
                AI_PROVIDER: "openai_compatible",
                AI_MODEL: "gpt-4",
                AI_BASE_URL: "https://api.openai.com/v1",
                AI_API_KEY: "sk-test",
            }, () => {
                const config = (0, ai_config_resolver_1.resolveGeneralAiConfig)();
                (0, test_1.expect)(config.provider).toBe("openai_compatible");
                (0, test_1.expect)(config.baseUrl).toBe("https://api.openai.com/v1");
                (0, test_1.expect)(config.apiKey).toBe("sk-test");
            });
        });
        (0, test_1.test)("should throw error for unsupported provider", () => {
            withEnv({
                AI_ENABLED: "true",
                AI_PROVIDER: "unsupported_provider",
                AI_MODEL: "some-model",
            }, () => {
                (0, test_1.expect)(() => (0, ai_config_resolver_1.resolveGeneralAiConfig)()).toThrow();
            });
        });
    });
    test_1.test.describe("Timeout Resolution", () => {
        (0, test_1.test)("should resolve scenario timeout independently from repair timeout", () => {
            withEnv({
                AI_ENABLED: "true",
                AI_PROVIDER: "copilot_cli",
                AI_MODEL: "claude-opus-4.8",
                AI_SCENARIO_TIMEOUT_MS: "240000",
                AI_REPAIR_TIMEOUT_MS: "60000",
            }, () => {
                const scenarioConfig = (0, ai_config_resolver_1.resolveScenarioAiConfig)();
                const repairConfig = (0, ai_config_resolver_1.resolveRepairAiConfig)();
                (0, test_1.expect)(scenarioConfig.timeoutMs).toBe(240000);
                (0, test_1.expect)(repairConfig.timeoutMs).toBe(60000);
            });
        });
    });
    test_1.test.describe("MaxAttempts Resolution", () => {
        (0, test_1.test)("should resolve scenario maxAttempts independently from repair maxAttempts", () => {
            withEnv({
                AI_ENABLED: "true",
                AI_PROVIDER: "copilot_cli",
                AI_MODEL: "claude-opus-4.8",
                AI_SCENARIO_MAX_ATTEMPTS: "2",
                AI_REPAIR_MAX_ATTEMPTS: "1",
            }, () => {
                const scenarioConfig = (0, ai_config_resolver_1.resolveScenarioAiConfig)();
                const repairConfig = (0, ai_config_resolver_1.resolveRepairAiConfig)();
                (0, test_1.expect)(scenarioConfig.maxAttempts).toBe(2);
                (0, test_1.expect)(repairConfig.maxAttempts).toBe(1);
            });
        });
        (0, test_1.test)("should default maxAttempts to 1", () => {
            withEnv({
                AI_ENABLED: "true",
                AI_PROVIDER: "copilot_cli",
                AI_MODEL: "claude-opus-4.8",
            }, () => {
                const config = (0, ai_config_resolver_1.resolveGeneralAiConfig)();
                (0, test_1.expect)(config.maxAttempts).toBe(1);
            });
        });
    });
    test_1.test.describe("Error Handling", () => {
        (0, test_1.test)("should throw clear error if provider is disabled", () => {
            withEnv({
                AI_ENABLED: "true",
                AI_PROVIDER: "disabled",
                AI_MODEL: "claude-opus-4.8",
            }, () => {
                (0, test_1.expect)(() => (0, ai_config_resolver_1.resolveGeneralAiConfig)()).toThrow();
            });
        });
        (0, test_1.test)("should throw clear error if AI is disabled", () => {
            withEnv({
                AI_ENABLED: "false",
            }, () => {
                (0, test_1.expect)(() => (0, ai_config_resolver_1.resolveGeneralAiConfig)()).toThrow();
            });
        });
        (0, test_1.test)("should throw error if openai_compatible missing baseUrl", () => {
            withEnv({
                AI_ENABLED: "true",
                AI_PROVIDER: "openai_compatible",
                AI_MODEL: "gpt-4",
                AI_BASE_URL: undefined,
                AI_API_KEY: "sk-test",
            }, () => {
                (0, test_1.expect)(() => (0, ai_config_resolver_1.resolveGeneralAiConfig)()).toThrow();
            });
        });
        (0, test_1.test)("should throw error if openai_compatible missing apiKey", () => {
            withEnv({
                AI_ENABLED: "true",
                AI_PROVIDER: "openai_compatible",
                AI_MODEL: "gpt-4",
                AI_BASE_URL: "https://api.openai.com/v1",
                AI_API_KEY: undefined,
            }, () => {
                (0, test_1.expect)(() => (0, ai_config_resolver_1.resolveGeneralAiConfig)()).toThrow();
            });
        });
    });
});
