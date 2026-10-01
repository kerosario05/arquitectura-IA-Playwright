import assert from "node:assert/strict";
import test from "node:test";
import { isPendingOutcomePlaceholder } from "./pending-outcome";
import { buildRecordingOutcomeAssertionStep } from "../cli/discovery-preview";

/**
 * Run d947dcc9: an AI-proposed variant whose outcome nobody recorded failed because its placeholder
 * "Resultado por confirmar; requiere revisión humana" became the assertion target
 * "; requiere revisión humana". Placeholders are never something to assert or click.
 */

test("the placeholders the engine writes are recognised", () => {
  for (const text of [
    "Resultado por confirmar; requiere revisión humana",
    "Resultado por confirmar: la grabación no observó esta variante",
    "Resultado esperado por confirmar",
    "Hipótesis pendiente de revisión: la aplicación inicia la vía de solicitud digital",
  ]) assert.equal(isPendingOutcomePlaceholder(text), true, text);
});

test("observed outcomes are not placeholders", () => {
  for (const text of ['Se muestra "Más detalles del producto"', "La aplicación carga su pantalla inicial", "", undefined]) {
    assert.equal(isPendingOutcomePlaceholder(text), false, String(text));
  }
});

test("an unknown final outcome adds no assertion to the replay; an observed one still does", () => {
  assert.equal(buildRecordingOutcomeAssertionStep("Resultado por confirmar; requiere revisión humana", 60), undefined);
  assert.equal(buildRecordingOutcomeAssertionStep('Se muestra "¡Hola!"', 60)?.action, 'Se muestra "¡Hola!"');
});
