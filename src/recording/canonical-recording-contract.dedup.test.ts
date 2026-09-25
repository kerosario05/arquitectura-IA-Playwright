import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalInteractions } from "./canonical-recording-contract";
import { isTechnicalIdentityAdmissible } from "./trace-normalizer";
import type { RecordedEvent, RecordedTarget } from "./session-trace.types";

/**
 * Physical recording evidence: pairs like `Seleccionar "X"` / `Seleccionar "X"` back to back for
 * the SAME compound control (combobox/autocomplete/grid picker), one per raw technical event
 * (click on the option descendant, then a change/selection confirmation on the owning control).
 * The prior dedup block matched on `controlIdentity` — built from each event's OWN raw
 * target/locator — so the two raw events, despite sharing the same OWNER, never matched and
 * both survived as separate canonical actions. Fixed by deduping on the actionable-owner
 * identity (`selectorControlId`, already computed for any compound "selection" target) instead
 * of the raw per-event target identity, gated by same surface + same value + sequence adjacency
 * (the gesture-cluster proxy: no other functional action between the two raw events) + neither
 * interaction unresolved.
 */

let seq = 0;
function tapEvent(overrides: {
  screenKey: string;
  target: Partial<RecordedTarget> & { label: string };
}): RecordedEvent {
  seq += 1;
  return { seq, t: seq * 100, kind: "tap", screenKey: overrides.screenKey, target: { locators: [], ...overrides.target } as RecordedTarget };
}

// A compound-control owner: descendant click + change confirmation share this selector identity
// via compoundRole="selection", even though their own raw locators differ.
function comboboxDescendantClick(screenKey: string, ownerField: string, value: string): RecordedEvent {
  return tapEvent({
    screenKey,
    target: {
      label: value,
      compoundRole: "selection",
      afterValue: value,
      associatedField: ownerField,
      eventTargetRef: `combobox:${ownerField}`, // selectorControlOf resolves the OWNER from this
      locators: [{ strategy: "text", value }], // the raw clicked <span>'s own identity — different from the owner
    },
  });
}

function comboboxChangeConfirm(screenKey: string, ownerField: string, value: string): RecordedEvent {
  return tapEvent({
    screenKey,
    target: {
      label: value,
      compoundRole: "selection",
      afterValue: value,
      associatedField: ownerField,
      eventTargetRef: `combobox:${ownerField}`, // same owner as the descendant click
      attributes: { id: `combobox-${ownerField}` },
      locators: [{ strategy: "id", value: `combobox-${ownerField}` }], // the owning control's own identity
    },
  });
}

test("0. precondition: a bare role locator alone still carries no technical authority (unchanged by this ticket's dedup work)", () => {
  assert.equal(isTechnicalIdentityAdmissible({ label: "x", locators: [{ strategy: "role", value: "button" }] } as RecordedTarget), false);
});

test("1. same gesture / same owner: descendant click + change confirmation collapse to ONE canonical select", () => {
  seq = 0;
  const events = [
    comboboxDescendantClick("s", "Cuenta", "Efectivo"),
    comboboxChangeConfirm("s", "Cuenta", "Efectivo"),
  ];
  const interactions = buildCanonicalInteractions(events);
  const selects = interactions.filter((i) => i.action === "select");
  assert.equal(selects.length, 1);
  assert.equal(selects[0].sourceEventRefs.length, 2, "both raw events must still be attributed to the one canonical action");
});

test("2. same value, different owner: two distinct comboboxes never collapse just because the value matches", () => {
  seq = 0;
  const events = [
    comboboxChangeConfirm("s", "Origen", "A"),
    comboboxChangeConfirm("s", "Destino", "A"),
  ];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions.filter((i) => i.action === "select").length, 2);
});

test("3. same owner, different value: never collapsed", () => {
  seq = 0;
  const events = [
    comboboxChangeConfirm("s", "Cuenta", "A"),
    comboboxChangeConfirm("s", "Cuenta", "B"),
  ];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions.filter((i) => i.action === "select").length, 2);
});

test("4. surface transition: same owner-like value across a screen change never dedups across surfaces", () => {
  seq = 0;
  const events = [
    comboboxChangeConfirm("surface-a", "Cuenta", "Efectivo"),
    comboboxChangeConfirm("surface-b", "Cuenta", "Efectivo"),
  ];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions.filter((i) => i.action === "select").length, 2);
});

test("5. legit repeated action: selecting the same value again after an unrelated functional action in between is never over-deduped", () => {
  seq = 0;
  const events = [
    comboboxChangeConfirm("s", "Cuenta", "Efectivo"),
    tapEvent({ screenKey: "s", target: { label: "Continuar", attributes: { id: "continue-btn" } } }),
    comboboxChangeConfirm("s", "Cuenta", "Efectivo"),
  ];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions.filter((i) => i.action === "select").length, 2);
});

test("6. temporally/sequence-separated gestures: same owner/value but not adjacent (something else happened) -> never collapsed", () => {
  seq = 0;
  const events = [
    comboboxChangeConfirm("s", "Cuenta", "Efectivo"),
    comboboxChangeConfirm("s", "Otro", "X"), // a different selection lands in between
    comboboxChangeConfirm("s", "Cuenta", "Efectivo"),
  ];
  const interactions = buildCanonicalInteractions(events);
  const cuentaSelects = interactions.filter((i) => i.action === "select" && i.entityScope === undefined && i.recordedValue === "Efectivo");
  assert.equal(cuentaSelects.length, 2, "the two Efectivo selections are not adjacent — a different owner's selection intervened — so they must stay separate");
});

test("7. raw target differs, owner same: option descendant click + combobox change still collapse to one action", () => {
  seq = 0;
  const events = [
    comboboxDescendantClick("s", "Producto", "201 - Cuentas de Ahorros sin Libreta DOP"),
    comboboxChangeConfirm("s", "Producto", "201 - Cuentas de Ahorros sin Libreta DOP"),
  ];
  const interactions = buildCanonicalInteractions(events);
  const selects = interactions.filter((i) => i.action === "select");
  assert.equal(selects.length, 1);
});

test("8. unresolved owner: same text/value never dedups by text alone when technical identity is unresolved", () => {
  seq = 0;
  // A generic label ("control") with no technical corroboration is unresolved by the shared
  // admission gate (prior ticket) regardless of surface transitions — the precondition this
  // test needs to prove dedup never rescues an unresolved pair by matching their display text.
  const events = [
    tapEvent({ screenKey: "s", target: { label: "control", compoundRole: "selection", afterValue: "Efectivo", locators: [{ strategy: "text", value: "Efectivo" }] } }),
    tapEvent({ screenKey: "s", target: { label: "control", compoundRole: "selection", afterValue: "Efectivo", locators: [{ strategy: "text", value: "Efectivo" }] } }),
  ];
  const interactions = buildCanonicalInteractions(events);
  const selects = interactions.filter((i) => i.action === "select");
  assert.ok(selects.every((s) => s.admissionStatus === "unresolved"), "precondition: both must be genuinely unresolved for this test to prove anything");
  assert.equal(selects.length, 2, "unresolved interactions must never be merged by coincidental text match");
});

test("9. role locator without a stable accessible name grants no technical authority on its own", () => {
  const bareRole = { label: "x", locators: [{ strategy: "role", value: "button" }] } as RecordedTarget;
  const qualifiedRole = { label: "x", locators: [{ strategy: "role", value: "button|finalize" }] } as RecordedTarget;
  assert.equal(isTechnicalIdentityAdmissible(bareRole), false);
  assert.equal(isTechnicalIdentityAdmissible(qualifiedRole), true);
});

test("10. portal-comercial-shaped regression fixture: repeated-pair evidence collapses only where owner/value/surface/gesture genuinely match", () => {
  seq = 0;
  const events = [
    comboboxDescendantClick("s", "Cuenta origen", "CONSTANTIN.POINDEXTER@GMAIL.COM"),
    comboboxChangeConfirm("s", "Cuenta origen", "CONSTANTIN.POINDEXTER@GMAIL.COM"),
    comboboxDescendantClick("s", "Tipo de cuenta", "Cuentas de Efectivo"),
    comboboxChangeConfirm("s", "Tipo de cuenta", "Cuentas de Efectivo"),
    comboboxDescendantClick("s", "Subtipo", "201 - Cuentas de Ahorros sin Libreta DOP"),
    comboboxChangeConfirm("s", "Subtipo", "201 - Cuentas de Ahorros sin Libreta DOP"),
    comboboxDescendantClick("s", "Categoria", "Ahorros Personales"),
    comboboxChangeConfirm("s", "Categoria", "Ahorros Personales"),
    comboboxDescendantClick("s", "Moneda", "Efectivo"),
    comboboxChangeConfirm("s", "Moneda", "Efectivo"),
  ];
  const rawEvents = events.length;
  const beforeCount = events.length; // one canonical action per raw event, pre-fix behavior
  const interactions = buildCanonicalInteractions(events);
  const afterCount = interactions.filter((i) => i.action === "select").length;
  assert.equal(rawEvents, 10);
  assert.equal(beforeCount, 10);
  assert.equal(afterCount, 5, "each descendant-click + change-confirm pair must collapse to exactly one canonical select, since each pair shares owner/value/surface/gesture");
});
