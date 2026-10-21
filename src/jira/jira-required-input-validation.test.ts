import assert from "node:assert/strict";
import test from "node:test";
import { collectMissingJiraRequiredInputs } from "./jira-required-input-validation";

test("blocks every required Jira field whose effective runtime value is blank", () => {
  const result = collectMissingJiraRequiredInputs([{
    scenarioId: "HU-1:jira:1",
    title: "Login",
    sourceIssueKey: "HU-1",
    steps: [],
    expectedResult: "",
    inputRequirements: [
      { key: "auth.rnc", label: "RNC", stepIndex: 1, operation: "fill", required: true, editable: true, sensitive: false, controlType: "text", source: "jira_step" },
      { key: "auth.username", label: "Usuario", stepIndex: 2, operation: "fill", required: true, editable: true, sensitive: false, controlType: "text", source: "jira_step" },
      { key: "auth.password", label: "Contraseña", stepIndex: 3, operation: "fill", required: true, editable: true, sensitive: true, controlType: "password", source: "jira_step" },
      { key: "optional.note", label: "Nota", stepIndex: 4, operation: "fill", required: false, editable: true, sensitive: false, controlType: "text", source: "jira_step" },
    ],
  }], { "HU-1:jira:1": { "auth.rnc": "130000000", "auth.username": "qa-user", "auth.password": "   " } });

  assert.deepEqual(result, [{
    scenarioId: "HU-1:jira:1", scenarioTitle: "Login", key: "auth.password", label: "Contraseña", stepIndex: 3,
  }]);
  assert.equal(JSON.stringify(result).includes("qa-user"), false);
});

test("accepts a complete scenario even when a required value is false or zero", () => {
  const result = collectMissingJiraRequiredInputs([{
    scenarioId: "HU-2:jira:1", title: "Flags", sourceIssueKey: "HU-2", steps: [], expectedResult: "",
    inputRequirements: [
      { key: "flag", label: "Flag", stepIndex: 1, operation: "fill", required: true, editable: true, sensitive: false, controlType: "text", source: "jira_step" },
      { key: "amount", label: "Monto", stepIndex: 2, operation: "fill", required: true, editable: true, sensitive: false, controlType: "number", source: "jira_step" },
    ],
  }], { "HU-2:jira:1": { flag: "false", amount: "0" } });
  assert.deepEqual(result, []);
});
