"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const codex_scenario_generator_1 = require("./codex-scenario-generator");
const step_intent_parser_1 = require("../discovery/step-intent-parser");
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
function pipeline(input) {
    const norm = (0, codex_scenario_generator_1.normalizeScenarioStep)(input);
    const parsed = (0, step_intent_parser_1.parseSingleIntent)(norm.step);
    return { norm, parsed };
}
console.log("\nData-key fill — normalize + parse pipeline");
test('TEST 1 — "monto" usando monto_transferencia_100 → dataKey, not literal', () => {
    const { norm, parsed } = pipeline('Ingresar "monto" usando monto_transferencia_100.');
    node_assert_1.default.strictEqual(norm.changed, true, "must be normalized");
    node_assert_1.default.strictEqual(norm.rejectReason, undefined, "must not be rejected");
    node_assert_1.default.ok(parsed, "must be parsed");
    node_assert_1.default.strictEqual(parsed.type, "action_fill");
    node_assert_1.default.strictEqual(parsed.actionTarget, "monto");
    node_assert_1.default.strictEqual(parsed.valueSource, "test_data");
    node_assert_1.default.strictEqual(parsed.valueKey, "monto_transferencia_100");
    node_assert_1.default.strictEqual(parsed.value, undefined, "literal value must not be set");
});
test('TEST 2 — "importe" usando payment_amount → dataKey, not literal', () => {
    const { norm, parsed } = pipeline('Ingresar "importe" usando payment_amount.');
    node_assert_1.default.strictEqual(norm.changed, true, "must be normalized");
    node_assert_1.default.strictEqual(norm.rejectReason, undefined, "must not be rejected");
    node_assert_1.default.ok(parsed, "must be parsed");
    node_assert_1.default.strictEqual(parsed.type, "action_fill");
    node_assert_1.default.strictEqual(parsed.actionTarget, "importe");
    node_assert_1.default.strictEqual(parsed.valueSource, "test_data");
    node_assert_1.default.strictEqual(parsed.valueKey, "payment_amount");
    node_assert_1.default.strictEqual(parsed.value, undefined, "literal value must not be set");
});
test('TEST 3 — literal fill "100" en "monto" → still literal (no regression)', () => {
    const { norm, parsed } = pipeline('Ingresar "100" en "monto".');
    node_assert_1.default.strictEqual(norm.changed, false, "must not be normalized (already canonical)");
    node_assert_1.default.ok(parsed, "must be parsed");
    node_assert_1.default.strictEqual(parsed.type, "action_fill");
    node_assert_1.default.strictEqual(parsed.actionTarget, "monto");
    node_assert_1.default.strictEqual(parsed.valueSource, "literal");
    node_assert_1.default.strictEqual(parsed.value, "100");
    node_assert_1.default.strictEqual(parsed.valueKey, undefined, "dataKey must not be set");
});
console.log("\nAll tests completed.");
