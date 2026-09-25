"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const codex_scenario_generator_1 = require("./codex-scenario-generator");
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
console.log("\nnormalizeScenarioStep — data-key fill normalization");
test('TEST 1 — Ingresar "monto" usando monto_transferencia_100. → fill, not rejected', () => {
    const result = (0, codex_scenario_generator_1.normalizeScenarioStep)('Ingresar "monto" usando monto_transferencia_100.');
    node_assert_1.default.strictEqual(result.rejectReason, undefined, "must not be rejected");
    node_assert_1.default.strictEqual(result.changed, true, "must be normalized");
    node_assert_1.default.ok(result.step.includes("monto"), "target must be preserved");
    node_assert_1.default.ok(result.step.includes("monto_transferencia_100"), "dataKey must be preserved");
    node_assert_1.default.ok(/Ingresar ".+" en ".+"\.$/.test(result.step), `must match canonical fill pattern, got: ${result.step}`);
});
test('TEST 2 — Ingresar "importe" usando payment_amount. → fill, not rejected (generic, no hardcode)', () => {
    const result = (0, codex_scenario_generator_1.normalizeScenarioStep)('Ingresar "importe" usando payment_amount.');
    node_assert_1.default.strictEqual(result.rejectReason, undefined, "must not be rejected");
    node_assert_1.default.strictEqual(result.changed, true, "must be normalized");
    node_assert_1.default.ok(result.step.includes("importe"), "target must be preserved");
    node_assert_1.default.ok(result.step.includes("payment_amount"), "dataKey must be preserved");
    node_assert_1.default.ok(/Ingresar ".+" en ".+"\.$/.test(result.step), `must match canonical fill pattern, got: ${result.step}`);
});
test("TEST 3 — truly narrative step must still be rejected", () => {
    const result = (0, codex_scenario_generator_1.normalizeScenarioStep)("El usuario debe completar el formulario correctamente.");
    node_assert_1.default.strictEqual(result.rejectReason, "forbidden_narrative_step", "must be rejected as narrative");
});
console.log("\nAll tests completed.");
