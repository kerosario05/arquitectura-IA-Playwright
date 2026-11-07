import assert from "node:assert/strict";
import test from "node:test";
import { expectedResultIsCoveredByAssertion } from "./jira-semantic-executor";

const assertion = 'Validar que se muestre "la pantalla de nueva solicitud"';

test("trailing 'after <flow>' clause does not make a covered expected result a second oracle", () => {
  assert.equal(expectedResultIsCoveredByAssertion("Se muestra la pantalla de nueva solicitud después de acceder como Negocios.", assertion), true);
  assert.equal(expectedResultIsCoveredByAssertion("Se muestra la pantalla de nueva solicitud tras iniciar sesión.", assertion), true);
});

test("a genuinely different or additional outcome is still not covered", () => {
  assert.equal(expectedResultIsCoveredByAssertion("Se muestra la pantalla de nueva solicitud y un mensaje de éxito.", assertion), false);
  assert.equal(expectedResultIsCoveredByAssertion("No se muestra la pantalla de nueva solicitud después de acceder como Negocios.", assertion), false);
  assert.equal(expectedResultIsCoveredByAssertion('Se muestra la pantalla de nueva solicitud tras ver "Bienvenida".', assertion), false);
});
