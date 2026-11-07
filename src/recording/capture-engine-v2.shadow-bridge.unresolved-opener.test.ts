import assert from "node:assert/strict";
import test from "node:test";
import { CaptureEngineV2ShadowBridge } from "./capture-engine-v2.shadow-bridge";
import type { CaptureOwnerCandidate } from "./capture-engine-v2.types";

const doc = { captureInstanceId: "instance-1", documentId: "doc-A" };
const node = (overrides: Partial<CaptureOwnerCandidate> & Pick<CaptureOwnerCandidate, "tag" | "pathDepth">): CaptureOwnerCandidate =>
  ({ editable: false, actionable: false, ...overrides });

// The arrow icon of a custom dropdown: no role, not actionable, wrapper divs already tied to a named field.
const arrowIconPath = (field: string | undefined): CaptureOwnerCandidate[] => [
  node({ tag: "i", pathDepth: 0 }),
  node({ tag: "div", pathDepth: 1 }),
  node({ tag: "div", pathDepth: 2, ...(field ? { associatedField: field } : {}) }),
  node({ tag: "div", pathDepth: 3, ...(field ? { associatedField: field } : {}) }),
];
const optionPath = [node({ tag: "li", role: "option", actionable: true, pathDepth: 0, accessibleName: "Aprobado", technicalRefs: ["id:opt-1"] })];

function bridgeWithIcon(field: string | undefined) {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({ type: "click", ...doc, interactionId: "pointer-1", composedPath: arrowIconPath(field) } as never);
  bridge.handleMessage({ type: "click", ...doc, interactionId: "pointer-2", composedPath: optionPath } as never);
  return bridge;
}

test("an ownerless dropdown arrow followed by an option projects a select owned by the wrapper's field", () => {
  const bridge = bridgeWithIcon("Resultado de la revisión");
  assert.equal(bridge.technicalActions.length, 2, "both physical clicks stay in the technical stream");
  assert.equal(bridge.functionalActions.length, 1);
  const select = bridge.functionalActions[0].action;
  assert.equal(select.functionalActionType, "select");
  assert.equal(select.owner?.associatedField, "Resultado de la revisión");
  assert.equal(select.selectionEvidence?.optionOwner?.accessibleName, "Aprobado");
  assert.equal(bridge.shadowDiagnostics.some((entry) => entry.reason === "selection_orphan_option"), false);
});

test("when no wrapper names a field the option stays an orphan, exactly as before", () => {
  const bridge = bridgeWithIcon(undefined);
  assert.equal(bridge.functionalActions.length, 0);
  assert.equal(bridge.shadowDiagnostics.some((entry) => entry.reason === "selection_orphan_option"), true);
});
