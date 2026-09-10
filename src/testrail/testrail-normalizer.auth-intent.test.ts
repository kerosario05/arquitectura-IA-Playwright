import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTestRailCase } from "./testrail-normalizer";
import { isAuthenticationTestScenario } from "../discovery/case-discovery";

const explicitAuthSteps = [
  { content: "Ingresar el valor [credential.identifier] en el campo \"Identificador\"." },
  { content: "Ingresar el valor [credential.username] en el campo \"Usuario\"." },
  { content: "Ingresar el valor secreto [credential.password] en el campo \"Clave\"." },
  { content: "Hacer clic en el botón \"Continuar\"." },
  { content: "Validar que se muestre la pantalla autenticada." },
];

function rawCase(steps: Array<{ content: string }>, extra: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: "Caso estructural",
    custom_steps_separated: steps,
    ...extra,
  } as any;
}

test("infers full_authentication for an explicit authentication flow", () => {
  const scenario = normalizeTestRailCase(rawCase(explicitAuthSteps));
  assert.equal(scenario.authIntent, "full_authentication");
  assert.equal(isAuthenticationTestScenario(scenario), true);
});

test("does not classify a business flow with authentication prerequisite as an auth test", () => {
  const scenario = normalizeTestRailCase(rawCase([
    ...explicitAuthSteps.slice(0, 4),
    { content: "Navegar a la sección de reportes." },
    { content: "Validar que se muestre el reporte solicitado." },
  ]));
  assert.equal(scenario.authIntent, undefined);
  assert.equal(isAuthenticationTestScenario(scenario), false);
});

test("preserves explicit gate_observation", () => {
  const scenario = normalizeTestRailCase(rawCase(explicitAuthSteps, { authIntent: "gate_observation" }));
  assert.equal(scenario.authIntent, "gate_observation");
  assert.equal(isAuthenticationTestScenario(scenario), false);
});

test("preserves explicit full_authentication", () => {
  const scenario = normalizeTestRailCase(rawCase([], { authIntent: "full_authentication" }));
  assert.equal(scenario.authIntent, "full_authentication");
});

test("classifies a post-submit auxiliary action after an auth wait as full_authentication", () => {
  const scenario = normalizeTestRailCase(rawCase([
    ...explicitAuthSteps.slice(0, 4),
    { content: "Esperar que finalice el proceso de autenticación." },
    { content: "Hacer clic en un control auxiliar." },
    { content: "Validar que el formulario de acceso ya no sea la pantalla activa." },
    { content: "Validar que se muestre la pantalla inicial autenticada." },
  ]));
  assert.equal(scenario.authIntent, "full_authentication");
});

test("does not classify a post-submit action as auxiliary without an auth wait", () => {
  const scenario = normalizeTestRailCase(rawCase([
    ...explicitAuthSteps.slice(0, 4),
    { content: "Hacer clic en un control auxiliar." },
    { content: "Validar que se muestre la pantalla autenticada." },
  ]));
  assert.equal(scenario.authIntent, undefined);
});

test("keeps business actions after an auxiliary action outside full_authentication", () => {
  const scenario = normalizeTestRailCase(rawCase([
    ...explicitAuthSteps.slice(0, 4),
    { content: "Esperar que finalice el proceso de autenticación." },
    { content: "Hacer clic en un control auxiliar." },
    { content: "Hacer clic en una función del negocio." },
    { content: "Validar que se muestre el resultado del negocio." },
  ]));
  assert.equal(scenario.authIntent, undefined);
});
