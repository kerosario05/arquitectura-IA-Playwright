"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_preview_runner_1 = require("../src/server/jobs/scenario-preview-runner");
function makeScenario(overrides) {
    return {
        sourceIssueKey: "HU-1",
        title: "Escenario de prueba",
        steps: ['1. Clic en "Elemento".'],
        preconditions: [],
        expectedResult: "OK",
        type: "functional",
        database: "",
        isConverted: 0,
        automationType: "ui_discovery",
        setupStrategy: "no_login",
        appSlug: "",
        routeProfile: "",
        dataRequirements: "",
        nonExecutableCriteria: "",
        mcpExecutable: true,
        ...overrides,
    };
}
(0, test_1.test)("explicit launch appSlug is the source of truth — never replaced by a default", () => {
    const params = { appSlug: "project-a" };
    const scenarios = [makeScenario({ sourceIssueKey: "HU-1" })];
    const resolved = (0, scenario_preview_runner_1.resolveEffectiveAppSlug)(params, scenarios);
    (0, test_1.expect)(resolved.appSlug).toBe("project-a");
    (0, test_1.expect)(resolved.appSlug).not.toBe("default-app");
    (0, test_1.expect)(resolved.appSlug).not.toBe("arquitectura-automatizacion");
    // The runner passes resolved.appSlug to `discovery:preview ... --app <appSlug>`
    console.log(`resolved appSlug=${resolved.appSlug} -> discovery:preview --app ${resolved.appSlug}`);
});
(0, test_1.test)("explicit launch appSlug wins even when scenario has a different targetAppSlug", () => {
    const params = { appSlug: "project-a" };
    const scenarios = [makeScenario({ sourceIssueKey: "HU-1", targetAppSlug: "project-b" })];
    const resolved = (0, scenario_preview_runner_1.resolveEffectiveAppSlug)(params, scenarios);
    // Precedence 1: launch/request appSlug beats scenario targetAppSlug
    (0, test_1.expect)(resolved.appSlug).toBe("project-a");
});
(0, test_1.test)("scenario targetAppSlug used when launch appSlug absent", () => {
    const params = { appSlug: undefined, targetAppSlug: undefined };
    const scenarios = [makeScenario({ sourceIssueKey: "HU-1", targetAppSlug: "project-b" })];
    const resolved = (0, scenario_preview_runner_1.resolveEffectiveAppSlug)(params, scenarios);
    (0, test_1.expect)(resolved.appSlug).toBe("project-b");
});
(0, test_1.test)("fallback preserved when no explicit appSlug or scenario target exists", () => {
    const params = { appSlug: undefined, targetAppSlug: undefined };
    const scenarios = [makeScenario({ sourceIssueKey: "HU-1" })];
    // No explicit slug anywhere → existing fallback (throws) is preserved
    (0, test_1.expect)(() => (0, scenario_preview_runner_1.resolveEffectiveAppSlug)(params, scenarios)).toThrow();
});
