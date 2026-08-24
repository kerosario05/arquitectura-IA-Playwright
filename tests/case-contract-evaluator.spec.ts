import { test, expect } from "@playwright/test";
import {
  buildMcpScenarioContractFromTestRailCase,
  buildVirtualCaseFromContract,
  evaluateCaseContractSufficiency,
  extractCaseContractMetadata,
} from "../src/automations/case-contract-evaluator";
import { normalizeTestRailCase } from "../src/testrail/testrail-normalizer";
import type { McpScenario } from "../src/scenarios/scenario-types";

test("case contract: sufficient TestRail contract recommends automation_from_case_contract", () => {
  const rawCase = {
    id: 93001,
    title: "Flujo kiosko con contrato completo",
    custom_preconds: "Cliente de pruebas habilitado",
    custom_steps_separated: [
      { content: "Clic en \"Información de productos\"." },
      { content: "Validar que se muestre \"Detalle de producto\"." },
    ],
    custom_expected: "Se visualiza el detalle del producto.",
    custom_route_profile: "kiosko-default",
    custom_navigation_prefix: "inicio>informacion",
  };
  const normalized = normalizeTestRailCase(rawCase);
  const metadata = extractCaseContractMetadata(rawCase);
  const scenario = buildMcpScenarioContractFromTestRailCase({
    scenario: normalized,
    appSlug: "app-a",
    metadata,
  });
  const evaluation = evaluateCaseContractSufficiency({
    scenario,
    appSlug: "app-a",
    sectionSlug: "detalle-kiosko",
    metadata,
    hasRouteProfileConfig: true,
  });
  expect(evaluation.sufficient).toBe(true);
  expect(evaluation.recommendedRoute).toBe("automation_from_case_contract");
});

test("case contract: equivalent HU and TestRail contracts share the same evaluation outcome", () => {
  const huScenario: McpScenario = {
    sourceIssueKey: "HU-100",
    title: "Abrir módulo y validar destino",
    steps: [
      "Clic en \"Transacciones y servicios\".",
      "Validar que se muestre \"Menú de transacciones\".",
    ],
    preconditions: ["Usuario con acceso"],
    expectedResult: "Se muestra el menú de transacciones.",
    type: "Functional",
    database: "QA",
    isConverted: 0,
    automationType: "ui_with_auth_gate",
    setupStrategy: "auth_gate",
    appSlug: "app-a",
    routeProfile: "kiosko-default",
    dataRequirements: "usuario",
    nonExecutableCriteria: "",
    mcpExecutable: true,
  };
  const testrailRaw = {
    id: 93002,
    title: "Abrir módulo y validar destino",
    custom_preconds: "Usuario con acceso",
    custom_steps_separated: [
      { content: "Clic en \"Transacciones y servicios\"." },
      { content: "Validar que se muestre \"Menú de transacciones\"." },
    ],
    custom_expected: "Se muestra el menú de transacciones.",
    custom_route_profile: "kiosko-default",
  };
  const normalized = normalizeTestRailCase(testrailRaw);
  const metadata = extractCaseContractMetadata(testrailRaw);
  const testRailScenario = buildMcpScenarioContractFromTestRailCase({
    scenario: normalized,
    appSlug: "app-a",
    metadata,
  });

  const huEvaluation = evaluateCaseContractSufficiency({
    scenario: huScenario,
    appSlug: "app-a",
    sectionSlug: "detalle-kiosko",
    metadata: { routeProfileName: "kiosko-default" },
    hasRouteProfileConfig: true,
  });
  const trEvaluation = evaluateCaseContractSufficiency({
    scenario: testRailScenario,
    appSlug: "app-a",
    sectionSlug: "detalle-kiosko",
    metadata,
    hasRouteProfileConfig: true,
  });
  expect(trEvaluation.recommendedRoute).toBe(huEvaluation.recommendedRoute);
  expect(trEvaluation.reasonCode).toBe(huEvaluation.reasonCode);
});

test("case contract: missing target/locator recommends targeted_discovery", () => {
  const scenario: McpScenario = {
    sourceIssueKey: "TR-C93003",
    title: "Acción con target ambiguo",
    steps: [
      "Clic en botón.",
      "Validar que se muestre \"Confirmación\".",
    ],
    preconditions: ["Usuario autenticado"],
    expectedResult: "Se muestra confirmación",
    type: "Functional",
    database: "QA",
    isConverted: 0,
    automationType: "ui_with_auth_gate",
    setupStrategy: "auth_gate",
    appSlug: "app-a",
    routeProfile: "kiosko-default",
    dataRequirements: "usuario",
    nonExecutableCriteria: "",
    mcpExecutable: true,
  };
  const evaluation = evaluateCaseContractSufficiency({
    scenario,
    appSlug: "app-a",
    sectionSlug: "detalle-kiosko",
    metadata: { routeProfileName: "kiosko-default" },
    hasRouteProfileConfig: true,
  });
  expect(evaluation.sufficient).toBe(false);
  expect(evaluation.recommendedRoute).toBe("targeted_discovery");
  expect(evaluation.gaps.some((gap) => gap.type === "missing_locator")).toBe(true);
});

test("case contract: missing route evidence recommends full_discovery", () => {
  const scenario: McpScenario = {
    sourceIssueKey: "TR-C93004",
    title: "Caso sin evidencia de ruta",
    steps: ["Clic en \"Continuar\"."],
    preconditions: [],
    expectedResult: "",
    type: "Functional",
    database: "QA",
    isConverted: 0,
    automationType: "ui_with_auth_gate",
    setupStrategy: "auth_gate",
    appSlug: "app-a",
    routeProfile: "",
    dataRequirements: "",
    nonExecutableCriteria: "",
    mcpExecutable: true,
  };
  const evaluation = evaluateCaseContractSufficiency({
    scenario,
    appSlug: "app-a",
    sectionSlug: "detalle-kiosko",
    metadata: {},
    hasRouteProfileConfig: false,
  });
  expect(evaluation.recommendedRoute).toBe("full_discovery");
  expect(evaluation.gaps.some((gap) => gap.type === "missing_route_evidence")).toBe(true);
});

test("case contract: manual/non-ui flow is blocked", () => {
  const scenario: McpScenario = {
    sourceIssueKey: "TR-C93005",
    title: "Validación manual",
    steps: ["Validar manualmente la auditoría interna en base de datos."],
    preconditions: [],
    expectedResult: "",
    type: "Functional",
    database: "QA",
    isConverted: 0,
    automationType: "ui_with_auth_gate",
    setupStrategy: "auth_gate",
    appSlug: "app-a",
    routeProfile: "kiosko-default",
    dataRequirements: "",
    nonExecutableCriteria: "",
    mcpExecutable: true,
  };
  const evaluation = evaluateCaseContractSufficiency({
    scenario,
    appSlug: "app-a",
    sectionSlug: "detalle-kiosko",
    metadata: { routeProfileName: "kiosko-default" },
    hasRouteProfileConfig: true,
  });
  expect(evaluation.recommendedRoute).toBe("blocked");
  expect(evaluation.gaps.some((gap) => gap.type === "manual_step" || gap.type === "non_ui_step")).toBe(true);
});

test("case contract: missing required test data is blocked", () => {
  const scenario: McpScenario = {
    sourceIssueKey: "TR-C93006",
    title: "Ingresar datos sin dataset",
    steps: [
      "Ingresar en \"Identificación\".",
      "Clic en \"Continuar\".",
    ],
    preconditions: [],
    expectedResult: "Continúa al siguiente paso",
    type: "Functional",
    database: "QA",
    isConverted: 0,
    automationType: "ui_with_auth_gate",
    setupStrategy: "auth_gate",
    appSlug: "app-a",
    routeProfile: "kiosko-default",
    dataRequirements: "",
    nonExecutableCriteria: "",
    mcpExecutable: true,
  };
  const evaluation = evaluateCaseContractSufficiency({
    scenario,
    appSlug: "app-a",
    sectionSlug: "detalle-kiosko",
    metadata: { routeProfileName: "kiosko-default" },
    hasRouteProfileConfig: true,
  });
  expect(evaluation.recommendedRoute).toBe("blocked");
  expect(evaluation.reasonCode).toBe("missing_test_data");
});

test("contract virtual case: carries TestRail case identity for discovery:preview", () => {
  const scenario: McpScenario = {
    sourceIssueKey: "TR-C93007",
    scenarioId: "TR-C93007",
    caseId: 93007,
    title: "Caso con identidad TestRail",
    steps: ["Clic en \"Información de productos\"."],
    preconditions: [],
    expectedResult: "Se muestra la pantalla destino",
    type: "Functional",
    database: "QA",
    isConverted: 0,
    automationType: "ui_with_auth_gate",
    setupStrategy: "auth_gate",
    appSlug: "app-a",
    routeProfile: "kiosko-default",
    dataRequirements: "",
    nonExecutableCriteria: "",
    mcpExecutable: true,
  };
  const vc = buildVirtualCaseFromContract({
    scenario,
    index: 0,
    sectionSlug: "detalle-kiosko",
    sectionName: "Detalle kiosko",
    sectionId: 4903,
    testRailCaseId: 93007,
    metadata: {
      navigationPrefix: "inicio>informacion",
      routeEvidence: "cache-key-1",
    },
  });
  expect(vc.testRailCaseId).toBe(93007);
  expect(vc.navigationPrefix).toBe("inicio>informacion");
  expect(vc.routeEvidence).toBe("cache-key-1");
});
