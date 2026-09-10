import assert from "node:assert/strict";
import test from "node:test";
import { parseStepIntent } from "./step-intent-parser";

test("keeps a generic leading row scope as action metadata", () => {
  const parsed = parseStepIntent("En la primera fila, ingresar [x] en campo Y");

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.type, "action_fill");
  assert.equal(parsed[0]?.rowScope, 1);
  assert.equal(parsed[0]?.valueKey, "x");
  assert.equal(parsed[0]?.actionTarget, "Y");
  assert.equal(parsed.some((intent) => intent.type === "assertion"), false);
});

test("preserves a value key and associated field for a generic grid selection", () => {
  const [intent] = parseStepIntent(
    "En la segunda fila, seleccionar la opción [currency] en el campo Moneda asociado a Ingresos",
  );

  assert.equal(intent?.type, "action_select");
  assert.equal(intent?.rowScope, 2);
  assert.equal(intent?.actionTarget, "Moneda");
  assert.equal(intent?.selectionField, "Moneda");
  assert.equal(intent?.associatedField, "Ingresos");
  assert.equal(intent?.valueKey, "currency");
});

test("keeps expected value keys on row-scoped assertions", () => {
  const [intent] = parseStepIntent(
    "En la primera fila, validar que valor autocompletado sea [expected]",
  );

  assert.equal(intent?.type, "assertion");
  assert.equal(intent?.rowScope, 1);
  assert.equal(intent?.expectedValueKey, "expected");
});

