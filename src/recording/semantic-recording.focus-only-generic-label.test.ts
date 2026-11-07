import assert from "node:assert/strict";
import test from "node:test";
import { classifySemanticEvent } from "./semantic-recording";
import type { RecordedEvent } from "./session-trace.types";

const event = (kind: "tap" | "fill", label: string, role: string): RecordedEvent => ({
  t: 0, seq: 0, kind, screenKey: "s", fingerprint: "f", url: "http://x/", pageKey: "tab-1",
  target: { label, role, tag: kind === "fill" ? "input" : "div", locators: [] },
} as unknown as RecordedEvent);

test("an unnamed button before an unnamed fill is a real action", () => {
  assert.equal(classifySemanticEvent(event("tap", "control", "button"), event("fill", "control", "input")), "FUNCTIONAL_ACTION");
});

test("an unnamed non-button wrapper tap before an unnamed fill stays focus-only", () => {
  assert.equal(classifySemanticEvent(event("tap", "control", ""), event("fill", "control", "input")), "FOCUS_ONLY");
});
