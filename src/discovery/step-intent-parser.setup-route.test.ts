import assert from "node:assert/strict";
import test from "node:test";
import { parseStepIntent } from "./step-intent-parser";

test("does not parse a field named fecha de inicio as application navigation", () => {
  const intents = parseStepIntent('Ingresar fecha de inicio laboral en "Fecha de inicio laboral"');

  assert.ok(intents.some((intent) => intent.type === "action_fill"));
  assert.ok(!intents.some((intent) => intent.type === "setup_route"));
});

test("keeps configured application launch as a setup route", () => {
  const intents = parseStepIntent("Abrir la aplicación configurada del proyecto");

  assert.equal(intents[0]?.type, "setup_route");
  assert.equal(intents[0]?.actionTarget, "APP_BASE_URL");
});

test("recognizes an explicit return to the home page as navigation", () => {
  const intents = parseStepIntent("Ir al inicio");

  assert.equal(intents[0]?.type, "setup_route");
  assert.equal(intents[0]?.actionTarget, "APP_BASE_URL");
});

test("parses an explicit request action as a control interaction", () => {
  const intents = parseStepIntent("Solicitar el código de autorización");

  assert.equal(intents[0]?.type, "action_click");
  assert.equal(intents[0]?.actionTarget, "el código de autorización");
});

test("parses clearing a quoted field as an empty-value fill", () => {
  const intents = parseStepIntent('Dejar vacío "Número de documento"');

  assert.equal(intents[0]?.type, "action_fill");
  assert.equal(intents[0]?.actionTarget, "Número de documento");
  assert.equal(intents[0]?.value, "");
  assert.equal(intents[0]?.valueSource, "literal");
});
