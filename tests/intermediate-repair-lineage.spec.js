"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_intermediate_repair_1 = require("../src/scenarios/scenario-intermediate-repair");
(0, test_1.test)("intermediate repair exposes one origin entry per repaired step", () => {
    const result = (0, scenario_intermediate_repair_1.repairMissingIntermediates)({ steps: ["1. A", "2. B"] }, null, {});
    (0, test_1.expect)(result.stepOrigins).toEqual([0, 1]);
});
