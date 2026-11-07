import assert from "node:assert/strict";
import test from "node:test";
import { normalizeEvents } from "./trace-normalizer";
import type { RecordedEvent } from "./session-trace.types";

const input = (label: string) => ({
  label, tag: "input", role: "textbox",
  locators: [{ strategy: "css" as const, value: `#${label}`, confidence: 1 }],
});

test("a copy-paste link follows its source when the normalizer drops events above it", () => {
  const raw = [
    // focus tap on the field about to be typed in: dropped by normalization
    { seq: 0, t: 0, kind: "tap", screenKey: "s", pageKey: "tab-1", target: input("first") },
    { seq: 1, t: 50, kind: "fill", screenKey: "s", pageKey: "tab-1", value: "abc", target: input("first") },
    { seq: 2, t: 100, kind: "value_source", screenKey: "s", pageKey: "tab-1", target: input("source"), valueSelection: { sourceKind: "input", startOffset: 0, endOffset: 3, endAtSourceEnd: true } },
    { seq: 3, t: 150, kind: "fill", screenKey: "s", pageKey: "tab-2", valueSource: "application", dependsOnEventRef: "event-3", target: input("search") },
  ] as unknown as RecordedEvent[];

  const normalized = normalizeEvents(raw);
  const sourceIndex = normalized.findIndex((event) => event.kind === "value_source");
  const paste = normalized.find((event) => event.kind === "fill" && event.valueSource === "application");
  assert.ok(sourceIndex >= 0 && paste, "source and paste must survive normalization");
  assert.ok(sourceIndex < 2, "an event above the source must have been dropped for this test to be meaningful");
  assert.equal(paste.dependsOnEventRef, `event-${sourceIndex + 1}`);
});
