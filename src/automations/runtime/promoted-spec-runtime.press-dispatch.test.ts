import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pressPromotedLocatorWithBoundedReresolution, PROMOTED_SPEC_RUNTIME_PUBLIC_METHODS } from "./promoted-spec-runtime";

/**
 * FIRST_LOSS (jobId 210649bd-ee18-4259-9ed7-b5af2f90d873): no runtime API existed for a target-
 * scoped keyboard press at all. A candidate given `operation=press` (contract) had no matching
 * wrapper and substituted `clickPromotedTarget`, clicking a locator built from the KEY text
 * ("Enter") instead of pressing that key on the recorded textbox target. Fixed by adding
 * `pressPromotedTarget`/`pressPromotedLocatorWithBoundedReresolution` -- a structural twin of the
 * existing click dispatch helper, dispatching `resolvedTarget.press(key)` exclusively.
 */

test("1/pressDispatched. the resolved locator's own .press(key) is called, never .click()", async () => {
  const calls: string[] = [];
  const locator = {
    press: async (key: string) => { calls.push(`press:${key}`); },
    click: async () => { calls.push("click"); },
  };
  await pressPromotedLocatorWithBoundedReresolution({ locator }, async () => undefined, 5000, "Enter");
  assert.deepEqual(calls, ["press:Enter"]);
});

test("2/reResolutionOnRetryableFailure. a retryable native-press error re-resolves and retries press on the fresh locator, never click", async () => {
  const calls: string[] = [];
  const failingLocator = {
    press: async () => { throw new Error("element is not attached to the DOM"); },
  };
  const freshLocator = {
    press: async (key: string) => { calls.push(`press:${key}`); },
  };
  const result = await pressPromotedLocatorWithBoundedReresolution(
    { locator: failingLocator },
    async () => ({ locator: freshLocator }),
    5000,
    "Enter",
  );
  assert.deepEqual(calls, ["press:Enter"]);
  assert.equal(result.reResolved, true);
});

test("3/nonRetryableFailurePropagates. a non-retryable failure is never swallowed or silently converted to a click", async () => {
  const locator = {
    press: async () => { throw new Error("strict mode violation: locator resolved to 3 elements"); },
  };
  await assert.rejects(
    () => pressPromotedLocatorWithBoundedReresolution({ locator }, async () => undefined, 5000, "Enter"),
  );
});

test("4/publicApiExposesPress. pressPromotedTarget is part of the public promoted-runtime API surface (the AI-facing allowlist)", () => {
  assert.ok((PROMOTED_SPEC_RUNTIME_PUBLIC_METHODS as readonly string[]).includes("pressPromotedTarget"));
});

test("5/methodDispatchesPressNotClick. the pressPromotedTarget class method calls the press helper, not clickPromotedLocatorWithBoundedReresolution", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "promoted-spec-runtime.ts"), "utf8");
  const start = source.indexOf("async pressPromotedTarget(options: PromotedPressOptions)");
  assert.ok(start >= 0, "expected pressPromotedTarget to be defined");
  const end = source.indexOf("\n  async selectPromotedItem(", start);
  const fn = source.slice(start, end);
  assert.match(fn, /pressPromotedLocatorWithBoundedReresolution\(/);
  assert.doesNotMatch(fn, /clickPromotedLocatorWithBoundedReresolution\(/);
  assert.doesNotMatch(fn, /\.locator\.click\(/);
});

test("6/noKeyboardFallbackOrPosition. the press method never uses page.keyboard, positional selectors, or a fixed sleep", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "promoted-spec-runtime.ts"), "utf8");
  const start = source.indexOf("async pressPromotedTarget(options: PromotedPressOptions)");
  const end = source.indexOf("\n  async selectPromotedItem(", start);
  const fn = source.slice(start, end);
  assert.doesNotMatch(fn, /page\.keyboard/);
  assert.doesNotMatch(fn, /\.nth\(|\.first\(\)|\.last\(\)/);
  assert.doesNotMatch(fn, /waitForTimeout\(\s*\d/);
});

test("7/sharedAdaptivePostPressWait. pressPromotedTarget uses the shared adaptive post-press wait and keeps a fail-closed outcome probe", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "promoted-spec-runtime.ts"), "utf8");
  const start = source.indexOf("async pressPromotedTarget(options: PromotedPressOptions)");
  const end = source.indexOf("\n  async selectPromotedItem(", start);
  const fn = source.slice(start, end);
  assert.match(fn, /this\.waitForPromotedPressTransition\(/);
  assert.doesNotMatch(fn, /this\.postActionStability\(/);
  assert.match(source, /waitForStableInteractiveScreen\(this\.page, \{[\s\S]*completionProbe:/);
  assert.match(source, /no_observable_post_action_outcome/);
});

test("8/clickStabilizationUnchanged. clickPromotedTarget retains its existing postActionStability path", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "promoted-spec-runtime.ts"), "utf8");
  const start = source.indexOf("async clickPromotedTarget(options: PromotedClickOptions)");
  const end = source.indexOf("\n  async fillPromotedField(", start);
  const fn = source.slice(start, end);
  assert.match(fn, /this\.postActionStability\(/);
  assert.doesNotMatch(fn, /waitForPromotedPressTransition/);
});
