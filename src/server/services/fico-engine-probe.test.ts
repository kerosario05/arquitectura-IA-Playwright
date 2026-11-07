import assert from "node:assert/strict";
import test from "node:test";
import { buildFicoRequest, ficoApprovesLoan, summarizeFicoResponse } from "./fico-engine-probe";

test("the loan is approved only when Prestamo Consumo and the participant are not rejected", async () => {
  const answer = (participantDecision: string, loan: string) => async () => ({ status: 200, body: { participantes: [{ finalDecision: loan,
    decisiones: [{ decision: participantDecision, flag: "Flag 5", razonDecision: "edad" }],
    productos: [{ tipoProducto: "Prestamo Consumo", finalDecision: loan, decisiones: [] }] }] } });
  assert.equal((await ficoApprovesLoan(answer("Aprobado", "Aprobado"), "001-1408375-1")).approved, true);
  assert.equal((await ficoApprovesLoan(answer("Rechazado", "Aprobado"), "00114083751")).approved, false);
  assert.equal((await ficoApprovesLoan(answer("Aprobado", "Rechazado"), "00114083751")).approved, false);
  await assert.rejects(ficoApprovesLoan(async () => ({ status: 500, body: {} }), "00114083751"), /HTTP 500/);
});

test("request carries the recorded pre-qualification values and a digits-only id", () => {
  const body = buildFicoRequest("001-1408375-1", { montoSolicitadoPesos: "30000" });
  assert.equal(body.identification, "00114083751");
  assert.equal(body.montoSolicitadoPesos, "30000");
  assert.equal(body.tipoProducto, "24");
  assert.throws(() => buildFicoRequest("abc"));
});

test("a rejected loan lists its rejection flags and is not approved", () => {
  const summary = summarizeFicoResponse({
    cvIncomeEstimator: "126263.0",
    participantes: [{ finalDecision: "Rechazado", productos: [
      { tipoProducto: "TC", finalDecision: "Rechazado", capacidadDeudaActual: 87.5, capacidadDeudaFutura: 103.3,
        decisiones: [{ decision: "Rechazado", flag: "Flag 44", razonDecision: "Capacidad Actual mayor a 80.0" }, { decision: "Pre-aprobado", flag: "Flag 24", razonDecision: "x" }] },
      { tipoProducto: "Prestamo Consumo", finalDecision: "Rechazado", capacidadDeudaActual: 87.5, capacidadDeudaFutura: 87.5,
        decisiones: [{ decision: "Rechazado", flag: "Flag 50", razonDecision: "La cantidad de Préstamos activos es mayor a 5" }] },
    ] }],
  });
  assert.equal(summary.approved, false);
  assert.equal(summary.cvIncomeEstimator, 126263);
  assert.deepEqual(summary.products[0].rejectionFlags, ["Flag 44: Capacidad Actual mayor a 80.0"]);
  assert.deepEqual(summary.products[1].rejectionFlags, ["Flag 50: La cantidad de Préstamos activos es mayor a 5"]);
});

test("the loan is approved when its own decision is not a rejection, whatever other products say", () => {
  const summary = summarizeFicoResponse({ participantes: [{ finalDecision: "Aprobado", productos: [
    { tipoProducto: "Prestamo Consumo", finalDecision: "Aprobado", decisiones: [] },
    { tipoProducto: "TC", finalDecision: "Rechazado", decisiones: [] },
  ] }] });
  assert.equal(summary.approved, true);
});
