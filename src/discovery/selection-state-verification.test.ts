import assert from "node:assert/strict";
import test from "node:test";
import { verifySelectionState, hasCausalSelectionTransition } from "./selection-state-verification";

test("check succeeds from checked state", () => {
  assert.deepEqual(verifySelectionState("check", { checked: false }, { checked: true }).matches, true);
});

test("uncheck rejects a checked control", () => {
  assert.equal(verifySelectionState("uncheck", { checked: true }, { checked: true }).matches, false);
});

test("select accepts a changed control value", () => {
  assert.equal(verifySelectionState("select", { value: "" }, { value: "USD" }).matches, true);
});

test("unobservable click is not treated as a state assertion", () => {
  assert.equal(verifySelectionState("click", {}, {}).observed, false);
});

/**
 * FIRST_LOSS (job a85d2d3b-e509-476b-9bf6-d3828a03cf5a, app kiosko, actionIndex=10,
 * target="Mobile"): a same-surface selection-like click with no network/route/DOM signal had no
 * completion evidence at all -- `interactiveStateAfter`/`verifySelectionState` were only ever
 * evaluated AFTER the shared wait already gave up (post-hoc failure diagnostics), so the wait
 * itself had zero visibility into the target's own state change. `hasCausalSelectionTransition`
 * is the STRICT causal check feeding the completion signal (unlike `verifySelectionState`, which
 * accepts `after=true` alone -- correct for post-hoc failure reporting, wrong for proving THIS
 * click caused anything).
 */

test("1/falseToTrueCompletes. checked false -> true is a causal transition", () => {
  assert.equal(hasCausalSelectionTransition({ checked: false }, { checked: true }), true);
});

test("2/falseToFalseBlocks. checked false -> false is not a causal transition", () => {
  assert.equal(hasCausalSelectionTransition({ checked: false }, { checked: false }), false);
});

test("3/alreadySelectedBlocks. checked true -> true is not causal -- already selected before this click, proves nothing about it", () => {
  assert.equal(hasCausalSelectionTransition({ checked: true }, { checked: true }), false);
});

test("4/ariaPressedFalseToTrue. the same causal rule applies to aria-pressed toggles, not just checked", () => {
  assert.equal(hasCausalSelectionTransition({ ariaPressed: "false" }, { ariaPressed: "true" }), true);
});

test("5/valueAppearingIsCausalUnlessAlreadySelected. a select's value going from empty to populated is causal, but not when the control was already in a selected boolean state", () => {
  assert.equal(hasCausalSelectionTransition({ value: "" }, { value: "USD" }), true);
  assert.equal(hasCausalSelectionTransition({ checked: true, value: "OLD" }, { checked: true, value: "NEW" }), false);
});

test("6/noAfterStateNeverCausal. missing after-state is never treated as a transition", () => {
  assert.equal(hasCausalSelectionTransition({ checked: false }, undefined), false);
});
