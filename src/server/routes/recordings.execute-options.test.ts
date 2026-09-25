import assert from "node:assert";
import { resolveExecuteJobOptions } from "./recordings";

type AsyncTestFn = () => void | Promise<void>;

async function test(label: string, fn: AsyncTestFn): Promise<void> {
  try {
    await fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  console.log("\nrecordings /execute — explicit spec-generation intent");

  // CASE 1: plain "Reproducir" (no generateSpec field) must keep deferring spec generation,
  // exactly as before this change.
  await test("plain replay (no generateSpec) defers spec generation", () => {
    const result = resolveExecuteJobOptions({});
    assert.strictEqual(result.generateSpec, false);
    assert.strictEqual(result.autoPromote, false);
    assert.strictEqual(result.autoPom, false);
  });

  // CASE 2: explicit "Reproducir y generar spec" (generateSpec: true) must invoke the
  // existing auto-promote/auto-pom spec generation pipeline.
  await test("explicit generateSpec:true invokes spec generation", () => {
    const result = resolveExecuteJobOptions({ generateSpec: true });
    assert.strictEqual(result.generateSpec, true);
    assert.strictEqual(result.autoPromote, true);
    assert.strictEqual(result.autoPom, true);
  });

  // Intent must be a structured boolean, never inferred from text/labels.
  await test("non-boolean generateSpec values are rejected, not truthy-coerced", () => {
    const stringTrue = resolveExecuteJobOptions({ generateSpec: "true" as unknown });
    assert.strictEqual(stringTrue.generateSpec, false, "string 'true' must not enable spec generation");

    const numberOne = resolveExecuteJobOptions({ generateSpec: 1 as unknown });
    assert.strictEqual(numberOne.generateSpec, false, "truthy number must not enable spec generation");

    const explicitFalse = resolveExecuteJobOptions({ generateSpec: false });
    assert.strictEqual(explicitFalse.generateSpec, false);
  });

  if (process.exitCode === 1) {
    console.error("\nrecordings execute-options tests FAILED");
  } else {
    console.log("\nrecordings execute-options tests PASSED");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
