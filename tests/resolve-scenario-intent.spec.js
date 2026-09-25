"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_preview_service_1 = require("../src/scenarios/scenario-preview.service");
(0, test_1.test)("resolved specific intent wins over huModel reclassification and clears conflicting subIntent", () => {
    const { intent, subIntent } = (0, scenario_preview_service_1.resolveScenarioIntent)("A", "B", "B1");
    (0, test_1.expect)(intent).toBe("A");
    (0, test_1.expect)(subIntent).toBeUndefined();
});
(0, test_1.test)("unknown resolved intent falls back to huModel and preserves compatible subIntent", () => {
    const { intent, subIntent } = (0, scenario_preview_service_1.resolveScenarioIntent)("B", "B", "B1");
    (0, test_1.expect)(intent).toBe("B");
    (0, test_1.expect)(subIntent).toBe("B1");
});
(0, test_1.test)("resolved intent matching huModel keeps existing subIntent", () => {
    const { intent, subIntent } = (0, scenario_preview_service_1.resolveScenarioIntent)("A", "A", "A1");
    (0, test_1.expect)(intent).toBe("A");
    (0, test_1.expect)(subIntent).toBe("A1");
});
(0, test_1.test)("fallback to huModel mainIntent when resolved intent is unknown", () => {
    const { intent, subIntent } = (0, scenario_preview_service_1.resolveScenarioIntent)("unknown_flow", "B", "B1");
    (0, test_1.expect)(intent).toBe("B");
    (0, test_1.expect)(subIntent).toBe("B1");
});
