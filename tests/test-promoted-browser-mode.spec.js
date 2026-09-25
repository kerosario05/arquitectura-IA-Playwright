"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const test_promoted_browser_mode_1 = require("../src/cli/test-promoted-browser-mode");
const test_promoted_1 = require("../src/cli/test-promoted");
(0, test_1.test)("promoted execution uses project URL over global APP_BASE_URL without mutation", () => {
    const baseEnv = { APP_BASE_URL: "https://legacy.example" };
    const childEnv = (0, test_promoted_1.buildPromotedExecutionEnv)(baseEnv, "portalempresarial");
    (0, test_1.expect)(childEnv.APP_BASE_URL).toBe("https://172.27.4.31/login");
    (0, test_1.expect)(baseEnv.APP_BASE_URL).toBe("https://legacy.example");
});
(0, test_1.test)("promoted execution keeps project environments isolated", () => {
    const baseEnv = { APP_BASE_URL: "https://legacy.example" };
    const projectA = (0, test_promoted_1.buildPromotedExecutionEnv)(baseEnv, "portalempresarial");
    const projectB = (0, test_promoted_1.buildPromotedExecutionEnv)({ ...baseEnv, APP_BASE_URL: "https://project-b.example/login" }, "missing-project");
    (0, test_1.expect)(projectA.APP_BASE_URL).toBe("https://172.27.4.31/login");
    (0, test_1.expect)(projectB.APP_BASE_URL).toBe("https://project-b.example/login");
    (0, test_1.expect)(baseEnv.APP_BASE_URL).toBe("https://legacy.example");
});
(0, test_1.test)("browser mode: explicit --headed has top priority", () => {
    const resolved = (0, test_promoted_browser_mode_1.resolvePromotedBrowserMode)({
        headedFlag: true,
        headlessFlag: true,
        automationHeadless: "true",
        automationSource: "qa_lab_automatic",
    });
    (0, test_1.expect)(resolved).toEqual({
        mode: "headed",
        source: "explicit_cli_flag",
    });
});
(0, test_1.test)("browser mode: explicit --headless is honored", () => {
    const resolved = (0, test_promoted_browser_mode_1.resolvePromotedBrowserMode)({
        headedFlag: false,
        headlessFlag: true,
        automationHeadless: undefined,
        automationSource: undefined,
    });
    (0, test_1.expect)(resolved).toEqual({
        mode: "headless",
        source: "explicit_cli_flag",
    });
});
(0, test_1.test)("browser mode: automatic QA Lab run resolves to headless", () => {
    const resolved = (0, test_promoted_browser_mode_1.resolvePromotedBrowserMode)({
        headedFlag: false,
        headlessFlag: false,
        automationHeadless: "true",
        automationSource: "qa_lab_automatic",
    });
    (0, test_1.expect)(resolved).toEqual({
        mode: "headless",
        source: "qa_lab_automatic",
    });
});
(0, test_1.test)("browser mode: no explicit flag keeps config mode", () => {
    const resolved = (0, test_promoted_browser_mode_1.resolvePromotedBrowserMode)({
        headedFlag: false,
        headlessFlag: false,
        automationHeadless: "false",
        automationSource: undefined,
    });
    (0, test_1.expect)(resolved).toEqual({
        mode: "config",
        source: "default_config",
    });
});
(0, test_1.test)("apply mode: headless forces HEADLESS=true and removes PWDEBUG", () => {
    const applied = (0, test_promoted_browser_mode_1.applyPromotedBrowserMode)({
        playwrightArgs: ["automations/apps", "--workers=1"],
        baseEnv: {
            HEADLESS: "false",
            PWDEBUG: "1",
        },
        browserMode: {
            mode: "headless",
            source: "qa_lab_automatic",
        },
    });
    (0, test_1.expect)(applied.playwrightArgs).toEqual(["automations/apps", "--workers=1"]);
    (0, test_1.expect)(applied.playwrightEnv.HEADLESS).toBe("true");
    (0, test_1.expect)(applied.playwrightEnv.PWDEBUG).toBeUndefined();
});
(0, test_1.test)("apply mode: headed appends --headed and sets HEADLESS=false", () => {
    const applied = (0, test_promoted_browser_mode_1.applyPromotedBrowserMode)({
        playwrightArgs: ["automations/apps", "--workers=1"],
        baseEnv: {
            HEADLESS: "true",
        },
        browserMode: {
            mode: "headed",
            source: "explicit_cli_flag",
        },
    });
    (0, test_1.expect)(applied.playwrightArgs).toEqual(["automations/apps", "--workers=1", "--headed"]);
    (0, test_1.expect)(applied.playwrightEnv.HEADLESS).toBe("false");
});
