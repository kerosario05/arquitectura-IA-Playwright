import assert from "node:assert";
import {
  classifySemanticObject,
  resolveFunctionalObject,
  validateSemanticScenarioTitle,
  repairSemanticScenarioTitle,
} from "./functional-object-resolver";

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

describe("A. Functional object resolution (A1-A5)", () => {
  test("A1: BDD requirement resolves a real object, never 'dado que'", () => {
    const r = resolveFunctionalObject(
      {
        id: "R1",
        sourceText: "Dado que soy cliente del banco, quiero ingresar mi documento de identidad (cedula o pasaporte)",
        action: "fill",
        category: "input_field",
      },
      { huModel: { requiredFields: ["documento de identidad"], selectableEntities: ["document"] } },
    );
    assert.notStrictEqual(r.object, "dado que");
    assert.ok(r.object, "must resolve a concrete object");
    assert.strictEqual(r.source, "field");
    assert.strictEqual(r.backed, true);
  });

  test("A2: requirement referencing a concrete field resolves from the field", () => {
    const r = resolveFunctionalObject(
      { sourceText: "Completar el campo de cedula para generar", action: "fill", category: "input_field" },
      { huModel: { requiredFields: ["cedula"] } },
    );
    assert.strictEqual(r.object, "cedula");
    assert.strictEqual(r.source, "field");
    assert.strictEqual(r.backed, true);
  });

  test("A3: requirement with no identifiable object returns null, no invention", () => {
    const r = resolveFunctionalObject(
      { sourceText: "Validar que el flujo se ejecute correctamente", action: "validate", category: "ui_validation" },
      { huModel: { requiredFields: ["rnc"] } },
    );
    assert.strictEqual(r.object, null);
    assert.strictEqual(r.backed, false);
  });

  test("A4: 'entry' is an internal token, never a functional object", () => {
    const cls = classifySemanticObject("entry");
    assert.strictEqual(cls.valid, false);
    assert.strictEqual(cls.kind, "internal");
    const r = resolveFunctionalObject(
      { sourceText: "Validar entry", action: "validate", category: "ui_validation" },
      { huModel: {} },
    );
    assert.strictEqual(r.object, null);
    assert.strictEqual(r.backed, false);
  });

  test("A5: 'found' is an internal token, never a functional object", () => {
    const cls = classifySemanticObject("found");
    assert.strictEqual(cls.valid, false);
    assert.strictEqual(cls.kind, "internal");
    const r = resolveFunctionalObject(
      { sourceText: "Validar found", action: "validate", category: "ui_validation" },
      { huModel: {} },
    );
    assert.strictEqual(r.object, null);
    assert.strictEqual(r.backed, false);
  });
});

describe("B. Semantic title contract (B6-B10)", () => {
  test("B6: 'Ejecutar flujo completo de dado que' is invalid", () => {
    const v = validateSemanticScenarioTitle("Ejecutar flujo completo de dado que");
    assert.strictEqual(v.valid, false);
    assert.strictEqual(v.reason, "invalid_or_missing_functional_object");
    assert.strictEqual(v.object, "dado que");
  });

  test("B7: 'Validar entry' is invalid", () => {
    const v = validateSemanticScenarioTitle("Validar entry");
    assert.strictEqual(v.valid, false);
    assert.strictEqual(v.reason, "invalid_or_missing_functional_object");
    assert.strictEqual(v.object, "entry");
  });

  test("B8: 'Validar found' is invalid", () => {
    const v = validateSemanticScenarioTitle("Validar found");
    assert.strictEqual(v.valid, false);
    assert.strictEqual(v.reason, "invalid_or_missing_functional_object");
    assert.strictEqual(v.object, "found");
  });

  test("B9: action + backed object passes the contract", () => {
    const ctx = { huModel: { requiredFields: ["documento de identidad"] } };
    const v = validateSemanticScenarioTitle("Completar documento de identidad", ctx);
    assert.strictEqual(v.valid, true);
    assert.ok(v.object, "must carry an object");
  });

  test("B10: title ending in a preposition is invalid", () => {
    const v = validateSemanticScenarioTitle("Validar estado del");
    assert.strictEqual(v.valid, false);
    assert.strictEqual(v.reason, "invalid_or_missing_functional_object");
  });
});

describe("C. Deterministic local repair (C11-C12)", () => {
  test("C11: bad title + backed object is repaired locally and valid", () => {
    const ctx = { huModel: { requiredFields: ["documento de identidad"] }, featureName: "documento de identidad" };
    const r = repairSemanticScenarioTitle("Ejecutar flujo completo de dado que", ctx);
    assert.strictEqual(r.repaired, true);
    assert.strictEqual(r.valid, true);
    assert.strictEqual(r.title, "Ejecutar flujo completo de documento de identidad");
  });

  test("C12: bad title + no backed object stays unrepairable (no visible scenario)", () => {
    const r = repairSemanticScenarioTitle("Validar entry", {});
    assert.strictEqual(r.repaired, false);
    assert.strictEqual(r.valid, false);
    assert.strictEqual(r.title, "Validar entry");
  });
});

describe("D. Coverage-repair guard (D13-D14)", () => {
  test("D13: gap with invalid object produces no scenario (guard blocks)", () => {
    const resolved = resolveFunctionalObject(
      { sourceText: "Validar entry", action: "validate", category: "ui_validation" },
      { huModel: {} },
    );
    assert.strictEqual(resolved.object, null);
    assert.strictEqual(resolved.backed, false);
    const hasValidTarget = !!resolved.object && classifySemanticObject(resolved.object).valid;
    assert.strictEqual(hasValidTarget, false);
  });

  test("D14: gap with backed object produces a valid semantic title", () => {
    const resolved = resolveFunctionalObject(
      { sourceText: "Completar el campo documento de identidad para continuar", action: "fill", category: "input_field" },
      { huModel: { requiredFields: ["documento de identidad"] } },
    );
    assert.strictEqual(resolved.object, "documento de identidad");
    assert.strictEqual(resolved.backed, true);
    const v = validateSemanticScenarioTitle(`Completar ${resolved.object}`, {
      huModel: { requiredFields: ["documento de identidad"] },
    });
    assert.strictEqual(v.valid, true);
  });
});

describe("E. required_fields_flow (E15-E16)", () => {
  test("E15: compatible huModel field yields a concrete required-fields object", () => {
    const resolved = resolveFunctionalObject(
      { sourceText: "documento de identidad", action: "fill", category: "input_field" },
      { huModel: { requiredFields: ["documento de identidad"] } },
    );
    assert.strictEqual(resolved.object, "documento de identidad");
    assert.strictEqual(resolved.source, "field");
    assert.strictEqual(resolved.backed, true);
    const v = validateSemanticScenarioTitle(`Completar datos requeridos de ${resolved.object}`, {
      huModel: { requiredFields: ["documento de identidad"] },
    });
    assert.strictEqual(v.valid, true);
  });

  test("E16: fields exist but none corresponds — no invented association", () => {
    const r = resolveFunctionalObject(
      { sourceText: "Validar que el flujo se ejecute correctamente", action: "validate", category: "ui_validation" },
      { huModel: { requiredFields: ["rnc"] } },
    );
    assert.strictEqual(r.object, null);
    assert.notStrictEqual(r.object, "rnc");
  });
});