import assert from "node:assert/strict";
import test from "node:test";
import { parseStepIntent } from "./step-intent-parser";

test("preserves the field relationship for option selections", () => {
  const [intent] = parseStepIntent(
    'Seleccionar la opción "Cédula" en el campo de tipo de identificación.'
  );

  assert.equal(intent?.type, "action_select");
  assert.equal(intent?.actionTarget, "Cédula");
  assert.equal(intent?.selectionField, "tipo de identificación");
});

test("does not add a field relationship to a standalone option selection", () => {
  const [intent] = parseStepIntent('Seleccionar la opción "Cédula".');

  assert.equal(intent?.type, "action_select");
  assert.equal(intent?.actionTarget, "Cédula");
  assert.equal(intent?.selectionField, undefined);
});
