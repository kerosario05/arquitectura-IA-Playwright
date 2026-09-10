import assert from "node:assert/strict";
import test from "node:test";
import { buildSemanticRecordingModel } from "./semantic-recording";
import { buildHappyPathScenario, materializeRecordedScenario } from "./trace-to-scenario";
import type { SessionTrace } from "./session-trace.types";

function trace(overrides: Partial<SessionTrace> = {}): SessionTrace {
  return {
    recordingId: "recording-1",
    projectSlug: "web-project",
    appSlug: "web-project",
    platform: "web",
    baseUrl: "https://example.test",
    label: "Alta de colaborador",
    startedAt: new Date(0).toISOString(),
    status: "stopped",
    screens: [{
      screenKey: "screen-a",
      title: "Pantalla principal",
      fingerprint: "technical-fingerprint",
      url: "https://example.test/form",
      firstSeenAt: 0,
      controls: [],
      texts: [],
    }],
    events: [
      { seq: 0, t: 1, kind: "fill", screenKey: "screen-a", target: { label: "Nombre", role: "textbox", locators: [{ strategy: "aria-label", value: "Nombre" }] }, value: "Ana" },
      { seq: 1, t: 2, kind: "fill", screenKey: "screen-a", target: { label: "Contraseña", role: "textbox", sensitive: true, locators: [{ strategy: "aria-label", value: "Contraseña" }] }, redactedKey: "auth.password" },
      { seq: 2, t: 3, kind: "tap", screenKey: "screen-a", target: { label: "Selector", role: "combobox", locators: [{ strategy: "role", value: "combobox|Selector" }] } },
    ],
    ...overrides,
  };
}

test("derives semantic assets without rewriting the raw trace", () => {
  const input = trace();
  const model = buildSemanticRecordingModel(input);
  assert.equal(input.events.length, 3);
  assert.equal(model.source, "SessionTrace");
  assert.equal(model.datasets[0].valueRole, "action_input");
  assert.equal(model.datasets[0].source, "RECORDED_CONFIRMED");
  assert.equal(model.datasets[1].valueRole, "secure_input");
  assert.equal(model.datasets[1].value, undefined);
  assert.equal(model.semanticEvents[2].controlAffordance, "selectable");
  assert.ok(model.technicalObservations.every((observation) => observation.status === "VALIDATED"));
});

test("never exposes a technical fingerprint as a semantic title", () => {
  const input = trace();
  input.screens[0].title = "screen-a-fingerprint";
  const model = buildSemanticRecordingModel(input);
  assert.equal(model.semanticScreens[0].title, undefined);
});

test("keeps username as a normal action input while the web plan stays key-based", () => {
  const input = trace();
  input.events = [{
    seq: 0,
    t: 1,
    kind: "fill",
    screenKey: "screen-a",
    target: { label: "Nombre de usuario", role: "input", locators: [{ strategy: "aria-label", value: "Nombre de usuario" }] },
    value: "should-not-appear",
  }];
  const scenario = buildHappyPathScenario(input, input.events);
  assert.equal(scenario.webSteps[1]?.value, undefined);
  assert.equal(scenario.webSteps[1]?.valueKey, "nombre_de_usuario");
  assert.equal(scenario.requiredData[0]?.sensitive, false);
  assert.equal(scenario.requiredData[0]?.valueRole, "action_input");
  assert.equal(scenario.testRailSteps[1]?.stepTemplate, "Ingresar [nombre_de_usuario] en \"Nombre de usuario\"");
  assert.equal(scenario.testRailSteps[1]?.renderedStep, 'Ingresar "should-not-appear" en "Nombre de usuario"');
});

test("materializes password only when the project policy allows it", () => {
  const input = trace({
    recordingDataPolicy: { persistRecordedValues: true, persistQaCredentials: false, includeQaCredentialsInTestRail: false },
    events: [{
      seq: 0,
      t: 1,
      kind: "fill",
      screenKey: "screen-a",
      target: { label: "Contraseña", role: "input", inputType: "password", locators: [{ strategy: "aria-label", value: "Contraseña" }] },
      value: "secret-value",
    }],
  });
  const protectedScenario = buildHappyPathScenario(input, input.events);
  assert.equal(protectedScenario.testRailSteps[1]?.sensitive, true);
  assert.match(protectedScenario.testRailSteps[1]?.renderedStep ?? "", /valor seguro/);
  assert.equal(protectedScenario.requiredData[0]?.exampleValue, undefined);

  input.recordingDataPolicy = { persistRecordedValues: true, persistQaCredentials: true, includeQaCredentialsInTestRail: true };
  const allowedScenario = buildHappyPathScenario(input, input.events);
  assert.equal(allowedScenario.requiredData[0]?.exampleValue, "secret-value");
  assert.equal(allowedScenario.testRailSteps[1]?.renderedStep, 'Ingresar "secret-value" en "Contraseña"');
  const edited = materializeRecordedScenario(allowedScenario, { [allowedScenario.testRailSteps[1]?.valueKey ?? ""]: "edited-value" });
  assert.equal(edited.testRailSteps[1]?.stepTemplate, allowedScenario.testRailSteps[1]?.stepTemplate);
  assert.equal(edited.testRailSteps[1]?.renderedStep, 'Ingresar "edited-value" en "Contraseña"');
});
