"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const mobile_scenario_prompt_builder_1 = require("./mobile-scenario-prompt-builder");
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
const fakeIssue = {
    key: "AA-93",
    summary: "Login usuario",
    description: "El usuario debe poder loguearse",
    acceptanceCriteria: "Se muestra pantalla de login",
    labels: [],
    components: [],
    status: "To Do",
    issueType: "Historia"
};
console.log("\nbuildMobileScenarioMessages — empty-screens routeProfile");
test("TEST 1 — routeProfile without screens property must not crash", () => {
    const routeProfile = {
        appSlug: "appconversacional",
        packageName: "com.appconversacionalbsc",
        appName: "appconversacional",
        platform: "android",
        mainActivity: "com.appconversacionalbsc.MainActivity",
        updatedAt: "2026-08-28T00:00:00.000Z"
    };
    const messages = (0, mobile_scenario_prompt_builder_1.buildMobileScenarioMessages)(fakeIssue, routeProfile, []);
    node_assert_1.default.ok(Array.isArray(messages), "must return messages array");
    node_assert_1.default.strictEqual(messages.length, 2, "must have system + user message");
    node_assert_1.default.strictEqual(messages[0].role, "system");
    node_assert_1.default.strictEqual(messages[1].role, "user");
});
test("TEST 2 — routeProfile with empty screens must not crash", () => {
    const routeProfile = {
        appSlug: "appconversacional",
        packageName: "com.appconversacionalbsc",
        appName: "appconversacional",
        platform: "android",
        mainActivity: "com.appconversacionalbsc.MainActivity",
        screens: {},
        updatedAt: "2026-08-28T00:00:00.000Z"
    };
    const messages = (0, mobile_scenario_prompt_builder_1.buildMobileScenarioMessages)(fakeIssue, routeProfile, []);
    node_assert_1.default.ok(Array.isArray(messages), "must return messages array");
    node_assert_1.default.strictEqual(messages.length, 2, "must have system + user message");
});
test("TEST 3 — null routeProfile must not crash", () => {
    const messages = (0, mobile_scenario_prompt_builder_1.buildMobileScenarioMessages)(fakeIssue, null, []);
    node_assert_1.default.ok(Array.isArray(messages), "must return messages array");
    node_assert_1.default.strictEqual(messages.length, 2, "must have system + user message");
});
console.log("\nAll tests completed.");
