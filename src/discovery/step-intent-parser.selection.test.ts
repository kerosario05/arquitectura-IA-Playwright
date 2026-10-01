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

test("preserves a runtime-backed selection field when the recording omits the word campo", () => {
  const [intent] = parseStepIntent('Seleccionar [moneda_seleccion] en "Moneda"');

  assert.equal(intent?.type, "action_select");
  assert.equal(intent?.actionTarget, "Moneda");
  assert.equal(intent?.selectionField, "Moneda");
  assert.equal(intent?.valueKey, "moneda_seleccion");
});

test("preserves a literal selection value and its field from a canonical scenario step", () => {
  const [intent] = parseStepIntent('Seleccionar "DOP" en "Moneda"');

  assert.equal(intent?.type, "action_select");
  assert.equal(intent?.actionTarget, "Moneda");
  assert.equal(intent?.selectionField, "Moneda");
  assert.equal(intent?.value, "DOP");
});

test("preserves a literal fill value and its field from a canonical scenario step", () => {
  const [intent] = parseStepIntent('Ingresar "Analista" en "Puesto"');

  assert.equal(intent?.type, "action_fill");
  assert.equal(intent?.actionTarget, "Puesto");
  assert.equal(intent?.value, "Analista");
});
