import test from "node:test";
import assert from "node:assert/strict";
import { isDynamicObjectDisplayLabel } from "./canonical-recording-contract";
import type { RecordedTarget } from "./session-trace.types";

const card = (evidence: Record<string, unknown>): RecordedTarget => ({
  label: "PRESTAMO CONSUMO HUMANO",
  tag: "div",
  locators: [],
  playwrightRecorderEvidence: { kind: "text", normalizedName: "PRESTAMO CONSUMO HUMANO", targetTag: "span", runtimeResolutionRequired: true, ...evidence },
}) as unknown as RecordedTarget;

test("an all-capitals card title with plain text evidence still reads as a person-shaped dynamic label (unchanged)", () => {
  assert.equal(isDynamicObjectDisplayLabel(card({})), true);
});

test("a title the recorder promoted to tell sibling items apart is the chosen item's identity, not run data", () => {
  assert.equal(isDynamicObjectDisplayLabel(card({ promotedTitle: true })), false);
});
