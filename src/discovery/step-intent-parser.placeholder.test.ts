import assert from "node:assert/strict";
import test from "node:test";
import { parseStepIntent } from "./step-intent-parser";

const cases = [
  ["auth.company_identifier", "RNC de la empresa"],
  ["auth.username", "Nombre de usuario"],
  ["auth.password", "Contraseña"],
  ["employee_1.document", "Cédula empleado 1"],
  ["a.b.c", "Campo"],
] as const;

for (const [key, field] of cases) {
  test(`preserves placeholder ${key}`, () => {
    const parsed = parseStepIntent(`Ingresar el valor [${key}] en el campo "${field}".`);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.type, "action_fill");
    assert.equal(parsed[0]?.actionTarget, field);
    assert.equal(parsed[0]?.valueKey, key);
  });
}

test("preserves a real sentence delimiter", () => {
  const parsed = parseStepIntent(
    'Ingresar el valor [auth.company_identifier] en el campo "RNC de la empresa". Continuar.'
  );
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0]?.valueKey, "auth.company_identifier");
});
