import assert from "node:assert/strict";
import test from "node:test";
import { classifyClickFailure } from "./promoted-spec-runtime";

/**
 * scenarioStepIndex=4 (recording d8dbd8f9-b353-4175-b365-e5f8957bae36): the candidate's action
 * never confirmed success, but telemetry showed the page moved from
 * /product-subcategory?category=cards&subcategory=credit to / while the action was still
 * "pending" — proving withTimeout's Promise.race left the real Playwright action running after
 * giving up on it. A blanket "click_not_resolved" label would misreport that as "nothing
 * happened". These tests prove classifyClickFailure distinguishes what's actually knowable.
 */

test("BUG scenarioStepIndex=4 repro: a wrapper timeout with the URL having changed is ACTION_EFFECT_OBSERVED_CALLBACK_UNRESOLVED, never a bare 'not resolved'", () => {
  const result = classifyClickFailure({
    nativeClickAttempted: false,
    callbackAttempted: true,
    callbackError: "click callback timed out after 15000ms",
    urlChangedDuringAction: true,
  });
  assert.equal(result, "ACTION_EFFECT_OBSERVED_CALLBACK_UNRESOLVED");
});

test("a wrapper timeout with the URL unchanged is ACTION_CALLBACK_TIMEOUT", () => {
  const result = classifyClickFailure({
    nativeClickAttempted: false,
    callbackAttempted: true,
    callbackError: "click callback timed out after 15000ms",
    urlChangedDuringAction: false,
  });
  assert.equal(result, "ACTION_CALLBACK_TIMEOUT");
});

test("neither a native click nor a callback was ever attempted -> ACTION_NOT_DISPATCHED", () => {
  const result = classifyClickFailure({
    nativeClickAttempted: false,
    callbackAttempted: false,
    urlChangedDuringAction: false,
  });
  assert.equal(result, "ACTION_NOT_DISPATCHED");
});

test("a real thrown error from options.action() itself (not our wrapper's synthetic timeout) is ACTION_FAILED, never mistaken for a timeout", () => {
  const result = classifyClickFailure({
    nativeClickAttempted: false,
    callbackAttempted: true,
    callbackError: "strict mode violation: locator resolved to 3 elements",
    urlChangedDuringAction: false,
  });
  assert.equal(result, "ACTION_FAILED");
});

test("a native click attempt's own wrapper timeout is also recognized (not just the callback path)", () => {
  const result = classifyClickFailure({
    nativeClickAttempted: true,
    callbackAttempted: false,
    nativeClickError: "native click timed out after 15000ms",
    urlChangedDuringAction: false,
  });
  assert.equal(result, "ACTION_CALLBACK_TIMEOUT");
});
