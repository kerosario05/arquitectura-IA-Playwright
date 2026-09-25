import assert from "node:assert/strict";
import test from "node:test";
import { buildWebLocators } from "./web-session-recorder";
import { isTechnicalIdentityAdmissible } from "../trace-normalizer";
import { buildCanonicalInteractions } from "../canonical-recording-contract";
import type { RecordedEvent, RecordedTarget } from "../session-trace.types";

/**
 * Physical evidence: a real input for "Número de identificación" — visually labeled, filled by
 * the user — produced `Ingresar "<valor>" en "Campo pendiente de identificar"` because the
 * label and input were structurally related (siblings/nested wrapper in a field-group
 * container) with no `for=`/`id` link, and `el.labels` (what `labelFor` relies on) only covers
 * that direct HTML association. `structural(el)` in web-session-recorder.ts's browser-injected
 * capture script previously fell back to the SAME `labelFor(el)` on a miss, adding no new
 * signal, so a non-grid field with no for=/aria/placeholder/title ended up with an empty
 * label AND an empty headerContext. Fixed there with `nearestFieldGroupLabel`: climbs
 * ancestors for a container owning EXACTLY ONE interactive descendant (this element) and
 * EXACTLY ONE label-like candidate (real structural ownership, fail-closed the moment a
 * container turns out to hold more than one field) and returns that container's label text as
 * `headerContext`.
 *
 * That browser-injected DOM-traversal logic itself cannot be exercised without a real
 * browser/DOM (no browser use is permitted for this ticket, and no jsdom-equivalent is
 * available in this repo) — these tests instead prove the DOWNSTREAM half of the fix: once
 * `structural(el)` resolves a `headerContext` for a non-grid field this way, the existing,
 * already-testable pipeline (`buildWebLocators` -> `isTechnicalIdentityAdmissible` ->
 * `buildCanonicalInteractions`) correctly turns it into a resolved, accepted, executable field
 * — and that when no such context is resolved (the ambiguous/display-only cases), the pipeline
 * still fails closed exactly as before.
 */

test("field-container headerContext (no grid) becomes an admissible structural locator via buildWebLocators", () => {
  const interaction = {
    kind: "fill",
    label: "",
    role: "textbox",
    compoundRole: "amount_or_text",
    headerContext: "Número de identificación", // what structural(el)'s new fallback now resolves
  } as any;
  const locators = buildWebLocators(interaction);
  const structural = locators.find((l) => l.strategy === "structural");
  assert.ok(structural, "a structural candidate must be produced from the resolved field-group label");
  assert.ok(structural!.value.includes("header=N"), `expected a header= component in ${structural!.value}`);
});

test("that structural locator is technically admissible (not the generic grid=...|role=... fallback shape)", () => {
  const target = {
    label: "",
    locators: [{ strategy: "structural", value: "header=Numero de identificacion|role=amount_or_text" }],
  } as RecordedTarget;
  assert.equal(isTechnicalIdentityAdmissible(target), true);
});

test("end to end: a field resolved via field-container association reaches an accepted, executable canonical interaction", () => {
  const events: RecordedEvent[] = [{
    seq: 1,
    t: 100,
    kind: "fill",
    screenKey: "s",
    value: "402-1234567-8",
    target: {
      label: "",
      associatedField: "Número de identificación", // simulates structural(el)'s resolved headerContext, carried through to the field
      compoundRole: "amount_or_text",
      locators: [{ strategy: "structural", value: "header=Numero de identificacion|role=amount_or_text" }],
    } as RecordedTarget,
  }];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions[0].admissionStatus, "accepted");
  assert.equal(interactions[0].semanticField, "Número de identificación");
  assert.equal(interactions[0].recordedValue, "402-1234567-8");
});

test("no field-group association resolved (ambiguous/display-only case): still fails closed, never a fabricated target", () => {
  const events: RecordedEvent[] = [{
    seq: 1,
    t: 100,
    kind: "fill",
    screenKey: "s",
    value: "x",
    target: {
      label: "control", // nearestFieldGroupLabel found nothing (ambiguous container, or no label at all)
      compoundRole: "amount_or_text",
      locators: [],
    } as RecordedTarget,
  }];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions[0].admissionStatus, "unresolved");
  assert.equal(interactions[0].semanticField, undefined);
});

test("disabled state is independent of field identity resolution: a resolved field stays resolved regardless of enabled/disabled", () => {
  const target = {
    label: "",
    associatedField: "Número de identificación",
    compoundRole: "amount_or_text",
    enabled: false, // captured separately from identity — see RecordedTarget.enabled
    locators: [{ strategy: "structural", value: "header=Numero de identificacion|role=amount_or_text" }],
  } as RecordedTarget;
  assert.equal(isTechnicalIdentityAdmissible(target), true, "disabled must never affect technical identity resolution");
});
