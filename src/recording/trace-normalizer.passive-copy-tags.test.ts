import assert from "node:assert/strict";
import test from "node:test";
import { isNonActionableContainerTap } from "./trace-normalizer";
import type { RecordedEvent } from "./session-trace.types";

const tap = (tag: string, extra: Record<string, unknown> = {}) => ({ kind: "tap", target: { label: "SOL-2026-0007", tag, locators: [], ...extra } }) as unknown as RecordedEvent;

test("a pointer on a definition-list value (the text a user selects to copy) is not a replayable click", () => {
  assert.equal(isNonActionableContainerTap(tap("dd")), true);
  assert.equal(isNonActionableContainerTap(tap("strong")), true);
});

test("the same tags stay actionable when capture proved an action owner", () => {
  assert.equal(isNonActionableContainerTap(tap("dd", { actionOwner: true })), false);
  assert.equal(isNonActionableContainerTap(tap("dd", { role: "button" })), false);
});
