import assert from "node:assert/strict";
import test from "node:test";
import { isValueSelectionTap } from "./canonical-recording-contract";
import type { RecordedEvent } from "./session-trace.types";

const staticTap = (id: string) => ({
  kind: "tap",
  target: { label: "SOL-2026-0007", tag: "dd", locators: [], technicalTargetCandidates: [{ structuralContext: { stableDirectAttributes: { id } } }] },
}) as unknown as RecordedEvent;
const source = (id: string) => ({ kind: "value_source", target: { tag: "dd", attributes: { id }, locators: [{ strategy: "id", value: id }] } }) as unknown as RecordedEvent;

test("the click that selected a later-copied value is a selection gesture, not a replayable step", () => {
  assert.equal(isValueSelectionTap([staticTap("numero-solicitud"), source("numero-solicitud")], 0), true);
});

test("a click on a different element, or with no copy after it, stays a normal interaction", () => {
  assert.equal(isValueSelectionTap([staticTap("numero-solicitud"), source("otro")], 0), false);
  assert.equal(isValueSelectionTap([staticTap("numero-solicitud")], 0), false);
});
