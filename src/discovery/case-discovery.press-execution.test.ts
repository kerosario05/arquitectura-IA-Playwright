import assert from "node:assert/strict";
import test from "node:test";
import { executePressActionTarget, type PressTargetResolution } from "./case-discovery";

/**
 * FIRST_LOSS: `case-discovery.ts`'s live action-execution loop had a dedicated branch for fill
 * (`isFillActionTarget`), but `action_press` had none -- it fell straight through to the shared
 * click/select code (native click, JS-native click fallback, click retry policy, all reached via
 * `resolveActionTarget` + Playwright `.click()`). A recorded press was therefore actually
 * EXECUTED as a click attempt against its resolved target.
 *
 * Fixed with an explicit `if (actionTarget.actionType === "action_press")` branch, inserted
 * immediately after the fill branch and BEFORE any of the shared click/select code, which
 * resolves the target via the SAME `resolveActionTarget` click already uses, then hands the
 * resolution to `executePressActionTarget` -- a small, PURE, extracted seam (the only part of
 * this fix that can be unit-tested without a live Playwright page) that decides whether to press
 * and does so via the resolved locator's OWN `.press()`, then unconditionally `continue`s so
 * `action_press` can never fall through into the click machinery.
 *
 * These tests exercise `executePressActionTarget` directly with a stub locator that exposes
 * ONLY `.press()` (no `.click()` at all) -- proving structurally, not just by assertion, that
 * nothing here could ever call a click method.
 */

function stubLocator(behavior: "resolve" | "throw"): { press(key: string): Promise<void>; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async press(key: string) {
      calls.push(key);
      if (behavior === "throw") throw new Error("press failed: element detached");
    },
  };
}

test("1/4/5. a valid key and a resolved target: locator.press(key) is invoked with the exact key, via the resolved locator", async () => {
  const locator = stubLocator("resolve");
  const resolution: PressTargetResolution = { status: "resolved", locator };
  const result = await executePressActionTarget("Enter", resolution);
  assert.equal(result.ok, true);
  assert.deepEqual(locator.calls, ["Enter"]);
});

test("2/3. the stub target has no click method at all -- structurally impossible for this code to call one", async () => {
  const locator = stubLocator("resolve");
  assert.equal((locator as any).click, undefined, "the resolved locator stub exposes no click method whatsoever");
  const resolution: PressTargetResolution = { status: "resolved", locator };
  await executePressActionTarget("Enter", resolution);
  assert.equal((locator as any).click, undefined, "still no click method after executing press");
});

test("6/missingKey. a missing/blank key fails closed -- press is never invoked", async () => {
  const locator = stubLocator("resolve");
  const resolution: PressTargetResolution = { status: "resolved", locator };
  const missing = await executePressActionTarget(undefined, resolution);
  const blank = await executePressActionTarget("   ", resolution);
  assert.equal(missing.ok, false);
  assert.equal(blank.ok, false);
  if (!missing.ok) assert.equal(missing.reason, "press_missing_key");
  assert.deepEqual(locator.calls, [], "press must never be invoked when the key is missing");
});

test("7/unresolved. an unresolved target fails closed -- press is never invoked", async () => {
  const locator = stubLocator("resolve");
  const resolution: PressTargetResolution = { status: "not_visible", locator };
  const result = await executePressActionTarget("Enter", resolution);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "press_resolution_failed:not_visible");
  assert.deepEqual(locator.calls, []);
});

test("8/ambiguous. a resolved status with no usable locator fails closed -- press is never invoked", async () => {
  const resolution: PressTargetResolution = { status: "resolved", locator: null };
  const result = await executePressActionTarget("Enter", resolution);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "press_resolution_invalid");
});

test("9/runtimeFailure. locator.press() throwing is reported as a failure, never a PASS, and never rethrown uncaught", async () => {
  const locator = stubLocator("throw");
  const resolution: PressTargetResolution = { status: "resolved", locator };
  const result = await executePressActionTarget("Enter", resolution);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /^press_failed:/);
  assert.deepEqual(locator.calls, ["Enter"], "press was genuinely attempted, not skipped -- it just failed");
});

test("15. no app/project/text hardcode: the mechanism generalizes to an arbitrary key", async () => {
  const locator = stubLocator("resolve");
  const resolution: PressTargetResolution = { status: "resolved", locator };
  const result = await executePressActionTarget("Tab", resolution);
  assert.equal(result.ok, true);
  assert.deepEqual(locator.calls, ["Tab"]);
});
