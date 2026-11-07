import test from "node:test";
import assert from "node:assert/strict";
import type { JiraIssueSource } from "../scenarios/scenario-types";
import type { TestDesignScenario } from "./test-design.types";
import { editedDesignSourceNeedsReview, refreshEditedTestDesignScenario } from "./test-design-edited-source";

const issue: JiraIssueSource = {
  key: "PAY-77", summary: "Reject invalid credentials", description: "",
  acceptanceCriteria: "AC8.1: invalid credentials show an error.", labels: [], components: [], status: "", issueType: "Story",
};

test("edited Design steps refresh the Jira review and remove only resolved stale warnings", async () => {
  const steps = [
    "Abrir la aplicación configurada del proyecto",
    'Ingresar contraseña no válida en "Contraseña"',
    'Presionar "Iniciar sesión"',
    "Validar que se informe que las credenciales no son válidas",
  ];
  const scenario: TestDesignScenario = {
    id: "design-case", title: "Rechazar credenciales no válidas", preconditions: "",
    steps: steps.map(action => ({ action, expected: "" })), data: [],
    acceptanceCriteriaRefs: ["AC8.1"], expectedResult: "Se informa el problema con las credenciales.",
    priority: "medium", type: "negative", selectedForTestRail: true, selectedForJira: true,
    testRailCaseId: null, origin: "ai", edited: true,
    generationWarnings: [
      "Revisar este caso antes de publicarlo: JIRA_ASSERTION_CAPABILITY_UNSUPPORTED",
      "La cobertura AC8.1 de la historia sigue pendiente.",
    ],
    jiraSourceScenarioId: "PAY-77:jira:1",
    jiraSourceScenario: {
      scenarioId: "PAY-77:jira:1", sourceIssueKey: "PAY-77", title: "Rechazar credenciales no válidas",
      steps, preconditions: [], expectedResult: "Se informa el problema con las credenciales.",
      acceptanceCriteriaRefs: ["AC8.1"],
      validation: {
        valid: false,
        errors: ["JIRA_ASSERTION_CAPABILITY_UNSUPPORTED"],
        issues: [{ code: "JIRA_ASSERTION_CAPABILITY_UNSUPPORTED", stepIndex: 4, step: steps[3] }],
      },
    } as never,
  };
  const correctedAction = 'Validar que se muestre "problema de credenciales"';
  const edited: TestDesignScenario = {
    ...scenario,
    steps: scenario.steps.map((step, index) => index === 3 ? { ...step, action: correctedAction } : step),
  };

  assert.equal(editedDesignSourceNeedsReview(edited), true);
  const refreshed = await refreshEditedTestDesignScenario(edited, issue);
  const validation = refreshed.jiraSourceScenario?.validation;
  assert.equal(validation?.errors?.includes("JIRA_ASSERTION_CAPABILITY_UNSUPPORTED"), false);
  assert.equal(validation?.issues?.some(item => item.code === "JIRA_ASSERTION_CAPABILITY_UNSUPPORTED"), false);
  assert.equal(refreshed.generationWarnings?.some(warning => warning.includes("JIRA_ASSERTION_CAPABILITY_UNSUPPORTED")), false);
  assert.equal(refreshed.generationWarnings?.includes("La cobertura AC8.1 de la historia sigue pendiente."), true);
});

test("re-editing an already edited case applies the new steps to the Jira source", async () => {
  const steps = ["Abrir la aplicación configurada del proyecto", 'Ingresar contraseña no válida en "Contraseña"', 'Presionar "Iniciar sesión"'];
  const scenario: TestDesignScenario = {
    id: "design-case", title: "Rechazar credenciales no válidas", preconditions: "",
    steps: steps.map(action => ({ action, expected: "" })), data: [],
    acceptanceCriteriaRefs: ["AC8.1"], expectedResult: "Se informa el problema con las credenciales.",
    priority: "medium", type: "negative", selectedForTestRail: true, selectedForJira: true,
    testRailCaseId: null, origin: "ai", edited: true,
    jiraSourceScenarioId: "PAY-77:jira:1",
    jiraSourceScenario: {
      scenarioId: "PAY-77:jira:1:edited-0123456789abcdef", sourceIssueKey: "PAY-77", title: "Rechazar credenciales no válidas",
      steps, preconditions: [], expectedResult: "Se informa el problema con las credenciales.",
      acceptanceCriteriaRefs: ["AC8.1"], validation: { valid: true, errors: [], issues: [] },
    } as never,
  };
  const edited: TestDesignScenario = { ...scenario, steps: scenario.steps.map((step, index) => index === 2 ? { ...step, action: 'Presionar "Entrar"' } : step) };
  const refreshed = await refreshEditedTestDesignScenario(edited, issue);
  assert.equal(refreshed.jiraSourceScenario?.steps[2], 'Presionar "Entrar"');
});

test("deleting the diagnosed absence step retires its duplicated expected-result warning after re-review", async () => {
  const expectedResult = 'No se muestra "comprobante de transacción exitosa".';
  const steps = [
    "Abrir la aplicación configurada del proyecto",
    'Ingresar contraseña no válida en "Contraseña"',
    'Presionar "Iniciar sesión"',
    'Validar que no se muestre "comprobante de transacción exitosa"',
  ];
  const scenario: TestDesignScenario = {
    id: "deleted-diagnosis", title: "Rechazar credenciales no válidas", preconditions: "",
    steps: steps.map(action => ({ action, expected: "" })), data: [],
    acceptanceCriteriaRefs: ["AC8.1"], expectedResult,
    priority: "medium", type: "negative", selectedForTestRail: true, selectedForJira: true,
    testRailCaseId: null, origin: "ai", edited: true,
    generationWarnings: ["Revisar este caso antes de publicarlo: JIRA_ASSERTION_CAPABILITY_UNSUPPORTED"],
    jiraSourceScenarioId: "PAY-77:jira:2",
    jiraSourceScenario: {
      scenarioId: "PAY-77:jira:2", sourceIssueKey: "PAY-77", title: "Rechazar credenciales no válidas",
      steps, preconditions: [], expectedResult, acceptanceCriteriaRefs: ["AC8.1"],
      validation: {
        valid: false,
        errors: ["JIRA_ASSERTION_CAPABILITY_UNSUPPORTED"],
        issues: [{ code: "JIRA_ABSENCE_REQUIRES_OBSERVED_CONTEXT", stepIndex: 4, step: steps[3] }],
      },
    } as never,
  };
  const edited = { ...scenario, steps: scenario.steps.slice(0, -1) };

  const refreshed = await refreshEditedTestDesignScenario(edited, issue);
  assert.deepEqual(refreshed.jiraSourceScenario?.steps, steps.slice(0, -1));
  assert.equal(refreshed.jiraSourceScenario?.validation.errors.length, 0);
  assert.equal(refreshed.jiraSourceScenario?.validation.issues?.length, 0);
  assert.equal(refreshed.generationWarnings?.some(warning => warning.startsWith("Revisar este caso antes de publicarlo:")) ?? false, false);
});

test("an unchanged generated scenario does not trigger a Jira review fetch", () => {
  const scenario = {
    id: "unchanged", title: "Case", preconditions: "", steps: [], data: [], expectedResult: "Expected",
    priority: "medium", type: "functional", selectedForTestRail: true, selectedForJira: true,
    testRailCaseId: null, origin: "ai", edited: false,
    jiraSourceScenario: { title: "Case", steps: [], expectedResult: "Expected" },
  } as unknown as TestDesignScenario;
  assert.equal(editedDesignSourceNeedsReview(scenario), false);
});
