import assert from "node:assert/strict";
import { test } from "node:test";
import { createProject } from "../db/project-repository";
import { closeConnection } from "../db/sql-connection";
import { deleteProject } from "../db/project-service";
import { createInputRequirementsHandlers } from "../server/routes/projects";
import { deriveJiraInputRequirements } from "./jira-input-requirements";
import { persistJiraCaseInputs } from "./jira-case-input-persistence";

test("Jira input persistence survives a DB reconnect and is returned by the TestRail selection API", async () => {
  const projectSlug = `jira-input-contract-${crypto.randomUUID()}`;
  const requirements = deriveJiraInputRequirements([
    'Ingresar usuario en "Usuario"', 'Ingresar una contraseña no válida en "Contraseña"',
    'Seleccionar origen en "Cuenta de origen"', 'Seleccionar destino en "Cuenta de destino"',
    'Ingresar monto en "Monto"', 'Ingresar código en "Código"',
  ]);
  const values = Object.fromEntries(requirements.map((field, index) => [field.key, `synthetic-${index}`]));
  try {
    await createProject({ slug: projectSlug, name: "Jira input contract fixture", projectType: 1 });
    const result = await persistJiraCaseInputs({ projectSlug, scenarioId: "HU-42:jira:1",
      publishedCases: [{ scenarioId: "HU-42:jira:1", caseId: 41 }], requirements, values });
    assert.equal(result.values, 6);
    await closeConnection();
    const handlers = createInputRequirementsHandlers();
    let body: any;
    await handlers.getInputRequirements({ params: { projectSlug, caseId: "41" } }, {
      json(value: unknown) { body = value; }, status() { return this; },
    }, (error: unknown) => { throw error; });
    assert.deepEqual(body.inputRequirements.map((field: { key: string }) => field.key).sort(), requirements.map(field => field.key).sort());
    assert.deepEqual(body.runtimeValues, values);
    assert.equal(body.inputRequirements.filter((field: { controlType: string }) => field.controlType === "select").length, 2);
    await handlers.getInputRequirements({ params: { projectSlug, caseId: "42" } }, {
      json(value: unknown) { body = value; }, status() { return this; },
    }, (error: unknown) => { throw error; });
    assert.deepEqual(body.runtimeValues, {});
  } finally {
    await deleteProject(projectSlug).catch(() => undefined);
    await closeConnection();
  }
});
