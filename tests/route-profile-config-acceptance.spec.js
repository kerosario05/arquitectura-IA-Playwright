"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_preview_service_1 = require("../src/scenarios/scenario-preview.service");
test_1.test.describe("configured routeProfile acceptance", () => {
    (0, test_1.test)("accepts navigation structure without entry or aliases", () => {
        const routeProfile = {
            routes: [{ from: "entry", intermediates: ["section"] }],
            intermediates: { entry: ["section"] },
        };
        (0, test_1.expect)((0, scenario_preview_service_1.isConfiguredRouteProfileUsable)(routeProfile)).toBe(true);
    });
    (0, test_1.test)("rejects an empty routeProfile", () => {
        (0, test_1.expect)((0, scenario_preview_service_1.isConfiguredRouteProfileUsable)({})).toBe(false);
        (0, test_1.expect)((0, scenario_preview_service_1.isConfiguredRouteProfileUsable)(null)).toBe(false);
    });
});
