import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalInteractions, evaluateRecordedScenarioExecutionReadiness } from "./canonical-recording-contract";
import type { RecordedEvent, RecordedTarget } from "./session-trace.types";

/**
 * Physical evidence (recording 6db50111-a843-4238-bfd8-91f9ff666962, scenario
 * REC-6DB50111-01): the user genuinely selected "Certificados de Deposito" for the
 * "Categoría de producto" field, but preflight reported
 * `unresolved_runtime_value:categoria_de_producto_seleccion` — the owner's own raw event (the
 * tap that opens the compound control) carries the field's real identity (valueKey resolved
 * from its structural/associatedField evidence) but NEVER carries a value of its own; only the
 * separate option/display-choice event carries the actual selected text. The prior dedup fix
 * (ticket: compound-selection dedup) required `previous.recordedValue === interaction.recordedValue`
 * as part of its merge gate — which is false whenever the owner has no value at all — so this
 * owner+option pair was never merged: the owner interaction survived, correctly identified but
 * permanently valueless (reported unresolved), while the option's own raw event produced a
 * second, independent interaction under a display/generic-derived key that was never wired to
 * any required runtime input.
 *
 * Fixed in buildCanonicalInteractions' dedup loop: the recordedValue equality requirement is
 * relaxed to "values compatible" (at most one side actually has a value — two DIFFERENT
 * resolved values are still never treated as compatible), and once a merge fires, the retained
 * (owner) record adopts the other side's recordedValue when its own is empty. Owner keeps
 * authority over valueKey/semanticField; option supplies the runtime value — exactly the
 * "OWNER defines the FIELD, OPTION defines the value" rule.
 */

let seq = 0;
function selectEvent(overrides: { screenKey: string; target: Partial<RecordedTarget> & { label: string } }): RecordedEvent {
  seq += 1;
  return { seq, t: seq * 100, kind: "tap", screenKey: overrides.screenKey, target: { locators: [], ...overrides.target } as RecordedTarget };
}

// The FIELD OWNER half: real structural/technical identity (header context), but the "open the
// compound control" tap itself never carries a selected value.
function ownerNoValue(screenKey: string, fieldLabel: string): RecordedEvent {
  return selectEvent({
    screenKey,
    target: {
      label: fieldLabel,
      compoundRole: "selection",
      associatedField: fieldLabel,
      eventTargetRef: `owner-ref:${fieldLabel}`,
      locators: [{ strategy: "structural", value: `header=${fieldLabel}|role=selection` }],
    },
  });
}

// The OPTION half: shares the owner's DOM ref (eventTargetRef) — the real link a browser
// capture would carry for "chose this option inside that same compound control" — but its own
// raw target has no associatedField/technical identity of its own, and its label is only the
// selected option's display text.
function optionWithValue(screenKey: string, fieldLabel: string, optionText: string): RecordedEvent {
  return selectEvent({
    screenKey,
    target: {
      label: optionText,
      compoundRole: "selection",
      eventTargetRef: `owner-ref:${fieldLabel}`,
      afterValue: optionText,
      locators: [],
    },
  });
}

test("1. owner (no value) + option (value): dataset lands on the OWNER's valueKey", () => {
  seq = 0;
  const events = [ownerNoValue("s", "Categoría de producto"), optionWithValue("s", "Categoría de producto", "Certificados de Deposito")];
  const interactions = buildCanonicalInteractions(events);
  const selects = interactions.filter((i) => i.action === "select");
  assert.equal(selects.length, 1, "owner and option must collapse to one canonical selection");
  assert.equal(selects[0].valueKey, "categoria_de_producto_seleccion");
  assert.equal(selects[0].recordedValue, "Certificados de Deposito");
});

test("2. option (value) then owner (no value), order independence: same result", () => {
  seq = 0;
  const events = [optionWithValue("s", "Producto", "300 - Deposito"), ownerNoValue("s", "Producto")];
  const interactions = buildCanonicalInteractions(events);
  const selects = interactions.filter((i) => i.action === "select");
  assert.equal(selects.length, 1);
  assert.equal(selects[0].valueKey, "producto_seleccion");
  assert.equal(selects[0].recordedValue, "300 - Deposito");
});

test("3. the option's own display-derived key never survives as a separate required item", () => {
  seq = 0;
  const events = [ownerNoValue("s", "Categoría de producto"), optionWithValue("s", "Categoría de producto", "Certificados de Deposito")];
  const interactions = buildCanonicalInteractions(events);
  const selects = interactions.filter((i) => i.action === "select");
  assert.ok(!selects.some((s) => s.valueKey === "certificados_de_deposito_seleccion"), "the option's own display-text-derived key must never appear as its own dataset item");
});

test("4. a generic/control-labeled owner still fails closed: no fabricated field identity, no merge into an unresolved control key", () => {
  seq = 0;
  const events = [
    selectEvent({ screenKey: "s", target: { label: "control", compoundRole: "selection", eventTargetRef: "owner-ref:x", locators: [] } }),
    optionWithValue("s", "Categoría de producto", "Certificados de Deposito"),
  ];
  const interactions = buildCanonicalInteractions(events);
  const selects = interactions.filter((i) => i.action === "select");
  assert.ok(!selects.some((s) => s.valueKey === "control_seleccion"), "a generic label must never become a required 'control_seleccion' runtime input");
});

test("5. same selected value, two different owners: both owners' keys preserved independently", () => {
  seq = 0;
  const events = [
    ownerNoValue("s", "Firma autorizada 1"), optionWithValue("s", "Firma autorizada 1", "Persona X"),
    ownerNoValue("s", "Firma autorizada 2"), optionWithValue("s", "Firma autorizada 2", "Persona X"),
  ];
  const interactions = buildCanonicalInteractions(events);
  const selects = interactions.filter((i) => i.action === "select");
  assert.equal(selects.length, 2, "two distinct owners must never collapse just because they share a selected value");
  assert.deepEqual(selects.map((s) => s.valueKey).sort(), ["firma_autorizada_1_seleccion", "firma_autorizada_2_seleccion"]);
  assert.ok(selects.every((s) => s.recordedValue === "Persona X"));
});

test("6. different values on genuinely different owners: no cross-field corruption", () => {
  seq = 0;
  const events = [
    ownerNoValue("s", "Categoría de producto"), optionWithValue("s", "Categoría de producto", "Certificados de Deposito"),
    ownerNoValue("s", "Producto"), optionWithValue("s", "Producto", "300 - Deposito"),
  ];
  const interactions = buildCanonicalInteractions(events);
  const selects = interactions.filter((i) => i.action === "select");
  assert.equal(selects.length, 2);
  const byKey = new Map(selects.map((s) => [s.valueKey, s.recordedValue]));
  assert.equal(byKey.get("categoria_de_producto_seleccion"), "Certificados de Deposito");
  assert.equal(byKey.get("producto_seleccion"), "300 - Deposito");
});

test("7. unresolved owner (no certified identity at all): the option is never merged into the guessed/generic owner", () => {
  seq = 0;
  const events = [
    selectEvent({ screenKey: "s", target: { label: "campo", compoundRole: "selection", locators: [] } }), // generic, no eventTargetRef link, no technical identity
    selectEvent({ screenKey: "s", target: { label: "Certificados de Deposito", compoundRole: "selection", afterValue: "Certificados de Deposito", locators: [] } }),
  ];
  const interactions = buildCanonicalInteractions(events);
  const selects = interactions.filter((i) => i.action === "select");
  assert.ok(selects.some((s) => s.admissionStatus === "unresolved"), "precondition: the generic owner must be genuinely unresolved");
  const unresolved = selects.find((s) => s.admissionStatus === "unresolved");
  assert.equal(unresolved?.recordedValue, undefined, "an unresolved/uncertified owner must never receive the option's value by a merge/guess — it stays unresolved rather than fabricating a link");
});

test("8. portal-shaped: categoria_de_producto_seleccion resolves with its real selected value", () => {
  seq = 0;
  const events = [ownerNoValue("s", "Categoria de producto"), optionWithValue("s", "Categoria de producto", "Certificados de Deposito")];
  const interactions = buildCanonicalInteractions(events);
  const select = interactions.find((i) => i.action === "select");
  assert.equal(select?.valueKey, "categoria_de_producto_seleccion");
  assert.equal(select?.recordedValue, "Certificados de Deposito");
});

test("9. portal-shaped: producto_seleccion resolves with its real selected value", () => {
  seq = 0;
  const events = [ownerNoValue("s", "Producto"), optionWithValue("s", "Producto", "300 - Deposito a plazo Financiero Personal Capitalizable DOP")];
  const interactions = buildCanonicalInteractions(events);
  const select = interactions.find((i) => i.action === "select");
  assert.equal(select?.valueKey, "producto_seleccion");
  assert.equal(select?.recordedValue, "300 - Deposito a plazo Financiero Personal Capitalizable DOP");
});

test("10. portal-shaped: firma_autorizada_2_seleccion resolves with its real selected value", () => {
  seq = 0;
  const events = [ownerNoValue("s", "Firma autorizada 2"), optionWithValue("s", "Firma autorizada 2", "Xsw4u Ucj44j45 452w4s5 Wp9j4u5")];
  const interactions = buildCanonicalInteractions(events);
  const select = interactions.find((i) => i.action === "select");
  assert.equal(select?.valueKey, "firma_autorizada_2_seleccion");
  assert.equal(select?.recordedValue, "Xsw4u Ucj44j45 452w4s5 Wp9j4u5");
});

test("11. preflight: the three previously-reported keys no longer produce unresolved_runtime_value", () => {
  seq = 0;
  const events = [
    ownerNoValue("s", "Categoria de producto"), optionWithValue("s", "Categoria de producto", "Certificados de Deposito"),
    ownerNoValue("s", "Producto"), optionWithValue("s", "Producto", "300 - Deposito a plazo Financiero Personal Capitalizable DOP"),
    ownerNoValue("s", "Firma autorizada 2"), optionWithValue("s", "Firma autorizada 2", "Xsw4u Ucj44j45 452w4s5 Wp9j4u5"),
  ];
  const interactions = buildCanonicalInteractions(events);
  const audit = evaluateRecordedScenarioExecutionReadiness({
    canonicalInteractions: interactions,
    runtimeInputRequirements: [],
    testRailSteps: [{ content: "step" } as any],
    stateSequenceValid: true,
    mutationDiagnostics: undefined,
    readiness: undefined,
  });
  const unresolvedRuntimeValueReasons = audit.blockReasons.filter((reason) => reason.startsWith("unresolved_runtime_value:"));
  assert.deepEqual(unresolvedRuntimeValueReasons, [], `expected no unresolved_runtime_value reasons, got: ${JSON.stringify(unresolvedRuntimeValueReasons)}`);
  assert.ok(!audit.blockReasons.includes("unresolved_runtime_value:categoria_de_producto_seleccion"));
  assert.ok(!audit.blockReasons.includes("unresolved_runtime_value:producto_seleccion"));
  assert.ok(!audit.blockReasons.includes("unresolved_runtime_value:firma_autorizada_2_seleccion"));
});
