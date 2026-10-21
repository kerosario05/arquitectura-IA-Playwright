import assert from "node:assert/strict";
import test from "node:test";
import { redactJiraScenarioInputs } from "./jira-rerun-manifest";
import { jobStore } from "../server/jobs/job-store";
import { jiraRuntimeValues } from "./jira-runtime-values";

test("scenario input overrides remain isolated and flat callers remain compatible", () => {
  const grouped = { a: { currency: "DOP" }, b: { currency: "USD" } };
  assert.deepEqual(jiraRuntimeValues(grouped, "a"), { currency: "DOP" });
  assert.deepEqual(jiraRuntimeValues(grouped, "b"), { currency: "USD" });
  assert.deepEqual(jiraRuntimeValues(grouped, "missing"), {});
  assert.deepEqual(jiraRuntimeValues({ currency: "USD" }, "a"), { currency: "USD" });
});

test("persisted Jira rerun keys preserve canonical numbering without literal inputs", () => {
  const scenario = { scenarioId: "AA-88-1", sourceIssueKey: "AA-88", title: "Synthetic", expectedResult: "",
    steps: ['Presionar "Solicitar"\nEsperado:pantalla de autenticación', 'Ingresar "synthetic-secret" en "Clave"'] };
  const safe = redactJiraScenarioInputs(scenario);
  assert.match(safe.steps[1], /\[jira_step_3\]/);
  assert.doesNotMatch(JSON.stringify(safe), /synthetic-secret/);
  assert.equal(safe.steps[0], scenario.steps[0]);
  assert.equal(scenario.steps[1], 'Ingresar "synthetic-secret" en "Clave"');
});

test("public Jira job redacts inputs while the internal runner retains transient values", () => {
  const job = jobStore.create("scenario-preview", { executionEngine: "jira_semantic", scenarioOrigin: { kind: "jira_generated", jiraKey: "AA-88" },
    dataOverrides: { clave: "synthetic-secret" }, scenarios: [{ scenarioId: "AA-88-1", sourceIssueKey: "AA-88", title: "Synthetic", expectedResult: "",
      steps: ['Ingresar "synthetic-secret" en "Clave"'] }] });
  assert.doesNotMatch(JSON.stringify(jobStore.get(job.id)), /synthetic-secret/);
  assert.equal((jobStore.getInternal(job.id)!.params.dataOverrides as Record<string, string>).clave, "synthetic-secret");
  jobStore.clearTransientParams(job.id);
  assert.doesNotMatch(JSON.stringify(jobStore.get(job.id)), /synthetic-secret/);
});
