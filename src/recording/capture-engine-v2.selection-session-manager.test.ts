import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { SelectionSessionManager } from "./capture-engine-v2.selection-session-manager";
import type { CaptureOwner } from "./capture-engine-v2.types";

/**
 * `SelectionSessionManager` OBSERVES the technical (Playwright-like) click stream and, when a
 * combobox-owner click is followed by a compatible option click, PROJECTS one logical
 * `CaptureFunctionalAction(functionalActionType="select")` -- without ever removing or altering
 * the two technical clicks that produced it (that responsibility belongs to the bridge, which
 * always appends both clicks to `technicalActions` BEFORE calling this manager; these tests
 * simulate that by passing the technical seq the bridge would already have assigned).
 */

const docA = { captureInstanceId: "instance-1", documentId: "doc-A" };
const docB = { captureInstanceId: "instance-1", documentId: "doc-B" };

const combobox: CaptureOwner = { tag: "span", role: "combobox", technicalRefs: ["id:doc-type-combo"], associatedField: "Tipo de documento" };
const option: CaptureOwner = { tag: "li", role: "option", technicalRefs: ["id:option-3"], accessibleName: "Cédula de ciudadanía" };
const unrelatedButton: CaptureOwner = { tag: "button", role: "button", accessibleName: "Iniciar sesión" };
const plainButton: CaptureOwner = { tag: "button", role: "button", accessibleName: "Depurar" };

test("combobox click observation opens a pending selection without needing an option yet", () => {
  const manager = new SelectionSessionManager();
  const opened = manager.observeTechnicalClick({ owner: combobox, documentContext: docA, technicalActionSeq: 4, identity: { label: "Tipo de documento" } });
  assert.equal(opened.outcome, "opened");
});

test("4. combobox click + option click observed -> exactly one functional select projection (the two technical clicks are the CALLER's responsibility, not touched here)", () => {
  const manager = new SelectionSessionManager();
  manager.observeTechnicalClick({ owner: combobox, documentContext: docA, technicalActionSeq: 4 });
  const projected = manager.observeTechnicalClick({ owner: option, documentContext: docA, technicalActionSeq: 5, selectedDisplay: "Cédula de ciudadanía" });

  assert.equal(projected.outcome, "projected");
  assert.equal(projected.outcome === "projected" && projected.action.functionalActionType, "select");
});

test("5. the functional projection references BOTH technical seqs, so it can be traced back to the exact technical actions it summarizes", () => {
  const manager = new SelectionSessionManager();
  manager.observeTechnicalClick({ owner: combobox, documentContext: docA, technicalActionSeq: 4 });
  const result = manager.observeTechnicalClick({ owner: option, documentContext: docA, technicalActionSeq: 5 });

  assert.equal(result.outcome, "projected");
  assert.deepEqual(result.outcome === "projected" && result.action.sourceTechnicalActionSeqs, [4, 5]);
});

test("2. the combobox's own technical refs are preserved on the projection's owner", () => {
  const manager = new SelectionSessionManager();
  manager.observeTechnicalClick({ owner: combobox, documentContext: docA, technicalActionSeq: 4 });
  const result = manager.observeTechnicalClick({ owner: option, documentContext: docA, technicalActionSeq: 5 });

  assert.equal(result.outcome, "projected");
  assert.deepEqual(result.outcome === "projected" && result.action.owner?.technicalRefs, ["id:doc-type-combo"]);
});

test("7. option evidence is preserved separately, under selectionEvidence.optionOwner -- never merged into owner", () => {
  const manager = new SelectionSessionManager();
  manager.observeTechnicalClick({ owner: combobox, documentContext: docA, technicalActionSeq: 4 });
  const result = manager.observeTechnicalClick({ owner: option, documentContext: docA, technicalActionSeq: 5, selectedDisplay: "Cédula de ciudadanía" });

  assert.equal(result.outcome, "projected");
  const action = result.outcome === "projected" ? result.action : undefined;
  assert.equal(action?.selectionEvidence.optionOwner?.technicalRefs?.[0], "id:option-3");
  assert.equal(action?.selectionEvidence.selectedDisplay, "Cédula de ciudadanía");
});

test("associatedField remains the combobox's own evidence, never overwritten by the option", () => {
  const manager = new SelectionSessionManager();
  manager.observeTechnicalClick({ owner: combobox, documentContext: docA, technicalActionSeq: 4 });
  const result = manager.observeTechnicalClick({ owner: option, documentContext: docA, technicalActionSeq: 5 });

  assert.equal(result.outcome, "projected");
  assert.equal(result.outcome === "projected" && result.action.owner?.associatedField, "Tipo de documento");
});

test("6. the option never replaces owner identity: the projection's owner is the combobox, not the option, by tag/role", () => {
  const manager = new SelectionSessionManager();
  manager.observeTechnicalClick({ owner: combobox, documentContext: docA, technicalActionSeq: 4 });
  const result = manager.observeTechnicalClick({ owner: option, documentContext: docA, technicalActionSeq: 5 });

  assert.equal(result.outcome, "projected");
  const owner = result.outcome === "projected" ? result.action.owner : undefined;
  assert.equal(owner?.tag, "span");
  assert.equal(owner?.role, "combobox");
});

test("9. an unresolved click between combobox and option is never observed by the manager at all -- the pending session survives untouched", () => {
  const manager = new SelectionSessionManager();
  manager.observeTechnicalClick({ owner: combobox, documentContext: docA, technicalActionSeq: 4 });
  // The bridge never calls observeTechnicalClick for an unresolved click (no owner was resolved
  // at all) -- simulated here simply by not calling it, which is the whole point: nothing changes.
  const result = manager.observeTechnicalClick({ owner: option, documentContext: docA, technicalActionSeq: 6 });

  assert.equal(result.outcome, "projected", "the session opened by the combobox must still be the one projected");
});

test("10. an unrelated, resolved actionable click cancels a pending selection, without fabricating a projection", () => {
  const manager = new SelectionSessionManager();
  manager.observeTechnicalClick({ owner: combobox, documentContext: docA, technicalActionSeq: 4 });
  const result = manager.observeTechnicalClick({ owner: unrelatedButton, documentContext: docA, technicalActionSeq: 5 });

  assert.equal(result.outcome, "unrelated_cancelled");
  // The cancelled session cannot resurface for a later option either.
  const later = manager.observeTechnicalClick({ owner: option, documentContext: docA, technicalActionSeq: 6 });
  assert.equal(later.outcome, "orphan_option");
});

test("8. two selections observed sequentially -> two functional projections, each tied to its own pair of technical seqs", () => {
  const manager = new SelectionSessionManager();
  const combobox2: CaptureOwner = { tag: "span", role: "combobox", technicalRefs: ["id:other-combo"] };

  manager.observeTechnicalClick({ owner: combobox, documentContext: docA, technicalActionSeq: 4 });
  const first = manager.observeTechnicalClick({ owner: option, documentContext: docA, technicalActionSeq: 5 });
  manager.observeTechnicalClick({ owner: combobox2, documentContext: docA, technicalActionSeq: 6 });
  const second = manager.observeTechnicalClick({ owner: option, documentContext: docA, technicalActionSeq: 7 });

  assert.equal(first.outcome, "projected");
  assert.equal(second.outcome, "projected");
  assert.deepEqual(first.outcome === "projected" && first.action.sourceTechnicalActionSeqs, [4, 5]);
  assert.deepEqual(second.outcome === "projected" && second.action.sourceTechnicalActionSeqs, [6, 7]);
});

test("a second combobox click cancels the first, incompatible pending session, and opens a new one", () => {
  const manager = new SelectionSessionManager();
  const combobox2: CaptureOwner = { tag: "span", role: "combobox", technicalRefs: ["id:other-combo"] };
  manager.observeTechnicalClick({ owner: combobox, documentContext: docA, technicalActionSeq: 4 });
  const second = manager.observeTechnicalClick({ owner: combobox2, documentContext: docA, technicalActionSeq: 5 });

  assert.equal(second.outcome, "reopened");
  const projected = manager.observeTechnicalClick({ owner: option, documentContext: docA, technicalActionSeq: 6 });
  assert.equal(projected.outcome, "projected");
  assert.equal(projected.outcome === "projected" && projected.action.owner?.technicalRefs?.[0], "id:other-combo", "the SECOND combobox must be the projected owner");
});

test("an option arriving in a different document than its combobox never produces a cross-document projection", () => {
  const manager = new SelectionSessionManager();
  manager.observeTechnicalClick({ owner: combobox, documentContext: docA, technicalActionSeq: 4 });
  const result = manager.observeTechnicalClick({ owner: option, documentContext: docB, technicalActionSeq: 5 });

  assert.equal(result.outcome, "orphan_option");
});

test("a duplicate option/click framework event after a successful projection never produces a second selection", () => {
  const manager = new SelectionSessionManager();
  manager.observeTechnicalClick({ owner: combobox, documentContext: docA, technicalActionSeq: 4 });
  const first = manager.observeTechnicalClick({ owner: option, documentContext: docA, technicalActionSeq: 5 });
  const duplicate = manager.observeTechnicalClick({ owner: option, documentContext: docA, technicalActionSeq: 6 });

  assert.equal(first.outcome, "projected");
  assert.equal(duplicate.outcome, "orphan_option", "no pending session remains to project a second time");
});

test("an option with no active combobox session produces a diagnostic outcome, never a functional projection", () => {
  const manager = new SelectionSessionManager();
  const result = manager.observeTechnicalClick({ owner: option, documentContext: docA, technicalActionSeq: 4 });
  assert.equal(result.outcome, "orphan_option");
});

test("a plain button followed by an option never synthesizes a projection", () => {
  const manager = new SelectionSessionManager();
  const buttonResult = manager.observeTechnicalClick({ owner: plainButton, documentContext: docA, technicalActionSeq: 4 });
  assert.equal(buttonResult.outcome, "ignored", "no pending session existed, and a plain button is neither combobox nor option");

  const optionResult = manager.observeTechnicalClick({ owner: option, documentContext: docA, technicalActionSeq: 5 });
  assert.equal(optionResult.outcome, "orphan_option");
});

test("explicit cancelSelectionSession clears any pending session", () => {
  const manager = new SelectionSessionManager();
  manager.observeTechnicalClick({ owner: combobox, documentContext: docA, technicalActionSeq: 4 });
  manager.cancelSelectionSession();

  const result = manager.observeTechnicalClick({ owner: option, documentContext: docA, technicalActionSeq: 5 });
  assert.equal(result.outcome, "orphan_option");
});

test("no field/value is required to reach a decision -- selectedValue/selectedDisplay are always optional", () => {
  const manager = new SelectionSessionManager();
  manager.observeTechnicalClick({ owner: combobox, documentContext: docA, technicalActionSeq: 4 });
  const result = manager.observeTechnicalClick({ owner: option, documentContext: docA, technicalActionSeq: 5 }); // no selectedValue/selectedDisplay at all
  assert.equal(result.outcome, "projected");
});

test("15/16. this module never references onInteraction/pushEvent/SessionTrace -- shadow-only by construction", () => {
  const source = fs.readFileSync(__filename.replace(/\.test\.ts$/, ".ts"), "utf8");
  assert.doesNotMatch(source, /onInteraction|pushEvent|SessionTrace/);
});
