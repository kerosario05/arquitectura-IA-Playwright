import assert from "node:assert/strict";
import test from "node:test";
import { pressCompatibilityCheck } from "./target-resolver";

/**
 * FIRST_LOSS: `resolveActionTargetCore` resolved the recorded technical target for a `press`
 * action just fine (`recordedIdentityMatched=true`, `matchCount=1`) but then rejected it as
 * `recorded_target_structural_incompatibility` because `resolveRecordedTechnicalTarget`'s
 * fallback locator-match branch set `structuralCompatibility` from a CLICK-era proxy --
 * whether the RECORDED METADATA happened to carry `structuralContext`/`stableAttributes` -- a
 * signal that has nothing to do with whether `locator.press(key)` is valid against the exact,
 * unique, visible, enabled element that was actually found. A textbox recorded via a simple
 * locator (no structural metadata needed for `fill`, which never checked this flag) always
 * failed press this way, even though `mode === "action"` already bypassed the FILL-specific
 * editability check for both click and press alike -- press was never given its own semantic
 * check the way fill has one.
 *
 * Fixed by giving press its OWN compatibility check (`pressCompatibilityCheck`, this file),
 * threaded through via a new `actionIntent: "press"` parameter on `resolveRecordedTechnicalTarget`
 * -- click behavior (an untouched code path when `actionIntent` is not `"press"`) is completely
 * unchanged. `Locator.evaluate` serializes this exact function's source to run in-page, so it is
 * tested directly here against plain DOM-shaped fakes, per this session's "no browser" convention
 * for this ~4000-line resolver (matching the disclosed gap in
 * `case-discovery.press-technical-target-lineage.test.ts`).
 */

function fakeElement(overrides: {
  tagName?: string;
  attributes?: Record<string, string>;
  disabled?: boolean;
  readOnly?: boolean;
  tabIndex?: number;
}): Element {
  const attributes = overrides.attributes ?? {};
  return {
    tagName: overrides.tagName ?? "DIV",
    disabled: overrides.disabled,
    readOnly: overrides.readOnly,
    tabIndex: overrides.tabIndex ?? -1,
    getAttribute: (name: string) => attributes[name] ?? null,
  } as unknown as Element;
}

test("1/textboxEnter + 2/compatibility. a recorded <input> textbox is press-compatible", () => {
  assert.equal(pressCompatibilityCheck(fakeElement({ tagName: "INPUT" })), true);
});

test("editable input/textarea/select tags are all press-compatible", () => {
  assert.equal(pressCompatibilityCheck(fakeElement({ tagName: "TEXTAREA" })), true);
  assert.equal(pressCompatibilityCheck(fakeElement({ tagName: "SELECT" })), true);
});

test("a contenteditable owner is press-compatible", () => {
  assert.equal(pressCompatibilityCheck(fakeElement({ tagName: "DIV", attributes: { contenteditable: "true" } })), true);
});

test("role-based keyboard-input owners (textbox/searchbox/spinbutton/combobox) are press-compatible", () => {
  for (const role of ["textbox", "searchbox", "spinbutton", "combobox"]) {
    assert.equal(pressCompatibilityCheck(fakeElement({ tagName: "DIV", attributes: { role } })), true, `role=${role}`);
  }
});

test("5/buttonPress. a <button> (or role=button) is press-compatible when actually focusable/interactive", () => {
  assert.equal(pressCompatibilityCheck(fakeElement({ tagName: "BUTTON" })), true);
  assert.equal(pressCompatibilityCheck(fakeElement({ tagName: "DIV", attributes: { role: "button" } })), true);
});

test("an explicitly focusable generic element (tabIndex >= 0) is press-compatible", () => {
  assert.equal(pressCompatibilityCheck(fakeElement({ tagName: "DIV", tabIndex: 0 })), true);
});

test("9/static. a static div/span with no role, no tabIndex, no contenteditable is NOT press-compatible", () => {
  assert.equal(pressCompatibilityCheck(fakeElement({ tagName: "DIV" })), false);
  assert.equal(pressCompatibilityCheck(fakeElement({ tagName: "SPAN" })), false);
});

test("8/disabled. a disabled input is NOT press-compatible", () => {
  assert.equal(pressCompatibilityCheck(fakeElement({ tagName: "INPUT", disabled: true })), false);
  assert.equal(pressCompatibilityCheck(fakeElement({ tagName: "INPUT", attributes: { "aria-disabled": "true" } })), false);
});

test("3/clickSeparation invariant documented here: readOnly does NOT block press (unlike the fill-only check), since Enter on a focused readonly field is a legitimate recorded action", () => {
  assert.equal(pressCompatibilityCheck(fakeElement({ tagName: "INPUT", readOnly: true })), true);
});

test("15/multiproject. no app/project/field hardcode -- the check is purely structural/semantic", () => {
  for (const tag of ["INPUT", "TEXTAREA"]) {
    assert.equal(pressCompatibilityCheck(fakeElement({ tagName: tag })), true, tag);
  }
});
