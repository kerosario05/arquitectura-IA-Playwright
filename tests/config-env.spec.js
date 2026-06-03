"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const env_1 = require("../src/config/env");
test_1.test.describe("TestRail environment variables and fallback verification", () => {
    (0, test_1.test)("TESTRAIL_SECTION_ID is loaded successfully if present", () => {
        (0, test_1.expect)(env_1.config.integrations.testRail?.sectionId).toBe(process.env.TESTRAIL_SECTION_ID);
    });
    (0, test_1.test)("requireTestRailConfig extracts the runtime fields correctly", () => {
        const runtimeConfig = (0, env_1.requireTestRailConfig)(env_1.config);
        (0, test_1.expect)(runtimeConfig.url).toBe(env_1.config.integrations.testRail?.url?.replace(/\/+$/, ""));
        (0, test_1.expect)(runtimeConfig.email).toBe(env_1.config.integrations.testRail?.email);
        (0, test_1.expect)(runtimeConfig.apiKey).toBe(env_1.config.integrations.testRail?.apiKey);
    });
});
test_1.test.describe("Codex auto-repair environment variables", () => {
    (0, test_1.test)("CODEX_AUTO_REPAIR_PROMPT_MODE is loaded from env", () => {
        const mode = env_1.config.integrations.codex?.autoRepairPromptMode;
        (0, test_1.expect)(mode).toBeDefined();
        (0, test_1.expect)(["compact", "verbose", "disabled"]).toContain(mode);
    });
    (0, test_1.test)("CODEX_AUTO_REPAIR_TIMEOUT_MS is loaded from env", () => {
        const timeout = env_1.config.integrations.codex?.autoRepairTimeoutMs;
        if (process.env.CODEX_AUTO_REPAIR_TIMEOUT_MS) {
            (0, test_1.expect)(timeout).toBe(Number(process.env.CODEX_AUTO_REPAIR_TIMEOUT_MS));
        }
    });
    (0, test_1.test)("default promptMode is compact when env var is not set", () => {
        const mode = env_1.config.integrations.codex?.autoRepairPromptMode;
        if (!process.env.CODEX_AUTO_REPAIR_PROMPT_MODE) {
            (0, test_1.expect)(mode).toBe("compact");
        }
    });
});
test_1.test.describe("AI-assisted discovery environment variables", () => {
    (0, test_1.test)("AGENT_PROVIDER is normalized when present", () => {
        const provider = env_1.config.integrations.ai?.agentProvider;
        if (process.env.AGENT_PROVIDER) {
            (0, test_1.expect)(provider).toBe(process.env.AGENT_PROVIDER.toLowerCase());
        }
    });
    (0, test_1.test)("AI discovery thresholds have defaults", () => {
        (0, test_1.expect)(env_1.config.integrations.ai?.discoveryConfidenceThreshold).toBeGreaterThan(0);
        (0, test_1.expect)(env_1.config.integrations.ai?.discoveryRequireApprovalThreshold).toBeGreaterThan(0);
        (0, test_1.expect)(env_1.config.integrations.ai?.discoveryMaxAttempts).toBeGreaterThan(0);
    });
});
test_1.test.describe("App profile environment variables", () => {
    (0, test_1.test)("APP_PROFILE and APP_NAME are loaded when present", () => {
        if (process.env.APP_PROFILE) {
            (0, test_1.expect)(env_1.config.app.appProfile).toBeDefined();
        }
        if (process.env.APP_NAME) {
            (0, test_1.expect)(env_1.config.app.name).toBe(process.env.APP_NAME);
        }
    });
});
test_1.test.describe("MISSING_INPUT_BEHAVIOR parsing", () => {
    (0, test_1.test)("parseMissingInputBehavior accepts auto_generate", () => {
        const { parseMissingInputBehavior } = require("../src/config/env");
        (0, test_1.expect)(parseMissingInputBehavior("auto_generate")).toBe("auto_generate");
    });
    (0, test_1.test)("parseMissingInputBehavior accepts fail, prompt, skip", () => {
        const { parseMissingInputBehavior } = require("../src/config/env");
        (0, test_1.expect)(parseMissingInputBehavior("fail")).toBe("fail");
        (0, test_1.expect)(parseMissingInputBehavior("prompt")).toBe("prompt");
        (0, test_1.expect)(parseMissingInputBehavior("skip")).toBe("skip");
    });
    (0, test_1.test)("parseMissingInputBehavior rejects invalid values", () => {
        const { parseMissingInputBehavior } = require("../src/config/env");
        (0, test_1.expect)(() => parseMissingInputBehavior("invalid")).toThrow("Invalid MISSING_INPUT_BEHAVIOR value");
        (0, test_1.expect)(() => parseMissingInputBehavior("auto")).toThrow("Invalid MISSING_INPUT_BEHAVIOR value");
    });
    (0, test_1.test)("parseMissingInputBehavior defaults to fail when undefined", () => {
        const { parseMissingInputBehavior } = require("../src/config/env");
        (0, test_1.expect)(parseMissingInputBehavior(undefined)).toBe("fail");
        (0, test_1.expect)(parseMissingInputBehavior("")).toBe("fail");
    });
    (0, test_1.test)("config.app.missingInputBehavior accepts auto_generate from env", () => {
        if (process.env.MISSING_INPUT_BEHAVIOR === "auto_generate") {
            (0, test_1.expect)(env_1.config.app.missingInputBehavior).toBe("auto_generate");
        }
    });
});
test_1.test.describe("Auto-Test-Data configuration parsing", () => {
    (0, test_1.test)("parseAutoGenerateTestData accepts true", () => {
        const { parseAutoGenerateTestData } = require("../src/config/env");
        (0, test_1.expect)(parseAutoGenerateTestData("true")).toBe(true);
        (0, test_1.expect)(parseAutoGenerateTestData("TRUE")).toBe(true);
    });
    (0, test_1.test)("parseAutoGenerateTestData accepts false", () => {
        const { parseAutoGenerateTestData } = require("../src/config/env");
        (0, test_1.expect)(parseAutoGenerateTestData("false")).toBe(false);
        (0, test_1.expect)(parseAutoGenerateTestData("FALSE")).toBe(false);
    });
    (0, test_1.test)("parseAutoGenerateTestData defaults to false", () => {
        const { parseAutoGenerateTestData } = require("../src/config/env");
        (0, test_1.expect)(parseAutoGenerateTestData(undefined)).toBe(false);
        (0, test_1.expect)(parseAutoGenerateTestData("")).toBe(false);
    });
    (0, test_1.test)("parseAutoGenerateTestData rejects invalid values", () => {
        const { parseAutoGenerateTestData } = require("../src/config/env");
        (0, test_1.expect)(() => parseAutoGenerateTestData("invalid")).toThrow("Invalid AUTO_GENERATE_TEST_DATA value");
        (0, test_1.expect)(() => parseAutoGenerateTestData("1")).toThrow("Invalid AUTO_GENERATE_TEST_DATA value");
    });
    (0, test_1.test)("parseAutoGenerateSensitiveData accepts false", () => {
        const { parseAutoGenerateSensitiveData } = require("../src/config/env");
        (0, test_1.expect)(parseAutoGenerateSensitiveData("false")).toBe(false);
    });
    (0, test_1.test)("parseAutoGenerateSensitiveData defaults to false", () => {
        const { parseAutoGenerateSensitiveData } = require("../src/config/env");
        (0, test_1.expect)(parseAutoGenerateSensitiveData(undefined)).toBe(false);
    });
    (0, test_1.test)("parseTestDataProfile accepts demo", () => {
        const { parseTestDataProfile } = require("../src/config/env");
        (0, test_1.expect)(parseTestDataProfile("demo")).toBe("demo");
        (0, test_1.expect)(parseTestDataProfile("DEMO")).toBe("demo");
    });
    (0, test_1.test)("parseTestDataProfile accepts qa", () => {
        const { parseTestDataProfile } = require("../src/config/env");
        (0, test_1.expect)(parseTestDataProfile("qa")).toBe("qa");
    });
    (0, test_1.test)("parseTestDataProfile accepts staging", () => {
        const { parseTestDataProfile } = require("../src/config/env");
        (0, test_1.expect)(parseTestDataProfile("staging")).toBe("staging");
    });
    (0, test_1.test)("parseTestDataProfile accepts production_like", () => {
        const { parseTestDataProfile } = require("../src/config/env");
        (0, test_1.expect)(parseTestDataProfile("production_like")).toBe("production_like");
    });
    (0, test_1.test)("parseTestDataProfile defaults to qa", () => {
        const { parseTestDataProfile } = require("../src/config/env");
        (0, test_1.expect)(parseTestDataProfile(undefined)).toBe("qa");
        (0, test_1.expect)(parseTestDataProfile("")).toBe("qa");
    });
    (0, test_1.test)("parseTestDataProfile rejects invalid values", () => {
        const { parseTestDataProfile } = require("../src/config/env");
        (0, test_1.expect)(() => parseTestDataProfile("invalid")).toThrow("Invalid APP_TEST_DATA_PROFILE value");
        (0, test_1.expect)(() => parseTestDataProfile("prod")).toThrow("Invalid APP_TEST_DATA_PROFILE value");
    });
    (0, test_1.test)("parseAutoSelectSafeDefaults defaults to false", () => {
        const { parseAutoSelectSafeDefaults } = require("../src/config/env");
        (0, test_1.expect)(parseAutoSelectSafeDefaults(undefined)).toBe(false);
        (0, test_1.expect)(parseAutoSelectSafeDefaults("false")).toBe(false);
    });
    (0, test_1.test)("parseAutoAcceptSafeCheckboxes defaults to false", () => {
        const { parseAutoAcceptSafeCheckboxes } = require("../src/config/env");
        (0, test_1.expect)(parseAutoAcceptSafeCheckboxes(undefined)).toBe(false);
        (0, test_1.expect)(parseAutoAcceptSafeCheckboxes("false")).toBe(false);
    });
    (0, test_1.test)("config.app exports auto-generate fields when env is set", () => {
        if (process.env.AUTO_GENERATE_TEST_DATA === "true") {
            (0, test_1.expect)(env_1.config.app.autoGenerateTestData).toBe(true);
        }
        if (process.env.APP_TEST_DATA_PROFILE === "demo") {
            (0, test_1.expect)(env_1.config.app.testDataProfile).toBe("demo");
        }
    });
});
