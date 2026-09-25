"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_mode_classifier_1 = require("../src/scenarios/scenario-mode-classifier");
(0, test_1.test)("classifies a route profile with navigation data and missing optional collections", () => {
    const routeProfile = {
        routes: [{ from: "entry", intermediates: ["section"] }],
        intermediates: { entry: ["section"] },
    };
    (0, test_1.expect)(() => (0, scenario_mode_classifier_1.classifyScenarioMode)("Validar que se muestre el listado", routeProfile)).not.toThrow();
    (0, test_1.expect)((0, scenario_mode_classifier_1.classifyScenarioMode)("Validar que se muestre el listado", routeProfile)).toMatchObject({
        mode: "listing_validation",
        missingSteps: ["entry", "list_target"],
    });
});
