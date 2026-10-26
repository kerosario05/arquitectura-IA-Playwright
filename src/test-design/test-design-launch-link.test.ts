import assert from "node:assert/strict";
import test from "node:test";
import type { RawTestRailCase } from "../types/testrail.types";
import { toCaseInput } from "./test-design-publisher";
import { testRailPayloadContentVersion, toJiraSemanticDesignScenario } from "./test-design-lineage";
import { sanitizeTestDesignLineageScenario } from "./test-design-lineage";
import { resolveTestDesignLaunchLinks } from "./test-design-launch-link";
import { normalizeScenario } from "./test-design.validation";

function fixture() {
  const scenario = normalizeScenario({
    id: "design-scenario-1", title: "Pago aprobado", preconditions: "Sesión iniciada",
    steps: [{ action: 'Presionar "Pagar"', expected: "" }], expectedResult: "Se muestra el recibo",
    selectedForTestRail: true,
  }, 0, { origin: "ai" });
  scenario.jiraSourceScenarioId = "PAY-7:jira:1";
  scenario.jiraSourceScenario = {
    sourceIssueKey: "PAY-7", title: "Pago aprobado", preconditions: ["Sesión iniciada"],
    steps: ['Presionar "Pagar"'], expectedResult: "Se muestra el recibo", scenarioId: "PAY-7:jira:1",
  } as never;
  const payload = toCaseInput(scenario, "PAY-7", { requiredCustomFields: {}, caseOracle: "QA" });
  const remote: RawTestRailCase = {
    id: 701, title: payload.title, custom_preconds: payload.preconditions,
    custom_steps_separated: payload.stepsSeparated, custom_expected: payload.customExpected,
  };
  const link = {
    testRailCaseId: 701, testRailProjectId: 15, testRailSuiteId: 2, testRailSectionId: 3,
    projectSlug: "payments", jiraProjectKey: "PAY", issueKey: "PAY-7", draftId: "draft-1", storyId: "story-1",
    designScenarioId: scenario.id, jiraScenarioId: scenario.jiraSourceScenarioId!,
    contentVersion: testRailPayloadContentVersion(payload), scenario, publishedAt: new Date(0).toISOString(),
  };
  return { scenario, payload, remote, link };
}

test("a published case routes to Jira only with its exact case link and matching content revision", async () => {
  const { remote, link } = fixture();
  const result = await resolveTestDesignLaunchLinks({
    caseIds: [701], projectId: 15, appSlug: "payments", links: [link],
    client: { getCase: async () => remote, updateCase: async () => remote },
  });
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.linked[0].designScenarioId, "design-scenario-1");
});

test("changed TestRail content returns explicit sync-or-normal choices without guessing by Jira reference", async () => {
  const { remote, link } = fixture();
  const result = await resolveTestDesignLaunchLinks({
    caseIds: [701], projectId: 15, appSlug: "payments", links: [link],
    client: { getCase: async () => ({ ...remote, title: "Changed outside Design" }), updateCase: async () => remote },
  });
  assert.deepEqual(result.linked, []);
  assert.deepEqual(result.conflicts, [{
    caseId: 701, issueKey: "PAY-7", designScenarioId: "design-scenario-1", reason: "content_changed",
    options: ["sync_and_run", "run_as_testrail"],
  }]);
});

test("user choice runs a divergent case normally or synchronizes it before Jira execution", async () => {
  const { remote, link } = fixture();
  let updated = false;
  const client = {
    getCase: async () => updated ? remote : { ...remote, title: "Edited" },
    updateCase: async () => { updated = true; return remote; },
  };
  const normal = await resolveTestDesignLaunchLinks({ caseIds: [701], projectId: 15, appSlug: "payments", links: [link],
    resolutions: { "701": "run_as_testrail" }, client });
  assert.equal(normal.linked.length, 0);
  assert.equal(updated, false);
  const synced = await resolveTestDesignLaunchLinks({ caseIds: [701], projectId: 15, appSlug: "payments", links: [link],
    resolutions: { "701": "sync_and_run" }, client });
  assert.equal(updated, true);
  assert.equal(synced.linked.length, 1);
});

test("project mismatch never dispatches the stored scenario to Jira", async () => {
  const { remote, link } = fixture();
  const result = await resolveTestDesignLaunchLinks({
    caseIds: [701], projectId: 15, appSlug: "another-app", links: [link],
    client: { getCase: async () => remote, updateCase: async () => remote },
  });
  assert.equal(result.linked.length, 0);
  assert.equal(result.conflicts[0].reason, "project_changed");
  assert.deepEqual(result.conflicts[0].options, ["run_as_testrail"]);
});

test("published lineage never duplicates sensitive runtime values", () => {
  const { scenario } = fixture();
  scenario.data = [{ key: "password", label: "Contraseña", value: "fixture-secret", sensitive: true, description: "" }];
  scenario.steps = [{ action: 'Ingresar "fixture-secret" en "Contraseña"', expected: "" }];
  scenario.jiraSourceScenario = { ...scenario.jiraSourceScenario!, steps: ['Ingresar "fixture-secret" en "Contraseña"'] } as never;
  const safe = sanitizeTestDesignLineageScenario(scenario);
  assert.equal(JSON.stringify(safe).includes("fixture-secret"), false);
  assert.equal(safe.data[0].value, "");
  assert.match(safe.steps[0].action, /\[Protegido\]/);
});

test("linked execution retains the original Jira steps instead of replacing them with Design text", () => {
  const { scenario } = fixture();
  scenario.steps = [{ action: 'Press "Pay" after review', expected: "Updated Design result" }];
  const execution = toJiraSemanticDesignScenario(scenario, "PAY-7");
  assert.equal(execution?.scenarioId, scenario.id);
  assert.deepEqual(execution?.steps, ['Presionar "Pagar"']);
  assert.equal(execution?.expectedResult, "Se muestra el recibo");
});
