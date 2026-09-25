import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalInteractions } from "./canonical-recording-contract";
import type { RecordedEvent, RecordedTarget } from "./session-trace.types";

/**
 * A real recording still produced duplicate pairs after the prior dedup fix: one interaction
 * targeting the compound control's own technical/structural owner
 * ("structural:grid=grid:div|role=amount_or_text"), another targeting the selected option's
 * bare DISPLAY VALUE ("Cuentas de Efectivo") — same valueKey, same recordedValue, but
 * selectorControlId/controlIdentity genuinely differ (each is built from that specific event's
 * own raw target), so the prior owner-identity-based merge never fired. valueKey alone is never
 * sufficient evidence on its own (two unrelated fields could coincidentally share one) — the
 * additional, required signal is that exactly ONE side of the pair carries its own technical
 * target evidence (technicalTargetRefs.length > 0): that asymmetry is what proves this is one
 * compound control's owner+option split, not two independently-identified fields.
 */

let seq = 0;
function selectEvent(overrides: {
  screenKey: string;
  target: Partial<RecordedTarget> & { label: string };
}): RecordedEvent {
  seq += 1;
  return { seq, t: seq * 100, kind: "tap", screenKey: overrides.screenKey, target: { locators: [], afterValue: overrides.target.label, ...overrides.target } as RecordedTarget };
}

// The technical/structural owner half of a compound selection (real shape: structural fallback
// carrying the field's own header context — admissible per the prior admission-gate ticket).
function ownerHalf(screenKey: string, fieldLabel: string, value: string): RecordedEvent {
  return selectEvent({
    screenKey,
    target: {
      label: value,
      compoundRole: "selection",
      associatedField: fieldLabel,
      afterValue: value,
      locators: [{ strategy: "structural", value: `header=${fieldLabel}|role=selection` }],
    },
  });
}

// The bare display/option half — same field/value, but its own raw target carries no technical
// identity of its own (the option's clicked descendant had no independent id/testid/structural
// evidence — only the option's own display text, which is why fieldOf resolves the SAME field
// name via associatedField, but technicalTargetRefs ends up empty for this specific raw event).
function optionHalf(screenKey: string, fieldLabel: string, value: string): RecordedEvent {
  return selectEvent({
    screenKey,
    target: {
      label: value,
      compoundRole: "selection",
      associatedField: fieldLabel,
      afterValue: value,
      locators: [],
    },
  });
}

test("1. owner then option, same valueKey: collapses to one canonical select", () => {
  seq = 0;
  const events = [ownerHalf("s", "Cuentas de Efectivo", "Cuentas de Efectivo"), optionHalf("s", "Cuentas de Efectivo", "Cuentas de Efectivo")];
  const interactions = buildCanonicalInteractions(events);
  const selects = interactions.filter((i) => i.action === "select");
  assert.equal(selects.length, 1);
});

test("2. option then owner, same valueKey (order independence): also collapses to one canonical select", () => {
  seq = 0;
  const events = [optionHalf("s", "Cuentas de Efectivo", "Cuentas de Efectivo"), ownerHalf("s", "Cuentas de Efectivo", "Cuentas de Efectivo")];
  const interactions = buildCanonicalInteractions(events);
  const selects = interactions.filter((i) => i.action === "select");
  assert.equal(selects.length, 1);
});

test("3. same valueKey, different owner (both sides carry their own technical identity): never merged", () => {
  seq = 0;
  const events = [ownerHalf("s", "Origen", "A"), ownerHalf("s", "Destino", "A")];
  // Force both to share a valueKey artificially by giving them the same field label + scope —
  // the point is both are full owners (technicalTargetRefs present on BOTH), so the required
  // asymmetry (exactly one side lacking its own technical identity) never holds.
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions.filter((i) => i.action === "select").length, 2);
});

test("4. same display value, different valueKey: never merged", () => {
  seq = 0;
  const events = [ownerHalf("s", "Campo A", "Efectivo"), optionHalf("s", "Campo B", "Efectivo")];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions.filter((i) => i.action === "select").length, 2);
});

test("5. same owner, different value: never merged", () => {
  seq = 0;
  const events = [ownerHalf("s", "Cuenta", "A"), optionHalf("s", "Cuenta", "B")];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions.filter((i) => i.action === "select").length, 2);
});

test("6. surface transition between the owner and option halves: never merged across surfaces", () => {
  seq = 0;
  const events = [ownerHalf("surface-a", "Cuenta", "Efectivo"), optionHalf("surface-b", "Cuenta", "Efectivo")];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions.filter((i) => i.action === "select").length, 2);
});

test("7. a functional intermediate action breaks adjacency: never merged", () => {
  seq = 0;
  const events = [
    ownerHalf("s", "Cuenta", "Efectivo"),
    selectEvent({ screenKey: "s", target: { label: "Continuar", attributes: { id: "continue" }, afterValue: undefined, compoundRole: undefined } }),
    optionHalf("s", "Cuenta", "Efectivo"),
  ];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions.filter((i) => i.action === "select").length, 2);
});

test("8. an unresolved member is never aggressively merged, even with matching valueKey/value", () => {
  seq = 0;
  const events = [
    selectEvent({ screenKey: "s", target: { label: "control", afterValue: "Efectivo", compoundRole: "selection", locators: [] } }), // generic label -> unresolved
    optionHalf("s", "control", "Efectivo"),
  ];
  const interactions = buildCanonicalInteractions(events);
  const selects = interactions.filter((i) => i.action === "select");
  assert.ok(selects.some((s) => s.admissionStatus === "unresolved"), "precondition: at least one side must be genuinely unresolved");
  assert.equal(selects.length, 2, "an unresolved member must never be merged away");
});

test("9. owner evidence is preserved on merge regardless of which side arrived first", () => {
  seq = 0;
  const events = [optionHalf("s", "Cuentas de Efectivo", "Cuentas de Efectivo"), ownerHalf("s", "Cuentas de Efectivo", "Cuentas de Efectivo")];
  const interactions = buildCanonicalInteractions(events);
  const merged = interactions.find((i) => i.action === "select")!;
  assert.ok(merged.technicalTargetRefs.some((ref) => ref.startsWith("structural:")), "the merged action must keep the technical/structural owner target, never just the display option");
});

test("10. source lineage: the merged canonical action retains both raw events' evidence without duplicating the functional action", () => {
  seq = 0;
  const events = [ownerHalf("s", "Cuentas de Efectivo", "Cuentas de Efectivo"), optionHalf("s", "Cuentas de Efectivo", "Cuentas de Efectivo")];
  const interactions = buildCanonicalInteractions(events);
  const selects = interactions.filter((i) => i.action === "select");
  assert.equal(selects.length, 1);
  assert.equal(selects[0].sourceEventRefs.length, 2, "both raw events must be attributed to the single canonical action");
});

test("11. portal-shaped fixture: five real-shape owner+option pairs collapse to exactly five canonical selections", () => {
  seq = 0;
  const fields: Array<{ field: string; value: string }> = [
    { field: "Correo electrónico", value: "CONSTANTIN.POINDEXTER@GMAIL.COM" },
    { field: "Tipo de cuenta", value: "Cuentas de Efectivo" },
    { field: "Subtipo", value: "201 - Cuentas de Ahorros sin Libreta DOP" },
    { field: "Categoria", value: "Ahorros Personales" },
    { field: "Moneda", value: "Efectivo" },
  ];
  const events: RecordedEvent[] = fields.flatMap(({ field, value }) => [ownerHalf("s", field, value), optionHalf("s", field, value)]);
  assert.equal(events.length, 10, "10 raw selection representations, matching the physically observed shape");
  const interactions = buildCanonicalInteractions(events);
  const selects = interactions.filter((i) => i.action === "select");
  assert.equal(selects.length, 5, "each owner+option pair must collapse to exactly one canonical selection");
});
