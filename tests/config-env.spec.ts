import { test, expect } from "@playwright/test";
import { config, requireTestRailConfig } from "../src/config/env";

test.describe("TestRail environment variables and fallback verification", () => {
  test("TESTRAIL_SECTION_ID is loaded successfully if present", () => {
    expect(config.integrations.testRail?.sectionId).toBe(process.env.TESTRAIL_SECTION_ID);
  });

  test("requireTestRailConfig extracts the runtime fields correctly", () => {
    const runtimeConfig = requireTestRailConfig(config);
    expect(runtimeConfig.url).toBe(config.integrations.testRail?.url?.replace(/\/+$/, ""));
    expect(runtimeConfig.email).toBe(config.integrations.testRail?.email);
    expect(runtimeConfig.apiKey).toBe(config.integrations.testRail?.apiKey);
  });
});

test.describe("Codex auto-repair environment variables", () => {
  test("CODEX_AUTO_REPAIR_PROMPT_MODE is loaded from env", () => {
    const mode = config.integrations.codex?.autoRepairPromptMode;
    expect(mode).toBeDefined();
    expect(["compact", "verbose"]).toContain(mode);
  });

  test("CODEX_AUTO_REPAIR_TIMEOUT_MS is loaded from env", () => {
    const timeout = config.integrations.codex?.autoRepairTimeoutMs;
    if (process.env.CODEX_AUTO_REPAIR_TIMEOUT_MS) {
      expect(timeout).toBe(Number(process.env.CODEX_AUTO_REPAIR_TIMEOUT_MS));
    }
  });

  test("default promptMode is compact when env var is not set", () => {
    const mode = config.integrations.codex?.autoRepairPromptMode;
    if (!process.env.CODEX_AUTO_REPAIR_PROMPT_MODE) {
      expect(mode).toBe("compact");
    }
  });
});

test.describe("AI-assisted discovery environment variables", () => {
  test("AGENT_PROVIDER is normalized when present", () => {
    const provider = config.integrations.ai?.agentProvider;
    if (process.env.AGENT_PROVIDER) {
      expect(provider).toBe(process.env.AGENT_PROVIDER.toLowerCase());
    }
  });

  test("AI discovery thresholds have defaults", () => {
    expect(config.integrations.ai?.discoveryConfidenceThreshold).toBeGreaterThan(0);
    expect(config.integrations.ai?.discoveryRequireApprovalThreshold).toBeGreaterThan(0);
    expect(config.integrations.ai?.discoveryMaxAttempts).toBeGreaterThan(0);
  });
});
