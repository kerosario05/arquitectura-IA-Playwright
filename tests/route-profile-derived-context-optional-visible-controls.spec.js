"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const route_profile_derived_context_1 = require("../src/scenarios/route-profile-derived-context");
(0, test_1.test)("derives route context when visibleControls is absent or not an array", () => {
    const baseProfile = {
        routes: [{ from: "entry", intermediates: ["section"] }],
        intermediates: { entry: ["section"] },
    };
    (0, test_1.expect)(() => (0, route_profile_derived_context_1.buildDerivedExecutionContext)("app", baseProfile, new Map(), [])).not.toThrow();
    (0, test_1.expect)(() => (0, route_profile_derived_context_1.buildDerivedExecutionContext)("app", { ...baseProfile, visibleControls: {} }, new Map(), [])).not.toThrow();
});
