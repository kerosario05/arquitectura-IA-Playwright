import assert from "node:assert";
import { normalizeScenarioStep } from "./codex-scenario-generator";
import { parseSingleIntent } from "../discovery/step-intent-parser";

function test(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

function pipeline(input: string) {
  const norm = normalizeScenarioStep(input);
  const parsed = parseSingleIntent(norm.step);
  return { norm, parsed };
}

console.log("\nData-key fill — normalize + parse pipeline");

test('TEST 1 — "monto" usando monto_transferencia_100 → dataKey, not literal', () => {
  const { norm, parsed } = pipeline('Ingresar "monto" usando monto_transferencia_100.');
  assert.strictEqual(norm.changed, true, "must be normalized");
  assert.strictEqual(norm.rejectReason, undefined, "must not be rejected");
  assert.ok(parsed, "must be parsed");
  assert.strictEqual(parsed!.type, "action_fill");
  assert.strictEqual(parsed!.actionTarget, "monto");
  assert.strictEqual(parsed!.valueSource, "test_data");
  assert.strictEqual(parsed!.valueKey, "monto_transferencia_100");
  assert.strictEqual((parsed as any).value, undefined, "literal value must not be set");
});

test('TEST 2 — "importe" usando payment_amount → dataKey, not literal', () => {
  const { norm, parsed } = pipeline('Ingresar "importe" usando payment_amount.');
  assert.strictEqual(norm.changed, true, "must be normalized");
  assert.strictEqual(norm.rejectReason, undefined, "must not be rejected");
  assert.ok(parsed, "must be parsed");
  assert.strictEqual(parsed!.type, "action_fill");
  assert.strictEqual(parsed!.actionTarget, "importe");
  assert.strictEqual(parsed!.valueSource, "test_data");
  assert.strictEqual(parsed!.valueKey, "payment_amount");
  assert.strictEqual((parsed as any).value, undefined, "literal value must not be set");
});

test('TEST 3 — literal fill "100" en "monto" → still literal (no regression)', () => {
  const { norm, parsed } = pipeline('Ingresar "100" en "monto".');
  assert.strictEqual(norm.changed, false, "must not be normalized (already canonical)");
  assert.ok(parsed, "must be parsed");
  assert.strictEqual(parsed!.type, "action_fill");
  assert.strictEqual(parsed!.actionTarget, "monto");
  assert.strictEqual(parsed!.valueSource, "literal");
  assert.strictEqual(parsed!.value, "100");
  assert.strictEqual(parsed!.valueKey, undefined, "dataKey must not be set");
});

console.log("\nAll tests completed.");
