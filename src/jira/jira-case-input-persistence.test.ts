import assert from "node:assert/strict";
import { test } from "node:test";
import { persistJiraCaseInputs } from "./jira-case-input-persistence";
import { deriveJiraInputRequirements } from "./jira-input-requirements";

test("keeps every Jira fill/select key and value scoped to its mapped project and TestRail case", async () => {
  const requirements = deriveJiraInputRequirements([
    'Ingresar usuario en "Usuario"', 'Ingresar contraseña en "Contraseña"',
    'Seleccionar cuenta en "Cuenta origen"', 'Seleccionar cuenta en "Cuenta destino"',
  ]);
  const metadata: unknown[] = [];
  const stored: unknown[] = [];
  const dependencies = {
    replace: async (projectSlug: string, caseId: number, fields: unknown[]) => { metadata.push({ projectSlug, caseId, fields }); },
    persist: async (input: { projectSlug: string; caseId: number; values: readonly { key: string; value: string | number | boolean }[] }) => { stored.push(input); return input.values.length; },
  };
  for (const [projectSlug, caseId] of [["project-a", 101], ["project-b", 202]] as const) {
    const values = Object.fromEntries(requirements.map((field, index) => [field.key, `synthetic-${projectSlug}-${index}`]));
    const result = await persistJiraCaseInputs({ projectSlug, scenarioId: "HU-1:jira:1",
      publishedCases: [{ scenarioId: "launch-alias", executionScenarioId: "HU-1:jira:1", caseId }],
      requirements, values: { ...values, unrelated: "ignored" },
    }, dependencies);
    assert.deepEqual(result, { status: "persisted", caseId, fields: 4, values: 4 });
  }
  const first = stored[0] as { projectSlug: string; caseId: number; values: Array<{ key: string; value: string }> };
  assert.equal(first.projectSlug, "project-a");
  assert.equal(first.caseId, 101);
  assert.deepEqual(first.values.map(field => field.key), requirements.map(field => field.key));
  assert.ok(first.values.every(field => field.value.startsWith("synthetic-project-a-")));
  assert.equal(metadata.length, 2);
});

test("does not guess a TestRail case or write values when the mapping is missing or ambiguous", async () => {
  const dependencies = { replace: async () => { throw new Error("unexpected write"); }, persist: async () => { throw new Error("unexpected write"); } };
  for (const publishedCases of [[], [{ scenarioId: "scenario", caseId: 1 }, { scenarioId: "scenario", caseId: 2 }]]) {
    assert.deepEqual(await persistJiraCaseInputs({ projectSlug: "project-c", scenarioId: "scenario", publishedCases,
      requirements: [], values: {},
    }, dependencies), { status: "unmapped", fields: 0, values: 0 });
  }
});
