import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionTrace } from "./session-trace.types";
import {
  normalizeReviewerContext,
  preconditionsWithReviewerContext,
  reviewerContextFor,
  reviewerContextForAi,
  withReviewerContext,
} from "./reviewer-context";
import { buildCompactSemanticAiContext } from "./trace-ai-enricher";

test("context is trimmed, bounded and empty fields are dropped", () => {
  const context = normalizeReviewerContext({
    purpose: "  Validar que el cliente consulta el detalle del préstamo  ",
    businessRules: "",
    preconditions: ["Cliente con sesión iniciada", " ", ...Array.from({ length: 12 }, (_, i) => `p${i}`)],
    testData: "x".repeat(900),
    unexpected: "ignored",
  })!;
  assert.equal(context.purpose, "Validar que el cliente consulta el detalle del préstamo");
  assert.equal(context.businessRules, undefined);
  assert.equal(context.preconditions!.length, 8);
  assert.equal(context.testData!.length, 600);
  assert.equal((context as Record<string, unknown>).unexpected, undefined);
  assert.equal(normalizeReviewerContext({ purpose: "   " }), undefined);
});

test("recording-wide and per-scenario scopes are stored apart and an empty one is removed", () => {
  let all = withReviewerContext(undefined, "recording", { purpose: "Consulta de productos" });
  all = withReviewerContext(all, "REC-01-FLOW-3", { expectedOutcome: "Se ve la tasa del préstamo", preconditions: ["Préstamo activo en catálogo"] });
  assert.deepEqual(Object.keys(all!.scenarios!), ["REC-01-FLOW-3"]);
  const merged = reviewerContextFor(all, "REC-01-FLOW-3")!;
  assert.equal(merged.purpose, "Consulta de productos");
  assert.equal(merged.expectedOutcome, "Se ve la tasa del préstamo");
  assert.equal(reviewerContextFor(all, "REC-01-FLOW-1")?.expectedOutcome, undefined);
  all = withReviewerContext(all, "REC-01-FLOW-3", undefined);
  assert.equal(all!.scenarios, undefined);
  assert.equal(withReviewerContext(all, "recording", undefined), undefined);
});

test("TestRail preconditions lead with the labelled context and drop the generic data placeholder", () => {
  const preconditions = preconditionsWithReviewerContext(
    ["Acceso a la aplicación configurada del proyecto", "Datos de prueba válidos disponibles para el proyecto"],
    { purpose: "Consultar el detalle del préstamo", expectedOutcome: "Se ve la tasa", testData: "Cliente con préstamo preaprobado", preconditions: ["Kiosko en sucursal"] },
  );
  assert.deepEqual(preconditions, [
    "Propósito: Consultar el detalle del préstamo",
    "Resultado esperado de negocio (declarado por QA, no verificado automáticamente): Se ve la tasa",
    "Datos de prueba: Cliente con préstamo preaprobado",
    "Kiosko en sucursal",
    "Acceso a la aplicación configurada del proyecto",
  ]);
  assert.deepEqual(preconditionsWithReviewerContext(["A"], undefined), ["A"]);
});

test("the AI gets purpose, rules and outcome -- never the test data", () => {
  const all = {
    recording: { purpose: "Consulta de productos", testData: "Cédula 001-1234567-8" },
    scenarios: { "REC-01-FLOW-1": { testData: "solo datos" } },
  };
  assert.deepEqual(reviewerContextForAi(all), { recording: { purpose: "Consulta de productos" } });
  assert.equal(reviewerContextForAi(undefined), null);

  const trace = {
    recordingId: "r", projectSlug: "k", appSlug: "k", platform: "web", label: "x", startedAt: "", status: "stopped",
    events: [], screens: [], reviewerContext: all,
  } as unknown as SessionTrace;
  const happyPath = { scenarioId: "REC-01", title: "t", preconditions: [], testRailSteps: [], requiredData: [] } as never;
  const { context } = buildCompactSemanticAiContext(trace, [], happyPath);
  assert.match(context, /Consulta de productos/);
  assert.doesNotMatch(context, /001-1234567-8/);
});
