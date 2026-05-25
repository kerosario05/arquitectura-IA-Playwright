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
    expect(["compact", "verbose", "disabled"]).toContain(mode);
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

test.describe("App profile environment variables", () => {
  test("APP_PROFILE and APP_NAME are loaded when present", () => {
    if (process.env.APP_PROFILE) {
      expect(config.app.appProfile).toBeDefined();
    }
    if (process.env.APP_NAME) {
      expect(config.app.name).toBe(process.env.APP_NAME);
    }
  });
});

test.describe("MISSING_INPUT_BEHAVIOR parsing", () => {
  test("parseMissingInputBehavior accepts auto_generate", () => {
    const { parseMissingInputBehavior } = require("../src/config/env");
    expect(parseMissingInputBehavior("auto_generate")).toBe("auto_generate");
  });

  test("parseMissingInputBehavior accepts fail, prompt, skip", () => {
    const { parseMissingInputBehavior } = require("../src/config/env");
    expect(parseMissingInputBehavior("fail")).toBe("fail");
    expect(parseMissingInputBehavior("prompt")).toBe("prompt");
    expect(parseMissingInputBehavior("skip")).toBe("skip");
  });

  test("parseMissingInputBehavior rejects invalid values", () => {
    const { parseMissingInputBehavior } = require("../src/config/env");
    expect(() => parseMissingInputBehavior("invalid")).toThrow("Invalid MISSING_INPUT_BEHAVIOR value");
    expect(() => parseMissingInputBehavior("auto")).toThrow("Invalid MISSING_INPUT_BEHAVIOR value");
  });

  test("parseMissingInputBehavior defaults to fail when undefined", () => {
    const { parseMissingInputBehavior } = require("../src/config/env");
    expect(parseMissingInputBehavior(undefined)).toBe("fail");
    expect(parseMissingInputBehavior("")).toBe("fail");
  });

  test("config.app.missingInputBehavior accepts auto_generate from env", () => {
    if (process.env.MISSING_INPUT_BEHAVIOR === "auto_generate") {
      expect(config.app.missingInputBehavior).toBe("auto_generate");
    }
  });
});

test.describe("Auto-Test-Data configuration parsing", () => {
  test("parseAutoGenerateTestData accepts true", () => {
    const { parseAutoGenerateTestData } = require("../src/config/env");
    expect(parseAutoGenerateTestData("true")).toBe(true);
    expect(parseAutoGenerateTestData("TRUE")).toBe(true);
  });

  test("parseAutoGenerateTestData accepts false", () => {
    const { parseAutoGenerateTestData } = require("../src/config/env");
    expect(parseAutoGenerateTestData("false")).toBe(false);
    expect(parseAutoGenerateTestData("FALSE")).toBe(false);
  });

  test("parseAutoGenerateTestData defaults to false", () => {
    const { parseAutoGenerateTestData } = require("../src/config/env");
    expect(parseAutoGenerateTestData(undefined)).toBe(false);
    expect(parseAutoGenerateTestData("")).toBe(false);
  });

  test("parseAutoGenerateTestData rejects invalid values", () => {
    const { parseAutoGenerateTestData } = require("../src/config/env");
    expect(() => parseAutoGenerateTestData("invalid")).toThrow("Invalid AUTO_GENERATE_TEST_DATA value");
    expect(() => parseAutoGenerateTestData("1")).toThrow("Invalid AUTO_GENERATE_TEST_DATA value");
  });

  test("parseAutoGenerateSensitiveData accepts false", () => {
    const { parseAutoGenerateSensitiveData } = require("../src/config/env");
    expect(parseAutoGenerateSensitiveData("false")).toBe(false);
  });

  test("parseAutoGenerateSensitiveData defaults to false", () => {
    const { parseAutoGenerateSensitiveData } = require("../src/config/env");
    expect(parseAutoGenerateSensitiveData(undefined)).toBe(false);
  });

  test("parseTestDataProfile accepts demo", () => {
    const { parseTestDataProfile } = require("../src/config/env");
    expect(parseTestDataProfile("demo")).toBe("demo");
    expect(parseTestDataProfile("DEMO")).toBe("demo");
  });

  test("parseTestDataProfile accepts qa", () => {
    const { parseTestDataProfile } = require("../src/config/env");
    expect(parseTestDataProfile("qa")).toBe("qa");
  });

  test("parseTestDataProfile accepts staging", () => {
    const { parseTestDataProfile } = require("../src/config/env");
    expect(parseTestDataProfile("staging")).toBe("staging");
  });

  test("parseTestDataProfile accepts production_like", () => {
    const { parseTestDataProfile } = require("../src/config/env");
    expect(parseTestDataProfile("production_like")).toBe("production_like");
  });

  test("parseTestDataProfile defaults to qa", () => {
    const { parseTestDataProfile } = require("../src/config/env");
    expect(parseTestDataProfile(undefined)).toBe("qa");
    expect(parseTestDataProfile("")).toBe("qa");
  });

  test("parseTestDataProfile rejects invalid values", () => {
    const { parseTestDataProfile } = require("../src/config/env");
    expect(() => parseTestDataProfile("invalid")).toThrow("Invalid APP_TEST_DATA_PROFILE value");
    expect(() => parseTestDataProfile("prod")).toThrow("Invalid APP_TEST_DATA_PROFILE value");
  });

  test("parseAutoSelectSafeDefaults defaults to false", () => {
    const { parseAutoSelectSafeDefaults } = require("../src/config/env");
    expect(parseAutoSelectSafeDefaults(undefined)).toBe(false);
    expect(parseAutoSelectSafeDefaults("false")).toBe(false);
  });

  test("parseAutoAcceptSafeCheckboxes defaults to false", () => {
    const { parseAutoAcceptSafeCheckboxes } = require("../src/config/env");
    expect(parseAutoAcceptSafeCheckboxes(undefined)).toBe(false);
    expect(parseAutoAcceptSafeCheckboxes("false")).toBe(false);
  });

  test("config.app exports auto-generate fields when env is set", () => {
    if (process.env.AUTO_GENERATE_TEST_DATA === "true") {
      expect(config.app.autoGenerateTestData).toBe(true);
    }
    if (process.env.APP_TEST_DATA_PROFILE === "demo") {
      expect(config.app.testDataProfile).toBe("demo");
    }
  });
});
