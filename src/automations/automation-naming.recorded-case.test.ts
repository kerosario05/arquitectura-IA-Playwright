import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPlanAutomationId } from "./automation-naming";

const LONG_TITLE = "Desde ¡Hola!: Explora nuestros productos > … > Tarjeta Crédito Visa Clásica > Solicitar > Generar Turno";

test("a recorded case is named after its recorded scenario, not the batch position", () => {
  const first = buildPlanAutomationId({ externalId: "PREVIEW-001", title: LONG_TITLE, recordedScenarioId: "REC-7BDE3453-01" });
  const second = buildPlanAutomationId({ externalId: "PREVIEW-001", title: LONG_TITLE, recordedScenarioId: "REC-CD227D7B-01" });
  assert.equal(first, "rec-7bde3453-01-desde-hola-explora-nuestros-productos");
  assert.notEqual(first, second);
});

test("the title part of a recorded case id stays short enough for deep Windows paths", () => {
  const id = buildPlanAutomationId({ title: LONG_TITLE, recordedScenarioId: "REC-7BDE3453-01-ALT-1" });
  assert.ok(id.length <= "rec-7bde3453-01-alt-1-".length + 40, id);
  assert.ok(!id.endsWith("-"));
});

test("a case that does not come from a recording keeps the historical id", () => {
  assert.equal(buildPlanAutomationId({ externalId: "PREVIEW-001", title: "Consulta de préstamo" }), "preview-001-consulta-de-prestamo");
  assert.equal(buildPlanAutomationId({ caseId: 37844, title: "Login" }), "37844-login");
});
