import assert from "node:assert/strict";
import { test } from "node:test";
import { scoreGoalRelevance } from "./trace-to-scenario";

/**
 * Recording 2920301b (goal "solicitar tarjeta, prestamo y cuenta"): the AI proposed exactly the
 * missing case -- pressing "Solicitar" on the product detail -- and the quality gate discarded it as
 * goal_coherence_failed. The gate only recognised operations from a fixed verb list (crear,
 * agregar, editar...) that did not include "solicitar". The goal's own operation now counts.
 */

const GOAL = "solicitar tarjeta, prestamo y cuenta";

function candidate(title: string, description = "", lastStep = "") {
  return { title, description, requiredData: [], testRailSteps: lastStep ? [{ content: lastStep, expected: "" }] : [] } as never;
}

test("a proposal that performs the goal's own operation is coherent with the goal", () => {
  const relevance = scoreGoalRelevance(GOAL, candidate(
    "Iniciar la solicitud desde el detalle del producto presionando \"Solicitar\"",
    "El objetivo declarado del recorrido es solicitar tarjeta, préstamo y cuenta; el botón Solicitar solo aparece en el detalle.",
    "Presionar \"Solicitar\"",
  ));
  assert.ok(relevance.score >= 0.6, `score=${relevance.score} reasons=${relevance.reasons.join(",")}`);
  assert.ok(relevance.reasons.includes("goal_operation_matched"));
});

test("the goal's operation counts through word forms (solicitud / solicitar)", () => {
  const relevance = scoreGoalRelevance("solicitar préstamo", candidate("Enviar la solicitud del préstamo personal", "", "Presionar \"Enviar solicitud\""));
  assert.ok(relevance.score >= 0.6, `score=${relevance.score}`);
});

test("navigation that abandons the operation stays irrelevant", () => {
  for (const title of ["Volver desde \"Más detalles del producto\" en lugar de finalizar la sesión", "Salir desde \"Conoce nuestros productos\" con \"Salir\""]) {
    const relevance = scoreGoalRelevance(GOAL, candidate(title, "Variante de navegación observada.", "Presionar \"Volver\""));
    assert.ok(relevance.score < 0.6, `${title}: score=${relevance.score}`);
  }
});

test("a browsing verb in the goal is not an operation to match", () => {
  const relevance = scoreGoalRelevance("ver productos", candidate("Ver el catálogo y volver", "", "Presionar \"Volver\""));
  assert.ok(!relevance.reasons.includes("goal_operation_matched"));
});
