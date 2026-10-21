import assert from "node:assert/strict";
import test from "node:test";
import { findJiraInvalidInputCollisions, resolveJiraConfiguredInputValues } from "./jira-runtime-values";

test("an app-profile access-code alias takes precedence over the global OTP fallback", () => {
  const values = resolveJiraConfiguredInputValues({
    overrides: undefined,
    scenarioId: "HU-1:jira:1",
    requirements: [{ key: "codigo_acceso_valido", label: "Código de acceso", dataCondition: "valid" }],
    testData: { "auth.access_code": "profile-code" },
    testDataAliases: { "auth.access_code": ["Código de acceso", "OTP"] },
    environment: { OTP_SECRET: "global-code" },
  });

  assert.equal(values.codigo_acceso_valido, "profile-code");
});

test("an explicitly declared but empty app-profile access-code alias does not inherit the global OTP", () => {
  const values = resolveJiraConfiguredInputValues({
    overrides: undefined,
    scenarioId: "HU-1:jira:1",
    requirements: [{ key: "codigo_acceso_valido", label: "Código de acceso", dataCondition: "valid" }],
    testData: { "auth.access_code": "" },
    testDataAliases: { "auth.access_code": ["Código de acceso", "OTP"] },
    environment: { OTP_SECRET: "global-code" },
  });

  assert.equal(values.codigo_acceso_valido, undefined);
});

test("blocks a negative value that matches the valid value for the same input in another scenario of the same Jira story", () => {
  const collisions = findJiraInvalidInputCollisions([
    {
      scenarioId: "HU-97:jira:1",
      sourceIssueKey: "HU-97",
      requirements: [{ key: "auth.token", label: "Token de seguridad", dataCondition: "valid" }],
      values: { "auth.token": "synthetic-token" },
    },
    {
      scenarioId: "HU-97:jira:2",
      sourceIssueKey: "hu-97",
      requirements: [{ key: "auth.token_invalid", label: "Token de seguridad", dataCondition: "invalid" }],
      values: { "auth.token_invalid": "synthetic-token" },
    },
  ]);

  assert.deepEqual(collisions, [{
    scenarioId: "HU-97:jira:2",
    inputKey: "auth.token_invalid",
    matchingScenarioId: "HU-97:jira:1",
  }]);
  assert.equal(JSON.stringify(collisions).includes("synthetic-token"), false);
});

test("allows distinct negative data and never compares inputs across different Jira stories", () => {
  const collisions = findJiraInvalidInputCollisions([
    {
      scenarioId: "HU-97:jira:1",
      sourceIssueKey: "HU-97",
      requirements: [{ key: "codigo_acceso", label: "Código de acceso", dataCondition: "valid" }],
      values: { codigo_acceso: "111111" },
    },
    {
      scenarioId: "HU-97:jira:2",
      sourceIssueKey: "HU-97",
      requirements: [{ key: "codigo_acceso_invalido", label: "Código de acceso", dataCondition: "invalid" }],
      values: { codigo_acceso_invalido: "222222" },
    },
    {
      scenarioId: "HU-98:jira:1",
      sourceIssueKey: "HU-98",
      requirements: [{ key: "codigo_acceso", label: "Código de acceso", dataCondition: "valid" }],
      values: { codigo_acceso: "222222" },
    },
  ]);

  assert.deepEqual(collisions, []);
});

test("does not block when the negative input has no concrete value or no valid counterpart", () => {
  const collisions = findJiraInvalidInputCollisions([
    {
      scenarioId: "HU-97:jira:1",
      sourceIssueKey: "HU-97",
      requirements: [{ key: "token_transferencia_invalido", label: "Token", dataCondition: "invalid" }],
      values: {},
    },
    {
      scenarioId: "HU-97:jira:2",
      sourceIssueKey: "HU-97",
      requirements: [{ key: "contrasena", label: "Contraseña", dataCondition: "valid" }],
      values: { contrasena: "configured" },
    },
  ]);

  assert.deepEqual(collisions, []);
});

test("does not confuse same-label inputs belonging to different repeated entities", () => {
  const collisions = findJiraInvalidInputCollisions([
    {
      scenarioId: "HU-99:jira:1",
      sourceIssueKey: "HU-99",
      requirements: [{ key: "employee_1.document", label: "Cédula", dataCondition: "valid" }],
      values: { "employee_1.document": "same-fixture-value" },
    },
    {
      scenarioId: "HU-99:jira:2",
      sourceIssueKey: "HU-99",
      requirements: [{ key: "employee_2.document_invalid", label: "Cédula", dataCondition: "invalid" }],
      values: { "employee_2.document_invalid": "same-fixture-value" },
    },
  ]);

  assert.deepEqual(collisions, []);
});
