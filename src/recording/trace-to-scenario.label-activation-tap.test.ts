import test from "node:test";
import assert from "node:assert/strict";
import { projectNativeSelectionOpeningTaps } from "./trace-to-scenario";

const tap = (t: number, target: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ t, kind: "tap", pageKey: "tab-2", target, ...extra }) as never;
const interaction = (ref: string) =>
  ({ action: "click", sourceEventRefs: [ref], technicalOnly: undefined, executionAuthority: undefined }) as never;
type Projected = { technicalOnly?: boolean; executionAuthority?: boolean };

test("label tap followed by the labelled radio click keeps only the label tap as authority", () => {
  const events = [
    tap(100, { label: "No", tag: "label" }, { interactionId: "pointer-3" }),
    tap(700, { label: "No", tag: "input", role: "radio" }),
  ];
  const [label, control] = projectNativeSelectionOpeningTaps(events, [interaction("event-1"), interaction("event-2")]) as Projected[];
  assert.equal(label.technicalOnly, undefined);
  assert.equal(control.technicalOnly, true);
  assert.equal(control.executionAuthority, false);
});

test("a different control name or a late click is left untouched", () => {
  const different = [tap(100, { label: "No", tag: "label" }), tap(300, { label: "Sí", tag: "input", role: "radio" })];
  const late = [tap(100, { label: "No", tag: "label" }), tap(5000, { label: "No", tag: "input", role: "radio" })];
  for (const events of [different, late]) {
    const [, control] = projectNativeSelectionOpeningTaps(events, [interaction("event-1"), interaction("event-2")]) as Projected[];
    assert.equal(control.technicalOnly, undefined);
  }
});
