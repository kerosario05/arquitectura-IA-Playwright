import assert from "node:assert/strict";
import test from "node:test";
import { aggregateTextUsedAsValue, buildSemanticRecordingModel, detectFormatMask, resolveRecordedField } from "./semantic-recording";
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

test("materializes QA password under the invariant recording policy: real value stays in the EXECUTION channel, DISPLAY stays safe regardless of policy", () => {
  // FIRST_LEAK fix: this test used to assert `renderedStep` (DISPLAY text) materialized the raw
  // secret ('Ingresar "secret-value" en "Contraseña"') under the "invariant" persistQaCredentials
  // policy -- that was the exact leak this ticket removes. `persistQaCredentials`/
  // `includeQaCredentialsInTestRail` govern the EXECUTION channel (`requiredData[].exampleValue`,
  // asserted below, unaffected) only; DISPLAY text for a sensitive field is now always the
  // generic, safe form, independent of any recording policy.
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
  const allowedScenario = buildHappyPathScenario(input, input.events);
  assert.equal(allowedScenario.testRailSteps[1]?.sensitive, true);
  assert.equal(allowedScenario.requiredData[0]?.exampleValue, "secret-value");
  assert.equal(allowedScenario.testRailSteps[1]?.renderedStep, 'Ingresar el valor seguro asociado a "Contraseña"');
  assert.ok(!allowedScenario.testRailSteps[1]?.renderedStep?.includes("secret-value"));
  const edited = materializeRecordedScenario(allowedScenario, { [allowedScenario.testRailSteps[1]?.valueKey ?? ""]: "edited-value" });
  assert.equal(edited.testRailSteps[1]?.stepTemplate, allowedScenario.testRailSteps[1]?.stepTemplate);
  assert.equal(edited.testRailSteps[1]?.renderedStep, 'Ingresar "edited-value" en "Contraseña"');
});

test("rejects format masks and generic labels as durable semantic fields", () => {
  assert.equal(detectFormatMask("000-0000000-0"), true);
  assert.equal(detectFormatMask("dd/mm/yyyy"), true);
  for (const label of ["000-0000000-0", "Indicar...", "campo"]) {
    const resolution = resolveRecordedField({ label, role: "input", inputType: "text", locators: [] });
    assert.equal(resolution.semanticField, null);
    assert.equal(resolution.needsReview, true);
  }
});

test("structural header association outranks a format placeholder", () => {
  const resolution = resolveRecordedField({
    label: "000-000-0000",
    placeholder: "000-000-0000",
    headerContext: "Teléfono del colaborador",
    role: "input",
    locators: [],
  });
  assert.equal(resolution.semanticField, "Teléfono del colaborador");
  assert.equal(resolution.needsReview, false);
  assert.equal(resolution.formatHint, "000-000-0000");
});

test("unresolved values remain preserved and primary wording stays functional", () => {
  const input = trace({
    recordingGoal: { declaredGoal: "Agregar varios colaboradores", normalizedGoal: "Agregar varios colaboradores", provenance: "USER_DECLARED", needsReview: false },
    events: [{
      seq: 0,
      t: 1,
      kind: "fill",
      screenKey: "screen-a",
      target: { label: "Indicar...", role: "input", locators: [] },
      value: "calidad@test.com.do",
    }],
  });
  const model = buildSemanticRecordingModel(input);
  const field = model.datasets[0];
  assert.equal(field.semanticField, null);
  assert.equal(field.value, "calidad@test.com.do");
  assert.equal(field.needsReview, true);
  const scenario = buildHappyPathScenario(input, input.events);
  assert.match(scenario.description, /Agregar varios colaboradores/);
  assert.doesNotMatch(scenario.description, /screen-a|pantalla 1|fingerprint/);
  assert.match(scenario.testRailSteps.at(-1)?.renderedStep ?? "", /calidad@test.com.do/);
  assert.match(scenario.testRailSteps.at(-1)?.renderedStep ?? "", /Campo pendiente de identificar/);
});

test("maps compound children only from shared row structure", () => {
  const input = trace({
    events: [
      { seq: 0, t: 1, kind: "tap", screenKey: "screen-a", target: { label: "Moneda", role: "combobox", rowIdentity: "row-1", locators: [{ strategy: "role", value: "combobox|Moneda" }] } },
      { seq: 1, t: 2, kind: "fill", screenKey: "screen-a", target: { label: "campo", role: "input", rowIdentity: "row-1", headerContext: "Monto", locators: [{ strategy: "css", value: "#amount" }] }, value: "1500" },
    ],
  });
  const model = buildSemanticRecordingModel(input);
  const compound = model.semanticComponents.find((component) => component.compoundField);
  assert.ok(compound);
  assert.equal(compound?.children?.length, 2);
  assert.equal(compound?.children?.[1]?.affordance, "editable");
});

test("does not split an aggregate compound display value without child evidence", () => {
  const input = trace({
    events: [{
      seq: 0,
      t: 1,
      kind: "fill",
      screenKey: "screen-a",
      target: { label: "campo", role: "input", rowIdentity: "row-1", associatedField: "Ingresos", locators: [] },
      value: "DOP 1,5000",
    }],
  });
  assert.equal(aggregateTextUsedAsValue(input.events[0]), true);
  const model = buildSemanticRecordingModel(input);
  assert.equal(model.datasets.length, 1);
  assert.equal(model.datasets[0]?.value, "DOP 1,5000");
  assert.equal(model.datasets[0]?.needsReview, true);
  assert.match(model.datasets[0]?.reviewReason ?? "", /aggregate_compound/);
});

test("preserves selection and amount as two datasets when two controls are observed", () => {
  const input = trace({
    events: [
      { seq: 0, t: 1, kind: "tap", screenKey: "screen-a", target: { label: "DOP", role: "option", rowIdentity: "row-1", associatedField: "Ingresos", afterValue: "DOP", locators: [{ strategy: "text", value: "DOP" }] } },
      { seq: 1, t: 2, kind: "fill", screenKey: "screen-a", target: { label: "campo", role: "input", rowIdentity: "row-1", associatedField: "Ingresos", locators: [{ strategy: "css", value: "#amount" }] }, value: "1500" },
    ],
  });
  const model = buildSemanticRecordingModel(input);
  assert.deepEqual(model.datasets.map((item) => item.value), ["DOP", "1500"]);
  const scenario = buildHappyPathScenario(input, input.events);
  assert.match(scenario.testRailSteps.map((step) => step.renderedStep ?? "").join(" | "), /DOP/);
  assert.match(scenario.testRailSteps.map((step) => step.renderedStep ?? "").join(" | "), /1500/);
});

test("materializes the V1 compound roles and technical state separately", () => {
  const input = trace({
    events: [
      {
        seq: 0,
        t: 1,
        kind: "tap",
        screenKey: "screen-a",
        target: {
          label: "USD",
          role: "option",
          interactionType: "select",
          compoundRole: "selection",
          associatedField: "Ingresos",
          cellRef: "cell:1:ingresos",
          rowRef: "row:1",
          headerRef: "header:Ingresos",
          afterValue: "USD",
          dynamicLifecycle: { selectedOption: "USD", options: ["USD", "DOP"], observationWindowMs: 180 },
          locators: [{ strategy: "text", value: "USD" }],
        },
      },
      {
        seq: 1,
        t: 2,
        kind: "fill",
        screenKey: "screen-a",
        target: {
          label: "campo",
          role: "input",
          compoundRole: "amount_or_text",
          associatedField: "Ingresos",
          cellRef: "cell:1:ingresos",
          rowRef: "row:1",
          headerRef: "header:Ingresos",
          beforeState: { value: "" },
          afterState: { value: "1500" },
          locators: [{ strategy: "css", value: "#amount" }],
        },
        value: "1500",
      },
    ],
  });
  const model = buildSemanticRecordingModel(input);
  assert.deepEqual(model.datasets.map((item) => item.valueKey).sort(), ["ingresos_seleccion", "ingresos_valor"]);
  assert.equal(model.semanticEvents[0]?.action, "select");
  assert.equal(model.technicalObservations[0]?.cellRef, "cell:1:ingresos");
  const compound = model.semanticComponents.find((component) => component.compoundField);
  assert.deepEqual(compound?.children?.map((child) => child.semanticRole), ["selection", "amount_or_text"]);
  assert.equal(compound?.children?.[0]?.valueKey, "ingresos_seleccion");
  assert.equal(compound?.children?.[1]?.valueKey, "ingresos_valor");
});

test("propagates a child beforeinput buffer instead of the compound display", () => {
  const input = trace({
    events: [{
      seq: 0,
      t: 1,
      kind: "fill",
      screenKey: "screen-a",
      target: {
        label: "display",
        role: "input",
        compoundRole: "amount_or_text",
        associatedField: "Compound",
        rowRef: "row-a",
        cellRef: "cell-a",
        eventTargetRef: "child-input",
        currentTargetRef: "compound-parent",
        deepestEditableTargetRef: "child-input",
        inputEventData: ["5", "5", "0", "0", "0"],
        inputTypes: ["insertText", "insertText", "insertText", "insertText", "insertText"],
        displayValue: "Option 55,000",
        committedValue: "Option 55,000",
        technicalTargetCandidates: [{
          targetType: "structural",
          semanticRole: "amount_or_text",
          locatorCandidates: [{ strategy: "structural", value: "cell-a|amount_or_text" }],
          structuralContext: { rowRef: "row-a", cellRef: "cell-a" },
          interactionEvidence: ["event-1"],
          confidence: 0.9,
          validatedByInteraction: true,
        }],
        locators: [{ strategy: "structural", value: "cell-a" }],
      },
      value: "Option 55,000",
    }],
  });
  const model = buildSemanticRecordingModel(input);
  assert.equal(model.datasets[0]?.value, "55000");
  assert.equal(model.datasets[0]?.displayValue, "Option 55,000");
});

test("stable component identity keeps sibling controls separate inside one container", () => {
  const input = trace({
    events: [
      { seq: 0, t: 1, kind: "fill", screenKey: "screen-a", target: { label: "RNC", role: "textbox", containerIdentity: "form", bounds: { x: 10, y: 20, width: 100, height: 20 }, locators: [{ strategy: "css", value: "#rnc" }] }, value: "1" },
      { seq: 1, t: 2, kind: "fill", screenKey: "screen-a", target: { label: "Usuario", role: "textbox", containerIdentity: "form", bounds: { x: 10, y: 60, width: 100, height: 20 }, locators: [{ strategy: "css", value: "#user" }] }, value: "u" },
      { seq: 2, t: 3, kind: "fill", screenKey: "screen-a", target: { label: "Clave", role: "textbox", containerIdentity: "form", bounds: { x: 10, y: 100, width: 100, height: 20 }, locators: [{ strategy: "css", value: "#password" }] }, value: "p" },
    ],
  });
  const model = buildSemanticRecordingModel(input);
  const controls = model.semanticComponents.filter((component) => component.screenIdentity === "screen-a");
  assert.equal(new Set(controls.map((component) => component.componentId)).size, controls.length);
  assert.ok(controls.length >= 3);
});
