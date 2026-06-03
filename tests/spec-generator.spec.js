"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const spec_generator_1 = require("../src/automations/spec-generator");
const app_profile_1 = require("../src/automations/app-profile");
const basePlan = {
    version: "1.0",
    source: "manual",
    status: "validated",
    scenario: {
        source: "testrail",
        externalId: "C37616",
        caseId: 37616,
        title: "Generic validated automation"
    },
    requiredData: [],
    steps: [
        {
            index: 1,
            action: "navigate",
            target: "APP_BASE_URL"
        }
    ],
    createdAt: new Date().toISOString()
};
function makeSpec(appSlug = "generic-app") {
    const appProfile = {
        appSlug,
        source: "default",
        name: "Generic App",
        baseUrl: "https://example.test",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    const appPaths = (0, app_profile_1.buildAppAutomationPaths)(appProfile, "test-automation");
    return (0, spec_generator_1.generateSpecFromPlan)(basePlan, "test-automation", appProfile, appPaths);
}
(0, test_1.test)("spec generated imports static dependencies", () => {
    const spec = makeSpec();
    (0, test_1.expect)(spec).toContain("import { test } from '@playwright/test';");
    (0, test_1.expect)(spec).toContain("import { config }");
    (0, test_1.expect)(spec).toContain("import { executeExecutionPlan }");
});
(0, test_1.test)("spec generated loads persisted app config", () => {
    const spec = makeSpec("profile-a");
    (0, test_1.expect)(spec).toContain("loadPromotedAppConfigSync");
    (0, test_1.expect)(spec).toContain("SPEC_APP_PROFILE = 'profile-a'");
    (0, test_1.expect)(spec).toContain("SPEC_APP_CONFIG_PATH");
    (0, test_1.expect)(spec).toContain("app.config.json");
});
(0, test_1.test)("spec generated resolves plan from app-specific directory", () => {
    const spec = makeSpec("profile-a");
    (0, test_1.expect)(spec).toContain("automations/apps/profile-a/cases/test-automation/plan.json");
    (0, test_1.expect)(spec).not.toContain("automations/plans/");
});
(0, test_1.test)("spec generated does not depend on APP_BASE_URL global at runtime", () => {
    const spec = makeSpec("profile-a");
    (0, test_1.expect)(spec).toContain("const __runtimeConfig = __appConfig ? buildMergedConfig(__appConfig, config) : config;");
    (0, test_1.expect)(spec).toContain("appBaseUrl: __runtimeConfig.app.baseUrl");
});
(0, test_1.test)("spec generated uses portable relative paths", () => {
    const spec = makeSpec("profile-a");
    (0, test_1.expect)(spec).not.toContain("C:\\");
    (0, test_1.expect)(spec).not.toContain("/home/");
    (0, test_1.expect)(spec).toContain("resolve(process.cwd(),");
});
(0, test_1.test)("spec generated does not print secrets", () => {
    const spec = makeSpec("profile-a");
    (0, test_1.expect)(spec).not.toContain("APP_PASSWORD");
    (0, test_1.expect)(spec).not.toContain("SECRET");
    (0, test_1.expect)(spec).not.toContain("TOKEN");
});
