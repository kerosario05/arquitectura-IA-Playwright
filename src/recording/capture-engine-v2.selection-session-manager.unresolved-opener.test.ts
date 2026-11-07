import assert from "node:assert/strict";
import test from "node:test";
import { SelectionSessionManager } from "./capture-engine-v2.selection-session-manager";
import type { CaptureOwner } from "./capture-engine-v2.types";

const docA = { captureInstanceId: "instance-1", documentId: "doc-A" };
const docB = { captureInstanceId: "instance-1", documentId: "doc-B" };
const option: CaptureOwner = { tag: "li", role: "option", technicalRefs: ["id:opt-1"], accessibleName: "Aprobado" };
const button: CaptureOwner = { tag: "button", role: "button", accessibleName: "Siguiente" };
const hint = { documentContext: docA, associatedField: "Resultado de la revisión", technicalActionSeq: 7 };

test("an ownerless opener inside a named field makes the next option a selection owned by that field", () => {
  const manager = new SelectionSessionManager();
  manager.noteUnresolvedClick(hint);
  const result = manager.observeTechnicalClick({ owner: option, documentContext: docA, technicalActionSeq: 8, selectedDisplay: "Aprobado" });
  assert.equal(result.outcome, "projected");
  if (result.outcome !== "projected") return;
  assert.equal(result.action.functionalActionType, "select");
  assert.equal(result.action.owner?.associatedField, "Resultado de la revisión");
  assert.deepEqual(result.action.sourceTechnicalActionSeqs, [7, 8]);
  assert.equal(result.action.owner?.technicalRefs, undefined, "no technical identity is invented for the owner");
});

test("without an unresolved opener an option stays an orphan, as before", () => {
  const manager = new SelectionSessionManager();
  assert.equal(manager.observeTechnicalClick({ owner: option, documentContext: docA, technicalActionSeq: 8 }).outcome, "orphan_option");
});

test("the hint only bridges to the very next click: another resolved click, a cancel or a newer ownerless click discards it", () => {
  const afterButton = new SelectionSessionManager();
  afterButton.noteUnresolvedClick(hint);
  afterButton.observeTechnicalClick({ owner: button, documentContext: docA, technicalActionSeq: 8 });
  assert.equal(afterButton.observeTechnicalClick({ owner: option, documentContext: docA, technicalActionSeq: 9 }).outcome, "orphan_option");

  const cancelled = new SelectionSessionManager();
  cancelled.noteUnresolvedClick(hint);
  cancelled.cancelSelectionSession();
  assert.equal(cancelled.observeTechnicalClick({ owner: option, documentContext: docA, technicalActionSeq: 8 }).outcome, "orphan_option");

  const replaced = new SelectionSessionManager();
  replaced.noteUnresolvedClick(hint);
  replaced.noteUnresolvedClick(null);
  assert.equal(replaced.observeTechnicalClick({ owner: option, documentContext: docA, technicalActionSeq: 8 }).outcome, "orphan_option");
});

test("a hint is never merged across documents and is used up by one projection", () => {
  const crossDocument = new SelectionSessionManager();
  crossDocument.noteUnresolvedClick(hint);
  assert.equal(crossDocument.observeTechnicalClick({ owner: option, documentContext: docB, technicalActionSeq: 8 }).outcome, "orphan_option");

  const once = new SelectionSessionManager();
  once.noteUnresolvedClick(hint);
  assert.equal(once.observeTechnicalClick({ owner: option, documentContext: docA, technicalActionSeq: 8 }).outcome, "projected");
  assert.equal(once.observeTechnicalClick({ owner: option, documentContext: docA, technicalActionSeq: 9 }).outcome, "orphan_option");
});
