import assert from "node:assert/strict";
import test from "node:test";
import type { SnapshotElement } from "../types/page-snapshot.types";
import { findUniqueSelectionListRecoveryControl, isSelectionListRecoveryControlLabel } from "./selection-list-recovery";

function button(text: string, nearbyText: string, overrides: Partial<SnapshotElement> = {}): SnapshotElement {
  return {
    id: text,
    type: "button",
    text,
    visible: true,
    candidateLocators: [],
    dataHints: [],
    nearbyText,
    ...overrides,
  };
}

test("recognizes generic Spanish and English list-recovery labels", () => {
  assert.equal(isSelectionListRecoveryControlLabel("Reintentar buscar lista"), true);
  assert.equal(isSelectionListRecoveryControlLabel("Retry loading options"), true);
  assert.equal(isSelectionListRecoveryControlLabel("Guardar"), false);
  assert.equal(isSelectionListRecoveryControlLabel("Reintentar operación"), false);
});

test("resolves a retry action only when its nearby DOM text associates it with the selected field", () => {
  const retry = button("Reintentar buscar lista", "Forma de pago Instrumento Reintentar buscar lista");
  const unrelated = button("Retry list", "Other product list");

  assert.equal(findUniqueSelectionListRecoveryControl([retry, unrelated], "Instrumento"), retry);
  assert.equal(findUniqueSelectionListRecoveryControl([retry, unrelated], "Account type"), undefined);
});

test("fails closed for hidden, disabled, or ambiguous retry controls and leaves ordinary selectors alone", () => {
  const nearby = "Payment method Instrument list Retry loading list";
  assert.equal(findUniqueSelectionListRecoveryControl([button("Retry loading list", nearby, { visible: false })], "Instrument"), undefined);
  assert.equal(findUniqueSelectionListRecoveryControl([button("Retry loading list", nearby, { disabled: true })], "Instrument"), undefined);
  assert.equal(findUniqueSelectionListRecoveryControl([
    button("Retry loading list", nearby),
    button("Retry list", nearby),
  ], "Instrument"), undefined);
  assert.equal(findUniqueSelectionListRecoveryControl([
    button("Choose", nearby, { role: "button" }),
  ], "Instrument"), undefined);
});
