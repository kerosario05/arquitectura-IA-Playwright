import { test, expect } from "@playwright/test";
import {
  applyCaseFinishedSummaryPatch,
  enforceExplicitScenarioClickAuthority,
  getScenarioPreviewOutcome,
  mergeScenarioPreviewSummary,
  parseScenarioPreviewResultsFile,
  parseScenarioPreviewResultsLine,
  shouldReportFailedBeforeFirstCase,
} from "../src/server/jobs/scenario-preview-runner";
import { buildRunStreamPayload } from "../src/server/routes/runs";

test("parsea summary final de discovery:preview", () => {
  const patch = parseScenarioPreviewResultsLine("[discovery:preview] Results: 5 passed, 2 failed out of 7");

  expect(patch).toEqual({
    completed: 7,
    passed: 5,
    failed: 2,
    scenarioCount: 7,
    totalStories: 7,
  });
});

test("case_finished passed incrementa completed y passed", () => {
  const patch = applyCaseFinishedSummaryPatch(
    { totalStories: 7, synced: 0, passed: 0, failed: 0, completed: 0 },
    "passed",
  );

  expect(patch.completed).toBe(1);
  expect(patch.passed).toBe(1);
  expect(patch.failed).toBe(0);
});

test("case_finished failed incrementa completed y failed", () => {
  const patch = applyCaseFinishedSummaryPatch(
    { totalStories: 7, synced: 0, passed: 1, failed: 0, completed: 1 },
    "failed",
  );

  expect(patch.completed).toBe(2);
  expect(patch.passed).toBe(1);
  expect(patch.failed).toBe(1);
});

test("results.json final tiene prioridad como fuente de verdad", () => {
  const summary = mergeScenarioPreviewSummary(
    { totalStories: 7, synced: 0, passed: 1, failed: 0, completed: 1 },
    parseScenarioPreviewResultsFile({
      total: 7,
      passed: 5,
      failed: 2,
      status: "failed",
      promotionStatus: "not_applicable",
      promotionReason: "Promotion not applicable because discovery status is discovered_partial.",
      cases: Array.from({ length: 7 }, (_, i) => ({ status: i < 5 ? "passed" : "failed" })),
    }),
  );

  expect(summary.completed).toBe(7);
  expect(summary.passed).toBe(5);
  expect(summary.failed).toBe(2);
  expect(summary.scenarioCount).toBe(7);
  expect(summary.totalStories).toBe(7);
  expect((summary as any).promotionStatus).toBe("not_applicable");
  expect((summary as any).promotionReason).toContain("discovered_partial");
});

test("promotion gate not_applicable no borra contadores", () => {
  const summary = mergeScenarioPreviewSummary(
    { totalStories: 7, synced: 0, passed: 5, failed: 2, completed: 7, scenarioCount: 7 },
    {
      promotionStatus: "not_applicable",
      promotionReason: "Promotion not applicable because discovery status is discovered_partial.",
    },
  );

  expect(summary.completed).toBe(7);
  expect(summary.passed).toBe(5);
  expect(summary.failed).toBe(2);
  expect((summary as any).promotionStatus).toBe("not_applicable");
});

test("results.json conserva failureGroups en summary final", () => {
  const summary = mergeScenarioPreviewSummary(
    undefined,
    parseScenarioPreviewResultsFile({
      total: 10,
      passed: 3,
      failed: 7,
      summary: {
        total: 10,
        passed: 3,
        failed: 7,
        failureGroups: {
          assertion_not_found: 4,
          target_not_found: 2,
          route_profile_missing: 1,
          promotion_not_applicable: 7,
        },
      },
    }),
  );

  expect((summary as any).failureGroups).toEqual({
    assertion_not_found: 4,
    target_not_found: 2,
    route_profile_missing: 1,
    promotion_not_applicable: 7,
  });
});

test("no usa failed before first case si hubo case_started", () => {
  expect(shouldReportFailedBeforeFirstCase({
    exitCode: 1,
    firstCaseStarted: true,
    finishedCaseIds: new Set<string>(),
    completedCount: 0,
    hasResultsSummary: false,
    sawResultsLine: false,
  })).toBe(false);
});

test("no usa failed before first case si hubo case_finished", () => {
  expect(shouldReportFailedBeforeFirstCase({
    exitCode: 1,
    firstCaseStarted: false,
    finishedCaseIds: new Set<string>(["PREVIEW-001"]),
    completedCount: 0,
    hasResultsSummary: false,
    sawResultsLine: false,
  })).toBe(false);
});

test("results line final evita failed before first case", () => {
  expect(shouldReportFailedBeforeFirstCase({
    exitCode: 1,
    firstCaseStarted: false,
    finishedCaseIds: new Set<string>(),
    completedCount: 0,
    hasResultsSummary: false,
    sawResultsLine: true,
  })).toBe(false);
});

test("failed before first case solo aplica sin ejecucion ni results utiles", () => {
  expect(shouldReportFailedBeforeFirstCase({
    exitCode: 1,
    firstCaseStarted: false,
    finishedCaseIds: new Set<string>(),
    completedCount: 0,
    hasResultsSummary: false,
    sawResultsLine: false,
  })).toBe(true);
});

test("buildRunStreamPayload conserva completed_with_failures como estado terminal", () => {
  const payload = buildRunStreamPayload({
    status: "completed_with_failures",
    exitCode: 1,
    currentCase: "Visualización de opciones principales tras iniciar el kiosco",
    currentCaseId: "PREVIEW-007",
    currentCaseTitle: "Visualización de opciones principales tras iniciar el kiosco",
    errorMessage: "7 de 8 escenarios pasaron. 1 requiere revisión.",
    summary: {
      completed: 8,
      passed: 7,
      failed: 1,
      scenarioCount: 8,
      totalStories: 8,
      failureGroups: { assertion_not_found_unrecovered: 1 },
    },
  }, true);

  expect(payload.status).toBe("completed_with_failures");
  expect(payload.currentCase).toBe("Visualización de opciones principales tras iniciar el kiosco");
  expect(payload.currentCaseId).toBe("PREVIEW-007");
  expect(payload.currentCaseTitle).toBe("Visualización de opciones principales tras iniciar el kiosco");
  expect((payload.summary as any).passed).toBe(7);
  expect((payload.summary as any).failed).toBe(1);
  expect((payload.summary as any).failureGroups.assertion_not_found_unrecovered).toBe(1);
});

test("exitCode=1 con results 7/1/8 devuelve completed_with_failures", () => {
  expect(getScenarioPreviewOutcome({
    exitCode: 1,
    results: {
      total: 8,
      completed: 8,
      passed: 7,
      failed: 1,
      cases: Array.from({ length: 8 }, (_, i) => ({ status: i < 7 ? "passed" : "failed" })),
    },
    completedCount: 8,
    sawCaseStarted: true,
    firstCaseStarted: true,
  })).toBe("completed_with_failures");
});

test("exitCode=1 sin cases ejecutados devuelve technical_failure", () => {
  expect(getScenarioPreviewOutcome({
    exitCode: 1,
    results: {
      ok: false,
      error: "discovery_preview_start_failed",
      message: "spawn failed",
    },
    completedCount: 0,
    sawCaseStarted: false,
    firstCaseStarted: false,
  })).toBe("technical_failure");
});

function countClicksOnTarget(steps: string[], target: string): number {
  const targetRegex = new RegExp(`^\\d+[\\.)]?\\s*Clic en "${target}"\\.?$|^Clic en "${target}"\\.?$`, "i");
  return steps.filter(step => targetRegex.test(step.trim())).length;
}

test("scenarioStepAuthority no duplica clic explícito ya presente", () => {
  const result = enforceExplicitScenarioClickAuthority(
    [
      '1. Clic en "Iniciar".',
      '2. Clic en "Información de productos".',
      '3. Validar que se muestre "Información de productos".',
    ],
    [
      '1. Clic en "Iniciar".',
      '2. Clic en "Información de productos".',
    ],
  );

  expect(countClicksOnTarget(result.steps, "Información de productos")).toBe(1);
  expect(result.restoredCount).toBe(0);
  expect(result.skippedCount).toBe(1);
});

test("scenarioStepAuthority restaura una vez cuando el clic explícito fue eliminado", () => {
  const result = enforceExplicitScenarioClickAuthority(
    [
      '1. Clic en "Iniciar".',
      '2. Validar que se muestre "Información de productos".',
    ],
    [
      '1. Clic en "Iniciar".',
      '2. Clic en "Información de productos".',
    ],
  );

  expect(countClicksOnTarget(result.steps, "Información de productos")).toBe(1);
  expect(result.restoredCount).toBe(1);
  expect(result.skippedCount).toBe(0);
});

test("scenarioStepAuthority trata equivalentes operativos como el mismo clic", () => {
  const result = enforceExplicitScenarioClickAuthority(
    [
      '1. Seleccionar la opción "Informacion de productos".',
      '2. Validar que se muestre "Información de productos".',
    ],
    ['1. Hacer clic en "Información de productos".'],
  );

  expect(result.restoredCount).toBe(0);
  expect(result.skippedCount).toBe(1);
});

test("scenarioStepAuthority conserva clics de targets diferentes", () => {
  const result = enforceExplicitScenarioClickAuthority(
    [
      '1. Validar que se muestre "Información de productos".',
      '2. Clic en "Transacciones y servicios".',
    ],
    [
      '1. Clic en "Información de productos".',
      '2. Clic en "Transacciones y servicios".',
    ],
  );

  expect(countClicksOnTarget(result.steps, "Información de productos")).toBe(1);
  expect(countClicksOnTarget(result.steps, "Transacciones y servicios")).toBe(1);
  expect(result.restoredCount).toBe(1);
});

test("scenarioStepAuthority preserva repeticiones legítimas en contexto distinto", () => {
  const result = enforceExplicitScenarioClickAuthority(
    [
      '1. Clic en "Información de productos".',
      '2. Clic en "Volver".',
      '3. Validar que se muestre "Información de productos".',
    ],
    [
      '1. Clic en "Información de productos".',
      '2. Clic en "Volver".',
      '3. Clic en "Información de productos".',
    ],
  );

  expect(countClicksOnTarget(result.steps, "Información de productos")).toBe(2);
  expect(result.restoredCount).toBe(1);
  expect(result.skippedCount).toBe(0);
});

test("scenarioStepAuthority no agrega copias extra con varios clics originales iguales", () => {
  const result = enforceExplicitScenarioClickAuthority(
    [
      '1. Clic en "Información de productos".',
      '2. Clic en "Volver".',
      '3. Clic en "Información de productos".',
      '4. Validar que se muestre "Información de productos".',
      '5. Validar que se muestre "Información de productos".',
    ],
    [
      '1. Clic en "Información de productos".',
      '2. Clic en "Volver".',
      '3. Clic en "Información de productos".',
    ],
  );

  expect(countClicksOnTarget(result.steps, "Información de productos")).toBe(2);
  expect(result.restoredCount).toBe(0);
  expect(result.skippedCount).toBe(2);
});

test("PREVIEW-003 conserva un solo clic en Información de productos", () => {
  const result = enforceExplicitScenarioClickAuthority(
    [
      '1. Clic en "Iniciar".',
      '2. Validar que se muestre "¿Qué deseas realizar hoy?".',
      '3. Clic en "Información de productos".',
      '4. Validar que se muestre "Información de productos".',
    ],
    [
      '1. Clic en "Iniciar".',
      '2. Clic en "Información de productos".',
    ],
  );

  expect(countClicksOnTarget(result.steps, "Información de productos")).toBe(1);
  expect(result.restoredCount).toBe(0);
  expect(result.skippedCount).toBe(1);
});

test("PREVIEW-004 reporta solo inserciones reales en restoredCount", () => {
  const result = enforceExplicitScenarioClickAuthority(
    [
      '1. Clic en "Iniciar".',
      '2. Validar que se muestre "¿Qué deseas realizar hoy?".',
      '3. Clic en "Transacciones y servicios".',
      '4. Validar que se muestre "Transacciones y servicios".',
      '5. Validar que se muestre "TRANSACCIONES Y SERVICIOS".',
    ],
    [
      '1. Clic en "Iniciar".',
      '2. Clic en "Transacciones y servicios".',
    ],
  );

  expect(countClicksOnTarget(result.steps, "Transacciones y servicios")).toBe(1);
  expect(result.restoredCount).toBe(0);
  expect(result.skippedCount).toBe(2);
});
