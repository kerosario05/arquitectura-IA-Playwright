import assert from "node:assert/strict";
import test from "node:test";
import { isNonActionableContainerTap, isPassiveTextTapTarget } from "./trace-normalizer";
import { buildCanonicalInteractions } from "./canonical-recording-contract";
import type { RecordedEvent } from "./session-trace.types";

// Shape of a real clickable number inside a grid: a role-less span whose only locator is the grid's own id.
function spanTap(copySelectionGesture?: boolean): RecordedEvent {
  return {
    seq: 1, t: 10, kind: "tap", screenKey: "inbox", pageKey: "tab-2", interactionId: "pointer-2",
    url: "https://app.example/",
    target: {
      label: "CASE-100", tag: "span",
      locators: [{ strategy: "id", value: "inbox-grid", confidence: 0.55 }],
      playwrightRecorderEvidence: { kind: "text", normalizedName: "CASE-100", targetTag: "span", scopeIdentity: { strategy: "id", value: "inbox-grid" }, runtimeResolutionRequired: true },
      ...(copySelectionGesture === undefined ? {} : { copySelectionGesture }),
    },
  } as unknown as RecordedEvent;
}

test("passive text tap: a lone click is kept, a selection gesture and older recordings keep the previous rule", () => {
  assert.equal(isPassiveTextTapTarget(spanTap().target), true);
  assert.equal(isNonActionableContainerTap(spanTap(false)), false, "lone click is an action");
  assert.equal(isNonActionableContainerTap(spanTap(true)), true, "repeated clicks / copy are a selection");
  assert.equal(isNonActionableContainerTap(spanTap()), true, "no marker: previous behaviour");
});

test("passive text tap: a role or a non-passive tag is never treated as passive", () => {
  assert.equal(isPassiveTextTapTarget({ tag: "span", role: "button" }), false);
  assert.equal(isPassiveTextTapTarget({ tag: "button" }), false);
});

test("canonical contract: a lone click on grid text becomes an interaction, a selection gesture does not", () => {
  const kept = buildCanonicalInteractions([spanTap(false)]);
  const dropped = buildCanonicalInteractions([spanTap(true)]);
  assert.ok(kept.some((interaction) => interaction.action === "click"), "lone click is replayable");
  assert.equal(dropped.some((interaction) => interaction.action === "click"), false);
});

test("block tap: a role-less div is a selection only when a gesture was seen and it has no action owner", () => {
  const block = (extra: Record<string, unknown>): RecordedEvent => ({
    seq: 1, t: 10, kind: "tap", screenKey: "card", pageKey: "tab-1", url: "https://app.example/",
    target: { label: "Header text", tag: "div", locators: [{ strategy: "css", value: "div:has(div)", confidence: 0.5 }], ...extra },
  } as unknown as RecordedEvent);
  assert.equal(isNonActionableContainerTap(block({ copySelectionGesture: true })), true);
  assert.equal(isNonActionableContainerTap(block({})), false, "no marker: previous behaviour");
  assert.equal(isNonActionableContainerTap(block({ copySelectionGesture: true, actionability: "FRAMEWORK_ACTIONABLE" })), false);
  assert.equal(isNonActionableContainerTap(block({ copySelectionGesture: true, role: "button" })), false);
});
