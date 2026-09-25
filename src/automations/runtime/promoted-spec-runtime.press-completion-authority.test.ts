import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * FIRST_LOSS fix (jobId e9a6c64b-2da2-4643-a855-6ea29e09a916): waitForPromotedPressTransition's
 * completionProbe previously treated ANY observable DOM mutation (routeChanged ||
 * domTransitionObserved || targetDisappeared) as authoritative "press completed" whenever
 * targetIdentity carried neither expectedRouteTransition nor expectedInPlaceTransition -- a
 * transient, non-navigational change (spinner, disabled-state toggle, blur) satisfied it long
 * before a real async navigation actually finished. Fixed by branching on whether an explicit
 * expectation exists: explicit expectations keep their own outcome-specific completionProbe
 * (completion authority, unchanged); with no explicit expectation, the call falls through to the
 * shared wait's own generic/adaptive stability check with NO completionProbe passed at all -- the
 * same "bare call" shape already used elsewhere (execution-plan-executor.ts's own post-navigate/
 * post-press stabilization), so a bare DOM mutation can never be treated as authoritative there.
 *
 * Structural/static verification, matching this exact function's own established test
 * convention (see test 7 in promoted-spec-runtime.press-dispatch.test.ts) -- no browser, no
 * Playwright Page fake needed for a class this deeply coupled to live page state.
 */

const source = fs.readFileSync(path.resolve(__dirname, "promoted-spec-runtime.ts"), "utf8");

function extractFunction(name: string, nextMarker: string): string {
  const start = source.indexOf(name);
  assert.ok(start !== -1, `${name} must exist in promoted-spec-runtime.ts`);
  const end = source.indexOf(nextMarker, start);
  assert.ok(end !== -1, `boundary marker "${nextMarker}" must exist after ${name}`);
  return source.slice(start, end);
}

const fn = extractFunction(
  "private async waitForPromotedPressTransition(",
  "\n  private async postActionStability(",
);

test("1/explicit route expectation: completionProbe is still provided, and routeChanged alone satisfies it (not a bare DOM mutation)", () => {
  assert.match(
    fn,
    /hasExplicitExpectation\s*\?\s*await waitForStableInteractiveScreen\(this\.page,\s*\{\s*completionProbe:/,
    "an explicit expectation must still route through a dedicated completionProbe",
  );
  assert.match(
    fn,
    /outcomeObserved = targetIdentity!\.expectedRouteTransition === true \? routeChanged : domTransitionObserved;/,
    "for an explicit expectation, expectedRouteTransition must select routeChanged as the sole authority (never OR'd with a bare DOM mutation)",
  );
});

test("2/explicit in-place expectation: the same completionProbe branch selects domTransitionObserved as authority when expectedRouteTransition is not set", () => {
  // Same source line as test 1 -- expectedRouteTransition===true selects routeChanged, the ternary's
  // else branch (domTransitionObserved) is what an expectedInPlaceTransition=true case receives.
  assert.match(fn, /: domTransitionObserved;/, "the in-place branch must use domTransitionObserved, not a broader OR condition");
});

test("3/no explicit expectation: falls to the shared wait's bare/generic call, no completionProbe passed, no domTransitionObserved-as-authority fallback", () => {
  assert.match(
    fn,
    /:\s*await waitForStableInteractiveScreen\(this\.page\);/,
    "the no-explicit-expectation branch must call waitForStableInteractiveScreen with no options (generic/adaptive mode)",
  );
  assert.doesNotMatch(
    fn,
    /routeChanged \|\| domTransitionObserved \|\| targetDisappeared/,
    "the old generic OR-of-any-DOM-change completion condition must be gone",
  );
  assert.doesNotMatch(
    fn,
    /const targetDisappeared/,
    "targetDisappeared must no longer be computed/used as a completion signal in this function's code (a historical mention in an explanatory comment is fine)",
  );
});

test("4/regression: waitForStableInteractiveScreen remains awaited in both branches before pressPromotedTarget can return", () => {
  assert.match(fn, /const stability = hasExplicitExpectation\s*\?\s*await waitForStableInteractiveScreen/);
  assert.match(fn, /if \(stability\.stable\) return;/, "the generic branch must still gate its own return on stability.stable");
  assert.match(fn, /if \(stability\.stable && outcomeObserved\) return;/, "the explicit branch must still gate its own return on both stability and outcomeObserved");
});

test("5/pressPromotedTarget still calls the (now branching) shared transition wait, never bypassing it", () => {
  const pressFn = extractFunction(
    "async pressPromotedTarget(options: PromotedPressOptions)",
    "\n  async selectPromotedItem(",
  );
  assert.match(pressFn, /this\.waitForPromotedPressTransition\(/);
});

test("6/genericUiChangeObservesControlValueMutationWithoutSerializingTheValue", () => {
  const snapshotFn = extractFunction("async function capturePromotedActionSurfaceSnapshot(", "\nexport type PromotedRuntimeConfig");
  assert.match(snapshotFn, /input, textarea, select, \[contenteditable=true\]/);
  assert.match(snapshotFn, /valueFingerprint=\$\{fingerprintValue\(value\)\}/);
  assert.match(snapshotFn, /value\.length/);
  assert.doesNotMatch(snapshotFn, /console\.log\([^\n]*value/);
  assert.doesNotMatch(snapshotFn, /JSON\.stringify\(value\)/);
});
