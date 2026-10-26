import assert from "node:assert/strict";
import test from "node:test";
import { jiraEnabledFieldTargets, jiraExpectedResultCoveredByAuthoredSteps as covered, jiraResetFieldTargets } from "./jira-expected-result-coverage";
import { compileJiraSpec } from "./jira-spec-compiler";
import path from "node:path";

test("narrative results are covered only when their menu destination is clicked and asserted", () => {
  const scenario = { title: "Menú del rol Negocios", expectedResult: "El menú de Negocios permite acceder a Solicitudes y muestra Nueva solicitud.",
    steps: ['Ingresar un usuario de Negocios en "Usuario"', 'Presionar "Solicitudes"', 'Validar que se muestre "Nueva solicitud"'] };
  assert.equal(covered(scenario), true);
  assert.equal(covered({ ...scenario, expectedResult: `${scenario.expectedResult.slice(0, -1)} y se muestra una alerta de bienvenida.` }), false);
  assert.equal(covered({ ...scenario, steps: scenario.steps.slice(0, 2) }), false);
});

test("a direct navigation result is covered only by the matching click and destination assertion", () => {
  const scenario = { expectedResult: "Explora nuestros productos dirige directamente a Información de productos.",
    steps: ['Presionar "Explora nuestros productos"', 'Validar que se muestre "Información de productos"'] };
  assert.equal(covered(scenario), true);
  assert.equal(covered({ ...scenario, steps: scenario.steps.slice(0, 1) }), false);
  assert.equal(covered({ ...scenario, expectedResult: "Explora nuestros productos dirige directamente a Información de productos y muestra los productos disponibles." }), false);
});

test("a saved complete draft summary needs every required input action, save, and observed draft identity", () => {
  const steps = ['Ingresar "dato" en "RNC"', 'Ingresar "dato" en "Denominación Social"',
    'Seleccionar "SRL" en "Tipo Sociedad"', 'Presionar "Guardar borrador"',
    'Validar que se muestre "Borrador"', 'Validar que se muestre "INVERSIONES DEL CARIBE SRL"'];
  const inputRequirements = [
    { key: "rnc", label: "RNC", stepIndex: 1 },
    { key: "name", label: "Denominación Social", stepIndex: 2 },
    { key: "type", label: "Tipo Sociedad", stepIndex: 3 },
  ];
  const scenario = { expectedResult: "La solicitud con el registro completo se guarda como borrador.", steps, inputRequirements };
  assert.equal(covered(scenario), true);
  assert.equal(covered({ ...scenario, inputRequirements: inputRequirements.slice(0, 2) }), false);
  assert.equal(covered({ ...scenario, expectedResult: `${scenario.expectedResult.slice(0, -1)} y notifica al supervisor.` }), false);
});

test("cascade and section-navigation summaries require their authored field and navigation evidence", () => {
  assert.equal(covered({ expectedResult: "La dirección en cascada queda completa.",
    steps: ['Seleccionar "Región" en "Departamento"', 'Seleccionar "Santiago" en "Provincia"',
      'Seleccionar "Santiago" en "Municipio"', 'Seleccionar "Los Jardines" en "Sectores"',
      'Validar que se muestre "Direcciones"'] }), true);
  const navigation = { expectedResult: "Se muestran todas las secciones y la navegación entre pestañas funciona.",
    steps: ['Validar que se muestre "Datos Generales"', 'Validar que se muestre "Capital y Finanzas"',
      'Validar que se muestre "Fechas Clave"', 'Validar que se muestre "Dirección y Contacto"',
      'Validar que se muestre "Gestión Documental"', 'Presionar "Flujo de Solicitud"',
      'Presionar "Registro de Datos"', 'Validar que se muestre "Verificar Solicitante"'] };
  assert.equal(covered(navigation), true);
  assert.equal(covered({ ...navigation, steps: navigation.steps.slice(0, 5) }), false);
});

test("logout, flow-log, and notification summaries need explicit postconditions", () => {
  assert.equal(covered({ expectedResult: 'Después de presionar "Salir", se muestra "Usuario" en el login.',
    steps: ['Presionar "Salir"', 'Validar que se muestre "Usuario"'] }), true);
  assert.equal(covered({ expectedResult: "Se muestra el avance por etapas y la bitácora.",
    steps: ['Validar que se muestre "Estado del flujo"', 'Validar que se muestre "Bitácora"',
      'Validar que se muestre "Solicitud creada"'] }), true);
  assert.equal(covered({ expectedResult: "La campana abre el listado filtrado por Devuelta.",
    steps: ['Presionar "Notificaciones"', 'Validar que se muestre "Solicitudes de prospectos PJ"',
      'Validar que se muestre "Devuelta"'] }), true);
  assert.equal(covered({ expectedResult: "La campana abre el listado filtrado por Devuelta.",
    steps: ['Presionar "Notificaciones"', 'Validar que se muestre "Solicitudes de prospectos PJ"'] }), false);
});

test("enabled-field summaries expand only into previously authored field labels", () => {
  const result = "Se habilitan país de origen, registro y representante.";
  const steps = ['Validar que se muestre "País de Origen"', 'Validar que se muestre "Registro en País de Origen"',
    'Validar que se muestre "Representante en el País"'];
  assert.deepEqual(jiraEnabledFieldTargets(result, steps), ["País de Origen", "Registro en País de Origen", "Representante en el País"]);
  assert.deepEqual(jiraEnabledFieldTargets(result, steps.slice(0, 2)), [], "a missing field label prevents dropping the enabled-state claim");
});

test("reset summaries expand into empty-value checks only for fields entered before clear", () => {
  const input = { expectedResult: "El formulario se restablece y la consulta desaparece.",
    steps: ['Ingresar "synthetic-id" en "Número de Identificación"', 'Presionar "Consultar"',
      'Validar que se muestre "Nuevo Prospecto"', 'Presionar "Limpiar consulta"',
      'Validar que no se muestre "Nuevo Prospecto"'],
    inputRequirements: [{ key: "identity", label: "Número de Identificación", stepIndex: 1 },
      { key: "username", label: "Usuario", stepIndex: 1 }] };
  assert.deepEqual(jiraResetFieldTargets(input), ["Número de Identificación"]);
  assert.deepEqual(jiraResetFieldTargets({ ...input, steps: input.steps.slice(0, 4) }), [],
    "without a later assertion that the query disappears, the summary remains unproven");
});

test("field-state evidence compiles to a direct runtime assertion, never text visibility", () => {
  for (const kind of ["field_enabled", "field_empty"] as const) {
    const compiled = compileJiraSpec({
      plan: { scenario: { source: "jira", title: "Field state" }, steps: [{ index: 1, action: "assertVisible",
        description: `Validar estado de Campo`, target: { strategy: "text", value: "Campo" } }] } as never,
      sourceScenario: { observableOracles: [{ type: "field_state", stepIndex: 1, target: "Campo", backed: true, details: { kind } }] },
      appSlug: "fixture", sectionSlug: "jira", automationId: "field-state", specPath: path.resolve(".artifacts/tmp/field-state/case.spec.ts"),
    });
    assert.deepEqual(compiled.unsupported, []);
    assert.match(compiled.source, new RegExp(`assertJiraSpecField${kind === "field_enabled" ? "Enabled" : "Empty"}\\(page, \\\"Campo\\\"`));
    assert.doesNotMatch(compiled.source, /assertJiraSpecVisibleText\(page, "Campo"/);
  }
});
