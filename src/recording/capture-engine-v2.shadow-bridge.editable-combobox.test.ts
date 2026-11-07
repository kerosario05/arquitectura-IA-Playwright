import assert from "node:assert/strict";
import test from "node:test";
import { CaptureEngineV2ShadowBridge } from "./capture-engine-v2.shadow-bridge";
import type { CaptureOwnerCandidate } from "./capture-engine-v2.types";

const doc = { captureInstanceId: "instance-1", documentId: "doc-A" };
const node = (overrides: Partial<CaptureOwnerCandidate> & Pick<CaptureOwnerCandidate, "tag" | "pathDepth">): CaptureOwnerCandidate =>
  ({ editable: false, actionable: false, ...overrides });

// A framework dropdown rendered as an input: role=combobox, editable, named by its label.
const comboboxInput = [node({ tag: "input", role: "combobox", editable: true, actionable: true, pathDepth: 0, accessibleName: "Resultado de la revisión", technicalRefs: ["id:combo-1"] })];
const optionPath = [node({ tag: "li", role: "option", actionable: true, pathDepth: 0, accessibleName: "Aprobado", technicalRefs: ["id:opt-1"] })];

function ready() {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  return bridge;
}

test("an editable combobox that opens a list and is followed by an option projects a select owned by the combobox", () => {
  const bridge = ready();
  bridge.handleMessage({ type: "click", ...doc, interactionId: "pointer-1", composedPath: comboboxInput } as never);
  bridge.handleMessage({ type: "click", ...doc, interactionId: "pointer-2", composedPath: optionPath } as never);
  assert.equal(bridge.functionalActions.length, 1);
  const select = bridge.functionalActions[0].action;
  assert.equal(select.functionalActionType, "select");
  assert.equal(select.owner?.accessibleName, "Resultado de la revisión");
  assert.equal(select.selectionEvidence?.optionOwner?.accessibleName, "Aprobado");
  assert.equal(bridge.shadowDiagnostics.some((entry) => entry.reason === "selection_orphan_option"), false);
});

test("typing into the editable combobox is an edit: the list that follows is an autocomplete, not a selection", () => {
  const bridge = ready();
  bridge.handleMessage({ type: "click", ...doc, interactionId: "pointer-1", composedPath: comboboxInput } as never);
  bridge.handleMessage({
    type: "focus", ...doc, sessionId: "session-combo", composedPath: [node({ tag: "input", role: "combobox", editable: true, pathDepth: 0 })],
    identity: { label: "Resultado de la revisión", tagName: "input", domId: "combo-1" }, initialValue: { present: false },
  } as never);
  bridge.handleMessage({ type: "edit_evidence", sessionId: "session-combo", kind: "input", valueState: { present: true, literal: "Apro" } } as never);
  bridge.handleMessage({ type: "blur", ...doc, sessionId: "session-combo" } as never);
  bridge.handleMessage({ type: "click", ...doc, interactionId: "pointer-2", composedPath: optionPath } as never);
  assert.equal(bridge.functionalActions.length, 0, "no selection is projected after an edit");
  assert.equal(bridge.technicalActions.some((record) => record.action.actionType === "edit"), true);
});

test("an editable text input that is not a combobox never opens a selection session", () => {
  const bridge = ready();
  bridge.handleMessage({ type: "click", ...doc, interactionId: "pointer-1", composedPath: [node({ tag: "input", editable: true, actionable: true, pathDepth: 0, accessibleName: "Nombre" })] } as never);
  bridge.handleMessage({ type: "click", ...doc, interactionId: "pointer-2", composedPath: optionPath } as never);
  assert.equal(bridge.functionalActions.length, 0);
});
