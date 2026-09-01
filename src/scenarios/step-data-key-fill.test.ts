import assert from "node:assert";
import { normalizeScenarioStep } from "./codex-scenario-generator";

function test(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

console.log("\nnormalizeScenarioStep — data-key fill normalization");

test('TEST 1 — Ingresar "monto" usando monto_transferencia_100. → fill, not rejected', () => {
  const result = normalizeScenarioStep('Ingresar "monto" usando monto_transferencia_100.');
  assert.strictEqual(result.rejectReason, undefined, "must not be rejected");
  assert.strictEqual(result.changed, true, "must be normalized");
  assert.ok(result.step.includes("monto"), "target must be preserved");
  assert.ok(result.step.includes("monto_transferencia_100"), "dataKey must be preserved");
  assert.ok(/Ingresar ".+" en ".+"\.$/.test(result.step), `must match canonical fill pattern, got: ${result.step}`);
});

test('TEST 2 — Ingresar "importe" usando payment_amount. → fill, not rejected (generic, no hardcode)', () => {
  const result = normalizeScenarioStep('Ingresar "importe" usando payment_amount.');
  assert.strictEqual(result.rejectReason, undefined, "must not be rejected");
  assert.strictEqual(result.changed, true, "must be normalized");
  assert.ok(result.step.includes("importe"), "target must be preserved");
  assert.ok(result.step.includes("payment_amount"), "dataKey must be preserved");
  assert.ok(/Ingresar ".+" en ".+"\.$/.test(result.step), `must match canonical fill pattern, got: ${result.step}`);
});

test("TEST 3 — truly narrative step must still be rejected", () => {
  const result = normalizeScenarioStep("El usuario debe completar el formulario correctamente.");
  assert.strictEqual(result.rejectReason, "forbidden_narrative_step", "must be rejected as narrative");
});

console.log("\nAll tests completed.");
