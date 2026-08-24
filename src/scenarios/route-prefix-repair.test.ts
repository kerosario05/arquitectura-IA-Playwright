import assert from "node:assert";
import { applyCanonicalRoutePrefix } from "./scenario-preview.service";

function test(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

function describe(name: string, fn: () => void): void {
  console.log(`\n${name}`);
  fn();
}

describe("applyCanonicalRoutePrefix", () => {
  test("repairs wrong order with entry step before functional route prefix", () => {
    const result = applyCanonicalRoutePrefix(
      [
        "Clic en \"Acción principal\".",
        "Clic en \"Entidad\".",
        "Clic en \"Entrada\".",
        "Validar el resultado visible."
      ],
      ["Acción principal", "Entidad"],
      [{ action: "click", target: "Entrada", when: "before_first_functional_step" }]
    );

    assert.deepStrictEqual(result.steps, [
      "Clic en \"Entrada\".",
      "Clic en \"Acción principal\".",
      "Clic en \"Entidad\".",
      "Validar el resultado visible."
    ]);
    assert.strictEqual(result.changed, true);
  });

  test("keeps already ordered scenario unchanged and without duplicates", () => {
    const original = [
      "Clic en \"Entrada\".",
      "Clic en \"Acción principal\".",
      "Clic en \"Entidad\".",
      "Validar el resultado visible."
    ];
    const result = applyCanonicalRoutePrefix(
      [...original],
      ["Acción principal", "Entidad"],
      [{ action: "click", target: "Entrada", when: "before_first_functional_step" }]
    );

    assert.deepStrictEqual(result.steps, original);
    assert.strictEqual(result.changed, false);
  });

  test("inserts missing functional click after entry and before validations", () => {
    const result = applyCanonicalRoutePrefix(
      [
        "Clic en \"Entrada\".",
        "Clic en \"Acción principal\".",
        "Validar el resultado visible."
      ],
      ["Acción principal", "Entidad"],
      [{ action: "click", target: "Entrada", when: "before_first_functional_step" }]
    );

    assert.deepStrictEqual(result.steps, [
      "Clic en \"Entrada\".",
      "Clic en \"Acción principal\".",
      "Clic en \"Entidad\".",
      "Validar el resultado visible."
    ]);
    assert.strictEqual(result.changed, true);
  });

  test("deduplicates repeated targets across case/accent variants", () => {
    const result = applyCanonicalRoutePrefix(
      [
        "Clic en \"entrada\".",
        "Clic en \"acción principal\".",
        "Clic en \"Entidad\".",
        "Validar el resultado visible."
      ],
      ["ACCION PRINCIPAL", "Acción principal", "Entidad"],
      [{ action: "click", target: "Entrada", when: "before_first_functional_step" }]
    );

    const clickSteps = result.steps.filter((step) => /^Clic en /i.test(step));
    assert.deepStrictEqual(clickSteps, [
      "Clic en \"entrada\".",
      "Clic en \"acción principal\".",
      "Clic en \"Entidad\"."
    ]);
    assert.strictEqual(result.steps[result.steps.length - 1], "Validar el resultado visible.");
  });

  test("does not insert entry click when when is not applicable", () => {
    const result = applyCanonicalRoutePrefix(
      [
        "Clic en \"Acción principal\".",
        "Validar el resultado visible."
      ],
      ["Acción principal"],
      [{ action: "click", target: "Entrada posterior", when: "after_authentication" }]
    );

    assert.deepStrictEqual(result.steps, [
      "Clic en \"Acción principal\".",
      "Validar el resultado visible."
    ]);
    assert.strictEqual(result.steps.some((step) => step.includes("Entrada posterior")), false);
    assert.strictEqual(result.changed, false);
  });

  test("ignores non-click entry actions in canonical prefix", () => {
    const result = applyCanonicalRoutePrefix(
      [
        "Clic en \"Acción principal\".",
        "Validar el resultado visible."
      ],
      ["Acción principal"],
      [{ action: "fill", target: "Entrada posterior", when: "before_first_functional_step" }]
    );

    assert.deepStrictEqual(result.steps, [
      "Clic en \"Acción principal\".",
      "Validar el resultado visible."
    ]);
    assert.strictEqual(result.steps.some((step) => step.includes("Entrada posterior")), false);
    assert.strictEqual(result.changed, false);
  });
});
