import assert from "node:assert/strict";
import test from "node:test";
import { CaptureEngineV2ShadowBridge } from "./capture-engine-v2.shadow-bridge";
import type { CaptureOwnerCandidate } from "./capture-engine-v2.types";

/**
 * FIRST_LOSS (recordingId 524bab88-2038-42b7-bb9a-59255adaa311): a REAL user edit on a custom
 * `role=spinbutton` control never materialized. `EditingSessionManager` already accepts the
 * trusted-interaction evidence kinds (`keyboard_edit_intent`, `trusted_editable_interaction`,
 * `explicit_value_transition`) and already decides a change via value delta (`computeChanged`),
 * but the browser instrumentation only ever emitted evidence from native
 * `beforeinput/input/change/paste` events. A framework widget that mutates `.value` as a
 * consequence of a trusted keyboard/pointer interaction therefore left the session with zero
 * evidence -> `no_user_edit_evidence` -> no edit action. The fix emits a trusted-interaction
 * evidence (and the final value at blur) ONLY when the interaction was trusted and on the
 * session's own editable; the value-delta gate still decides, so focus/click/programmatic-only
 * changes never become edits.
 *
 * These tests drive the Node-side bridge with the exact message sequence the fixed browser
 * instrumentation now emits (no browser involved).
 */

const doc = { captureInstanceId: "instance-1", documentId: "doc-A" };

function editable(overrides: Partial<CaptureOwnerCandidate> = {}): CaptureOwnerCandidate {
  return { tag: "input", role: "spinbutton", editable: true, actionable: false, pathDepth: 0, ...overrides };
}

function openSession(bridge: CaptureEngineV2ShadowBridge, sessionId: string, initialLiteral: string, field?: string): void {
  bridge.handleMessage({
    type: "focus", ...doc, sessionId,
    composedPath: [editable(field ? { associatedField: field } : {})],
    identity: { label: field ?? "control", tagName: "input" },
    initialValue: { present: initialLiteral.length > 0, literal: initialLiteral },
  });
}

function trustedInteraction(bridge: CaptureEngineV2ShadowBridge, sessionId: string, literal: string): void {
  bridge.handleMessage({ type: "edit_evidence", sessionId, kind: "trusted_editable_interaction", valueState: { present: literal.length > 0, literal } });
}
function finalValue(bridge: CaptureEngineV2ShadowBridge, sessionId: string, literal: string): void {
  bridge.handleMessage({ type: "edit_evidence", sessionId, kind: "explicit_value_transition", valueState: { present: literal.length > 0, literal } });
}
function blur(bridge: CaptureEngineV2ShadowBridge, sessionId: string): void {
  bridge.handleMessage({ type: "blur", ...doc, sessionId });
}

test("1/nativeInputUnchanged. a normal native input evidence still yields exactly one edit action", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  openSession(bridge, "s", "");
  bridge.handleMessage({ type: "edit_evidence", sessionId: "s", kind: "input", valueState: { present: true, literal: "qauser" } });
  blur(bridge, "s");
  assert.equal(bridge.technicalActions.length, 1);
  assert.equal(bridge.technicalActions[0].action.actionType, "edit");
  assert.equal(bridge.technicalActions[0].action.value?.literal, "qauser");
});

test("2/customSpinbuttonValueDelta. no native input/change, but trusted interaction + value delta -> edit action", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  openSession(bridge, "s", "0", "Monto");
  trustedInteraction(bridge, "s", "0");
  finalValue(bridge, "s", "1500");
  blur(bridge, "s");
  assert.equal(bridge.technicalActions.length, 1);
  assert.equal(bridge.technicalActions[0].action.actionType, "edit");
  assert.equal(bridge.technicalActions[0].action.value?.literal, "1500");
  assert.equal(bridge.technicalActions[0].action.owner?.associatedField, "Monto");
});

test("3/focusBlurNoChange. focus + blur with no trusted interaction and no change -> no action", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  openSession(bridge, "s", "5");
  blur(bridge, "s");
  assert.equal(bridge.technicalActions.length, 0);
  assert.ok(bridge.shadowDiagnostics.some((d) => d.reason === "commit_no_user_edit_evidence"));
});

test("4/programmaticOnlyMutationRejected. focus + framework value change with NO trusted interaction -> no action", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  openSession(bridge, "s", "5");
  // The framework changed the value, but the user never interacted with this editable.
  blur(bridge, "s");
  assert.equal(bridge.technicalActions.length, 0, "a programmatic-only mutation is never a user edit");
});

test("5/sameValueRejected. trusted interaction but initial == final value -> no action", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  openSession(bridge, "s", "5");
  trustedInteraction(bridge, "s", "5");
  finalValue(bridge, "s", "5");
  blur(bridge, "s");
  assert.equal(bridge.technicalActions.length, 0);
});

test("6/noDuplicate. native evidence plus the value-delta fallback still yields exactly one action", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  openSession(bridge, "s", "0");
  bridge.handleMessage({ type: "edit_evidence", sessionId: "s", kind: "input", valueState: { present: true, literal: "1500" } });
  trustedInteraction(bridge, "s", "1500");
  finalValue(bridge, "s", "1500");
  blur(bridge, "s");
  assert.equal(bridge.technicalActions.length, 1, "never two actions for one physical edit");
});

test("7/twoFieldsSameRole. two spinbuttons with identical tag/role keep their distinct associatedField lineage", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  openSession(bridge, "a", "0", "Field A");
  trustedInteraction(bridge, "a", "0");
  finalValue(bridge, "a", "100");
  blur(bridge, "a");
  openSession(bridge, "b", "0", "Field B");
  trustedInteraction(bridge, "b", "0");
  finalValue(bridge, "b", "200");
  blur(bridge, "b");
  assert.equal(bridge.technicalActions.length, 2);
  const fields = bridge.technicalActions.map((record) => record.action.owner?.associatedField).sort();
  assert.deepEqual(fields, ["Field A", "Field B"]);
});

test("8/ambiguousFieldNoFabrication. an editable with no field relation still emits the edit without inventing an associatedField", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  openSession(bridge, "s", "0");
  trustedInteraction(bridge, "s", "0");
  finalValue(bridge, "s", "42");
  blur(bridge, "s");
  assert.equal(bridge.technicalActions.length, 1);
  assert.equal(bridge.technicalActions[0].action.owner?.associatedField, undefined, "no field relation -> never fabricated");
});

test("9/insideDialogStillCaptured. an editable reached from a deep composed path (inside a modal) is not discarded", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "focus", ...doc, sessionId: "s",
    composedPath: [editable({ pathDepth: 0 }), { tag: "div", role: "region", editable: false, actionable: false, pathDepth: 1 }, { tag: "div", role: "dialog", editable: false, actionable: false, pathDepth: 2 }],
    identity: { label: "Plazo", tagName: "input" },
    initialValue: { present: true, literal: "0" },
  });
  trustedInteraction(bridge, "s", "0");
  finalValue(bridge, "s", "12");
  blur(bridge, "s");
  assert.equal(bridge.technicalActions.length, 1, "a field inside a dialog/region is captured like any other editable");
  assert.equal(bridge.technicalActions[0].action.value?.literal, "12");
});

test("10/integrationTwoModalEdits. focus+edit A, focus+edit B, blur -> both edits present", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  openSession(bridge, "a", "0", "Field A");
  trustedInteraction(bridge, "a", "0");
  finalValue(bridge, "a", "100");
  blur(bridge, "a");
  openSession(bridge, "b", "0", "Field B");
  trustedInteraction(bridge, "b", "0");
  finalValue(bridge, "b", "200");
  blur(bridge, "b");
  assert.equal(bridge.technicalActions.filter((record) => record.action.actionType === "edit").length, 2);
});

test("11/sensitiveNoLiteralLeak. a sensitive editable never exposes its literal, only presence + changed", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "focus", ...doc, sessionId: "s",
    composedPath: [editable({ role: "textbox" })],
    identity: { label: "Contraseña", tagName: "input" },
    initialValue: { present: false },
    sensitive: true,
  });
  bridge.handleMessage({ type: "edit_evidence", sessionId: "s", kind: "trusted_editable_interaction", valueState: { present: true, changed: true } });
  blur(bridge, "s");
  assert.equal(bridge.technicalActions.length, 1);
  assert.equal(bridge.technicalActions[0].action.value?.literal, undefined, "no literal for a sensitive field");
  assert.equal(bridge.technicalActions[0].action.value?.present, true);
});
