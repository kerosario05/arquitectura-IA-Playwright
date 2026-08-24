import { test, expect } from "@playwright/test";
import { buildLaunchSelectionPlan } from "../src/server/jobs/launch-orchestrator";
import { extractExistingTestRailCaseIdsFromPayload, extractLaunchScenariosFromPayload } from "../src/server/routes/runs";

function makeGeneratedScenario(id: string, title = "Generated scenario") {
  return {
    scenarioId: id,
    title,
    steps: ['Clic en "Iniciar".'],
    expectedResult: "OK",
    preconditions: [],
  };
}

test("solo Jira/IA: todos los escenarios seleccionados van a publicación", () => {
  const payload = {
    selectedScenarios: [
      makeGeneratedScenario("JIRA-001", "Escenario Jira 1"),
      makeGeneratedScenario("JIRA-002", "Escenario Jira 2"),
    ],
  };

  const selectedScenarios = extractLaunchScenariosFromPayload(payload);
  const existingTestRailCaseIds = extractExistingTestRailCaseIdsFromPayload(payload, selectedScenarios);
  const plan = buildLaunchSelectionPlan({ selectedScenarios, existingTestRailCaseIds });

  expect(plan.scenariosToPublish.map((s) => s.scenarioId)).toEqual(["JIRA-001", "JIRA-002"]);
  expect(plan.existingTestRailCaseIds).toHaveLength(0);
});

test("solo casos existentes de TestRail: selección launchable sin escenarios a publicar", () => {
  const payload = {
    selectedTestRailCases: [
      { caseId: 42811, title: "Caso 42811" },
      { id: "42812", title: "Caso 42812" },
    ],
  };

  const selectedScenarios = extractLaunchScenariosFromPayload(payload);
  const existingTestRailCaseIds = extractExistingTestRailCaseIdsFromPayload(payload, selectedScenarios);
  const plan = buildLaunchSelectionPlan({ selectedScenarios, existingTestRailCaseIds });

  expect(plan.scenariosToPublish).toHaveLength(0);
  expect(plan.existingTestRailCaseIds).toHaveLength(2);
  expect(plan.existingTestRailCaseIds).toEqual(expect.arrayContaining([42811, 42812]));
  expect(plan.invalidScenarioTitles).toHaveLength(0);
});

test("selección mixta: publica solo IA/Jira nuevos y reutiliza caseIds existentes", () => {
  const payload = {
    selectedScenarios: [
      makeGeneratedScenario("GEN-001", "Escenario IA nuevo"),
      { ...makeGeneratedScenario("LEGACY-CASE-55", "Caso existente"), testRailCaseId: 55 },
    ],
    selectedCaseIds: [55, 56],
  };

  const selectedScenarios = extractLaunchScenariosFromPayload(payload);
  const existingTestRailCaseIds = extractExistingTestRailCaseIdsFromPayload(payload, selectedScenarios);
  const plan = buildLaunchSelectionPlan({ selectedScenarios, existingTestRailCaseIds });

  expect(plan.scenariosToPublish.map((s) => s.scenarioId)).toEqual(["GEN-001"]);
  expect(plan.existingTestRailCaseIds).toEqual(expect.arrayContaining([55, 56]));
  expect(plan.existingScenarios.map((s) => s.scenarioId)).toEqual(["LEGACY-CASE-55"]);
});

test("equivalentes de fuentes de caseIds se deduplican", () => {
  const payload = {
    selectedCaseIds: ["77", 78],
    testRailCaseIds: [78, "79"],
    existingTestRailCaseIds: [79, 80],
    selectedTestRailCases: [{ caseId: 80 }, { testRailCaseId: 81 }],
  };

  const selectedScenarios = extractLaunchScenariosFromPayload(payload);
  const existingTestRailCaseIds = extractExistingTestRailCaseIdsFromPayload(payload, selectedScenarios);

  expect(existingTestRailCaseIds.sort((a, b) => a - b)).toEqual([77, 78, 79, 80, 81]);
});

test("escenario con metadata.caseId no entra al plan de publicación", () => {
  const payload = {
    selectedScenarios: [
      {
        ...makeGeneratedScenario("WITH-META-CASE"),
        metadata: { caseId: 901 },
      },
    ],
  };

  const selectedScenarios = extractLaunchScenariosFromPayload(payload);
  const existingTestRailCaseIds = extractExistingTestRailCaseIdsFromPayload(payload, selectedScenarios);
  const plan = buildLaunchSelectionPlan({ selectedScenarios, existingTestRailCaseIds });

  expect(plan.scenariosToPublish).toHaveLength(0);
  expect(plan.existingTestRailCaseIds).toEqual([901]);
});

test("escenario sin scenarioId ni caseId queda inválido para evitar ejecución ambigua", () => {
  const payload = {
    selectedScenarios: [
      {
        title: "Sin identificador",
        steps: ['Clic en "Iniciar".'],
        expectedResult: "OK",
        preconditions: [],
      },
    ],
  };

  const selectedScenarios = extractLaunchScenariosFromPayload(payload);
  const existingTestRailCaseIds = extractExistingTestRailCaseIdsFromPayload(payload, selectedScenarios);
  const plan = buildLaunchSelectionPlan({ selectedScenarios, existingTestRailCaseIds });

  expect(plan.invalidScenarioTitles).toEqual(["Sin identificador"]);
});
