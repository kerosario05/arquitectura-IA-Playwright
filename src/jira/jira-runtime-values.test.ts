import assert from "node:assert/strict";
import test from "node:test";
import { authoredNegativeInputValues, findJiraInvalidInputCollisions, inferJiraScenarioInputConditions, jiraInvalidInputCollisionDiagnostic, resolveJiraConfiguredInputValues, type JiraRuntimeInputRequirement } from "./jira-runtime-values";

test("negative outcome context binds only its named field and preserves its authored value over profile defaults", () => {
  const scenario = inferJiraScenarioInputConditions({
    title: "Consultar una identificación inválida",
    expectedResult: "La consulta informa que la identificación es inválida.",
    steps: ['Ingresar "demo-user" en "Usuario"', 'Ingresar "demo-password" en "Contraseña"',
      'Ingresar "12345" en "Número de Identificación"'],
    inputRequirements: [
      { key: "usuario", label: "Usuario", stepIndex: 1 },
      { key: "contrasena", label: "Contraseña", stepIndex: 2 },
      { key: "jira_step_3", label: "Número de Identificación", stepIndex: 3 },
    ] as JiraRuntimeInputRequirement[],
  });

  assert.deepEqual(scenario.inputRequirements?.map(field => field.dataCondition), [undefined, undefined, "invalid"]);
  const configured = resolveJiraConfiguredInputValues({
    overrides: {}, scenarioId: "HU-1:jira:3", requirements: scenario.inputRequirements!,
    testData: { "identity.rnc": "101000013" },
    testDataAliases: { "identity.rnc": ["Número de Identificación"] },
  });
  const authored = authoredNegativeInputValues(scenario.steps, scenario.inputRequirements!);
  for (const [key, value] of Object.entries(authored)) if (!configured[key]) configured[key] = value;
  assert.equal(configured.jira_step_3, "12345", "a valid profile RNC cannot replace the authored invalid identifier");
});

test("negative context inference handles expiration across generic project field labels", () => {
  const scenario = inferJiraScenarioInputConditions({
    title: "Rechazar un código de acceso vencido",
    expectedResult: "El código SMS expirado no autoriza el acceso.",
    inputRequirements: [
      { key: "auth.username", label: "Usuario" },
      { key: "otp", label: "Código SMS" },
    ] as JiraRuntimeInputRequirement[],
  });
  assert.deepEqual(scenario.inputRequirements?.map(field => field.dataCondition), [undefined, "expired"]);
});

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

test("flags a negative value matching a valid same-story input as a step-scoped warning", () => {
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
  assert.deepEqual(jiraInvalidInputCollisionDiagnostic(collisions[0], [
    { key: "auth.token_invalid", label: "Token de seguridad", dataCondition: "invalid", stepIndex: 4 },
  ]), {
    severity: "warning",
    action: "continue_to_runtime_assertion",
    inputKey: "auth.token_invalid",
    matchingScenarioId: "HU-97:jira:1",
    stepIndex: 4,
  });
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
