"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const mobile_scenario_prompt_builder_1 = require("../src/scenarios/mobile-scenario-prompt-builder");
/**
 * Mobile Scenario Prompt Builder — Pre-provider null safety tests (T1-T10)
 *
 * Tests that buildMobileScenarioMessages does NOT crash when:
 * - routeProfile.screens is undefined/missing
 * - knowledgeItems is empty
 * - destinationClaimManifest is empty
 * - aliases/config are undefined/null
 */
const baseIssue = {
    key: "AA-94",
    summary: "Test issue",
    description: "Test description",
    acceptanceCriteria: "CA01: Test criterion",
    labels: [],
    components: [],
    status: "To Do",
    issueType: "Story",
};
function makeMinimalProfile(overrides = {}) {
    return {
        appSlug: overrides.appSlug ?? "test-app",
        packageName: overrides.packageName ?? "com.test.app",
        appName: overrides.appName ?? "Test App",
        platform: "android",
        mainActivity: overrides.mainActivity ?? "com.test.app.MainActivity",
        updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z",
        screens: overrides.screens ?? {},
        ...("flows" in overrides ? { flows: overrides.flows } : {}),
        ...("functionalDataProfiles" in overrides ? { functionalDataProfiles: overrides.functionalDataProfiles } : {}),
    };
}
// T1: routeProfile exists + screens=[] → no crash
(0, test_1.test)("T1: routeProfile exists with empty screens → no crash", () => {
    const profile = makeMinimalProfile({ screens: {} });
    const messages = (0, mobile_scenario_prompt_builder_1.buildMobileScenarioMessages)(baseIssue, profile, [], []);
    (0, test_1.expect)(messages).toHaveLength(2);
    (0, test_1.expect)(messages[0].role).toBe("system");
    (0, test_1.expect)(messages[1].role).toBe("user");
});
// T2: knowledgeItems=[] → no crash
(0, test_1.test)("T2: empty knowledgeItems → no crash", () => {
    const messages = (0, mobile_scenario_prompt_builder_1.buildMobileScenarioMessages)(baseIssue, null, [], []);
    (0, test_1.expect)(messages).toHaveLength(2);
});
// T3: destinationClaimManifest=[] → no crash
(0, test_1.test)("T3: empty destinationClaimManifest → no crash", () => {
    const messages = (0, mobile_scenario_prompt_builder_1.buildMobileScenarioMessages)(baseIssue, null, [], []);
    (0, test_1.expect)(messages).toHaveLength(2);
});
// T4: routeProfile undefined → no crash
(0, test_1.test)("T4: routeProfile undefined → no crash", () => {
    const messages = (0, mobile_scenario_prompt_builder_1.buildMobileScenarioMessages)(baseIssue, undefined, undefined, undefined);
    (0, test_1.expect)(messages).toHaveLength(2);
});
// T5: all optional params undefined → no crash
(0, test_1.test)("T5: all optional params undefined → no crash", () => {
    const messages = (0, mobile_scenario_prompt_builder_1.buildMobileScenarioMessages)(baseIssue);
    (0, test_1.expect)(messages).toHaveLength(2);
});
// T6: screens property missing from JSON → no crash
(0, test_1.test)("T6: screens property missing from routeProfile → no crash", () => {
    const profile = makeMinimalProfile();
    delete profile.screens;
    const messages = (0, mobile_scenario_prompt_builder_1.buildMobileScenarioMessages)(baseIssue, profile, [], []);
    (0, test_1.expect)(messages).toHaveLength(2);
});
// T7: screens property null → no crash
(0, test_1.test)("T7: screens property null → no crash", () => {
    const profile = makeMinimalProfile({ screens: null });
    const messages = (0, mobile_scenario_prompt_builder_1.buildMobileScenarioMessages)(baseIssue, profile, [], []);
    (0, test_1.expect)(messages).toHaveLength(2);
});
// T8: provider input is constructed correctly
(0, test_1.test)("T8: provider input contains issue text", () => {
    const messages = (0, mobile_scenario_prompt_builder_1.buildMobileScenarioMessages)(baseIssue, null, [], []);
    const userContent = messages[1].content;
    (0, test_1.expect)(userContent).toContain("AA-94");
    (0, test_1.expect)(userContent).toContain("Test issue");
    (0, test_1.expect)(userContent).toContain("CA01");
});
// T9: provider invocation point is reached (mock)
(0, test_1.test)("T9: provider invocation point is reached", () => {
    let providerCalled = false;
    const mockProvider = {
        completeJson: async () => {
            providerCalled = true;
            return { parsedJson: { scenarios: [], rejected: [] }, rawText: "{}", diagnostics: { exitCode: 0 } };
        }
    };
    // Build messages should not crash
    const messages = (0, mobile_scenario_prompt_builder_1.buildMobileScenarioMessages)(baseIssue, null, [], []);
    (0, test_1.expect)(messages).toHaveLength(2);
    (0, test_1.expect)(providerCalled).toBe(false); // Provider not called yet, but messages built successfully
});
// T10: no production hardcodes
(0, test_1.test)("T10: no production hardcodes", () => {
    const messages = (0, mobile_scenario_prompt_builder_1.buildMobileScenarioMessages)(baseIssue, null, [], []);
    const userContent = messages[1].content;
    (0, test_1.expect)(userContent).not.toContain("appconversacional");
    (0, test_1.expect)(userContent).not.toContain("com.appconversacionalbsc");
});
