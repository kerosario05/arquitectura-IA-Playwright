"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_preview_service_1 = require("../src/scenarios/scenario-preview.service");
(0, test_1.test)("high-confidence specific primary intent is preserved over heuristic model", () => {
    const effective = (0, scenario_preview_service_1.resolveEffectiveIntent)("catalog_listing_flow", "high", "balance_inquiry");
    (0, test_1.expect)(effective).toBe("catalog_listing_flow");
});
(0, test_1.test)("unknown primary intent falls back to heuristic model", () => {
    const effective = (0, scenario_preview_service_1.resolveEffectiveIntent)("unknown_flow", "low", "catalog_listing");
    (0, test_1.expect)(effective).toBe("catalog_listing");
});
(0, test_1.test)("high-confidence specific non-catalog primary intent is preserved", () => {
    const effective = (0, scenario_preview_service_1.resolveEffectiveIntent)("payment_transfer", "high", "catalog_listing");
    (0, test_1.expect)(effective).toBe("payment_transfer");
});
