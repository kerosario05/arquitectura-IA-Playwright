"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const discovery_preview_1 = require("./discovery-preview");
function test(label, fn) {
    try {
        fn();
        console.log(`  PASS  ${label}`);
    }
    catch (err) {
        console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    }
}
test("keeps valid discovered_partial as a successful event", () => {
    const result = (0, discovery_preview_1.resolvePreviewCompletion)({
        caseResult: {
            status: "discovered_partial",
            steps: [{ status: "found" }, { status: "skipped" }],
        },
        promotionStatus: "pending",
    }, true);
    node_assert_1.default.strictEqual(result.eventStatus, "passed");
});
test("keeps failed for a real partial step error", () => {
    const result = (0, discovery_preview_1.resolvePreviewCompletion)({
        caseResult: {
            status: "discovered_partial",
            steps: [{ status: "found" }, { status: "failed", error: "target not found" }],
            failedAtStep: 1,
            failedReason: "target not found",
        },
        promotionStatus: "pending",
    }, true);
    node_assert_1.default.strictEqual(result.eventStatus, "failed");
});
