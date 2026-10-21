import assert from "node:assert/strict";
import test from "node:test";
import { parseStepIntent } from "../discovery/step-intent-parser";
import { auditGeneratedJiraSyntax } from "./jira-scenario-generator";

const candidate = (steps: string[]) => ({
  sourceIssueKey: "X-1",
  title: "Consultar y exportar",
  steps,
  expectedResult: "Se muestra \"Resultados\".",
  preconditions: [],
  inputRequirements: [],
});

test("export/download controls and date-start fields are UI actions, not setup routes", async () => {
  for (const step of ['Presionar "Exportar CSV".', 'Ingresar una fecha de inicio en "Desde".']) {
    assert.ok(!parseStepIntent(step).some((intent) => intent.type === "setup_route"), step);
  }
  const failures = await auditGeneratedJiraSyntax([candidate([
    "Abrir la aplicación configurada del proyecto",
    'Presionar "Exportar CSV".',
    'Validar que se descarga "reporte.csv".',
  ])]);
  assert.ok(!failures.some((failure) => failure.reason === "JIRA_ROUTE_NOT_DECLARED"), JSON.stringify(failures));
});

test("an explicit setup route without a declared URL is still rejected", async () => {
  const failures = await auditGeneratedJiraSyntax([candidate(["Acceder a la aplicación"])]);
  assert.ok(failures.some((failure) => failure.reason === "JIRA_ROUTE_NOT_DECLARED"), JSON.stringify(failures));
});
