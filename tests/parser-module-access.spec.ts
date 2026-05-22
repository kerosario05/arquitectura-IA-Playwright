import { test, expect } from "@playwright/test";
import { parseStepIntent, classifyStepSet } from "../src/discovery/step-intent-parser";

test("'Acceder al módulo \"Generar cartas\"' produces action target 'Generar cartas'", () => {
  const intents = parseStepIntent('Acceder al módulo "Generar cartas".');
  expect(intents.length).toBeGreaterThan(0);
  expect(intents[0].type).toBe("action_click");
  expect(intents[0].actionTarget).toBe("Generar cartas");
});

test("'Ingresar al módulo \"Pago de productos\"' produces action target 'Pago de productos'", () => {
  const intents = parseStepIntent('Ingresar al módulo "Pago de productos".');
  expect(intents.length).toBeGreaterThan(0);
  expect(intents[0].type).toBe("action_click");
  expect(intents[0].actionTarget).toBe("Pago de productos");
});

test("'Abrir el módulo \"Consulta de balance\"' produces action target 'Consulta de balance'", () => {
  const intents = parseStepIntent('Abrir el módulo "Consulta de balance".');
  expect(intents.length).toBeGreaterThan(0);
  expect(intents[0].type).toBe("action_click");
  expect(intents[0].actionTarget).toBe("Consulta de balance");
});

test("Module access steps are not classified as assertion targets", () => {
  const intents = parseStepIntent('Acceder al módulo "Generar cartas".');
  const classified = classifyStepSet(intents);
  expect(classified.assertionIntents.length).toBe(0);
  expect(classified.actionIntents.length).toBeGreaterThan(0);
});

test("C37869 parser includes 'Generar cartas' before 'Carta de referencia'", () => {
  const fullStep = 'Acceder al módulo "Generar cartas".Seleccionar "Carta de referencia".';
  const intents = parseStepIntent(fullStep);
  const actionTargets = intents.filter(i => i.actionTarget).map(i => i.actionTarget);

  expect(actionTargets).toContain("Generar cartas");
  expect(actionTargets).toContain("Carta de referencia");

  const generacionIndex = actionTargets.indexOf("Generar cartas");
  const cartaIndex = actionTargets.indexOf("Carta de referencia");
  expect(generacionIndex).toBeLessThan(cartaIndex);
});

test("Assertion 'Validar que se muestre la vista previa de la carta' remains assertion target", () => {
  const intents = parseStepIntent('Validar que se muestre la vista previa de la carta.');
  expect(intents.length).toBeGreaterThan(0);
  expect(intents[0].type).toBe("assertion");
});

test("'Continuar.' as functional step is action target", () => {
  const intents = parseStepIntent('Continuar.');
  expect(intents.length).toBeGreaterThan(0);
  expect(intents[0].type).toBe("action_click");
  expect(intents[0].actionTarget).toBe("Continuar");
});

test("'Acceder a \"Generar cartas\"' produces action target", () => {
  const intents = parseStepIntent('Acceder a "Generar cartas".');
  expect(intents.length).toBeGreaterThan(0);
  expect(intents[0].type).toBe("action_click");
  expect(intents[0].actionTarget).toBe("Generar cartas");
});

test("'Ir al módulo \"Transacciones\"' produces action target", () => {
  const intents = parseStepIntent('Ir al módulo "Transacciones".');
  expect(intents.length).toBeGreaterThan(0);
  expect(intents[0].type).toBe("action_click");
  expect(intents[0].actionTarget).toBe("Transacciones");
});

test("'Entrar a \"Configuración\"' produces action target", () => {
  const intents = parseStepIntent('Entrar a "Configuración".');
  expect(intents.length).toBeGreaterThan(0);
  expect(intents[0].type).toBe("action_click");
  expect(intents[0].actionTarget).toBe("Configuración");
});
