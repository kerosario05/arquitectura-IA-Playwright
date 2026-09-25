"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const target_resolver_1 = require("./target-resolver");
function uniqueVisibleControl() {
    return {
        count: async () => 1,
        isVisible: async () => true,
        isEnabled: async () => true,
    };
}
(0, node_test_1.default)("stale route does not veto one exact visible enabled recorded control", async () => {
    const locator = uniqueVisibleControl();
    const page = {
        url: () => "https://app.test/current-surface",
        getByRole: () => locator,
    };
    const result = await (0, target_resolver_1.resolveActionTarget)(page, {
        url: page.url(),
        title: "Current",
        elements: [],
    }, "Expected control", {
        expectedRouteBefore: "https://app.test/recorded-surface",
        recordedTechnicalTargetRefs: ["role:button|Expected control"],
    });
    strict_1.default.equal(result.status, "resolved");
    strict_1.default.equal(result.matchReason, "recorded_technical_target_current_dom_stale_surface_recovered");
});
(0, node_test_1.default)("different application origin remains a hard surface incompatibility", async () => {
    const compatibility = (0, target_resolver_1.classifyRecordedSurfaceCompatibility)("https://current.test/surface", "https://recorded.test/surface");
    strict_1.default.equal(compatibility.hardIncompatibility, true);
    strict_1.default.deepEqual(compatibility.reasons, ["wrong_application_origin"]);
});
(0, node_test_1.default)("same origin path drift is classified as soft stale surface evidence", () => {
    const compatibility = (0, target_resolver_1.classifyRecordedSurfaceCompatibility)("https://app.test/current", "https://app.test/recorded");
    strict_1.default.equal(compatibility.hardIncompatibility, false);
    strict_1.default.equal(compatibility.routeMismatch, true);
});
