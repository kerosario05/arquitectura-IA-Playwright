import assert from "node:assert/strict";
import test from "node:test";
import type { PageSnapshot, SnapshotElement } from "../types/page-snapshot.types";
import { isVisibleDateTime, resolveObservableSnapshotMatch, VISIBLE_DATE_TIME_TARGET } from "./observable-snapshot-matcher";

function snapshot(texts: string[], semanticSignals: string[] = []): PageSnapshot {
  const elements: SnapshotElement[] = texts.map((text, index) => ({
    id: `e-${index}`,
    type: /^(?:Resumen|Confirmación|Comprobante)$/.test(text) ? "heading" : "text",
    text,
    visible: true,
    candidateLocators: [{ strategy: "text", value: text, exact: true, confidence: 1 }],
    dataHints: [],
  }));
  if (semanticSignals.length) {
    elements.push({
      id: "date-time",
      type: "text",
      text: "[REDACTED]",
      visible: true,
      semanticSignals,
      candidateLocators: [],
      dataHints: [],
    });
  }
  return {
    version: "1.0",
    url: "https://fixture.invalid/receipt",
    title: "Fixture",
    capturedAt: "2026-10-21T20:00:00.000Z",
    elements,
    summary: { totalElements: elements.length, buttons: 0, links: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 },
  };
}

test("resolves Spanish outcome phrases to exact visible UI labels within one snapshot", () => {
  const observed = snapshot([
    "Resumen", "Cuenta Corriente", "Cuenta de Ahorro", "Confirmación", "Transferencias a Mis Cuentas",
    "Cuenta Origen", "Cuenta Destino", "Monto a Acreditar", "Impuesto 0.20%", "Comprobante",
    "Transacción Exitosa", "Comisión", "Tasa de Cambio", "Total debitado", "# Referencia:",
  ], ["date_time_value"]);

  const cases: Array<[string, string[]]> = [
    ['Validar que se muestre "resumen de sus productos"', ["Resumen", "Cuenta Corriente"]],
    ['Validar que se muestre "la confirmación de la transferencia"', ["Confirmación", "Transferencias a Mis Cuentas"]],
    ['Validar que la confirmación muestre las "cuentas seleccionadas".', ["Cuenta Origen", "Cuenta Destino"]],
    ['Validar que la confirmación muestre el "monto".', ["Monto a Acreditar"]],
    ['Validar que la confirmación muestre los "impuestos".', ["Impuesto 0.20%"]],
    ['Validar que se muestre "comprobante de transacción exitosa"', ["Comprobante", "Transacción Exitosa"]],
    ['Validar que el comprobante muestre el "monto de la transferencia".', ["Monto a Acreditar", "Transferencias a Mis Cuentas"]],
    ['Validar que el comprobante muestre las "cuentas involucradas".', ["Cuenta Origen", "Cuenta Destino"]],
    ['Validar que el comprobante muestre la "fecha y hora".', [VISIBLE_DATE_TIME_TARGET]],
    ['Validar que el comprobante muestre la "referencia de la operación".', ["# Referencia:", "Transacción Exitosa"]],
  ];

  for (const [requirement, expectedTargets] of cases) {
    const match = resolveObservableSnapshotMatch(requirement, observed);
    assert.ok(match, requirement);
    assert.deepEqual(match?.targets, expectedTargets, requirement);
  }
});

test("does not back an outcome when one of its visible components is absent", () => {
  const observed = snapshot(["Comprobante", "Cuenta Origen", "Monto a Acreditar"]);
  assert.equal(resolveObservableSnapshotMatch('Validar que se muestre "comprobante de transacción exitosa"', observed), undefined);
  assert.equal(resolveObservableSnapshotMatch('Validar que se muestren las "cuentas involucradas"', observed), undefined);
  assert.equal(resolveObservableSnapshotMatch('Validar que se muestre la "fecha y hora"', observed), undefined);
});

test("prefers direct receipt labels over unrelated broad nearby text", () => {
  const receipt = snapshot(["Resumen", "Transferencias a Mis Cuentas", "Comprobante", "Transacción Exitosa", "Monto a Acreditar:", "Cuenta Origen", "Cuenta Destino", "Total debitado", "# Referencia:"]);
  const unrelatedGlobalRegion = "Resumen Dashboard Consultas Transferencias Pagos Impuestos Transacciones Comprobantes "
    + "Resumen Dashboard Consultas Transferencias Pagos Impuestos Transacciones Comprobantes";
  receipt.elements[0]!.nearbyText = unrelatedGlobalRegion;
  receipt.elements[1]!.nearbyText = unrelatedGlobalRegion;
  receipt.elements[2]!.nearbyText = unrelatedGlobalRegion;
  receipt.elements[3]!.nearbyText = unrelatedGlobalRegion;
  receipt.elements[8]!.nearbyText = unrelatedGlobalRegion;

  assert.deepEqual(
    resolveObservableSnapshotMatch('Validar que se muestre "comprobante de transacción exitosa"', receipt)?.targets,
    ["Comprobante", "Transacción Exitosa"],
  );
  assert.deepEqual(
    resolveObservableSnapshotMatch('Validar que el comprobante muestre el "monto de la transferencia"', receipt)?.targets,
    ["Monto a Acreditar:", "Transferencias a Mis Cuentas"],
  );
  assert.deepEqual(
    resolveObservableSnapshotMatch('Validar que el comprobante muestre la "referencia de la operación"', receipt)?.targets,
    ["# Referencia:", "Transacción Exitosa"],
  );
});

test("recognizes a transfer confirmation from its complete visible summary shape", () => {
  const confirmation = snapshot([
    "Transferencias a Mis Cuentas", "Cuenta Origen", "Cuenta Destino", "Monto a Acreditar",
    "Comisión", "Impuesto 0.20%", "Total a Debitar",
  ]);
  assert.ok(resolveObservableSnapshotMatch('Validar que se muestre "la confirmación de la transferencia"', confirmation));
  const incomplete = snapshot(["Transferencias a Mis Cuentas", "Cuenta Origen", "Cuenta Destino", "Monto a Acreditar"]);
  assert.equal(resolveObservableSnapshotMatch('Validar que se muestre "la confirmación de la transferencia"', incomplete), undefined);
});

test("classifies visible date-time values without retaining the displayed value", () => {
  assert.equal(isVisibleDateTime("21/10/2026 04:17:36 PM"), true);
  assert.equal(isVisibleDateTime("2026-10-21 16:17:36"), true);
  assert.equal(isVisibleDateTime("No date has been recorded"), false);
});
