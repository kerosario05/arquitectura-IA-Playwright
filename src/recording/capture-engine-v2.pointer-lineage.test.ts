import assert from "node:assert/strict";
import test from "node:test";
import { CaptureEngineV2ShadowBridge } from "./capture-engine-v2.shadow-bridge";
import type { CaptureOwnerCandidate } from "./capture-engine-v2.types";
import { buildCanonicalInteractions } from "./canonical-recording-contract";
import type { RecordedEvent } from "./session-trace.types";

const doc = { captureInstanceId: "instance-1", documentId: "doc-A" };
function button(): CaptureOwnerCandidate {
  return { tag: "button", role: "button", editable: false, actionable: true, trustedClick: true, pathDepth: 0 };
}

test("trusted pointer observation preserves owner identity and the same interaction lineage as its tap", () => {
  const pointers: Array<{ seq: number; action: any }> = [];
  const clicks: Array<{ seq: number; action: any }> = [];
  const bridge = new CaptureEngineV2ShadowBridge(undefined, (record) => clicks.push(record), undefined, (record) => pointers.push(record));
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({ type: "pointer", ...doc, trusted: true, interactionId: "pointer-1", composedPath: [button()] });
  bridge.handleMessage({ type: "click", ...doc, interactionId: "pointer-1", composedPath: [button()] });

  assert.equal(pointers.length, 1);
  assert.equal(pointers[0].action.actionType, "observation");
  assert.equal(pointers[0].action.observationType, "pointer");
  assert.equal(pointers[0].action.interactionId, "pointer-1");
  assert.equal(clicks.length, 1);
  assert.equal(clicks[0].action.interactionId, pointers[0].action.interactionId);
  assert.equal(pointers[0].action.owner?.role, clicks[0].action.owner?.role);
});

test("canonical integration uses the transported pointer anchor before a navigation", () => {
  const events: RecordedEvent[] = [
    { seq: 0, t: 10, kind: "note", observationType: "pointer", interactionId: "pointer-1", screenKey: "home", url: "/", target: { label: "Action", role: "button", locators: [] } },
    { seq: 1, t: 11, kind: "tap", interactionId: "pointer-1", screenKey: "home", url: "/", target: { label: "Action", role: "button", locators: [] } },
    { seq: 2, t: 12, kind: "navigate", screenKey: "home", url: "/next", toScreenKey: "next" },
  ];
  const interactions = buildCanonicalInteractions(events);
  const action = interactions.find((item) => item.action === "click");
  assert.equal(action?.routeAfter, "/next");
  assert.equal(action?.causedTransition, true);
});

test("legacy pointer-less traces remain fail-closed and are not reconstructed from positions", () => {
  const events: RecordedEvent[] = [
    { seq: 1, t: 11, kind: "tap", screenKey: "home", url: "/", target: { label: "Action", role: "button", locators: [] } },
    { seq: 2, t: 12, kind: "navigate", screenKey: "home", url: "/", toScreenKey: "next" },
  ];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions.some((item) => item.action === "click"), true);
  assert.equal((events[0] as any).x, undefined);
});
