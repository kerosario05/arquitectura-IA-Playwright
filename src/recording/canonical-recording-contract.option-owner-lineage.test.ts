import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalInteractions } from "./canonical-recording-contract";
import type { RecordedEvent, RecordedTarget } from "./session-trace.types";

/**
 * FIRST_LOSS (jobId 73e597f1-1312-48ba-b422-66ffdf9b091d, confirmed identical across a fresh job
 * and its rerun -- a WRITER defect, not stale-artifact reuse): a transient overlay option's raw
 * CLICK event has no real DOM field ancestor to climb from (it renders in a portal), so `fieldOf`
 * fell back to the option's OWN display label as its `semanticField` -- which then becomes
 * `associatedField` on the technical action `resolveActionTarget` receives, instead of the owning
 * field's name. Confirmed against the REAL physical shape (three raw events per selection: an
 * owner-open click with no technical identity, an option click WITH real technical identity, and
 * a separate synthesized "select" event that already independently records the correct owner
 * field + the exact chosen value) via the two job artifacts' `canonicalInteractions`.
 *
 * Fix: a same-screen "select" interaction whose own `recordedValue` equals the option click's
 * (wrong) `semanticField` is real, already-captured, independently-observed evidence of the same
 * physical value -- not a guess -- so it corrects the click's `semanticField` in place. The
 * click's own target/technicalTargetRefs/execution authority are never touched.
 */

let seq = 0;
function rawEvent(screenKey: string, target: Partial<RecordedTarget> & { label: string }): RecordedEvent {
  seq += 1;
  return { seq, t: seq * 100, kind: "tap", screenKey, target: { locators: [], ...target } as RecordedTarget };
}

// The owner click that opens the dropdown -- no technical identity of its own (matches the
// physical `technicalTargetRefs: []` on the real owner interaction), real field label. A plain
// click never carries `afterValue` (only the eventual value-commit event does).
function ownerOpenClick(screenKey: string, ownerField: string): RecordedEvent {
  return rawEvent(screenKey, { label: ownerField, associatedField: ownerField, locators: [] });
}

// The option click -- REAL technical identity (role/css/id), but no associatedField at all: this
// is exactly the transient-overlay gap `fieldOf` cannot climb past.
function optionClick(screenKey: string, optionLabel: string): RecordedEvent {
  return rawEvent(screenKey, {
    label: optionLabel,
    locators: [{ strategy: "css", value: "#opt-1" }],
    technicalTargetCandidates: [{
      targetType: "structural",
      locatorCandidates: [{ strategy: "css", value: "#opt-1", confidence: 0.8 }],
      structuralContext: { owner: { tag: "li", role: "option" }, stableDirectAttributes: { id: "opt-1", role: "option" }, deterministicStructuralIdentity: true },
      interactionEvidence: [],
      confidence: 0.85,
    }] as any,
  });
}

// The synthesized "select" commit event -- compoundRole "selection", carries the CORRECT owner
// field via its own associatedField, and the exact committed value as afterValue/recordedValue.
function selectCommit(screenKey: string, ownerField: string, value: string): RecordedEvent {
  return rawEvent(screenKey, { label: value, compoundRole: "selection", associatedField: ownerField, afterValue: value, locators: [] });
}

test("1/optionAdoptsOwnerSemanticField. option.target stays the option, option.associatedField becomes the owner field", () => {
  seq = 0;
  const events = [ownerOpenClick("s", "Categoría de producto"), optionClick("s", "Cuentas de Efectivo"), selectCommit("s", "Categoría de producto", "Cuentas de Efectivo")];
  const interactions = buildCanonicalInteractions(events);

  const owner = interactions.find((i) => i.action !== "select" && i.technicalTargetRefs.length === 0);
  const option = interactions.find((i) => i.action !== "select" && i.technicalTargetRefs.length > 0);
  assert.ok(owner, "expected the owner-open interaction to survive");
  assert.ok(option, "expected the option-click interaction to survive");

  assert.equal(owner!.semanticField, "Categoría de producto");
  assert.equal(option!.semanticField, "Categoría de producto", "the option's associatedField must become the OWNER field, not its own label");
  assert.notEqual(option!.semanticField, "Cuentas de Efectivo", "must never stay the option's own display text");
  // target/technical identity untouched -- only semanticField changed.
  assert.deepEqual(option!.technicalTargetRefs, ["css:#opt-1"]);
});

test("2/twoConsecutiveSelectionsNoCrossContamination. A→X and B→Y stay correctly attributed, never swapped or merged across fields", () => {
  seq = 0;
  const events = [
    ownerOpenClick("s", "Categoría de producto"), optionClick("s", "Cuentas de Efectivo"), selectCommit("s", "Categoría de producto", "Cuentas de Efectivo"),
    ownerOpenClick("s", "Producto"), optionClick("s", "201 - Cuentas de Ahorros"), selectCommit("s", "Producto", "201 - Cuentas de Ahorros"),
  ];
  const interactions = buildCanonicalInteractions(events);
  const options = interactions.filter((i) => i.action !== "select" && i.technicalTargetRefs.length > 0);
  assert.equal(options.length, 2);
  const categoriaOption = options.find((o) => o.technicalTargetRefs.includes("css:#opt-1"));
  assert.ok(categoriaOption);
  assert.equal(categoriaOption!.semanticField, "Categoría de producto");
});

test("3/optionTargetNeverBecomesOwner. the option's own technical target/ref is never replaced by the owner's", () => {
  seq = 0;
  const events = [ownerOpenClick("s", "Categoría de producto"), optionClick("s", "Cuentas de Efectivo"), selectCommit("s", "Categoría de producto", "Cuentas de Efectivo")];
  const interactions = buildCanonicalInteractions(events);
  const option = interactions.find((i) => i.action !== "select" && i.technicalTargetRefs.length > 0);
  assert.ok(option);
  assert.ok(option!.technicalTargetRefs.some((ref) => ref.includes("opt-1")), "target must still resolve to the option element");
});

test("4/noOwnerLineageAvailable. without any matching select-sibling, the option's semanticField is left untouched -- never fabricated", () => {
  seq = 0;
  const events = [ownerOpenClick("s", "Categoría de producto"), optionClick("s", "Cuentas de Efectivo")];
  const interactions = buildCanonicalInteractions(events);
  const option = interactions.find((i) => i.action !== "select" && i.technicalTargetRefs.length > 0);
  assert.ok(option);
  assert.equal(option!.semanticField, "Cuentas de Efectivo", "with no corroborating select sibling, semanticField is left as-is (fails closed downstream, never guessed here)");
});

test("5/ambiguousSelectSiblingsLeftUntouched. two same-screen select interactions record the SAME value for different fields: no correction is applied", () => {
  seq = 0;
  const events = [
    ownerOpenClick("s", "Categoría de producto"), optionClick("s", "Cuentas de Efectivo"),
    selectCommit("s", "Categoría de producto", "Cuentas de Efectivo"),
    selectCommit("s", "Otro Campo", "Cuentas de Efectivo"),
  ];
  const interactions = buildCanonicalInteractions(events);
  const option = interactions.find((i) => i.action !== "select" && i.technicalTargetRefs.length > 0);
  assert.ok(option);
  assert.equal(option!.semanticField, "Cuentas de Efectivo", "ambiguous owner candidates must never be resolved by guessing either one");
});
