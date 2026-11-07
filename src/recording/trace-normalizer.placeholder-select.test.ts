import assert from "node:assert/strict";
import test from "node:test";
import { disambiguatePlaceholderSelectionFields, isPlaceholderPrompt, stripPlaceholderOrdinal } from "./trace-normalizer";

test("the ordinal is stripped only from placeholder prompts", () => {
  assert.equal(stripPlaceholderOrdinal("Seleccione una opción (2)"), "Seleccione una opción");
  assert.equal(stripPlaceholderOrdinal("Seleccione una opción"), "Seleccione una opción");
  assert.equal(stripPlaceholderOrdinal("Firma autorizada (2)"), "Firma autorizada (2)");
});

const selection = (seq: number, associatedField: string, label: string): any =>
  ({ seq, t: seq, kind: "tap", target: { label, role: "option", compoundRole: "selection", associatedField } });

test("empty-state prompts are placeholders, real field names are not", () => {
  for (const prompt of ["Seleccione una opción", "Seleccione…", "seleccionar", "Select", "Select an option", "Elija una opción"]) {
    assert.equal(isPlaceholderPrompt(prompt), true, prompt);
  }
  for (const name of ["Código referente", "Seleccionar fila", "Tipo de cliente", "Plazo", "", undefined]) {
    assert.equal(isPlaceholderPrompt(name), false, String(name));
  }
});

test("same-prompt selections get their own field name; real labels are untouched", () => {
  const out = disambiguatePlaceholderSelectionFields([
    selection(1, "Seleccione una opción", "PRÉSTAMOS PERSONALES NUEVOS"),
    selection(2, "Plazo", "12 meses"),
    selection(3, "Seleccione una opción", "Construcción"),
    selection(4, "Seleccione una opción", "Depósito a Cuenta"),
    selection(5, "Plazo", "24 meses"),
  ]);
  assert.deepEqual(out.map((event) => event.target?.associatedField), [
    "Seleccione una opción", "Plazo", "Seleccione una opción (2)", "Seleccione una opción (3)", "Plazo",
  ]);
});
