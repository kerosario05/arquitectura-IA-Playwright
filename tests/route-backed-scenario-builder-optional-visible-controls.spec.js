"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_route_resolver_1 = require("../src/scenarios/scenario-route-resolver");
const route_backed_scenario_builder_1 = require("../src/scenarios/route-backed-scenario-builder");
(0, test_1.test)("resolves detail navigation without optional visibleControls", () => {
    const routeProfile = {
        routes: [{ from: "entry", intermediates: ["section"] }],
        intermediates: { entry: ["section"] },
    };
    const issue = {
        key: "TEST-1",
        summary: "Detail navigation",
        description: "Validar la información detallada disponible.",
        acceptanceCriteria: "Validar que se muestre la información del producto.",
        labels: [],
        components: [],
        status: "Open",
        issueType: "Story",
    };
    const resolution = (0, scenario_route_resolver_1.resolveScenarioRoute)(issue, routeProfile, "app");
    (0, test_1.expect)(resolution.scenarioMode).toBe("detail_navigation");
    (0, test_1.expect)(() => (0, route_backed_scenario_builder_1.buildExecutableSteps)("detail_navigation", routeProfile, issue.description, ["section"])).not.toThrow();
});
