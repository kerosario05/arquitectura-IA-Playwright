"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_preview_service_1 = require("../src/scenarios/scenario-preview.service");
(0, test_1.test)("preserves referenced origins through canonical prefix changes", () => {
    const result = (0, scenario_preview_service_1.applyCanonicalRoutePrefix)(['Clic en "A".', 'Clic en "B".', 'Clic en "B".'], ["B", "NEW"], [], [{ stepIndex: 1 }, { stepIndex: 2 }]);
    (0, test_1.expect)(result.steps).toEqual(['1. Clic en "NEW".', 'Clic en "A".', 'Clic en "B".', 'Clic en "B".']);
    (0, test_1.expect)(result.stepOrigins).toEqual([undefined, 0, 1, 2]);
});
