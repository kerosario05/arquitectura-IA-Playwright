import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionTrace } from "./session-trace.types";
import { evaluateGoalCoverage } from "./goal-coverage";

function trace(goal: string | undefined, pressed: string[], screens: Array<{ title: string; controls: string[] }>, acknowledged = false) {
  return {
    recordingGoal: goal
      ? { declaredGoal: goal, normalizedGoal: goal, provenance: "USER_DECLARED", needsReview: false, ...(acknowledged ? { coverageAcknowledged: { acknowledgedAt: "now" } } : {}) }
      : undefined,
    events: pressed.map((label) => ({ kind: "tap", target: { label } })),
    screens: screens.map((screen, index) => ({ screenKey: `s${index}`, title: screen.title, controls: screen.controls.map((label) => ({ label })) })),
  } as unknown as SessionTrace;
}

const KIOSK_SCREENS = [
  { title: "¡Hola!", controls: ["Explora nuestros productos"] },
  { title: "Conoce nuestros productos", controls: ["Tarjetas", "Cuentas", "Préstamos"] },
  { title: "Selecciona un producto", controls: ["Préstamo Personal", "Volver"] },
  { title: "Más detalles del producto", controls: ["Finalizar sesión", "Volver", "Solicitar"] },
];

test("recording 2920301b: browsing products does not complete \"solicitar\", and the unpressed control is named", () => {
  const coverage = evaluateGoalCoverage(trace(
    "solicitar tarjeta, prestamo y cuenta",
    ["Explora nuestros productos", "Tarjetas", "Tarjeta de Crédito", "Cuentas", "Cuenta de Ahorro", "Préstamos", "Préstamo Personal", "Finalizar sesión"],
    KIOSK_SCREENS,
  ));
  assert.equal(coverage.status, "partial");
  const solicitar = coverage.terms.find((term) => term.term === "solicitar")!;
  assert.equal(solicitar.kind, "action");
  assert.equal(solicitar.covered, false);
  assert.deepEqual(solicitar.missing, { control: "Solicitar", screen: "Más detalles del producto" });
  assert.deepEqual(coverage.terms.filter((term) => term.kind === "object").map((term) => [term.term, term.covered]), [["tarjeta", true], ["prestamo", true], ["cuenta", true]]);
});

test("pressing the control completes the goal", () => {
  const coverage = evaluateGoalCoverage(trace("solicitar préstamo", ["Préstamos", "Préstamo Personal", "Solicitar"], KIOSK_SCREENS));
  assert.equal(coverage.status, "covered");
  assert.deepEqual(coverage.terms.find((term) => term.term === "solicitar")?.evidence, ["Solicitar"]);
});

test("a browsing goal is covered by reaching screens, without a matching control", () => {
  const coverage = evaluateGoalCoverage(trace("consultar productos", ["Explora nuestros productos", "Tarjetas"], KIOSK_SCREENS));
  assert.equal(coverage.status, "covered");
});

test("a goal none of whose terms were walked is not reached", () => {
  const coverage = evaluateGoalCoverage(trace("transferir dinero a terceros", ["Explora nuestros productos"], KIOSK_SCREENS));
  assert.equal(coverage.status, "not_reached");
  assert.equal(coverage.terms.find((term) => term.term === "transferir")?.missing, undefined);
});

test("no goal, unnamed controls and the reviewer's acceptance", () => {
  assert.equal(evaluateGoalCoverage(trace(undefined, ["Tarjetas"], KIOSK_SCREENS)).status, "no_goal");
  assert.deepEqual(evaluateGoalCoverage(trace("ver tarjetas", ["control", "Tarjetas"], KIOSK_SCREENS)).pressed, ["Tarjetas"]);
  assert.equal(evaluateGoalCoverage(trace("solicitar tarjeta", ["Tarjetas"], KIOSK_SCREENS, true)).acknowledged, true);
});
