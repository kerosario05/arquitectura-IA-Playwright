import { test, expect } from "@playwright/test";
import { resolveAiConfig, resolveScenarioAiConfig, resolveRepairAiConfig, resolveGeneralAiConfig } from "../src/ai/ai-config-resolver";
import { AiProviderError } from "../src/ai/ai-provider.types";

function withEnv(values: Record<string, string | undefined>, fn: () => void): void {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test.describe("AI Config Resolver", () => {
  test.describe("resolveScenarioAiConfig", () => {
    test("should use AI_SCENARIO_* variables over AI_* fallback", () => {
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
        const config = resolveScenarioAiConfig();

        expect(config.provider).toBe("copilot_cli");
        expect(config.model).toBe("claude-opus-4.8");
        expect(config.timeoutMs).toBe(240000);
        expect(config.maxAttempts).toBe(1);
        expect(config.purpose).toBe("scenario_generation");
      });
    });

    test("should fall back to AI_* variables if AI_SCENARIO_* not set", () => {
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
        const config = resolveScenarioAiConfig();

        expect(config.provider).toBe("copilot_cli");
        expect(config.model).toBe("claude-sonnet-4.6");
        expect(config.timeoutMs).toBe(60000);
        expect(config.purpose).toBe("scenario_generation");
      });
    });

    test("should use default timeout if not specified", () => {
      withEnv({
        AI_ENABLED: "true",
        AI_PROVIDER: "copilot_cli",
        AI_MODEL: "claude-opus-4.8",
      }, () => {
        const config = resolveScenarioAiConfig();

        expect(config.timeoutMs).toBe(240000); // Default for scenario generation
      });
    });

    test("should throw error if AI_PROVIDER not set", () => {
      withEnv({
        AI_ENABLED: "true",
        AI_PROVIDER: undefined,
        AI_SCENARIO_PROVIDER: undefined,
      }, () => {
        expect(() => resolveScenarioAiConfig()).toThrow();
      });
    });

    test("should throw error if AI_MODEL not set", () => {
      withEnv({
        AI_ENABLED: "true",
        AI_PROVIDER: "copilot_cli",
        AI_MODEL: undefined,
        AI_SCENARIO_MODEL: undefined,
      }, () => {
        expect(() => resolveScenarioAiConfig()).toThrow();
      });
    });
  });

  test.describe("resolveRepairAiConfig", () => {
    test("should use AI_REPAIR_* variables over AI_* fallback", () => {
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
        const config = resolveRepairAiConfig();

        expect(config.provider).toBe("copilot_cli");
        expect(config.model).toBe("claude-sonnet-4.6");
        expect(config.timeoutMs).toBe(60000);
        expect(config.maxAttempts).toBe(1);
        expect(config.purpose).toBe("repair");
      });
    });

    test("should fall back to AI_* variables if AI_REPAIR_* not set", () => {
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
        const config = resolveRepairAiConfig();

        expect(config.provider).toBe("copilot_cli");
        expect(config.model).toBe("claude-sonnet-4.6");
        expect(config.timeoutMs).toBe(30000);
        expect(config.purpose).toBe("repair");
      });
    });

    test("should use default timeout if not specified", () => {
      withEnv({
        AI_ENABLED: "true",
        AI_PROVIDER: "copilot_cli",
        AI_MODEL: "claude-sonnet-4.6",
        AI_SCENARIO_TIMEOUT_MS: undefined,
        AI_REPAIR_TIMEOUT_MS: undefined,
        AI_TIMEOUT_MS: undefined,
      }, () => {
        const config = resolveRepairAiConfig();

        expect(config.timeoutMs).toBe(60000); // Default for repair
      });
    });
  });

  test.describe("resolveGeneralAiConfig", () => {
    test("should use AI_* variables", () => {
      withEnv({
        AI_ENABLED: "true",
        AI_PROVIDER: "copilot_cli",
        AI_MODEL: "claude-sonnet-4.6",
        AI_TIMEOUT_MS: "30000",
      }, () => {
        const config = resolveGeneralAiConfig();

        expect(config.provider).toBe("copilot_cli");
        expect(config.model).toBe("claude-sonnet-4.6");
        expect(config.timeoutMs).toBe(30000);
        expect(config.purpose).toBe("general");
      });
    });

    test("should use default timeout if not specified", () => {
      withEnv({
        AI_ENABLED: "true",
        AI_PROVIDER: "copilot_cli",
        AI_MODEL: "claude-sonnet-4.6",
        AI_SCENARIO_TIMEOUT_MS: undefined,
        AI_REPAIR_TIMEOUT_MS: undefined,
        AI_TIMEOUT_MS: undefined,
      }, () => {
        const config = resolveGeneralAiConfig();

        expect(config.timeoutMs).toBe(30000); // Default for general
      });
    });
  });

  test.describe("Provider Selection", () => {
    test("should support copilot_cli provider", () => {
      withEnv({
        AI_ENABLED: "true",
        AI_PROVIDER: "copilot_cli",
        AI_MODEL: "claude-opus-4.8",
        COPILOT_CLI_COMMAND: "copilot",
        COPILOT_CLI_EXTRA_ARGS: "--arg1 --arg2",
      }, () => {
        const config = resolveGeneralAiConfig();

        expect(config.provider).toBe("copilot_cli");
        expect(config.command).toBe("copilot");
        expect(config.extraArgs).toEqual(["--arg1", "--arg2"]);
      });
    });

    test("should support codex_cli provider (legacy)", () => {
      withEnv({
        AI_ENABLED: "true",
        AI_PROVIDER: "codex_cli",
        AI_MODEL: "codex",
        CODEX_CLI_COMMAND: "codex",
        CODEX_CLI_EXTRA_ARGS: "--skip-git-repo-check",
      }, () => {
        const config = resolveGeneralAiConfig();

        expect(config.provider).toBe("codex_cli");
        expect(config.command).toBe("codex");
        expect(config.extraArgs).toEqual(["--skip-git-repo-check"]);
      });
    });

    test("should support openai_compatible provider", () => {
      withEnv({
        AI_ENABLED: "true",
        AI_PROVIDER: "openai_compatible",
        AI_MODEL: "gpt-4",
        AI_BASE_URL: "https://api.openai.com/v1",
        AI_API_KEY: "sk-test",
      }, () => {
        const config = resolveGeneralAiConfig();

        expect(config.provider).toBe("openai_compatible");
        expect(config.baseUrl).toBe("https://api.openai.com/v1");
        expect(config.apiKey).toBe("sk-test");
      });
    });

    test("should throw error for unsupported provider", () => {
      withEnv({
        AI_ENABLED: "true",
        AI_PROVIDER: "unsupported_provider",
        AI_MODEL: "some-model",
      }, () => {
        expect(() => resolveGeneralAiConfig()).toThrow();
      });
    });
  });

  test.describe("Timeout Resolution", () => {
    test("should resolve scenario timeout independently from repair timeout", () => {
      withEnv({
        AI_ENABLED: "true",
        AI_PROVIDER: "copilot_cli",
        AI_MODEL: "claude-opus-4.8",
        AI_SCENARIO_TIMEOUT_MS: "240000",
        AI_REPAIR_TIMEOUT_MS: "60000",
      }, () => {
        const scenarioConfig = resolveScenarioAiConfig();
        const repairConfig = resolveRepairAiConfig();

        expect(scenarioConfig.timeoutMs).toBe(240000);
        expect(repairConfig.timeoutMs).toBe(60000);
      });
    });
  });

  test.describe("MaxAttempts Resolution", () => {
    test("should resolve scenario maxAttempts independently from repair maxAttempts", () => {
      withEnv({
        AI_ENABLED: "true",
        AI_PROVIDER: "copilot_cli",
        AI_MODEL: "claude-opus-4.8",
        AI_SCENARIO_MAX_ATTEMPTS: "2",
        AI_REPAIR_MAX_ATTEMPTS: "1",
      }, () => {
        const scenarioConfig = resolveScenarioAiConfig();
        const repairConfig = resolveRepairAiConfig();

        expect(scenarioConfig.maxAttempts).toBe(2);
        expect(repairConfig.maxAttempts).toBe(1);
      });
    });

    test("should default maxAttempts to 1", () => {
      withEnv({
        AI_ENABLED: "true",
        AI_PROVIDER: "copilot_cli",
        AI_MODEL: "claude-opus-4.8",
      }, () => {
        const config = resolveGeneralAiConfig();

        expect(config.maxAttempts).toBe(1);
      });
    });
  });

  test.describe("Error Handling", () => {
    test("should throw clear error if provider is disabled", () => {
      withEnv({
        AI_ENABLED: "true",
        AI_PROVIDER: "disabled",
        AI_MODEL: "claude-opus-4.8",
      }, () => {
        expect(() => resolveGeneralAiConfig()).toThrow();
      });
    });

    test("should throw clear error if AI is disabled", () => {
      withEnv({
        AI_ENABLED: "false",
      }, () => {
        expect(() => resolveGeneralAiConfig()).toThrow();
      });
    });

    test("should throw error if openai_compatible missing baseUrl", () => {
      withEnv({
        AI_ENABLED: "true",
        AI_PROVIDER: "openai_compatible",
        AI_MODEL: "gpt-4",
        AI_BASE_URL: undefined,
        AI_API_KEY: "sk-test",
      }, () => {
        expect(() => resolveGeneralAiConfig()).toThrow();
      });
    });

    test("should throw error if openai_compatible missing apiKey", () => {
      withEnv({
        AI_ENABLED: "true",
        AI_PROVIDER: "openai_compatible",
        AI_MODEL: "gpt-4",
        AI_BASE_URL: "https://api.openai.com/v1",
        AI_API_KEY: undefined,
      }, () => {
        expect(() => resolveGeneralAiConfig()).toThrow();
      });
    });
  });
});
