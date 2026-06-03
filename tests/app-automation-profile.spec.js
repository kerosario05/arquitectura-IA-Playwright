"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const app_profile_1 = require("../src/automations/app-profile");
function makeConfig(overrides) {
    return {
        app: {
            name: "Generic Banking App",
            appProfile: "profile-a",
            baseUrl: "https://app-a.example.test",
            loginMode: "password",
            username: "demo-user",
            password: "demo-pass",
            extraLoginFields: { tenant: "main", secretCode: "1234" },
            testData: { account: "001" },
            testDataAliases: { account: ["acc"] },
            missingInputBehavior: "fail",
            ...overrides
        },
        execution: {
            browser: "chromium",
            headless: true,
            evidenceDir: ".artifacts/evidence",
            defaultTimeoutMs: 30000
        },
        integrations: {}
    };
}
(0, test_1.test)("normalizeAppSlug cleans accents, spaces and symbols", () => {
    (0, test_1.expect)((0, app_profile_1.normalizeAppSlug)("  Módulo Pagos / QA  ")).toBe("modulo-pagos-qa");
});
(0, test_1.test)("deriveAppProfile uses APP_PROFILE when present", () => {
    const profile = (0, app_profile_1.deriveAppProfile)({
        appProfile: "Custom Profile",
        appName: "Ignored Name",
        baseUrl: "https://example.test"
    });
    (0, test_1.expect)(profile.appSlug).toBe("custom-profile");
});
(0, test_1.test)("deriveAppProfile derives from baseUrl when APP_PROFILE is missing", () => {
    const profile = (0, app_profile_1.deriveAppProfile)({
        appProfile: "",
        appName: "",
        baseUrl: "https://portal.internal.example.test"
    });
    (0, test_1.expect)(profile.appSlug).toBe("example");
});
(0, test_1.test)("buildAppAutomationPaths creates per-app directories", () => {
    const profile = (0, app_profile_1.deriveAppProfile)({ appProfile: "qa-web", baseUrl: "https://example.test" });
    const paths = (0, app_profile_1.buildAppAutomationPaths)(profile, "auto-1");
    (0, test_1.expect)(paths.appDir.replace(/\\/g, "/")).toContain("automations/apps/qa-web");
    (0, test_1.expect)(paths.casesDir).toContain("cases");
    (0, test_1.expect)(paths.caseDir).toContain("auto-1");
    (0, test_1.expect)(paths.caseConfigPath).toContain("case.json");
    (0, test_1.expect)(paths.configPath).toContain("app.config.json");
    (0, test_1.expect)(paths.planPath).toContain("plan.json");
    (0, test_1.expect)(paths.specPath).toContain("spec.ts");
    (0, test_1.expect)(paths.runsDir).toContain("runs");
    (0, test_1.expect)(paths.evidenceDir).toContain("evidence");
});
(0, test_1.test)("serializeRuntimeConfigForPromotion persists runnable config and refs", () => {
    const promoted = (0, app_profile_1.serializeRuntimeConfigForPromotion)(makeConfig());
    (0, test_1.expect)(promoted.baseUrl).toBe("https://app-a.example.test");
    (0, test_1.expect)(promoted.loginMode).toBe("password");
    (0, test_1.expect)(promoted.testData.account).toBe("001");
    (0, test_1.expect)(promoted.usernameRef).toBe("APP_USERNAME");
    (0, test_1.expect)(promoted.passwordRef).toBe("APP_PASSWORD");
});
(0, test_1.test)("redactPromotedAppConfigForLogs does not expose password", () => {
    const promoted = (0, app_profile_1.serializeRuntimeConfigForPromotion)(makeConfig());
    const redacted = (0, app_profile_1.redactPromotedAppConfigForLogs)(promoted);
    (0, test_1.expect)(JSON.stringify(redacted)).not.toContain("demo-pass");
});
