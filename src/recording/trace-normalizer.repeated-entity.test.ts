import assert from "node:assert/strict";
import test from "node:test";
import { normalizeEvents } from "./trace-normalizer";
import type { RecordedEvent } from "./session-trace.types";

const route = "https://app.test/records/create";

function event(
  seq: number,
  kind: RecordedEvent["kind"],
  label: string,
  value?: string,
): RecordedEvent {
  return {
    seq,
    t: seq * 1_000,
    kind,
    screenKey: "record-form",
    url: route,
    ...(kind === "fill" ? { value } : {}),
    target: {
      label,
      associatedField: label === "Select record" ? "Record details" : label,
      role: kind === "fill" ? "input" : "button",
      tag: kind === "fill" ? "input" : "button",
      id: kind === "fill" ? `shared-${label}` : undefined,
      locators: [{ strategy: "role", value: `${kind}|${label}`, confidence: 0.95 }],
    },
  } as RecordedEvent;
}

test("separates repeated form edits after an observed add-another action", () => {
  const raw: RecordedEvent[] = [
    event(0, "tap", "Select record"),
    event(1, "fill", "Customer name", "First Customer"),
    event(2, "fill", "Email", "first@example.test"),
    event(3, "tap", "Add another"),
    event(4, "tap", "Select record"),
    event(5, "fill", "Customer name", "Second Customer"),
    event(6, "fill", "Email", "second@example.test"),
    event(7, "tap", "Validate"),
  ];

  const normalized = normalizeEvents(raw);
  const fills = normalized.filter((candidate) => candidate.kind === "fill");

  assert.deepEqual(fills.map((candidate) => [candidate.target?.entityScope, candidate.target?.associatedField, candidate.value]), [
    ["entity_1", "Customer name", "First Customer"],
    ["entity_1", "Email", "first@example.test"],
    ["entity_2", "Customer name", "Second Customer"],
    ["entity_2", "Email", "second@example.test"],
  ]);
});

test("does not infer repeated entities when the form fields are not repeated after the affordance", () => {
  const raw: RecordedEvent[] = [
    event(0, "fill", "Customer name", "First Customer"),
    event(1, "tap", "Add another"),
    event(2, "fill", "Different field", "Another value"),
  ];

  const normalized = normalizeEvents(raw);

  assert.equal(normalized.some((candidate) => Boolean(candidate.target?.entityScope)), false);
});
