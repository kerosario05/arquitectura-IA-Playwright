import assert from "node:assert/strict";
import test from "node:test";
import { parseStepIntent } from "./step-intent-parser";

test("a recorded file attachment is an executable fill-like action on its field, not an assertion", () => {
  const [intent] = parseStepIntent('Adjuntar "cedula-1.txt" en "Cédula del representante legal"');
  assert.equal(intent.type, "action_fill");
  assert.equal(intent.actionVerb, "upload");
  assert.equal(intent.actionTarget, "Cédula del representante legal");
});

test("a slash inside a fill target label does not turn the fill into a navigation path", () => {
  for (const label of ["Calle / Avenida / Autopista", "Departamento / Área", "Número casa / edificio"]) {
    const [intent] = parseStepIntent(`Ingresar "15" en "${label}"`);
    assert.equal(intent.type, "action_fill", label);
    assert.equal(intent.actionTarget, label);
  }
});

test("'ingresar a' keeps parsing a menu path", () => {
  const [intent] = parseStepIntent("Ingresar a Solicitudes > Nueva solicitud");
  assert.equal(intent.type, "navigation_path");
});

test("opening a second tab and switching back are executable actions", () => {
  const [open] = parseStepIntent('Abrir una pestaña nueva y navegar al link "http://localhost:4311/"');
  assert.equal(open.type, "action_click");
  assert.equal(open.actionTarget, "http://localhost:4311/");
  const [back] = parseStepIntent('Cambiar a la pestaña "http://localhost:4310/"');
  assert.equal(back.type, "action_click");
  assert.equal(back.actionTarget, "http://localhost:4310/");
});
