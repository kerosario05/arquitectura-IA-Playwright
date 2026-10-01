import assert from "node:assert/strict";
import test from "node:test";
import { observedFinalOutcome } from "./trace-to-scenario";

/**
 * Recording e52ee42c: the final oracle of a 61-step scenario was an observation from step 7, so it
 * was checked on the closing "¡Hola!" screen and blocked promotion; sub-flows got the setup row.
 */

const setup = { content: "Abrir la aplicación configurada del proyecto", expected: "La aplicación carga su pantalla inicial", classification: "FUNCTIONAL_ACTION" as const, isSetup: true };
const action = (content: string) => ({ content, expected: "", classification: "FUNCTIONAL_ACTION" as const });
const shows = (text: string) => ({ content: `El sistema muestra "${text}"`, expected: `Se muestra "${text}"`, classification: "FUNCTIONAL_ASSERTION" as const });

test("an observation followed by more actions is not the final outcome", () => {
  assert.equal(observedFinalOutcome([setup, action("Solicitar"), shows("Más detalles del producto"), action("Generar Turno"), action("Finalizar sesión")]), undefined);
});

test("the setup row is never the final outcome of a flow that acted", () => {
  assert.equal(observedFinalOutcome([setup, action("Explora"), action("Cancelar")]), undefined);
});

test("an observation after the last action is the final outcome", () => {
  assert.equal(observedFinalOutcome([setup, action("Finalizar sesión"), shows("¡Hola!")]), 'Se muestra "¡Hola!"');
  assert.equal(observedFinalOutcome([setup, shows("A"), action("Volver"), shows("B")]), 'Se muestra "B"');
});

test("a flow with only its setup keeps the setup's observation", () => {
  assert.equal(observedFinalOutcome([setup]), "La aplicación carga su pantalla inicial");
});
